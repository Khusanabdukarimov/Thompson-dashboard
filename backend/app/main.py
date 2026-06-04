import json
import logging
import os
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Optional

_log = logging.getLogger(__name__)

import uvicorn
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse
from pydantic import BaseModel

APP_DIR = Path(__file__).resolve().parent          # backend/app/
BACKEND_DIR = APP_DIR.parent                       # backend/

load_dotenv(BACKEND_DIR / ".env")

from datetime import date

from app.api.routes import payroll as payroll_routes
from app.api.routes import call_stats as call_stats_routes
from app.core import auth as auth_module
from app.db import init_db
from app.db_bx import init_bx_db, bx_engine
from sqlalchemy import text
from app.services import bitrix
from app.services import meta as meta_svc
from app.services.meta import MetaClient

app = FastAPI(openapi_url="/api/openapi.json", docs_url="/api/docs")

# Auth middleware (no-op unless AUTH_ENABLED=true env)
auth_module.install_auth_middleware(app)


@app.on_event("startup")
def _on_startup():
    init_db()
    init_bx_db()


app.include_router(payroll_routes.router)
app.include_router(auth_module.router)
app.include_router(call_stats_routes.router)


@app.get("/api/config")
def api_config():
    """Frontend bootstrap config — exposed safely to browser."""
    portal = bitrix.BITRIX24_PORTAL or ""
    # Strip trailing /rest/ to get base portal URL for UI links
    portal_base = portal.rstrip("/")
    if portal_base.endswith("/rest"):
        portal_base = portal_base[:-len("/rest")]
    return {
        "bitrix_portal": portal_base,
        "currency": {
            "primary": "UZS",
            "secondary": "USD",
        },
    }


# Legacy HTML root removed — React SPA at /var/www/mountain/frontend/app/dist
# is served by nginx. Backend is API-only.


class LeadCreate(BaseModel):
    date: Optional[str]
    employee_id: Optional[int]
    client: str
    source: Optional[str]
    amount: Optional[float] = 0.0
    status: Optional[str] = "NEW"
    deal_id: Optional[str]
    notes: Optional[str]


@app.get("/api/users")
def api_list_users():
    users = bitrix.list_users()
    return {"count": len(users), "users": users}


@app.post("/api/leads")
def api_create_lead(payload: LeadCreate):
    fields = {
        "TITLE": payload.client,
        "NAME": payload.client,
        "STATUS_ID": payload.status,
        "UF_CRM_1774413003006": payload.date,
    }
    if payload.employee_id:
        fields["ASSIGNED_BY_ID"] = payload.employee_id
    if payload.amount:
        # Bitrix expects MONEY fields often as custom fields on lead or as "OPPORTUNITY"
        fields["OPPORTUNITY"] = payload.amount
    if payload.notes:
        fields["COMMENTS"] = payload.notes

    res = bitrix.create_lead(fields)
    if not res:
        raise HTTPException(status_code=500, detail="Failed to create lead in Bitrix24")
    return {"result": res}


@app.get("/api/leads/{lead_id}")
def api_get_lead(lead_id: int):
    lead = bitrix.get_lead_details(lead_id)
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    return lead


# Removed: legacy demo /api/payroll/{emp_id} endpoint with hardcoded data.
# Use /api/payroll/calculate?bitrix_user_id=&year=&month= for real payroll
# (Bitrix won-deal revenue \u00d7 KPI tier + bonuses \u2212 penalties).


@app.get("/api/leads")
def api_leads(
    range: str = "all",
    responsible_id: Optional[int] = None,
    stage_id: Optional[str] = None,
    search: Optional[str] = None,
    page: int = 1,
    limit: int = 50,
):
    offset = (page - 1) * limit
    days = None if range == "all" else (1 if range == "today" else int(range))
    days_interval = f"{days} days" if days is not None else None
    search_param = f"%{search}%" if search else None
    
    query = text("""
        SELECT
            l.id, l.title, l.name, l.last_name,
            l.opportunity, l.currency,
            l.is_won, l.is_failed, l.is_processed,
            l.date_create, l.date_modify,
            s.name_uz        AS stage_name,
            s.bitrix_id      AS stage_bitrix_id,
            TRIM(r.name || ' ' || COALESCE(r.last_name, '')) AS responsible_name,
            (SELECT phone FROM lead_phones lp
             WHERE lp.lead_id = l.id LIMIT 1) AS primary_phone,
            COUNT(*) OVER()  AS total_count
        FROM leads l
        LEFT JOIN stages       s ON s.id = l.stage_id
        LEFT JOIN responsibles r ON r.id = l.responsible_id
        WHERE
            (:days_interval IS NULL OR l.date_create >= NOW() - CAST(:days_interval AS INTERVAL))
            AND (:responsible_id IS NULL OR l.responsible_id = :responsible_id)
            AND (:stage_id IS NULL OR s.bitrix_id = :stage_id)
            AND (l.source_id IS NULL OR (l.source_id NOT ILIKE '%amocrm%' AND l.source_id != 'UC_1WUFJB'))
            AND (:search IS NULL OR l.name ILIKE :search
                                 OR l.last_name ILIKE :search
                                 OR l.title ILIKE :search
                                 OR EXISTS (
                                     SELECT 1 FROM lead_phones lp
                                     WHERE lp.lead_id = l.id AND lp.phone ILIKE :search
                                 ))
        ORDER BY l.date_create DESC
        LIMIT :limit OFFSET :offset;
    """)
    with bx_engine.connect() as conn:
        res = conn.execute(query, {
            "days_interval": days_interval,
            "responsible_id": responsible_id,
            "stage_id": stage_id,
            "search": search_param,
            "limit": limit,
            "offset": offset
        }).mappings().all()
    
    count = res[0]["total_count"] if res else 0
    return {"count": count, "leads": [dict(r) for r in res], "offset": offset, "limit": limit}


@app.get("/api/users/timeman")
def api_users_timeman():
    users = bitrix.list_users()
    result = []
    for u in users:
        uid = u.get("ID")
        tm = None
        if uid:
            try:
                tm = bitrix.get_timeman_status(uid)
            except Exception:
                pass
        full_name = f"{u.get('NAME', '')} {u.get('LAST_NAME', '')}".strip()
        result.append({
            "id": uid,
            "name": full_name,
            "email": u.get("EMAIL", ""),
            "active": u.get("ACTIVE", True),
            "work_position": u.get("WORK_POSITION", ""),
            "timeman": tm,
        })
    return {"count": len(result), "users": result}


@app.get("/api/deals/aggregate")
def api_deals_aggregate(user_id: int, start_date: str, end_date: str, stage: Optional[str] = None):
    res = bitrix.aggregate_deals_sum_by_user(user_id, start_date, end_date, stage_filter=stage)
    return res


# /api/stats, /api/responsibles, /api/conversion, /api/filter-options
# removed — all dashboard data now served by Node.js /api/dashboard/lead-*


@app.get("/api/dashboard/amocrm-sources")
def api_amocrm_sources():
    """Return amoCRM sub-source list from a local JSON fallback file when DB is not available.

    This endpoint is intentionally DB-free so the frontend can fetch amoCRM "Manba" options
    even when PostgreSQL is not configured.
    """
    # Possible locations for the fallback file: repo_root/bitrix-sync/amocrm_sources.json
    try:
        repo_root = BACKEND_DIR.parent
        candidates = [repo_root / 'bitrix-sync' / 'amocrm_sources.json', BACKEND_DIR / 'amocrm_sources.json']
        for p in candidates:
            try:
                if p.exists():
                    txt = p.read_text(encoding='utf8')
                    arr = json.loads(txt)
                    if isinstance(arr, list):
                        return arr
            except Exception:
                continue
    except Exception:
        pass
    # Fallback to an empty list if nothing is available.
    return []


@app.get("/api/stats/deals")
def api_stats_deals(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    assigned_by: Optional[int] = None,
    stage_id: Optional[str] = None,
    source_id: Optional[str] = None,
):
    conditions = ["1=1"]
    params: dict = {}
    if start_date:
        conditions.append("d.date_create >= :start_date")
        params["start_date"] = start_date
    if end_date:
        conditions.append("d.date_create < :end_date ::date + INTERVAL '1 day'")
        params["end_date"] = end_date
    if assigned_by:
        conditions.append("d.responsible_id = :assigned_by")
        params["assigned_by"] = assigned_by
    if stage_id:
        conditions.append("s.bitrix_id = :stage_id")
        params["stage_id"] = stage_id
    if source_id:
        conditions.append("d.source_id = :source_id")
        params["source_id"] = source_id
    where = "WHERE " + " AND ".join(conditions)

    with bx_engine.connect() as conn:
        stats = conn.execute(text(f"""
            SELECT
                COUNT(d.id)                                                      AS total,
                COUNT(d.id) FILTER (WHERE s.is_won)                             AS won_count,
                COUNT(d.id) FILTER (WHERE s.is_final AND NOT s.is_won)          AS lost_count,
                COALESCE(SUM(d.opportunity) FILTER (WHERE s.is_won), 0)         AS total_won_revenue,
                ROUND(COUNT(d.id) FILTER (WHERE s.is_won)::NUMERIC
                    / NULLIF(COUNT(d.id), 0) * 100, 2)                          AS conversion_rate
            FROM deals d
            LEFT JOIN stages s ON s.id = d.stage_id
            {where}
        """), params).mappings().first()

        stage_rows = conn.execute(text(f"""
            SELECT s.bitrix_id, s.name, COUNT(d.id) AS cnt
            FROM deals d
            LEFT JOIN stages s ON s.id = d.stage_id
            {where}
            GROUP BY s.bitrix_id, s.name
        """), params).mappings().all()

        all_stage_rows = conn.execute(text(
            "SELECT bitrix_id, name FROM stages WHERE entity = 'deal' ORDER BY sort_order"
        )).mappings().all()

        user_rows = conn.execute(text(f"""
            SELECT
                r.id                                                            AS responsible_id,
                TRIM(r.name || ' ' || COALESCE(r.last_name, ''))               AS full_name,
                s.bitrix_id                                                     AS stage_bitrix_id,
                COUNT(d.id)                                                     AS cnt,
                COALESCE(SUM(d.opportunity) FILTER (WHERE s.is_won), 0)        AS won_revenue
            FROM deals d
            LEFT JOIN stages s ON s.id = d.stage_id
            LEFT JOIN responsibles r ON r.id = d.responsible_id
            {where}
            GROUP BY r.id, r.name, r.last_name, s.bitrix_id
        """), params).mappings().all()

    by_stage = {r["bitrix_id"]: r["cnt"] for r in stage_rows if r["bitrix_id"]}
    stage_names = {r["bitrix_id"]: r["name"] for r in all_stage_rows}
    all_stages = [r["bitrix_id"] for r in all_stage_rows]

    user_map: dict = {}
    for r in user_rows:
        uid = str(r["responsible_id"] or "unknown")
        if uid not in user_map:
            user_map[uid] = {
                "id": uid,
                "name": r["full_name"] or f"User {uid}",
                "total": 0,
                "won_revenue": 0.0,
                "by_stage": {},
            }
        stage = r["stage_bitrix_id"] or "UNKNOWN"
        user_map[uid]["by_stage"][stage] = int(r["cnt"])
        user_map[uid]["total"] += int(r["cnt"])
        user_map[uid]["won_revenue"] += float(r["won_revenue"] or 0)

    by_user = sorted(user_map.values(), key=lambda x: -x["total"])
    return {
        "total":             int(stats["total"] or 0),
        "won_count":         int(stats["won_count"] or 0),
        "lost_count":        int(stats["lost_count"] or 0),
        "total_won_revenue": float(stats["total_won_revenue"] or 0),
        "conversion_rate":   float(stats["conversion_rate"] or 0),
        "by_stage":          by_stage,
        "by_user":           by_user,
        "all_stages":        all_stages,
        "stage_names":       stage_names,
        "users":             [{"id": u["id"], "name": u["name"]} for u in by_user],
    }


@app.get("/api/stats/deals/by-source")
def api_stats_deals_by_source(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    assigned_by: Optional[int] = None,
    stage_id: Optional[str] = None,
    source_id: Optional[str] = None,
):
    conditions = ["1=1"]
    params: dict = {}
    if start_date:
        conditions.append("d.date_create >= :start_date")
        params["start_date"] = start_date
    if end_date:
        conditions.append("d.date_create < :end_date ::date + INTERVAL '1 day'")
        params["end_date"] = end_date
    if assigned_by:
        conditions.append("d.responsible_id = :assigned_by")
        params["assigned_by"] = assigned_by
    if stage_id:
        conditions.append("s.bitrix_id = :stage_id")
        params["stage_id"] = stage_id
    if source_id:
        conditions.append("d.source_id = :source_id")
        params["source_id"] = source_id
    where = "WHERE " + " AND ".join(conditions)

    with bx_engine.connect() as conn:
        rows = conn.execute(text(f"""
            SELECT
                COALESCE(d.source_id, 'Noma''lum')                             AS source_id,
                COUNT(d.id)                                                     AS total,
                COUNT(d.id) FILTER (WHERE NOT s.is_final)                      AS ishlaydi,
                COUNT(d.id) FILTER (WHERE s.is_final AND NOT s.is_won)         AS provodka,
                COUNT(d.id) FILTER (WHERE s.is_won)                            AS success,
                COALESCE(SUM(d.opportunity) FILTER (WHERE s.is_won), 0)        AS revenue
            FROM deals d
            LEFT JOIN stages s ON s.id = d.stage_id
            {where}
            GROUP BY d.source_id
            ORDER BY total DESC
        """), params).mappings().all()

    sources = []
    source_names = {}
    for r in rows:
        src = r["source_id"]
        total = int(r["total"] or 0)
        success = int(r["success"] or 0)
        sources.append({
            "id":         src,
            "label":      src,
            "ishlaydi":   int(r["ishlaydi"] or 0),
            "provodka":   int(r["provodka"] or 0),
            "success":    success,
            "revenue":    float(r["revenue"] or 0),
            "total":      total,
            "conversion": round(success / total * 100, 2) if total else 0,
        })
        source_names[src] = src

    return {"sources": sources, "source_names": source_names}


@app.get("/api/meta/campaign-forms")
def api_meta_campaign_forms(ad_account_id: Optional[str] = None):
    """Return all campaigns that use lead gen (Instant Form) objectives,
    each with the list of instant forms attached via their adsets."""
    account_id = ad_account_id or meta_svc.META_AD_ACCOUNT
    if not account_id:
        raise HTTPException(status_code=400, detail="ad_account_id is required")
    if not account_id.startswith("act_"):
        account_id = f"act_{account_id}"
    campaigns = meta_svc.get_campaign_leadgen_forms(account_id)
    return {"count": len(campaigns), "campaigns": campaigns}


@app.get("/api/meta/accounts")
def api_meta_accounts():
    return meta_svc.get_ad_accounts()


@app.get("/api/meta/insights")
def api_meta_insights(
    month: str,
    year: int,
    ad_account_id: Optional[str] = None,
):
    import calendar
    month_num = meta_svc.MONTH_NAMES.get(month.lower())
    if not month_num:
        raise HTTPException(status_code=400, detail=f"Unknown month: {month}")
    days_in_month = calendar.monthrange(year, month_num)[1]
    since = f"{year}-{month_num:02d}-01"
    until = f"{year}-{month_num:02d}-{days_in_month:02d}"

    account_id = ad_account_id or meta_svc.META_AD_ACCOUNT
    if not account_id:
        raise HTTPException(status_code=400, detail="ad_account_id is required")

    rows = meta_svc.get_campaign_insights(account_id, since, until)
    if isinstance(rows, dict) and "error" in rows:
        raise HTTPException(status_code=400, detail=rows["error"])

    data = meta_svc.insights_to_monthly(rows, month, year)
    return {"month": month, "year": year, "data": data}


@app.get("/api/meta/campaigns")
def api_meta_campaigns(month: str, year: int, ad_account_id: Optional[str] = None):
    """Per-ad × platform breakdown — feeds Kampaniyalar page table."""
    import calendar as _cal
    month_num = meta_svc.MONTH_NAMES.get(month.lower())
    if not month_num:
        raise HTTPException(status_code=400, detail=f"Unknown month: {month}")
    days_in_month = _cal.monthrange(year, month_num)[1]
    since = f"{year}-{month_num:02d}-01"
    until = f"{year}-{month_num:02d}-{days_in_month:02d}"

    account_id = ad_account_id or meta_svc.META_AD_ACCOUNT
    if not account_id:
        raise HTTPException(status_code=400, detail="ad_account_id is required")

    rows = meta_svc.get_ad_breakdown(account_id, since, until)
    if isinstance(rows, dict) and "error" in rows:
        raise HTTPException(status_code=400, detail=rows["error"])

    return {"month": month, "year": year, "rows": meta_svc.ads_to_table(rows)}


# ────────────────────────────────────────────────────────────────────
# Marketing daily breakdown (Bitrix-derived metrics for Kunlik hisobot)
# ────────────────────────────────────────────────────────────────────
import calendar as _calendar
from datetime import datetime as _dt

# UTM_SOURCE (lower) or SOURCE_ID (upper) → bucket.
# Add aliases here if Bitrix data uses other tags.
_UTM_TO_SOURCE = {
    "instagram": "instagram", "ig": "instagram", "instagram_ads": "instagram", "ig_ads": "instagram",
    "facebook": "target", "fb": "target", "meta": "target",
    "facebook_ads": "target", "fb_ads": "target", "target": "target", "target_ads": "target",
}
_SOURCE_ID_TO_BUCKET = {
    "INSTAGRAM": "instagram", "IG": "instagram",
    "FACEBOOK": "target", "FB": "target", "META": "target", "TARGET": "target",
}

# Lead statuses considered "qualified" — mirrors JARAYON_STATUSES in /api/stats/leads.
_QUALIFIED_LEAD_STATUSES = {
    "IN_PROCESS", "PROCESSED", "UC_1KPATX", "UC_Q2U9EL", "UC_KXC3ZW", "UC_L28G68", "CONVERTED",
}


def _classify_source(utm_source, source_id=None):
    bucket = _UTM_TO_SOURCE.get((utm_source or "").strip().lower())
    if bucket:
        return bucket
    return _SOURCE_ID_TO_BUCKET.get((source_id or "").strip().upper())


def _stage_is_won(stage_id):
    s = (stage_id or "").upper()
    return s == "WON" or s.endswith(":WON")


def _parse_bitrix_day(date_str, year: int, month_num: int):
    if not date_str:
        return None
    try:
        dt = _dt.fromisoformat(date_str.replace("Z", "+00:00"))
    except Exception:
        try:
            dt = _dt.strptime(date_str[:10], "%Y-%m-%d")
        except Exception:
            return None
    if dt.year != year or dt.month != month_num:
        return None
    return dt.day


@app.get("/api/marketing/bitrix-daily")
def api_marketing_bitrix_daily(month: str, year: int):
    """Daily breakdown of Bitrix-derived metrics for the Kunlik hisobot table.

    Per-day arrays (length = days in month) bucketed by source (UTM_SOURCE):
      - sales_sum, sales_count: WON deals by CLOSEDATE
      - deals:                  all deals created (DATE_CREATE)
      - qual_leads:             leads with qualifying STATUS_ID by DATE_CREATE
    """
    month_num = meta_svc.MONTH_NAMES.get(month.lower())
    if not month_num:
        raise HTTPException(status_code=400, detail=f"Unknown month: {month}")
    days_in_month = _calendar.monthrange(year, month_num)[1]
    since = f"{year}-{month_num:02d}-01"
    until = f"{year}-{month_num:02d}-{days_in_month:02d}T23:59:59"

    metrics = ("sales_sum", "sales_count", "qual_leads", "deals")
    result = {src: {m: [0] * days_in_month for m in metrics} for src in ("target", "instagram")}

    deals_closed = bitrix.list_deals(
        filter_dict={">=CLOSEDATE": since, "<=CLOSEDATE": until},
        select=["ID", "OPPORTUNITY", "CLOSEDATE", "STAGE_ID", "UTM_SOURCE", "SOURCE_ID"],
    )
    for d in deals_closed:
        src = _classify_source(d.get("UTM_SOURCE"), d.get("SOURCE_ID"))
        if src is None or not _stage_is_won(d.get("STAGE_ID")):
            continue
        day = _parse_bitrix_day(d.get("CLOSEDATE"), year, month_num)
        if day is None:
            continue
        try:
            opp = float(d.get("OPPORTUNITY") or 0)
        except Exception:
            opp = 0.0
        result[src]["sales_sum"][day - 1] += opp
        result[src]["sales_count"][day - 1] += 1

    deals_created = bitrix.list_deals(
        filter_dict={">=DATE_CREATE": since, "<=DATE_CREATE": until},
        select=["ID", "DATE_CREATE", "UTM_SOURCE", "SOURCE_ID"],
    )
    for d in deals_created:
        src = _classify_source(d.get("UTM_SOURCE"), d.get("SOURCE_ID"))
        if src is None:
            continue
        day = _parse_bitrix_day(d.get("DATE_CREATE"), year, month_num)
        if day is None:
            continue
        result[src]["deals"][day - 1] += 1

    leads = bitrix.list_leads(
        filter_dict={">=DATE_CREATE": since, "<=DATE_CREATE": until},
        select=["ID", "DATE_CREATE", "STATUS_ID", "UTM_SOURCE", "SOURCE_ID"],
    )
    for l in leads:
        src = _classify_source(l.get("UTM_SOURCE"), l.get("SOURCE_ID"))
        if src is None or l.get("STATUS_ID") not in _QUALIFIED_LEAD_STATUSES:
            continue
        day = _parse_bitrix_day(l.get("DATE_CREATE"), year, month_num)
        if day is None:
            continue
        result[src]["qual_leads"][day - 1] += 1

    return {"month": month, "year": year, "data": result}


@app.api_route("/install", methods=["GET", "POST", "HEAD"], response_class=HTMLResponse)
async def bitrix_install(_request: Request):
    """Bitrix24 calls this during app installation. Must respond with BX24.installFinish()."""
    return HTMLResponse(content=(
        "<!DOCTYPE html><html><head>"
        '<script src="https://api.bitrix24.com/api/v1/"></script>'
        "<script>BX24.init(function(){ BX24.installFinish(); });</script>"
        "</head><body></body></html>"
    ))


@app.post("/api/bitrix/handler", response_class=HTMLResponse)
async def bitrix_iframe_handler(request: Request):
    """Bitrix24 POSTs here when the app is opened from a CRM Lead/Deal card.
    Reads PLACEMENT_OPTIONS, fetches the client name, injects it into index.html."""
    form = await request.form()
    placement = str(form.get("PLACEMENT") or "")
    placement_options_raw = str(form.get("PLACEMENT_OPTIONS") or "")

    client_name = None
    try:
        opts = json.loads(placement_options_raw) if placement_options_raw else {}
        entity_id = opts.get("ID")
        if entity_id:
            if "LEAD" in placement:
                lead = bitrix.get_lead_details(int(entity_id))
                if lead:
                    parts = [lead.get("NAME") or "", lead.get("LAST_NAME") or ""]
                    client_name = " ".join(p for p in parts if p) or None
            elif "DEAL" in placement:
                deal = bitrix.get_deal_details(int(entity_id))
                if deal and deal.get("CONTACT_ID"):
                    contact = bitrix.get_contact_details(int(deal["CONTACT_ID"]))
                    if contact:
                        parts = [contact.get("NAME") or "", contact.get("LAST_NAME") or ""]
                        client_name = " ".join(p for p in parts if p) or None
    except Exception:
        pass  # Return app without pre-fill rather than erroring

    dist_index = Path("/var/www/mountain/frontend/app/dist/index.html")
    html = dist_index.read_text(encoding="utf-8")
    # Inject BX24 SDK + context + route before React mounts.
    # The SDK script must come first so BX24 is defined when the app bundle runs.
    script = (
        f'<script src="https://api.bitrix24.com/api/v1/"></script>'
        f'<script>'
        f'window.__BX_CLIENT__={json.dumps({"clientName": client_name})};'
        f'history.replaceState(null,"","/lidlar");'
        f'BX24.init(function(){{}});'
        f'</script>'
    )
    html = html.replace("</head>", f"{script}</head>", 1)
    return HTMLResponse(content=html)


if __name__ == "__main__":
    host = os.getenv("SERVER_IP", "127.0.0.1")
    uvicorn.run(app, host=host, port=8000)


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


@app.get("/api/stats")
def api_stats(range: str = "all"):
    days = None if range == "all" else (1 if range == "today" else int(range))
    days_interval = f"{days} days" if days is not None else None
    
    stats_query = text("""
        SELECT
            COUNT(*)                                                                AS total_leads,
            COUNT(*) FILTER (WHERE NOT s.is_final)                                  AS in_process,
            COUNT(*) FILTER (WHERE s.is_final AND NOT s.is_won)                     AS failed,
            COUNT(*) FILTER (WHERE s.is_final AND s.is_won)                         AS converted,
            ROUND(COUNT(*) FILTER (WHERE s.is_final AND s.is_won)::NUMERIC
                  / NULLIF(COUNT(*), 0) * 100, 2)                                   AS conversion_pct,
            COALESCE(SUM(opportunity), 0)                                           AS total_opportunity,
            COALESCE(ROUND(AVG(opportunity), 0), 0)                                 AS avg_opportunity,
            COUNT(*) FILTER (
                WHERE NOT s.is_final
                  AND l.date_modify < NOW() - INTERVAL '7 days'
            )                                                                       AS frozen_leads,
            ROUND(AVG(
                EXTRACT(EPOCH FROM (NOW() - l.date_create)) / 86400.0
            ) FILTER (WHERE NOT s.is_final), 1)                                     AS avg_age_days,
            -- Sifatli lid: O'ylab ko'radi + Tashrif belgilandi + Tashrif buyurdi + Bekor bo'ldi + Kelmadi
            COUNT(l.id) FILTER (WHERE s.bitrix_id IN (
                'THINKING', 'CONSULTATION', 'NOT_TRANSFERRED', 'RECYCLED'
            ))                                                                      AS sifatli_lid_count,
            -- Tashrif belgilandi (CONSULTATION = Konsultatsiya o'tkazildi/belgilandi)
            COUNT(l.id) FILTER (WHERE s.bitrix_id = 'CONSULTATION')                AS tashrif_belgilandi_count,
            -- Tashrif buyurdi = Konsultatsiya o'tdi (same stage key until separate stage confirmed)
            COUNT(l.id) FILTER (WHERE s.bitrix_id = 'CONSULTATION')                AS tashrif_buyurdi_count,
            -- Muvaffaqiyatsiz = Sifatsiz + Bekor bo'ldi
            COUNT(l.id) FILTER (WHERE s.bitrix_id IN ('JUNK', 'RECYCLED'))         AS muvaffaqiyatsiz_count
        FROM leads l
        JOIN stages s ON s.id = l.stage_id
        WHERE (:days_interval IS NULL OR l.date_create >= NOW() - CAST(:days_interval AS INTERVAL));
    """)

    funnel_query = text("""
        SELECT
            s.bitrix_id,
            s.name AS name_uz,
            s.sort_order,
            COUNT(l.id)                     AS lead_count,
            COALESCE(SUM(l.opportunity), 0) AS total_opportunity
        FROM stages s
        LEFT JOIN leads l ON l.stage_id = s.id
            AND (:days_interval IS NULL OR l.date_create >= NOW() - CAST(:days_interval AS INTERVAL))
        WHERE s.entity = 'lead'
        GROUP BY s.id, s.bitrix_id, s.name, s.sort_order
        ORDER BY s.sort_order;
    """)

    with bx_engine.connect() as conn:
        stats = conn.execute(stats_query, {"days_interval": days_interval}).mappings().first()
        funnel = conn.execute(funnel_query, {"days_interval": days_interval}).mappings().all()

    return {
        "header": dict(stats) if stats else {},
        "funnel": [dict(r) for r in funnel]
    }

@app.get("/api/responsibles")
def api_responsibles(range: str = "all"):
    days = None if range == "all" else (1 if range == "today" else int(range))
    days_interval = f"{days} days" if days is not None else None
    
    query = text("""
        SELECT
            r.id                                                            AS responsible_id,
            TRIM(r.name || ' ' || COALESCE(r.last_name, ''))               AS full_name,
            COUNT(l.id)                                                     AS total,
            COUNT(l.id) FILTER (WHERE s.bitrix_id = 'NEW')                 AS yangi_lid,
            COUNT(l.id) FILTER (WHERE s.bitrix_id = 'NO_ANSWER')           AS javob_bermadi,
            COUNT(l.id) FILTER (WHERE s.bitrix_id = 'CALLBACK')            AS qayta_aloqa,
            COUNT(l.id) FILTER (WHERE s.bitrix_id = 'THINKING')            AS oylab_koradi,
            COUNT(l.id) FILTER (WHERE s.bitrix_id = 'CONSULTATION')        AS konsultatsiya,
            COUNT(l.id) FILTER (WHERE s.bitrix_id = 'NOT_TRANSFERRED')     AS otkazilmadi,
            COUNT(l.id) FILTER (WHERE s.bitrix_id = 'ARCHIVE')             AS sandiq,
            COUNT(l.id) FILTER (WHERE s.bitrix_id = 'JUNK')                AS sifatsiz,
            COUNT(l.id) FILTER (WHERE s.bitrix_id = 'RECYCLED')            AS bekor_boldi,
            COALESCE(SUM(l.opportunity), 0)                                 AS total_opportunity
        FROM responsibles r
        LEFT JOIN leads l ON l.responsible_id = r.id
            AND (:days_interval IS NULL OR l.date_create >= NOW() - CAST(:days_interval AS INTERVAL))
        LEFT JOIN stages s ON s.id = l.stage_id
        WHERE r.active = TRUE
        GROUP BY r.id, r.name, r.last_name
        ORDER BY total DESC;
    """)
    with bx_engine.connect() as conn:
        res = conn.execute(query, {"days_interval": days_interval}).mappings().all()
        
    return {"responsibles": [dict(r) for r in res]}


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
        f'history.replaceState(null,"","/marketing/kunlik");'
        f'BX24.init(function(){{}});'
        f'</script>'
    )
    html = html.replace("</head>", f"{script}</head>", 1)
    return HTMLResponse(content=html)


if __name__ == "__main__":
    host = os.getenv("SERVER_IP", "127.0.0.1")
    uvicorn.run(app, host=host, port=8000)


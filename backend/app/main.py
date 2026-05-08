import json
import os
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Optional

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
from app.services import bitrix
from app.services import meta as meta_svc
from app.services.bitrix import (
    aggregate_deals_sum_total,
    get_visits_by_date,
    list_leads,
)
from app.services.meta import MetaClient

app = FastAPI(openapi_url="/api/openapi.json", docs_url="/api/docs")

# Auth middleware (no-op unless AUTH_ENABLED=true env)
auth_module.install_auth_middleware(app)


@app.on_event("startup")
def _on_startup():
    init_db()


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
def api_list_leads(
    assigned_by: Optional[int] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    status_id: Optional[str] = None,
    source_id: Optional[str] = None,
    search: Optional[str] = None,
    limit: Optional[int] = None,
    offset: int = 0,
    enrich: bool = False,
):
    """List leads with optional filters and enrichment.

    enrich=true → include status_name, source_name, assigned_name resolved server-side.
    """
    f = {}
    select = [
        "ID", "TITLE", "NAME", "LAST_NAME", "SECOND_NAME",
        "ASSIGNED_BY_ID", "OPPORTUNITY", "STATUS_ID", "SOURCE_ID",
        "DATE_CREATE", "DATE_MODIFY",
        "PHONE", "EMAIL", "COMMENTS",
        "UF_CRM_1774413003006",
    ]
    if assigned_by:  f["ASSIGNED_BY_ID"] = assigned_by
    if status_id:    f["STATUS_ID"] = status_id
    if source_id:    f["SOURCE_ID"] = source_id
    if start_date:   f[">=DATE_CREATE"] = start_date
    if end_date:     f["<=DATE_CREATE"] = end_date
    if search:       f["%TITLE"] = search   # Bitrix substring filter

    leads = bitrix.list_leads(filter_dict=f, select=select)
    total = len(leads)

    # Optional pagination (server-side after Bitrix-side filtering)
    if limit:
        leads = leads[offset: offset + limit]

    if enrich:
        status_names = bitrix.get_lead_status_names()
        source_names = bitrix.get_deal_source_names()
        users = {str(u["ID"]): f"{u.get('NAME','') or ''} {u.get('LAST_NAME','') or ''}".strip() or f"User {u['ID']}"
                 for u in bitrix.list_users()}
        for ld in leads:
            ld["_status_name"]  = status_names.get(ld.get("STATUS_ID") or "", ld.get("STATUS_ID") or "")
            ld["_source_name"]  = source_names.get(ld.get("SOURCE_ID") or "", ld.get("SOURCE_ID") or "")
            ld["_assigned_name"] = users.get(str(ld.get("ASSIGNED_BY_ID") or ""), "")

    return {"count": total, "leads": leads, "offset": offset, "limit": limit}


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


@app.get("/api/stats/leads")
def api_stats_leads(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    assigned_by: Optional[int] = None,
    status_id: Optional[str] = None,
    source_id: Optional[str] = None,
    utm_source: Optional[str] = None,
    utm_medium: Optional[str] = None,
    utm_campaign: Optional[str] = None,
    utm_content: Optional[str] = None,
    utm_term: Optional[str] = None,
):
    f = {}
    if start_date:   f[">=DATE_CREATE"] = start_date
    if end_date:     f["<=DATE_CREATE"] = end_date
    if assigned_by:  f["ASSIGNED_BY_ID"] = assigned_by
    if status_id:    f["STATUS_ID"] = status_id
    if source_id:    f["SOURCE_ID"] = source_id
    if utm_source:   f["UTM_SOURCE"] = utm_source
    if utm_medium:   f["UTM_MEDIUM"] = utm_medium
    if utm_campaign: f["UTM_CAMPAIGN"] = utm_campaign
    if utm_content:  f["UTM_CONTENT"] = utm_content
    if utm_term:     f["UTM_TERM"] = utm_term

    select = [
        "ID", "ASSIGNED_BY_ID", "STATUS_ID", "OPPORTUNITY", "SOURCE_ID",
        "UTM_SOURCE", "UTM_MEDIUM", "UTM_CAMPAIGN", "UTM_CONTENT", "UTM_TERM",
        "DATE_CREATE", "DATE_MODIFY",
    ]
    # Run all 4 Bitrix calls concurrently — reduces wall-clock time from ~sum to ~max
    with ThreadPoolExecutor(max_workers=4) as ex:
        f_leads   = ex.submit(bitrix.list_leads, f, select)
        f_users   = ex.submit(bitrix.list_users)
        f_status  = ex.submit(bitrix.get_lead_status_names)
        f_sources = ex.submit(bitrix.get_deal_source_names)
    leads        = f_leads.result()
    all_users    = f_users.result()
    status_names = f_status.result()
    source_names = f_sources.result()
    users_map = {u["ID"]: f"{u.get('NAME', '')} {u.get('LAST_NAME', '')}".strip()
                 for u in all_users}

    JARAYON_STATUSES = {"NEW", "IN_PROCESS", "PROCESSED", "UC_1KPATX", "UC_Q2U9EL", "UC_KXC3ZW", "UC_L28G68"}
    FROZEN_DAYS = 7  # idle days threshold for "muzlab qolgan" (frozen) leads

    by_status: dict = {}
    by_user: dict = {}
    total_opp = 0.0
    sources_found: set = set()
    source_counts: dict = {}
    utm_sources_found: set = set()
    utm_mediums_found: set = set()
    utm_campaigns_found: set = set()
    utm_contents_found: set = set()
    utm_terms_found: set = set()
    utm_medium_counts: dict = {}
    utm_campaign_counts: dict = {}
    ages_days: list = []
    frozen_count = 0
    now_utc = _dt.utcnow()  # naive UTC — avoids timezone import

    for u in all_users:
        uid = str(u["ID"])
        if u.get("ACTIVE", True):
            by_user[uid] = {"id": uid, "name": users_map.get(uid, f"User {uid}"),
                            "total": 0, "revenue": 0.0, "by_status": {}}

    for lead in leads:
        uid = str(lead.get("ASSIGNED_BY_ID", ""))
        status = lead.get("STATUS_ID", "UNKNOWN")
        opp = float(lead.get("OPPORTUNITY") or 0)
        total_opp += opp
        by_status[status] = by_status.get(status, 0) + 1
        if uid not in by_user:
            by_user[uid] = {"id": uid, "name": users_map.get(uid, f"User {uid}"),
                            "total": 0, "revenue": 0.0, "by_status": {}}
        by_user[uid]["total"] += 1
        by_user[uid]["revenue"] += opp
        by_user[uid]["by_status"][status] = by_user[uid]["by_status"].get(status, 0) + 1

        src = (lead.get("SOURCE_ID") or "").strip()
        if src:
            sources_found.add(src)
            source_counts[src] = source_counts.get(src, 0) + 1

        for val, col in [
            (lead.get("UTM_SOURCE"),   utm_sources_found),
            (lead.get("UTM_MEDIUM"),   utm_mediums_found),
            (lead.get("UTM_CAMPAIGN"), utm_campaigns_found),
            (lead.get("UTM_CONTENT"),  utm_contents_found),
            (lead.get("UTM_TERM"),     utm_terms_found),
        ]:
            v = (val or "").strip()
            if v: col.add(v)

        med = (lead.get("UTM_MEDIUM") or "").strip()
        if med:
            utm_medium_counts[med] = utm_medium_counts.get(med, 0) + 1
        camp = (lead.get("UTM_CAMPAIGN") or "").strip()
        if camp:
            utm_campaign_counts[camp] = utm_campaign_counts.get(camp, 0) + 1

        # Lead age / frozen computation (only for active/jarayon leads)
        if status in JARAYON_STATUSES:
            created_str = lead.get("DATE_CREATE")
            modified_str = lead.get("DATE_MODIFY") or created_str
            if created_str:
                try:
                    def _to_naive_utc(s):
                        dt = _dt.fromisoformat(s.replace("Z", "+00:00"))
                        if dt.tzinfo is not None:
                            dt = dt - dt.utcoffset()
                            dt = dt.replace(tzinfo=None)
                        return dt
                    created = _to_naive_utc(created_str)
                    age = (now_utc - created).days
                    ages_days.append(age)
                    modified = _to_naive_utc(modified_str)
                    if (now_utc - modified).days >= FROZEN_DAYS:
                        frozen_count += 1
                except Exception:
                    pass

    avg_age_days = round(sum(ages_days) / len(ages_days), 1) if ages_days else 0
    jarayon_total = sum(v for k, v in by_status.items() if k in JARAYON_STATUSES)
    converted = sum(v for k, v in by_status.items() if "CONVERT" in k.upper() or k == "CLOSED")
    total = len(leads)
    return {
        "total": total,
        "total_revenue": round(total_opp, 2),
        "converted": converted,
        "jarayon_total": jarayon_total,
        "conversion_rate": round(converted / total * 100, 2) if total else 0,
        "avg_age_days": avg_age_days,
        "frozen_count": frozen_count,
        "by_status": by_status,
        "by_user": sorted(by_user.values(), key=lambda x: x["total"], reverse=True),
        "all_statuses": list(status_names.keys()),
        "status_names": status_names,
        "users": [{"id": u["ID"], "name": users_map[u["ID"]]} for u in all_users],
        "sources": sorted(
            [{"id": s, "label": source_names.get(s, s), "count": source_counts.get(s, 0)} for s in sources_found],
            key=lambda x: -x["count"],
        ),
        "utm_sources":        sorted(utm_sources_found),
        "utm_mediums":        sorted(utm_mediums_found),
        "utm_campaigns":      sorted(utm_campaigns_found),
        "utm_contents":       sorted(utm_contents_found),
        "utm_terms":          sorted(utm_terms_found),
        "utm_medium_counts":  sorted([{"label": k, "val": v} for k, v in utm_medium_counts.items()], key=lambda x: -x["val"]),
        "utm_campaign_counts": sorted([{"label": k, "val": v} for k, v in utm_campaign_counts.items()], key=lambda x: -x["val"]),
    }


@app.get("/api/stats/deals")
def api_stats_deals(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    assigned_by: Optional[int] = None,
    stage_id: Optional[str] = None,
    source_id: Optional[str] = None,
):
    f = {}
    if start_date:
        f[">=DATE_CREATE"] = start_date
    if end_date:
        f["<=DATE_CREATE"] = end_date
    if assigned_by:
        f["ASSIGNED_BY_ID"] = assigned_by
    if stage_id:
        f["STAGE_ID"] = stage_id
    if source_id:
        f["SOURCE_ID"] = source_id
    select = ["ID", "ASSIGNED_BY_ID", "STAGE_ID", "OPPORTUNITY", "CURRENCY_ID"]
    deals = bitrix.list_deals(filter_dict=f, select=select)
    all_users = bitrix.list_users()
    users_map = {u["ID"]: f"{u.get('NAME', '')} {u.get('LAST_NAME', '')}".strip()
                 for u in all_users}
    stage_names = bitrix.get_deal_stage_names()

    by_stage: dict = {}
    by_user: dict = {}
    total_won = 0.0
    won_count = 0

    for u in all_users:
        uid = str(u["ID"])
        if u.get("ACTIVE", True):
            by_user[uid] = {"id": uid, "name": users_map.get(uid, f"User {uid}"),
                            "total": 0, "won_revenue": 0.0, "by_stage": {}}

    for deal in deals:
        uid = str(deal.get("ASSIGNED_BY_ID", ""))
        stage = deal.get("STAGE_ID", "UNKNOWN")
        opp = float(deal.get("OPPORTUNITY") or 0)
        if "WON" in stage.upper():
            total_won += opp
            won_count += 1
        by_stage[stage] = by_stage.get(stage, 0) + 1
        if uid not in by_user:
            by_user[uid] = {"id": uid, "name": users_map.get(uid, f"User {uid}"),
                            "total": 0, "won_revenue": 0.0, "by_stage": {}}
        by_user[uid]["total"] += 1
        if "WON" in stage.upper():
            by_user[uid]["won_revenue"] += opp
        by_user[uid]["by_stage"][stage] = by_user[uid]["by_stage"].get(stage, 0) + 1

    total = len(deals)
    lost = sum(v for k, v in by_stage.items() if "LOSE" in k.upper())
    return {
        "total": total,
        "won_count": won_count,
        "lost_count": lost,
        "total_won_revenue": total_won,
        "conversion_rate": round(won_count / total * 100, 1) if total else 0,
        "by_stage": by_stage,
        "by_user": sorted(by_user.values(), key=lambda x: x["total"], reverse=True),
        "all_stages": sorted(by_stage.keys()),
        "stage_names": stage_names,
        "users": [{"id": u["ID"], "name": users_map[u["ID"]]} for u in all_users],
    }


@app.get("/api/stats/deals/by-source")
def api_deals_by_source(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    assigned_by: Optional[int] = None,
    stage_id: Optional[str] = None,
):
    f = {}
    if start_date:
        f[">=DATE_CREATE"] = start_date
    if end_date:
        f["<=DATE_CREATE"] = end_date
    if assigned_by:
        f["ASSIGNED_BY_ID"] = assigned_by
    if stage_id:
        f["STAGE_ID"] = stage_id
    select = ["ID", "STAGE_ID", "SOURCE_ID", "OPPORTUNITY"]
    deals = bitrix.list_deals(filter_dict=f, select=select)
    source_names = bitrix.get_deal_source_names()

    by_source: dict = {}
    for deal in deals:
        src_id = deal.get("SOURCE_ID") or "UNKNOWN"
        stage = deal.get("STAGE_ID", "")
        opp = float(deal.get("OPPORTUNITY") or 0)
        if src_id not in by_source:
            label = source_names.get(src_id, src_id) if src_id != "UNKNOWN" else "Noma'lum"
            by_source[src_id] = {"id": src_id, "label": label, "ishlaydi": 0, "provodka": 0, "success": 0, "revenue": 0.0}
        if "WON" in stage.upper():
            by_source[src_id]["success"] += 1
            by_source[src_id]["revenue"] += opp
        elif "LOSE" in stage.upper():
            by_source[src_id]["provodka"] += 1
        else:
            by_source[src_id]["ishlaydi"] += 1

    result = []
    for src in by_source.values():
        total = src["ishlaydi"] + src["provodka"] + src["success"]
        conv = round(src["success"] / total * 100, 1) if total else 0
        result.append({**src, "total": total, "conversion": conv})
    result.sort(key=lambda x: -x["total"])
    return {"sources": result, "source_names": source_names}


@app.get("/api/stats/lead-quality")
def api_stats_lead_quality(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    assigned_by: Optional[int] = None,
    source_id: Optional[str] = None,
    utm_source: Optional[str] = None,
    utm_medium: Optional[str] = None,
    utm_campaign: Optional[str] = None,
    utm_content: Optional[str] = None,
    utm_term: Optional[str] = None,
):
    REASON_FIELDS = {
        "UC_F8K4GI": "UF_CRM_1770282341169",
        "UC_NAZK5J": "UF_CRM_1775826103146",
        "JUNK":      "UF_CRM_1770609460118",
    }
    STATUS_KEY = {"UC_F8K4GI": "sifatsiz", "UC_NAZK5J": "bekor", "JUNK": "sandiq"}

    base_filter: dict = {}
    if start_date:   base_filter[">=DATE_CREATE"] = start_date
    if end_date:     base_filter["<=DATE_CREATE"] = end_date
    if assigned_by:  base_filter["ASSIGNED_BY_ID"] = assigned_by
    if source_id:    base_filter["SOURCE_ID"] = source_id
    if utm_source:   base_filter["UTM_SOURCE"] = utm_source
    if utm_medium:   base_filter["UTM_MEDIUM"] = utm_medium
    if utm_campaign: base_filter["UTM_CAMPAIGN"] = utm_campaign
    if utm_content:  base_filter["UTM_CONTENT"] = utm_content
    if utm_term:     base_filter["UTM_TERM"] = utm_term

    result: dict = {"sifatsiz": [], "bekor": [], "sandiq": [], "utm": []}

    # Run all 4 list_leads calls + enum_map fetch concurrently
    with ThreadPoolExecutor(max_workers=5) as ex:
        f_enum = ex.submit(bitrix.get_lead_enum_map)
        reason_futures = {
            status_id: ex.submit(
                bitrix.list_leads,
                {"STATUS_ID": status_id, **base_filter},
                ["ID", "ASSIGNED_BY_ID", reason_field],
            )
            for status_id, reason_field in REASON_FIELDS.items()
        }
        f_utm_leads = ex.submit(bitrix.list_leads, base_filter, ["ID", "UTM_SOURCE"])

    enum_map = f_enum.result()

    for status_id, reason_field in REASON_FIELDS.items():
        leads = reason_futures[status_id].result()
        counts: dict = {}
        field_enum = enum_map.get(reason_field, {})
        for lead in leads:
            val = lead.get(reason_field)
            if not val:
                continue
            if isinstance(val, list):
                parts = [field_enum.get(str(v), str(v)) for v in val if v]
                label = ", ".join(sorted(parts)) if parts else None
            else:
                label = field_enum.get(str(val), str(val))
            if label:
                counts[label] = counts.get(label, 0) + 1
        key = STATUS_KEY[status_id]
        result[key] = sorted([{"label": k, "val": v} for k, v in counts.items()], key=lambda x: -x["val"])

    utm_counts: dict = {}
    for lead in f_utm_leads.result():
        src = (lead.get("UTM_SOURCE") or "").strip()
        if src:
            utm_counts[src] = utm_counts.get(src, 0) + 1
    result["utm"] = sorted([{"label": k, "val": v} for k, v in utm_counts.items()], key=lambda x: -x["val"])

    return result


@app.get("/api/attendance")
def api_attendance(start_date: str, end_date: str):
    # Return leads that act as visits between dates (uses TASHRIF_DATE field)
    leads = bitrix.get_visits_by_date(start_date, end_date)
    return {"count": len(leads), "visits": leads}

@app.get("/api/facebook/insights")
async def api_facebook_insights(start_date: str, end_date: str):
    """Return account-level daily Facebook insights between two ISO dates."""
    try:
        client = MetaClient()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Meta client init error: {e}")

    try:
        insights = await client.get_daily_insights(date.fromisoformat(start_date), date.fromisoformat(end_date))
        return {"count": len(insights), "data": [i.dict() for i in insights]}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Meta API error: {e}")


@app.get("/api/dashboard/daily")
async def api_dashboard_daily(date_str: str):
    """Return combined dashboard data for a single date (YYYY-MM-DD)."""
    try:
        # Facebook
        client = MetaClient()
        fb = await client.get_daily_insights(date.fromisoformat(date_str), date.fromisoformat(date_str))
        fb_row = fb[0].dict() if fb else {"date": date_str, "spend": 0, "leads_count": 0}
    except Exception as e:
        fb_row = {"error": str(e)}

    try:
        # Bitrix visits and leads
        visits = get_visits_by_date(date_str, date_str)
        leads = list_leads(filter_dict={})
        deals = aggregate_deals_sum_total(date_str, date_str)
    except Exception as e:
        visits = []
        leads = []
        deals = {"sum": 0, "count": 0}

    return {
        "date": date_str,
        "facebook": fb_row,
        "bitrix": {
            "visits_count": len(visits),
            "leads_count": len(leads),
            "closed_deals": deals,
        },
    }


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
    # Inject BX context + navigate to the target route before React mounts
    script = (
        f'<script>'
        f'window.__BX_CLIENT__={json.dumps({"clientName": client_name})};'
        f'history.replaceState(null,"","/marketing/kunlik");'
        f'</script>'
    )
    html = html.replace("</head>", f"{script}</head>", 1)
    return HTMLResponse(content=html)


if __name__ == "__main__":
    host = os.getenv("SERVER_IP", "127.0.0.1")
    uvicorn.run(app, host=host, port=8000)


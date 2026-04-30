from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel
from typing import Optional
from pathlib import Path
from dotenv import load_dotenv
import uvicorn
import os


APP_DIR = Path(__file__).resolve().parent          # backend/app/
BACKEND_DIR = APP_DIR.parent                       # backend/
PROJECT_ROOT = BACKEND_DIR.parent                  # mountain/
FRONTEND_LEGACY = PROJECT_ROOT / "frontend" / "legacy"

load_dotenv(BACKEND_DIR / ".env")

from app.services import bitrix, meta as meta_svc
from app.services.meta import MetaClient
from datetime import date
from app.services.bitrix import aggregate_deals_sum_total, get_visits_by_date, list_leads

app = FastAPI(openapi_url="/api/openapi.json", docs_url="/api/docs")


@app.get("/")
def serve_index():
    return FileResponse(FRONTEND_LEGACY / "marketing.html")


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


@app.get("/api/payroll/{emp_id}")
def api_get_payroll(emp_id: str):
    # The frontend expects payroll values for the selected employee.
    # For now, use the static JS payData in the HTML via a simple mapping.
    # Attempt to map common employee keys used in HTML: sb, dy, bt, nk, zr
    demo = {
        "sb": {
            "name": "Shahzod Botirov",
            "fix": "5,200,000",
            "kpi": "$6,180",
            "bonus": "$530",
            "penalty": "0",
            "total": "\u2248 14,200,000 so'm + $6,710"
        },
        "dy": {
            "name": "Dilnoza Yusupova",
            "fix": "5,200,000",
            "kpi": "$0",
            "bonus": "\u2014",
            "penalty": "0",
            "total": "\u2248 5,940,000 so'm"
        }
    }
    return demo.get(emp_id, {"error": "unknown emp id"})


@app.get("/api/leads")
def api_list_leads(assigned_by: Optional[int] = None, start_date: Optional[str] = None, end_date: Optional[str] = None):
    f = {}
    select = ["ID", "TITLE", "ASSIGNED_BY_ID", "OPPORTUNITY", "STATUS_ID", "UF_CRM_1774413003006", "DATE_CREATE"]
    if assigned_by:
        f["ASSIGNED_BY_ID"] = assigned_by
    if start_date and end_date:
        f["%s" % bitrix.TASHRIF_DATE] = None
    leads = bitrix.list_leads(filter_dict=f, select=select)
    return {"count": len(leads), "leads": leads}


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


@app.get("/marketing")
def serve_marketing():
    return FileResponse(FRONTEND_LEGACY / "marketing.html")


@app.get("/payroll")
def serve_payroll():
    return FileResponse(FRONTEND_LEGACY / "payroll.html")


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

    select = ["ID", "ASSIGNED_BY_ID", "STATUS_ID", "OPPORTUNITY", "SOURCE_ID",
              "UTM_SOURCE", "UTM_MEDIUM", "UTM_CAMPAIGN", "UTM_CONTENT", "UTM_TERM"]
    leads = bitrix.list_leads(filter_dict=f, select=select)
    all_users = bitrix.list_users()
    users_map = {u["ID"]: f"{u.get('NAME', '')} {u.get('LAST_NAME', '')}".strip()
                 for u in all_users}
    status_names = bitrix.get_lead_status_names()
    source_names = bitrix.get_deal_source_names()

    by_status: dict = {}
    by_user: dict = {}
    total_opp = 0.0
    sources_found: set = set()
    utm_sources_found: set = set()
    utm_mediums_found: set = set()
    utm_campaigns_found: set = set()
    utm_contents_found: set = set()
    utm_terms_found: set = set()

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
        if src: sources_found.add(src)
        for val, col in [
            (lead.get("UTM_SOURCE"),   utm_sources_found),
            (lead.get("UTM_MEDIUM"),   utm_mediums_found),
            (lead.get("UTM_CAMPAIGN"), utm_campaigns_found),
            (lead.get("UTM_CONTENT"),  utm_contents_found),
            (lead.get("UTM_TERM"),     utm_terms_found),
        ]:
            v = (val or "").strip()
            if v: col.add(v)

    JARAYON_STATUSES = {"NEW", "IN_PROCESS", "PROCESSED", "UC_1KPATX", "UC_Q2U9EL", "UC_KXC3ZW", "UC_L28G68"}
    jarayon_total = sum(v for k, v in by_status.items() if k in JARAYON_STATUSES)
    converted = sum(v for k, v in by_status.items() if "CONVERT" in k.upper() or k == "CLOSED")
    total = len(leads)
    return {
        "total": total,
        "total_revenue": total_opp,
        "converted": converted,
        "jarayon_total": jarayon_total,
        "conversion_rate": round(converted / total * 100, 2) if total else 0,
        "by_status": by_status,
        "by_user": sorted(by_user.values(), key=lambda x: x["total"], reverse=True),
        "all_statuses": list(status_names.keys()),
        "status_names": status_names,
        "users": [{"id": u["ID"], "name": users_map[u["ID"]]} for u in all_users],
        "sources": sorted([{"id": s, "label": source_names.get(s, s)} for s in sources_found], key=lambda x: x["label"]),
        "utm_sources":   sorted(utm_sources_found),
        "utm_mediums":   sorted(utm_mediums_found),
        "utm_campaigns": sorted(utm_campaigns_found),
        "utm_contents":  sorted(utm_contents_found),
        "utm_terms":     sorted(utm_terms_found),
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

    enum_map = bitrix.get_lead_enum_map()
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

    for status_id, reason_field in REASON_FIELDS.items():
        f = {"STATUS_ID": status_id, **base_filter}
        leads = bitrix.list_leads(filter_dict=f, select=["ID", "ASSIGNED_BY_ID", reason_field])
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

    all_leads = bitrix.list_leads(filter_dict=base_filter, select=["ID", "UTM_SOURCE"])
    utm_counts: dict = {}
    for lead in all_leads:
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


@app.get("/meta-api.js")
def serve_meta_api_js():
    return FileResponse(FRONTEND_LEGACY / "meta-api.js", media_type="application/javascript")


@app.get("/config.js")
def serve_config_js():
    return FileResponse(FRONTEND_LEGACY / "config.js", media_type="application/javascript")


if __name__ == "__main__":
    host = os.getenv("SERVER_IP", "127.0.0.1")
    uvicorn.run(app, host=host, port=8000)


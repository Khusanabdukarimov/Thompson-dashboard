import os
import json
import hashlib
import logging
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from functools import lru_cache
from zoneinfo import ZoneInfo

import requests
from dateutil.parser import parse as parse_b24_datetime
from sqlalchemy import text
from app.db_bx import bx_engine

try:
    from helper.config import (
        BITRIX24_PORTAL,
        BITRIX24_TOKEN,
        TASHRIF_DATE,
        TASHRIF_VISTORS_COUNT,
    )
except Exception:
    BITRIX24_PORTAL = os.environ.get('BITRIX24_PORTAL', 'https://your-portal.bitrix24.com/rest/')
    BITRIX24_TOKEN = os.environ.get('BITRIX24_TOKEN', '')
    TASHRIF_DATE = os.environ.get('TASHRIF_DATE', 'UF_CRM_VISIT_DATE')
    TASHRIF_VISTORS_COUNT = os.environ.get('TASHRIF_VISTORS_COUNT', 'UF_CRM_VISITORS_COUNT')

# Session with connection pooling for concurrent page fetches
_session = requests.Session()
_adapter = requests.adapters.HTTPAdapter(pool_connections=16, pool_maxsize=16)
_session.mount("https://", _adapter)
_session.mount("http://", _adapter)

TSK_TZ = ZoneInfo("Asia/Tashkent")
log = logging.getLogger(__name__)

# ─── Per-key threading locks (within-process serialisation) ──────────────────
_FETCH_LOCKS: dict[str, threading.Lock] = {}
_FETCH_LOCKS_MUTEX = threading.Lock()


def _get_fetch_lock(key: str) -> threading.Lock:
    with _FETCH_LOCKS_MUTEX:
        if key not in _FETCH_LOCKS:
            _FETCH_LOCKS[key] = threading.Lock()
        return _FETCH_LOCKS[key]


# ─── No Database Cache ────────────────────────────────────────────────────────


# ─── Batch-based pagination ───────────────────────────────────────────────────

def _build_params(filter_dict=None, select=None, extra: dict | None = None) -> dict:
    params: dict = {}
    if filter_dict:
        for k, v in filter_dict.items():
            params[f"filter[{k}]"] = v
    if select:
        params["select[]"] = select
    if extra:
        params.update(extra)
    return params


def _fetch_page(list_url: str, base_params: dict, start: int) -> list:
    """Fetch one page; on 429 back off and retry up to 2 times."""
    for attempt in range(3):
        if attempt:
            time.sleep(attempt * 3.0)  # 3s, 6s back-off
        try:
            res = _session.get(list_url, params={**base_params, "start": start}, timeout=30)
            if res.status_code == 200:
                data = res.json()
                if "error" in data:
                    log.warning("page error (start=%s, attempt=%d): %s", start, attempt + 1, data["error"])
                    continue
                return data.get("result", [])
            if res.status_code in (429, 503):
                log.warning("rate-limited at start=%s (attempt %d)", start, attempt + 1)
                continue
            log.warning("page fetch failed (start=%s, status=%s)", start, res.status_code)
            break
        except Exception as exc:
            log.warning("page fetch exception (start=%s, attempt=%d): %s", start, attempt + 1, exc)
    return []


_PAGE_DELAY_LARGE = 1.0   # delay for large fetches (>50 pages) — stays under rate limit
_LARGE_FETCH_THRESHOLD = 50  # pages


def _translate_filters(filter_dict: dict) -> tuple[str, dict]:
    if not filter_dict:
        return "1=1", {}
    clauses = []
    params = {}
    for i, (k, v) in enumerate(filter_dict.items()):
        op = "="
        field = k
        if k.startswith(">="): op = ">="; field = k[2:]
        elif k.startswith("<="): op = "<="; field = k[2:]
        elif k.startswith(">"): op = ">"; field = k[1:]
        elif k.startswith("<"): op = "<"; field = k[1:]
        
        col = field.lower()
        if field == "ASSIGNED_BY_ID" or field == "RESPONSIBLE_ID": col = "responsible_id"
        if field == "STATUS_ID" or field == "STAGE_ID": col = "s.bitrix_id"
        
        pname = f"p{i}"
        clauses.append(f"{col} {op} :{pname}")
        params[pname] = v
    return " AND ".join(clauses), params

def _paginate_db(table: str, filter_dict=None) -> tuple[list, int]:
    where_clause, params = _translate_filters(filter_dict)
    
    # Basic join for stages if needed
    join_clause = ""
    select_fields = "t.*"
    if "s.bitrix_id" in where_clause:
        join_clause = "LEFT JOIN stages s ON s.id = t.stage_id"
        select_fields = "t.*, s.bitrix_id AS status_id"

    query = text(f"SELECT {select_fields} FROM {table} t {join_clause} WHERE {where_clause}")
    
    with bx_engine.connect() as conn:
        res = conn.execute(query, params).mappings().all()
        items = [dict(r) for r in res]
        # Map uppercase keys for Bitrix compatibility
        for item in items:
            for k in list(item.keys()):
                item[k.upper()] = item.pop(k)
        return items, len(items)

def _paginate(method: str, filter_dict=None, select=None, extra: dict | None = None) -> tuple[list, int]:
    if method == "crm.lead.list":
        return _paginate_db("leads", filter_dict)
    if method == "crm.deal.list":
        return _paginate_db("deals", filter_dict)
    if method == "user.get.json" or method == "user.get":
        return _paginate_db("responsibles", filter_dict)
    if method == "crm.activity.list":
        return _paginate_db("bx_activities", filter_dict) # fallback to bx_activities if Node.js doesn't sync yet
    
    log.info("Bypassing Bitrix API call for %s", method)
    return [], 0


# Removed distributed cache locking logic


# ─── Single-entity fetches ────────────────────────────────────────────────────

def get_lead_details(lead_id):
    query = text("""
        SELECT
            l.*,
            s.name        AS stage_name,
            s.bitrix_id   AS stage_bitrix_id,
            TRIM(r.name || ' ' || COALESCE(r.last_name, '')) AS responsible_name,
            (SELECT phone FROM lead_phones lp WHERE lp.lead_id = l.id LIMIT 1) AS primary_phone
        FROM leads l
        LEFT JOIN stages s       ON s.id = l.stage_id
        LEFT JOIN responsibles r ON r.id = l.responsible_id
        WHERE l.id = :id;
    """)
    with bx_engine.connect() as conn:
        res = conn.execute(query, {"id": lead_id}).mappings().first()
        return dict(res) if res else None


def get_deal_details(deal_id):
    query = text("""
        SELECT
            d.*,
            s.name        AS stage_name,
            s.bitrix_id   AS stage_bitrix_id,
            TRIM(r.name || ' ' || COALESCE(r.last_name, '')) AS responsible_name
        FROM deals d
        LEFT JOIN stages s       ON s.id = d.stage_id
        LEFT JOIN responsibles r ON r.id = d.responsible_id
        WHERE d.id = :id;
    """)
    with bx_engine.connect() as conn:
        res = conn.execute(query, {"id": deal_id}).mappings().first()
        return dict(res) if res else None


def get_contact_details(contact_id):
    # No contacts table in schema.sql, returning None
    return None


def get_user_details(user_id):
    query = text("SELECT * FROM responsibles WHERE id = :id;")
    with bx_engine.connect() as conn:
        res = conn.execute(query, {"id": user_id}).mappings().first()
        return dict(res) if res else None


def get_task(task_id):
    return None

def get_timeman_status(user_id):
    return None

def get_booking_details(booking_id):
    return None

def get_booking_clients(booking_id):
    return None


# ─── List functions (batch-paginated + Redis cached) ─────────────────────────

def list_users(ttl: int = 1800) -> list:
    res, _ = _paginate("user.get.json", filter_dict={"ACTIVE": "Y"})
    return res

def list_leads(filter_dict=None, select=None, ttl: int = 1800) -> list:
    res, _ = _paginate("crm.lead.list", filter_dict=filter_dict, select=select)
    return res

def list_deals(filter_dict=None, select=None, ttl: int = 1800) -> list:
    res, _ = _paginate("crm.deal.list", filter_dict=filter_dict, select=select)
    return res

def list_activities(filter_dict=None, select=None, ttl: int = 1800) -> list:
    res, _ = _paginate("crm.activity.list", filter_dict=filter_dict, select=select)
    return res


def get_tasks_by_date(start_date_iso, end_date_iso, ttl: int = 300) -> list:
    return []


def get_visits_by_date(start_date_iso, end_date_iso, ttl: int = 300) -> list:
    filter_dict = {
        f">={TASHRIF_DATE}": start_date_iso,
        f"<={TASHRIF_DATE}": end_date_iso,
    }
    select = ["ID", "ASSIGNED_BY_ID", TASHRIF_DATE]
    res, _ = _paginate("crm.lead.list", filter_dict=filter_dict, select=select)
    return res


def get_todays_visits_leads() -> list:
    now = datetime.now(TSK_TZ)
    start_of_day = now.replace(hour=0, minute=0, second=0, microsecond=0)
    end_of_day = now.replace(hour=23, minute=59, second=59, microsecond=999999)
    filter_dict = {
        f">={TASHRIF_DATE}": start_of_day.isoformat(),
        f"<={TASHRIF_DATE}": end_of_day.isoformat(),
    }
    select = ["ID", "TITLE", "NAME", "LAST_NAME", "PHONE", "ASSIGNED_BY_ID",
              TASHRIF_DATE, TASHRIF_VISTORS_COUNT, "UF_CRM_1774413003006", "STATUS_ID"]
    res, _ = _paginate("crm.lead.list", filter_dict=filter_dict, select=select)
    return res


def get_tomorrows_visits_leads() -> list:
    now = datetime.now(TSK_TZ)
    start_of_tomorrow = (now + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
    end_of_tomorrow = (now + timedelta(days=1)).replace(hour=23, minute=59, second=59, microsecond=999999)
    filter_dict = {
        f">={TASHRIF_DATE}": start_of_tomorrow.isoformat(),
        f"<={TASHRIF_DATE}": end_of_tomorrow.isoformat(),
    }
    select = ["ID", "TITLE", "NAME", "LAST_NAME", "PHONE", "ASSIGNED_BY_ID",
              TASHRIF_DATE, TASHRIF_VISTORS_COUNT, "UF_CRM_1774413003006", "STATUS_ID"]
    res, _ = _paginate("crm.lead.list", filter_dict=filter_dict, select=select)
    return res


# ─── Aggregate helpers ────────────────────────────────────────────────────────

def aggregate_deals_sum_by_user(user_id, start_iso, end_iso, stage_filter=None):
    filter_dict = {
        "ASSIGNED_BY_ID": user_id,
        ">=CLOSEDATE": start_iso,
        "<=CLOSEDATE": end_iso,
    }
    if stage_filter:
        filter_dict["STAGE_ID"] = stage_filter
    deals = list_deals(filter_dict=filter_dict, select=["ID", "OPPORTUNITY"])
    total = 0.0
    for d in deals:
        opp = d.get("OPPORTUNITY")
        try:
            total += float(opp) if opp not in (None, '') else 0.0
        except Exception:
            pass
    return {"sum": total, "count": len(deals)}


def aggregate_deals_sum_total(start_iso, end_iso, stage_filter=None):
    filter_dict = {">=CLOSEDATE": start_iso, "<=CLOSEDATE": end_iso}
    if stage_filter:
        filter_dict["STAGE_ID"] = stage_filter
    deals = list_deals(filter_dict=filter_dict, select=["ID", "OPPORTUNITY"])
    total = 0.0
    for d in deals:
        opp = d.get("OPPORTUNITY")
        try:
            total += float(opp) if opp not in (None, '') else 0.0
        except Exception:
            pass
    return {"sum": total, "count": len(deals)}


# ─── Metadata (lru_cache — rarely changes) ───────────────────────────────────

def get_source_names():
    query = text("SELECT bitrix_id, name FROM sources;")
    with bx_engine.connect() as conn:
        res = conn.execute(query).mappings().all()
        return {r["bitrix_id"]: r["name"] for r in res}


def get_lead_status_names():
    query = text("SELECT bitrix_id, name FROM stages WHERE entity = 'lead';")
    with bx_engine.connect() as conn:
        res = conn.execute(query).mappings().all()
        return {r["bitrix_id"]: r["name"] for r in res}

def get_deal_stage_names():
    query = text("SELECT bitrix_id, name FROM stages WHERE entity = 'deal';")
    with bx_engine.connect() as conn:
        res = conn.execute(query).mappings().all()
        return {r["bitrix_id"]: r["name"] for r in res}


@lru_cache(maxsize=1)
def get_lead_enum_map():
    res = requests.get(f"{BITRIX24_PORTAL}{BITRIX24_TOKEN}/crm.lead.fields.json", timeout=15)
    if res.status_code != 200:
        return {}
    fields = res.json().get("result", {})
    return {
        fid: {str(item["ID"]): item["VALUE"] for item in fdef.get("items", [])}
        for fid, fdef in fields.items()
        if fdef.get("items")
    }


# ─── Stage lookup ─────────────────────────────────────────────────────────────

def get_stage_list(status_id, entity_type="deal"):
    status_type = "DEAL_STAGE" if entity_type == "deal" else "STATUS"
    res = requests.get(
        f"{BITRIX24_PORTAL}{BITRIX24_TOKEN}/crm.status.list.json",
        params={"FILTER[ENTITY_ID]": status_type, "FILTER[STATUS_ID]": status_id}
    )
    if res.status_code == 200:
        fields = res.json().get("result", [])
        return fields[0] if fields else {}
    return {}


# ─── Mutations ────────────────────────────────────────────────────────────────

def create_lead(fields: dict):
    res = requests.post(f"{BITRIX24_PORTAL}{BITRIX24_TOKEN}/crm.lead.add.json", json={"fields": fields})
    return res.json().get("result") if res.status_code == 200 else None


def set_lead_responsible(lead_id, user_id):
    res = requests.post(
        f"{BITRIX24_PORTAL}{BITRIX24_TOKEN}/crm.lead.update.json",
        json={"id": lead_id, "fields": {"ASSIGNED_BY_ID": user_id}}
    )
    return res.json().get("result") if res.status_code == 200 else None


def update_lead_status(lead_id, status_id):
    res = requests.post(
        f"{BITRIX24_PORTAL}{BITRIX24_TOKEN}/crm.lead.update.json",
        json={"id": lead_id, "fields": {"STATUS_ID": status_id}}
    )
    return res.json().get("result") if res.status_code == 200 else None


def update_lead_fields(lead_id, fields):
    res = requests.post(
        f"{BITRIX24_PORTAL}{BITRIX24_TOKEN}/crm.lead.update.json",
        json={"id": lead_id, "fields": fields}
    )
    return res.json().get("result") if res.status_code == 200 else None


def set_deal_responsible(deal_id, user_id):
    res = requests.post(
        f"{BITRIX24_PORTAL}{BITRIX24_TOKEN}/crm.deal.update.json",
        json={"id": deal_id, "fields": {"ASSIGNED_BY_ID": user_id}}
    )
    return res.json().get("result") if res.status_code == 200 else None


def sms_log_save(contact_id, message):
    res = requests.post(
        f"{BITRIX24_PORTAL}{BITRIX24_TOKEN}/crm.timeline.logmessage.add",
        json={"fields": {
            "entityTypeId": 3,
            "entityId": contact_id,
            "text": str(message),
            "title": "SMS yuborildi",
            "iconCode": "sms"
        }}
    )
    return res.json().get("result") if res.status_code == 200 else None


# ─── Activities ───────────────────────────────────────────────────────────────

def is_overdue(dt_str):
    if not dt_str:
        return False
    dt = parse_b24_datetime(dt_str)
    if not dt:
        return False
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=ZoneInfo("UTC")).astimezone(TSK_TZ)
    else:
        dt = dt.astimezone(TSK_TZ)
    return dt < datetime.now(TSK_TZ)


def get_uncompleted_activities(entity_type, entity_id):
    type_id = 1 if entity_type == 'lead' else 2

    # Fetch TASKS_TASK and TODO in parallel
    with ThreadPoolExecutor(max_workers=2) as pool:
        f_tasks = pool.submit(lambda: requests.get(
            f"{BITRIX24_PORTAL}{BITRIX24_TOKEN}/crm.activity.list",
            params={
                "filter[OWNER_TYPE_ID]": type_id,
                "filter[OWNER_ID]": entity_id,
                "filter[COMPLETED]": "N",
                "filter[PROVIDER_TYPE_ID]": "TASKS_TASK",
                "select[]": ["ID", "ASSOCIATED_ENTITY_ID"]
            }
        ).json())
        f_todos = pool.submit(lambda: requests.get(
            f"{BITRIX24_PORTAL}{BITRIX24_TOKEN}/crm.activity.list",
            params={
                "filter[OWNER_TYPE_ID]": type_id,
                "filter[OWNER_ID]": entity_id,
                "filter[COMPLETED]": "N",
                "filter[PROVIDER_TYPE_ID]": "TODO",
                "select[]": ["ID", "DEADLINE", "SUBJECT"]
            }
        ).json())

    task_acts = f_tasks.result().get("result", [])
    todo_acts = f_todos.result().get("result", [])

    # Fetch all task details in parallel (N+1 → parallel N)
    task_ids = [a.get("ASSOCIATED_ENTITY_ID") for a in task_acts if a.get("ASSOCIATED_ENTITY_ID")]
    task_details: dict = {}
    if task_ids:
        with ThreadPoolExecutor(max_workers=min(len(task_ids), 8)) as pool:
            futures = {tid: pool.submit(get_task, int(tid)) for tid in task_ids}
            for tid, future in futures.items():
                task_details[tid] = future.result()

    tasks_overdue = [
        act for act in task_acts
        if (t := task_details.get(act.get("ASSOCIATED_ENTITY_ID"))) and is_overdue(t.get("deadline"))
    ]
    todos_overdue = [act for act in todo_acts if is_overdue(act.get("DEADLINE"))]

    return {"TASKS_TASK": tasks_overdue, "TODO": todos_overdue}

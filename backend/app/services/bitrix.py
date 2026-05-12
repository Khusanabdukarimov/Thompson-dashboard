import os
import json
import hashlib
import logging
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from functools import lru_cache
from urllib.parse import urlencode
from zoneinfo import ZoneInfo

import requests
import redis as redis_lib
from dateutil.parser import parse as parse_b24_datetime

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

TSK_TZ = ZoneInfo("Asia/Tashkent")
log = logging.getLogger(__name__)

# ─── Redis ────────────────────────────────────────────────────────────────────

_redis: redis_lib.Redis | None = None

def _get_redis() -> redis_lib.Redis | None:
    global _redis
    if _redis is not None:
        return _redis
    try:
        r = redis_lib.Redis(host="localhost", port=6379, db=0, socket_timeout=1, socket_connect_timeout=1)
        r.ping()
        _redis = r
    except Exception:
        _redis = None
    return _redis


def _cache_key(method: str, filter_dict=None, select=None, extra: dict | None = None) -> str:
    payload = json.dumps({"m": method, "f": filter_dict, "s": select, "e": extra}, sort_keys=True)
    return "b24:" + hashlib.md5(payload.encode()).hexdigest()


def _cache_get(key: str):
    r = _get_redis()
    if not r:
        return None
    try:
        raw = r.get(key)
        return json.loads(raw) if raw else None
    except Exception:
        return None


def _cache_set(key: str, value, ttl: int = 300):
    r = _get_redis()
    if not r:
        return
    try:
        r.setex(key, ttl, json.dumps(value, default=str))
    except Exception:
        pass


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


def _fetch_batch_chunk(method: str, base_params: dict, starts: list[int]) -> list:
    """Send one batch request covering up to 50 pages and return combined results."""
    batch_url = f"{BITRIX24_PORTAL}{BITRIX24_TOKEN}/batch"
    cmd = {}
    for i, s in enumerate(starts):
        page_params = {**base_params, "start": s}
        cmd[f"p{i}"] = f"{method}?" + urlencode(page_params, doseq=True)

    try:
        res = requests.post(batch_url, json={"halt": 0, "cmd": cmd}, timeout=30)
        if res.status_code != 200:
            return []
        result_map = res.json().get("result", {}).get("result", {})
        items = []
        for i in range(len(starts)):
            page = result_map.get(f"p{i}", [])
            if isinstance(page, list):
                items.extend(page)
        return items
    except Exception as exc:
        log.warning("batch chunk failed: %s", exc)
        return []


def _paginate(method: str, filter_dict=None, select=None, extra: dict | None = None) -> list:
    """
    Fetch all pages for a Bitrix24 list method.

    Strategy:
      1. Fetch page 0 to get `total`.
      2. Group remaining page offsets into chunks of 50.
      3. Fire each chunk as a single batch request (in parallel if >1 chunk).

    Worst case for 1 000 leads (20 pages):
      Before: 20 sequential HTTP calls ≈ 30s
      After : 1 first call + 1 batch call  ≈  3s
    """
    list_url = f"{BITRIX24_PORTAL}{BITRIX24_TOKEN}/{method}"
    base_params = _build_params(filter_dict, select, extra)

    try:
        res = requests.get(list_url, params={**base_params, "start": 0}, timeout=20)
        if res.status_code != 200:
            return []
    except Exception as exc:
        log.warning("first page failed (%s): %s", method, exc)
        return []

    data = res.json()
    all_items: list = data.get("result", [])
    total: int = data.get("total", 0)

    if total <= 50:
        return all_items

    remaining = list(range(50, total, 50))
    chunks = [remaining[i:i + 50] for i in range(0, len(remaining), 50)]

    if len(chunks) == 1:
        all_items.extend(_fetch_batch_chunk(method, base_params, chunks[0]))
    else:
        with ThreadPoolExecutor(max_workers=min(len(chunks), 4)) as pool:
            futures = [pool.submit(_fetch_batch_chunk, method, base_params, ch) for ch in chunks]
            for f in futures:
                all_items.extend(f.result())

    return all_items


def _paginate_cached(method: str, filter_dict=None, select=None,
                     extra: dict | None = None, ttl: int = 300) -> list:
    key = _cache_key(method, filter_dict, select, extra)
    cached = _cache_get(key)
    if cached is not None:
        return cached
    result = _paginate(method, filter_dict, select, extra)
    _cache_set(key, result, ttl)
    return result


# ─── Single-entity fetches ────────────────────────────────────────────────────

def get_lead_details(lead_id):
    res = requests.get(f"{BITRIX24_PORTAL}{BITRIX24_TOKEN}/crm.lead.get.json", params={"id": lead_id})
    return res.json().get("result") if res.status_code == 200 else None


def get_deal_details(deal_id):
    res = requests.get(f"{BITRIX24_PORTAL}{BITRIX24_TOKEN}/crm.deal.get.json", params={"id": deal_id})
    return res.json().get("result") if res.status_code == 200 else None


def get_contact_details(contact_id):
    res = requests.get(f"{BITRIX24_PORTAL}{BITRIX24_TOKEN}/crm.contact.get.json", params={"id": contact_id})
    return res.json().get("result") if res.status_code == 200 else None


def get_user_details(user_id):
    res = requests.get(f"{BITRIX24_PORTAL}{BITRIX24_TOKEN}/user.get.json", params={"ID": user_id})
    if res.status_code == 200:
        result = res.json().get("result")
        return result[0] if result else None
    return None


def get_task(task_id):
    res = requests.get(
        f"{BITRIX24_PORTAL}{BITRIX24_TOKEN}/tasks.task.get",
        params={"taskId": task_id, "select[]": {"UF_CRM_TASK", "TITLE", "CREATED_DATE", "DEADLINE", "STATUS", "RESPONSIBLE_ID"}}
    )
    if res.status_code == 200:
        return res.json().get("result", {}).get("task")
    return None


def get_timeman_status(user_id):
    res = requests.get(f"{BITRIX24_PORTAL}{BITRIX24_TOKEN}/timeman.status", params={"USER_ID": user_id})
    return res.json().get("result") if res.status_code == 200 else None


def get_booking_details(booking_id):
    res = requests.get(f"{BITRIX24_PORTAL}{BITRIX24_TOKEN}/booking.v1.booking.get", params={"id": booking_id})
    return res.json().get("result") if res.status_code == 200 else None


def get_booking_clients(booking_id):
    res = requests.get(f"{BITRIX24_PORTAL}{BITRIX24_TOKEN}/booking.v1.booking.client.list", params={"bookingId": booking_id})
    if res.status_code == 200:
        return res.json().get("result", {}).get("bookingClient", [])
    return None


# ─── List functions (batch-paginated + Redis cached) ─────────────────────────

def list_users(ttl: int = 600) -> list:
    return _paginate_cached("user.get.json", filter_dict={"ACTIVE": "Y"}, ttl=ttl)


def list_leads(filter_dict=None, select=None, ttl: int = 300) -> list:
    return _paginate_cached("crm.lead.list", filter_dict=filter_dict, select=select, ttl=ttl)


def list_deals(filter_dict=None, select=None, ttl: int = 300) -> list:
    return _paginate_cached("crm.deal.list", filter_dict=filter_dict, select=select, ttl=ttl)


def list_activities(filter_dict=None, select=None, ttl: int = 300) -> list:
    return _paginate_cached("crm.activity.list", filter_dict=filter_dict, select=select, ttl=ttl)


def get_tasks_by_date(start_date_iso, end_date_iso, ttl: int = 300) -> list:
    filter_dict = {">=CREATED_DATE": start_date_iso, "<=CREATED_DATE": end_date_iso}
    select = ["ID", "RESPONSIBLE_ID", "TITLE"]
    key = _cache_key("tasks.task.list", filter_dict, select)
    cached = _cache_get(key)
    if cached is not None:
        return cached

    # tasks.task.list returns result.tasks, not result directly — handle manually
    list_url = f"{BITRIX24_PORTAL}{BITRIX24_TOKEN}/tasks.task.list"
    base_params = _build_params(filter_dict, select)
    all_tasks: list = []
    start = 0
    while True:
        res = requests.get(list_url, params={**base_params, "start": start}, timeout=20)
        if res.status_code != 200:
            break
        data = res.json()
        tasks = data.get("result", {}).get("tasks", [])
        all_tasks.extend(tasks)
        if "next" in data:
            start = data["next"]
        else:
            break

    _cache_set(key, all_tasks, ttl)
    return all_tasks


def get_visits_by_date(start_date_iso, end_date_iso, ttl: int = 300) -> list:
    filter_dict = {
        f">={TASHRIF_DATE}": start_date_iso,
        f"<={TASHRIF_DATE}": end_date_iso,
    }
    select = ["ID", "ASSIGNED_BY_ID", TASHRIF_DATE]
    return _paginate_cached("crm.lead.list", filter_dict=filter_dict, select=select, ttl=ttl)


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
    return _paginate_cached("crm.lead.list", filter_dict=filter_dict, select=select, ttl=60)


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
    return _paginate_cached("crm.lead.list", filter_dict=filter_dict, select=select, ttl=60)


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

@lru_cache(maxsize=1)
def get_lead_status_names():
    res = requests.get(
        f"{BITRIX24_PORTAL}{BITRIX24_TOKEN}/crm.status.list.json",
        params={"filter[ENTITY_ID]": "STATUS"}, timeout=10
    )
    if res.status_code != 200:
        return {}
    return {s["STATUS_ID"]: s["NAME"] for s in res.json().get("result", [])}


@lru_cache(maxsize=1)
def get_deal_source_names():
    res = requests.get(
        f"{BITRIX24_PORTAL}{BITRIX24_TOKEN}/crm.status.list.json",
        params={"filter[ENTITY_ID]": "SOURCE"}, timeout=10
    )
    if res.status_code != 200:
        return {}
    return {s["STATUS_ID"]: s["NAME"] for s in res.json().get("result", [])}


def get_deal_stage_names():
    stages = {}
    res = requests.get(
        f"{BITRIX24_PORTAL}{BITRIX24_TOKEN}/crm.status.list.json",
        params={"filter[ENTITY_ID]": "DEAL_STAGE"}
    )
    if res.status_code == 200:
        for s in res.json().get("result", []):
            stages[s["STATUS_ID"]] = s["NAME"]
    try:
        cat_res = requests.get(f"{BITRIX24_PORTAL}{BITRIX24_TOKEN}/crm.deal.category.list.json")
        if cat_res.status_code == 200:
            cats = cat_res.json().get("result", [])
            # Fetch all category stages in parallel
            def _fetch_cat_stages(cat_id):
                r = requests.get(
                    f"{BITRIX24_PORTAL}{BITRIX24_TOKEN}/crm.deal.category.stages.json",
                    params={"id": cat_id}
                )
                return r.json().get("result", []) if r.status_code == 200 else []

            with ThreadPoolExecutor(max_workers=min(len(cats), 8)) as pool:
                futures = {cat.get("ID"): pool.submit(_fetch_cat_stages, cat.get("ID")) for cat in cats if cat.get("ID")}
                for cat_id, future in futures.items():
                    for s in future.result():
                        stages[s["STATUS_ID"]] = s["NAME"]
    except Exception:
        pass
    return stages


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

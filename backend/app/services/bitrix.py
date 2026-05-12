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


_PAGE_DELAY = 0.4  # seconds between page requests — keeps us ≤ 2.5 req/s


def _paginate(method: str, filter_dict=None, select=None, extra: dict | None = None) -> tuple[list, int]:
    """
    Sequential pagination: one page at a time with a small inter-page delay.
    The distributed lock in _paginate_cached guarantees only ONE process
    runs this at a time, so there is no thundering-herd risk.
    """
    list_url = f"{BITRIX24_PORTAL}{BITRIX24_TOKEN}/{method}"
    base_params = _build_params(filter_dict, select, extra)

    try:
        res = _session.get(list_url, params={**base_params, "start": 0}, timeout=30)
        if res.status_code != 200:
            return [], 0
    except Exception as exc:
        log.warning("first page failed (%s): %s", method, exc)
        return [], 0

    data = res.json()
    if "error" in data:
        log.warning("first page error (%s): %s", method, data["error"])
        return [], 0

    all_items: list = list(data.get("result", []))
    total: int = data.get("total", 0)

    if total <= 50:
        return all_items, total

    for start in range(50, total, 50):
        time.sleep(_PAGE_DELAY)
        items = _fetch_page(list_url, base_params, start)
        all_items.extend(items)

    log.info("_paginate %s: total=%d fetched=%d", method, total, len(all_items))
    return all_items, total


def _paginate_cached(method: str, filter_dict=None, select=None,
                     extra: dict | None = None, ttl: int = 300) -> list:
    key = _cache_key(method, filter_dict, select, extra)

    # 1. Fast path — no lock needed
    cached = _cache_get(key)
    if cached is not None:
        return cached

    # 2. Distributed lock (Redis SETNX) — prevents thundering herd across
    #    uvicorn worker processes.  Only ONE process fetches; others wait.
    r = _get_redis()
    dist_lock_key = f"b24:lock:{key}"
    dist_token = f"{os.getpid()}:{threading.get_ident()}"
    dist_acquired = bool(r.set(dist_lock_key, dist_token, nx=True, ex=120)) if r else True

    if not dist_acquired:
        log.info("_paginate_cached %s: another process is fetching — waiting…", method)
        for _w in range(90):
            time.sleep(1)
            cached = _cache_get(key)
            if cached is not None:
                log.info("_paginate_cached %s: got result after waiting %ds", method, _w + 1)
                return cached
        log.warning("_paginate_cached %s: wait timeout — fetching directly", method)
        # Fall through without owning the dist lock (best-effort)

    # 3. Within-process lock per cache key — prevents duplicate threads inside
    #    the same uvicorn worker from both fetching at the same time.
    local_lock = _get_fetch_lock(key)
    with local_lock:
        cached = _cache_get(key)
        if cached is not None:
            _release_dist_lock(r, dist_lock_key, dist_token, dist_acquired)
            return cached

        try:
            result, total = _paginate(method, filter_dict, select, extra)
            complete = total == 0 or len(result) >= total * 0.95
            if result and complete:
                _cache_set(key, result, ttl)
            elif result and not complete:
                log.warning("_paginate_cached %s: incomplete (%d/%d) — not caching",
                            method, len(result), total)
            return result
        finally:
            _release_dist_lock(r, dist_lock_key, dist_token, dist_acquired)


def _release_dist_lock(r, lock_key: str, token: str, acquired: bool):
    if not acquired or not r:
        return
    try:
        current = r.get(lock_key)
        if current and current.decode() == token:
            r.delete(lock_key)
    except Exception:
        pass


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

def list_users(ttl: int = 1800) -> list:
    return _paginate_cached("user.get.json", filter_dict={"ACTIVE": "Y"}, ttl=ttl)


def list_leads(filter_dict=None, select=None, ttl: int = 1800) -> list:
    return _paginate_cached("crm.lead.list", filter_dict=filter_dict, select=select, ttl=ttl)


def list_deals(filter_dict=None, select=None, ttl: int = 1800) -> list:
    return _paginate_cached("crm.deal.list", filter_dict=filter_dict, select=select, ttl=ttl)


def list_activities(filter_dict=None, select=None, ttl: int = 1800) -> list:
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

    if all_tasks:
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

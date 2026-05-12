import os

# Try to import project config helper, otherwise fall back to environment variables.
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
    # Default custom field names for visit date / visitors count — adapt to your CRM
    TASHRIF_DATE = os.environ.get('TASHRIF_DATE', 'UF_CRM_VISIT_DATE')
    TASHRIF_VISTORS_COUNT = os.environ.get('TASHRIF_VISTORS_COUNT', 'UF_CRM_VISITORS_COUNT')
from datetime import datetime
from functools import lru_cache

import requests
from dateutil.parser import parse as parse_b24_datetime


def get_lead_details(lead_id):
    url = f"{BITRIX24_PORTAL}{BITRIX24_TOKEN}/crm.lead.get.json"
    params = {"id": lead_id}
    res = requests.get(url, params=params)
    if res.status_code == 200:
        return res.json().get("result")
    return None

def get_deal_details(deal_id):
    url = f"{BITRIX24_PORTAL}{BITRIX24_TOKEN}/crm.deal.get.json"
    params = {"id": deal_id}
    res = requests.get(url, params=params)
    if res.status_code == 200:
        return res.json().get("result")
    return None

def get_contact_details(contact_id):
    url = f"{BITRIX24_PORTAL}{BITRIX24_TOKEN}/crm.contact.get.json"
    params = {"id": contact_id}
    res = requests.get(url, params=params)
    if res.status_code == 200:
        return res.json().get("result")
    return None

def get_user_details(user_id):
    url = f"{BITRIX24_PORTAL}{BITRIX24_TOKEN}/user.get.json"
    params = {"ID": user_id}
    res = requests.get(url, params=params)
    print(res.json().get("result"))
    if res.status_code == 200:
        result = res.json().get("result")
        return result[0] if result else None
    return None


def list_users():
    """Return list of users from Bitrix24 (basic fields).

    This is a small wrapper used to populate employee dropdowns in the frontend.
    """
    url = f"{BITRIX24_PORTAL}{BITRIX24_TOKEN}/user.get.json"
    all_users = []
    start = 0
    try:
        while True:
            res = requests.get(url, params={"start": start, "ACTIVE": "Y"})
            if res.status_code != 200:
                break
            data = res.json()
            page = data.get("result", [])
            all_users.extend(page)
            if "next" in data:
                start = data["next"]
            else:
                break
    except Exception as e:
        print(f"Error listing users: {e}")
    return all_users


def create_lead(fields: dict):
    """Create a lead in Bitrix24 using crm.lead.add endpoint.

    fields: dict of lead fields (TITLE, NAME, LAST_NAME, PHONE, ASSIGNED_BY_ID, etc.)
    Returns the created lead id or None.
    """
    url = f"{BITRIX24_PORTAL}{BITRIX24_TOKEN}/crm.lead.add.json"
    data = {"fields": fields}
    try:
        res = requests.post(url, json=data)
        if res.status_code == 200:
            return res.json().get("result")
    except Exception as e:
        print(f"Error creating lead: {e}")
    return None

def get_stage_list(status_id, entity_type="deal"):
    """
    Deal yoki Lead uchun stage/status nomini olish.
    """
    url = f"{BITRIX24_PORTAL}{BITRIX24_TOKEN}/crm.status.list.json"

    # Lead va Deal uchun STATUS_TYPE farqli
    status_type = "DEAL_STAGE" if entity_type == "deal" else "STATUS"

    params = {
        "FILTER[ENTITY_ID]": status_type,
        "FILTER[STATUS_ID]": status_id
    }

    res = requests.get(url, params=params)
    if res.status_code == 200:
        fields = res.json().get("result", [])
        return fields[0] if fields else {}
    return {}

from zoneinfo import ZoneInfo

TSK_TZ = ZoneInfo("Asia/Tashkent")

def is_overdue(dt_str):
    if not dt_str:
        return False
    dt = parse_b24_datetime(dt_str)
    if not dt:
        return False
    
    # If dt has no timezone info, assume UTC then convert to Tashkent
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=ZoneInfo("UTC")).astimezone(TSK_TZ)
    else:
        # If it has timezone (like Bitrix ISO format), convert to Tashkent
        dt = dt.astimezone(TSK_TZ)
        
    now = datetime.now(TSK_TZ)
    return dt < now
def get_uncompleted_activities(entity_type, entity_id):
    type_id = 1 if entity_type == 'lead' else 2

    # --- TASKS ---
    response = requests.get(
        f"{BITRIX24_PORTAL}{BITRIX24_TOKEN}/crm.activity.list",
        params={
            "filter[OWNER_TYPE_ID]": type_id,
            "filter[OWNER_ID]": entity_id,
            "filter[COMPLETED]": "N",
            "filter[PROVIDER_TYPE_ID]": "TASKS_TASK",
            "select[]": ["ID", "ASSOCIATED_ENTITY_ID"]
        }
    ).json()

    tasks_overdue = []
    for act in response.get("result", []):
        task_id = act.get("ASSOCIATED_ENTITY_ID")
        if not task_id:
            continue

        task = get_task(int(task_id))
        if not task:
            continue

        if is_overdue(task.get("deadline")):
            tasks_overdue.append(act)

    # --- TODO ---
    response2 = requests.get(
        f"{BITRIX24_PORTAL}{BITRIX24_TOKEN}/crm.activity.list",
        params={
            "filter[OWNER_TYPE_ID]": type_id,
            "filter[OWNER_ID]": entity_id,
            "filter[COMPLETED]": "N",
            "filter[PROVIDER_TYPE_ID]": "TODO",
            "select[]": ["ID", "DEADLINE", "SUBJECT"]
        }
    ).json()

    todos_overdue = []
    for act in response2.get("result", []):
        if is_overdue(act.get("DEADLINE")):
            todos_overdue.append(act)

    # Return only overdue activities
    return {
        "TASKS_TASK": tasks_overdue,
        "TODO": todos_overdue
    }



def get_booking_details(booking_id):
    url = f"{BITRIX24_PORTAL}{BITRIX24_TOKEN}/booking.v1.booking.get"
    params = {"id": booking_id}
    res = requests.get(url, params=params)
    print(res.json())
    if res.status_code == 200:
        return res.json().get("result")
    return None

def get_booking_clients(booking_id):
    url = f"{BITRIX24_PORTAL}{BITRIX24_TOKEN}/booking.v1.booking.client.list"
    params = {"bookingId": booking_id}
    res = requests.get(url, params=params)
    print(res.json())
    if res.status_code == 200:
        return res.json().get("result").get("bookingClient", [])
    return None

#crm.timeline.logmessage.add
def sms_log_save(contact_id, message):
    url = f"{BITRIX24_PORTAL}{BITRIX24_TOKEN}/crm.timeline.logmessage.add"
    data = {
        "fields": {
            "entityTypeId": 3,
            "entityId": contact_id,
            "text": f"{message}",
            "title": "SMS yuborildi",
            "iconCode": "sms"
        }
    }
    res = requests.post(url, json=data)
    if res.status_code == 200:
        return res.json().get("result")
    return None

def set_lead_responsible(lead_id, user_id):
  
    url = f"{BITRIX24_PORTAL}{BITRIX24_TOKEN}/crm.lead.update.json"
    data = {
        "id": lead_id,
        "fields": {
            "ASSIGNED_BY_ID": user_id
        }
    }
    res = requests.post(url, json=data)
    if res.status_code == 200:
        return res.json().get("result")
    return None

def update_lead_status(lead_id, status_id):
    url = f"{BITRIX24_PORTAL}{BITRIX24_TOKEN}/crm.lead.update.json"
    data = {
        "id": lead_id,
        "fields": {
            "STATUS_ID": status_id
        }
    }
    res = requests.post(url, json=data)
    if res.status_code == 200:
        return res.json().get("result")
    return None

def update_lead_fields(lead_id, fields):
    url = f"{BITRIX24_PORTAL}{BITRIX24_TOKEN}/crm.lead.update.json"
    data = {
        "id": lead_id,
        "fields": fields
    }
    res = requests.post(url, json=data)
    if res.status_code == 200:
        return res.json().get("result")
    return None

def set_deal_responsible(deal_id, user_id):
  
    url = f"{BITRIX24_PORTAL}{BITRIX24_TOKEN}/crm.deal.update.json"
    data = {
        "id": deal_id,
        "fields": {
            "ASSIGNED_BY_ID": user_id
        }
    }
    res = requests.post(url, json=data)
    if res.status_code == 200:
        return res.json().get("result")
    return None


def get_task(task_id):
    url = f"{BITRIX24_PORTAL}{BITRIX24_TOKEN}/tasks.task.get"
    params = {"taskId": task_id, "select[]": {"UF_CRM_TASK", "TITLE", "CREATED_DATE", "DEADLINE", "STATUS", "RESPONSIBLE_ID"}}
    res = requests.get(url, params=params)
    if res.status_code == 200:
        return res.json().get("result").get("task")
    return None

def get_timeman_status(user_id):
    url = f"{BITRIX24_PORTAL}{BITRIX24_TOKEN}/timeman.status"
    params = {"USER_ID": user_id}
    res = requests.get(url, params=params)
    
    if res.status_code == 200:
        return res.json().get("result")
    return None

def get_todays_visits_leads():
    url = f"{BITRIX24_PORTAL}{BITRIX24_TOKEN}/crm.lead.list"
    now = datetime.now(TSK_TZ)
    start_of_day = now.replace(hour=0, minute=0, second=0, microsecond=0)
    end_of_day = now.replace(hour=23, minute=59, second=59, microsecond=999999)
    
    params = {
        "filter[>={}]".format(TASHRIF_DATE): start_of_day.isoformat(),
        "filter[<={}]".format(TASHRIF_DATE): end_of_day.isoformat(),
        "select[]": ["ID", "TITLE", "NAME", "LAST_NAME", "PHONE", "ASSIGNED_BY_ID", TASHRIF_DATE, TASHRIF_VISTORS_COUNT, "UF_CRM_1774413003006", "STATUS_ID"]
    }
    res = requests.get(url, params=params)
    if res.status_code == 200:
        return res.json().get("result", [])
    return []

from datetime import timedelta


def get_tomorrows_visits_leads():
    url = f"{BITRIX24_PORTAL}{BITRIX24_TOKEN}/crm.lead.list"
    now = datetime.now(TSK_TZ)
    start_of_tomorrow = (now + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
    end_of_tomorrow = (now + timedelta(days=1)).replace(hour=23, minute=59, second=59, microsecond=999999)
    
    params = {
        "filter[>={}]".format(TASHRIF_DATE): start_of_tomorrow.isoformat(),
        "filter[<={}]".format(TASHRIF_DATE): end_of_tomorrow.isoformat(),
        "select[]": ["ID", "TITLE", "NAME", "LAST_NAME", "PHONE", "ASSIGNED_BY_ID", TASHRIF_DATE, TASHRIF_VISTORS_COUNT, "UF_CRM_1774413003006", "STATUS_ID"]
    }
    res = requests.get(url, params=params)
    if res.status_code == 200:
        return res.json().get("result", [])
    return []

def get_tasks_by_date(start_date_iso, end_date_iso):
    url = f"{BITRIX24_PORTAL}{BITRIX24_TOKEN}/tasks.task.list"
    all_tasks = []
    start = 0
    while True:
        params = {
            "filter[>=CREATED_DATE]": start_date_iso,
            "filter[<=CREATED_DATE]": end_date_iso,
            "select[]": ["ID", "RESPONSIBLE_ID", "TITLE"],
            "start": start
        }
        res = requests.get(url, params=params)
        if res.status_code == 200:
            data = res.json()
            tasks = data.get("result", {}).get("tasks", [])
            all_tasks.extend(tasks)
            if "next" in data:
                start = data["next"]
            else:
                break
        else:
            break
    return all_tasks

def get_visits_by_date(start_date_iso, end_date_iso):
    url = f"{BITRIX24_PORTAL}{BITRIX24_TOKEN}/crm.lead.list"
    all_leads = []
    start = 0
    while True:
        params = {
            "filter[>={}]".format(TASHRIF_DATE): start_date_iso,
            "filter[<={}]".format(TASHRIF_DATE): end_date_iso,
            "select[]": ["ID", "ASSIGNED_BY_ID", TASHRIF_DATE],
            "start": start
        }
        res = requests.get(url, params=params)
        if res.status_code == 200:
            data = res.json()
            leads = data.get("result", [])
            all_leads.extend(leads)
            if "next" in data:
                start = data["next"]
            else:
                break
        else:
            break
    return all_leads


@lru_cache(maxsize=1)
def get_lead_status_names():
    """Returns {status_id: name} for all lead statuses. Cached for process lifetime."""
    url = f"{BITRIX24_PORTAL}{BITRIX24_TOKEN}/crm.status.list.json"
    res = requests.get(url, params={"filter[ENTITY_ID]": "STATUS"}, timeout=10)
    if res.status_code != 200:
        return {}
    return {s["STATUS_ID"]: s["NAME"] for s in res.json().get("result", [])}


@lru_cache(maxsize=1)
def get_deal_source_names():
    """Returns {source_id: name} for all deal/lead sources. Cached for process lifetime."""
    url = f"{BITRIX24_PORTAL}{BITRIX24_TOKEN}/crm.status.list.json"
    res = requests.get(url, params={"filter[ENTITY_ID]": "SOURCE"}, timeout=10)
    if res.status_code != 200:
        return {}
    return {s["STATUS_ID"]: s["NAME"] for s in res.json().get("result", [])}


def get_deal_stage_names():
    """Returns {stage_id: name} for deal stages across all pipelines."""
    stages = {}
    url = f"{BITRIX24_PORTAL}{BITRIX24_TOKEN}/crm.status.list.json"
    res = requests.get(url, params={"filter[ENTITY_ID]": "DEAL_STAGE"})
    if res.status_code == 200:
        for s in res.json().get("result", []):
            stages[s["STATUS_ID"]] = s["NAME"]
    try:
        cat_res = requests.get(f"{BITRIX24_PORTAL}{BITRIX24_TOKEN}/crm.deal.category.list.json")
        if cat_res.status_code == 200:
            for cat in cat_res.json().get("result", []):
                cat_id = cat.get("ID")
                if cat_id:
                    st_res = requests.get(
                        f"{BITRIX24_PORTAL}{BITRIX24_TOKEN}/crm.deal.category.stages.json",
                        params={"id": cat_id}
                    )
                    if st_res.status_code == 200:
                        for s in st_res.json().get("result", []):
                            stages[s["STATUS_ID"]] = s["NAME"]
    except Exception:
        pass
    return stages


@lru_cache(maxsize=1)
def get_lead_enum_map():
    """Returns {field_id: {enum_id: label}} for all enumerated lead fields.
    Cached for process lifetime — crm.lead.fields.json is a large, slow call.
    """
    url = f"{BITRIX24_PORTAL}{BITRIX24_TOKEN}/crm.lead.fields.json"
    res = requests.get(url, timeout=15)
    if res.status_code != 200:
        return {}
    fields = res.json().get("result", {})
    return {
        fid: {str(item["ID"]): item["VALUE"] for item in fdef.get("items", [])}
        for fid, fdef in fields.items()
        if fdef.get("items")
    }


def list_deals(filter_dict=None, select=None):
    url = f"{BITRIX24_PORTAL}{BITRIX24_TOKEN}/crm.deal.list"
    all_deals = []
    start = 0
    while True:
        params = {"start": start}
        if filter_dict:
            for k, v in filter_dict.items():
                params[f"filter[{k}]"] = v
        if select:
            params["select[]"] = select
        res = requests.get(url, params=params)
        if res.status_code == 200:
            data = res.json()
            deals = data.get("result", [])
            all_deals.extend(deals)
            if "next" in data:
                start = data["next"]
            else:
                break
        else:
            break
    return all_deals


def list_leads(filter_dict=None, select=None):
    """Generic wrapper around crm.lead.list with pagination.

    filter_dict: mapping of filter keys to values (e.g. {"ASSIGNED_BY_ID": 12})
    select: list of fields to request
    Returns a list of lead dicts.
    """
    url = f"{BITRIX24_PORTAL}{BITRIX24_TOKEN}/crm.lead.list"
    all_leads = []
    start = 0
    while True:
        params = {"start": start}
        if filter_dict:
            for k, v in filter_dict.items():
                params[f"filter[{k}]"] = v
        if select:
            params["select[]"] = select

        res = requests.get(url, params=params)
        if res.status_code == 200:
            data = res.json()
            leads = data.get("result", [])
            all_leads.extend(leads)
            if "next" in data:
                start = data["next"]
            else:
                break
        else:
            break
    return all_leads


def aggregate_deals_sum_by_user(user_id, start_iso, end_iso, stage_filter=None):
    """Aggregate sum of OPPORTUNITY for deals assigned to user between dates (close date).

    Returns dict {"sum": float, "count": int}
    """
    url = f"{BITRIX24_PORTAL}{BITRIX24_TOKEN}/crm.deal.list"
    total = 0.0
    count = 0
    start = 0
    while True:
        params = {
            "filter[ASSIGNED_BY_ID]": user_id,
            "filter[>=CLOSEDATE]": start_iso,
            "filter[<=CLOSEDATE]": end_iso,
            "select[]": ["ID", "OPPORTUNITY"],
            "start": start
        }
        if stage_filter:
            params[f"filter[STAGE_ID]"] = stage_filter

        res = requests.get(url, params=params)
        if res.status_code == 200:
            data = res.json()
            deals = data.get("result", [])
            for d in deals:
                opp = d.get("OPPORTUNITY")
                try:
                    val = float(opp) if opp not in (None, '') else 0.0
                except Exception:
                    val = 0.0
                total += val
                count += 1
            if "next" in data:
                start = data["next"]
            else:
                break
        else:
            break
    return {"sum": total, "count": count}


def aggregate_deals_sum_total(start_iso, end_iso, stage_filter=None):
    """Aggregate total OPPORTUNITY sum for all deals between dates.

    Returns dict {"sum": float, "count": int}
    """
    url = f"{BITRIX24_PORTAL}{BITRIX24_TOKEN}/crm.deal.list"
    total = 0.0
    count = 0
    start = 0
    while True:
        params = {
            "filter[>=CLOSEDATE]": start_iso,
            "filter[<=CLOSEDATE]": end_iso,
            "select[]": ["ID", "OPPORTUNITY"],
            "start": start
        }
        if stage_filter:
            params[f"filter[STAGE_ID]"] = stage_filter

        res = requests.get(url, params=params)
        if res.status_code == 200:
            data = res.json()
            deals = data.get("result", [])
            for d in deals:
                opp = d.get("OPPORTUNITY")
                try:
                    val = float(opp) if opp not in (None, '') else 0.0
                except Exception:
                    val = 0.0
                total += val
                count += 1
            if "next" in data:
                start = data["next"]
            else:
                break
        else:
            break
    return {"sum": total, "count": count}


def list_activities(filter_dict=None, select=None):
    """List CRM activities with pagination."""
    url = f"{BITRIX24_PORTAL}{BITRIX24_TOKEN}/crm.activity.list"
    all_items = []
    start = 0
    while True:
        params = {"start": start}
        if filter_dict:
            for k, v in filter_dict.items():
                params[f"filter[{k}]"] = v
        if select:
            params["select[]"] = select
        res = requests.get(url, params=params)
        if res.status_code == 200:
            data = res.json()
            items = data.get("result", [])
            all_items.extend(items)
            if "next" in data:
                start = data["next"]
            else:
                break
        else:
            break
    return all_items
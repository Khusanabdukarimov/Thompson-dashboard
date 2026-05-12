from __future__ import annotations

import os
from datetime import date
from decimal import Decimal
from typing import Any

import httpx
from pydantic import BaseModel
from tenacity import (
    retry,
    stop_after_attempt,
    wait_exponential,
    retry_if_exception_type,
)


# Facebook'da "lid" deb hisoblanadigan barcha action turlari
LEAD_ACTION_TYPES: set[str] = {
    "lead",
    "onsite_conversion.lead_grouped",
    "offsite_conversion.fb_pixel_lead",
    "onsite_conversion.messaging_conversation_started_7d",
}


class DailyInsight(BaseModel):
    """Bir kunlik Facebook reklama natijasi."""
    date: date
    spend: Decimal
    leads_count: int


class FacebookAPIError(Exception):
    """Facebook API xatosi."""


class MetaClient:
    def __init__(
        self,
        ad_account_id: str | None = None,
        access_token: str | None = None,
        api_version: str = "v21.0",
        timeout: float = 30.0,
    ):
        # Support both FB_* names and META_* names from .env
        self.ad_account_id = (
            ad_account_id
            or os.getenv("FB_AD_ACCOUNT_ID")
            or os.getenv("META_AD_ACCOUNT_ID")
        )
        self.access_token = (
            access_token
            or os.getenv("FB_ACCESS_TOKEN")
            or os.getenv("META_USER_TOKEN")
            or os.getenv("META_APP_SECRET")
        )
        self.api_version = api_version
        self.base_url = f"https://graph.facebook.com/{api_version}"
        self.timeout = timeout

        if not self.ad_account_id or not self.access_token:
            raise ValueError(
                "FB_AD_ACCOUNT_ID va FB_ACCESS_TOKEN .env'da bo'lishi kerak"
            )

        # act_ prefiksi yo'q bo'lsa, qo'shamiz
        if not self.ad_account_id.startswith("act_"):
            self.ad_account_id = f"act_{self.ad_account_id}"

    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=2, max=10),
        retry=retry_if_exception_type(httpx.HTTPError),
        reraise=True,
    )
    async def _get(self, url: str, params: dict[str, Any]) -> dict[str, Any]:
        """HTTP GET, avtomatik retry bilan."""
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            response = await client.get(url, params=params)
            if response.status_code != 200:
                raise FacebookAPIError(
                    f"Facebook API {response.status_code}: {response.text}"
                )
            return response.json()

    @staticmethod
    def _extract_leads(actions: list[dict[str, Any]] | None) -> int:
        """`actions` ro'yxatidan barcha lid turlarini yig'adi."""
        if not actions:
            return 0
        return sum(
            int(a.get("value", 0))
            for a in actions
            if a.get("action_type") in LEAD_ACTION_TYPES
        )

    async def get_daily_insights(
        self,
        date_from: date,
        date_to: date,
    ) -> list[DailyInsight]:
        """
        Account darajasidagi kunlik insights.
        Har kun uchun bitta qator qaytaradi.
        """
        url = f"{self.base_url}/{self.ad_account_id}/insights"
        params: dict[str, Any] = {
            "fields": "spend,actions,date_start",
            "time_increment": 1,
            "level": "account",
            "time_range": (
                f'{{"since":"{date_from.isoformat()}",'
                f'"until":"{date_to.isoformat()}"}}'
            ),
            "access_token": self.access_token,
            "limit": 500,
        }

        results: list[DailyInsight] = []

        # Pagination — barcha sahifalarni o'qiymiz
        while url:
            data = await self._get(url, params)

            for row in data.get("data", []):
                results.append(
                    DailyInsight(
                        date=date.fromisoformat(row["date_start"]),
                        spend=Decimal(str(row.get("spend", "0"))),
                        leads_count=self._extract_leads(row.get("actions")),
                    )
                )

            # Keyingi sahifa bormi?
            paging = data.get("paging", {})
            next_url = paging.get("next")
            if next_url:
                url = next_url
                params = {}  # next URL'da hammasi bor
            else:
                url = ""

        return results
import os
import requests
from datetime import date, timedelta
import calendar
from dotenv import load_dotenv

load_dotenv()

META_APP_ID     = os.environ.get("META_APP_ID", "")
META_APP_SECRET = os.environ.get("META_APP_SECRET", "")
META_USER_TOKEN = os.environ.get("META_USER_TOKEN", "")
META_AD_ACCOUNT = os.environ.get("META_AD_ACCOUNT_ID", "")

GRAPH = "https://graph.facebook.com/v19.0"

MONTH_NAMES = {
    "yanvar": 1, "fevral": 2, "mart": 3, "aprel": 4,
    "may": 5, "iyun": 6, "iyul": 7, "avgust": 8,
    "sentabr": 9, "oktabr": 10, "noyabr": 11, "dekabr": 12,
}


def _token():
    if META_USER_TOKEN:
        return META_USER_TOKEN
    # Fallback to app token (limited, cannot access ad accounts)
    return f"{META_APP_ID}|{META_APP_SECRET}"


def get_ad_accounts():
    """Return all ad accounts the current token can access."""
    res = requests.get(
        f"{GRAPH}/me/adaccounts",
        params={"access_token": _token(), "fields": "id,name,account_status,currency"},
    )
    return res.json()


def get_campaign_insights(ad_account_id: str, since: str, until: str):
    """
    Fetch daily campaign insights from Meta Ads for a date range.
    since/until: 'YYYY-MM-DD'
    Returns list of records with date, campaign_name, spend, impressions, clicks, leads.
    """
    url = f"{GRAPH}/{ad_account_id}/insights"
    params = {
        "access_token": _token(),
        "fields": "spend,impressions,clicks,reach,actions",
        "level": "campaign",
        "breakdowns": "publisher_platform",
        "time_increment": 1,
        "time_range": f'{{"since":"{since}","until":"{until}"}}',
        "limit": 500,
    }
    rows = []
    while url:
        res = requests.get(url, params=params)
        data = res.json()
        if "error" in data:
            return {"error": data["error"]}
        rows.extend(data.get("data", []))
        url = data.get("paging", {}).get("next")
        params = {}  # next URL already includes params
    return rows


def get_ad_breakdown(ad_account_id: str, since: str, until: str):
    """Per-ad × platform breakdown for the date range, aggregated.

    Returns one row per (ad, platform). Used by the Kampaniyalar page table.
    """
    url = f"{GRAPH}/{ad_account_id}/insights"
    fields = ",".join([
        "campaign_id", "campaign_name", "adset_id", "adset_name", "ad_id", "ad_name",
        "objective", "spend", "impressions", "reach", "frequency",
        "clicks", "unique_clicks", "inline_link_clicks",
        "cpm", "cpc", "ctr", "actions", "video_play_actions",
    ])
    params = {
        "access_token": _token(),
        "fields": fields,
        "level": "ad",
        "breakdowns": "publisher_platform",
        "time_range": f'{{"since":"{since}","until":"{until}"}}',
        "limit": 500,
    }
    rows = []
    while url:
        res = requests.get(url, params=params)
        data = res.json()
        if "error" in data:
            return {"error": data["error"]}
        rows.extend(data.get("data", []))
        url = data.get("paging", {}).get("next")
        params = {}
    return rows


def _action_value(actions, types):
    if not actions:
        return 0
    s = 0
    for a in actions:
        if a.get("action_type") in types:
            try:
                s += int(float(a.get("value") or 0))
            except Exception:
                pass
    return s


def ads_to_table(rows):
    """Aggregate ad rows into per-(ad × platform) table rows for the frontend.

    Computed fields:
      hook_rate = 3s video views / impressions (videolar uchun)
      visit_rate = landing_page_views / link_clicks
      lid_rate = leads / link_clicks
    """
    from collections import defaultdict
    LEAD_TYPES = {"lead", "offsite_conversion.fb_pixel_lead",
                  "onsite_conversion.lead_grouped",
                  "onsite_conversion.messaging_conversation_started_7d"}
    LPV_TYPES = {"landing_page_view"}
    V3_TYPES = {"video_view", "video_3sec_watched_actions"}

    bucket = defaultdict(lambda: {
        "campaign_name": "", "adset_name": "", "ad_name": "",
        "objective": "", "platform": "",
        "spend": 0.0, "impressions": 0, "reach": 0, "frequency_w": 0.0,
        "clicks": 0, "unique_clicks": 0, "link_clicks": 0,
        "leads": 0, "lpv": 0, "v3": 0,
    })

    for r in rows:
        if not isinstance(r, dict) or "error" in r:
            continue
        ad_id = r.get("ad_id") or r.get("ad_name") or ""
        platform = (r.get("publisher_platform") or "").lower()
        # Bucket all Facebook surfaces (facebook, audience_network, messenger) under "facebook".
        if platform == "instagram":
            plat = "instagram"
        else:
            plat = "facebook"
        key = (ad_id, plat)
        b = bucket[key]
        b["campaign_name"] = r.get("campaign_name") or b["campaign_name"]
        b["adset_name"]    = r.get("adset_name") or b["adset_name"]
        b["ad_name"]       = r.get("ad_name") or b["ad_name"]
        b["objective"]     = r.get("objective") or b["objective"]
        b["platform"]      = plat
        try:
            b["spend"] += float(r.get("spend") or 0)
        except Exception:
            pass
        impr = int(r.get("impressions") or 0)
        b["impressions"] += impr
        b["reach"] += int(r.get("reach") or 0)
        try:
            b["frequency_w"] += float(r.get("frequency") or 0) * impr
        except Exception:
            pass
        b["clicks"]        += int(r.get("clicks") or 0)
        b["unique_clicks"] += int(r.get("unique_clicks") or 0)
        b["link_clicks"]   += int(r.get("inline_link_clicks") or 0)
        b["leads"] += _action_value(r.get("actions"), LEAD_TYPES)
        b["lpv"]   += _action_value(r.get("actions"), LPV_TYPES)
        b["v3"]    += _action_value(r.get("video_play_actions"), V3_TYPES)

    out = []
    for b in bucket.values():
        impr = b["impressions"]
        clicks = b["clicks"]
        link = b["link_clicks"]
        out.append({
            "campaign_name": b["campaign_name"],
            "adset_name":    b["adset_name"],
            "ad_name":       b["ad_name"],
            "objective":     b["objective"],
            "platform":      b["platform"],
            "spend":         round(b["spend"], 2),
            "impressions":   impr,
            "reach":         b["reach"],
            "frequency":     round(b["frequency_w"] / impr, 2) if impr else 0.0,
            "clicks":        clicks,
            "unique_clicks": b["unique_clicks"],
            "link_clicks":   link,
            "leads":         b["leads"],
            "landing_page_views": b["lpv"],
            "cpm":           round(b["spend"] / impr * 1000, 2) if impr else 0.0,
            "cpc":           round(b["spend"] / clicks, 2) if clicks else 0.0,
            "ctr":           round(clicks / impr * 100, 2) if impr else 0.0,
            "hook_rate":     round(b["v3"] / impr * 100, 2) if impr else 0.0,
            "visit_rate":    round(b["lpv"] / link * 100, 2) if link else 0.0,
            "lid_rate":      round(b["leads"] / link * 100, 2) if link else 0.0,
        })
    out.sort(key=lambda r: r["spend"], reverse=True)
    return out


def insights_to_monthly(rows, month_key: str, year: int):
    """
    Convert raw insight rows into the monthData format the frontend expects.
    Returns {target: {budget:[...], leads:[...]}, instagram: {budget:[...], leads:[...]}}
    """
    month_num = MONTH_NAMES.get(month_key.lower())
    if not month_num:
        return {}
    days_in_month = calendar.monthrange(year, month_num)[1]

    result = {
        "target":    {m: [0] * days_in_month for m in ("budget", "leads", "clicks", "impressions")},
        "instagram": {m: [0] * days_in_month for m in ("budget", "leads", "clicks", "impressions")},
    }

    for row in rows:
        if "error" in row:
            continue
        day_str = row.get("date_start", "")
        try:
            day = int(day_str.split("-")[2])
        except Exception:
            continue
        if day < 1 or day > days_in_month:
            continue
        idx = day - 1

        platform = (row.get("publisher_platform") or "").lower()
        src = "instagram" if platform == "instagram" else "target"

        spend = float(row.get("spend") or 0)
        clicks = int(row.get("clicks") or 0)
        impressions = int(row.get("impressions") or 0)

        lead_count = 0
        for action in row.get("actions") or []:
            if action.get("action_type") in ("lead", "offsite_conversion.fb_pixel_lead",
                                              "onsite_conversion.lead_grouped"):
                lead_count += int(action.get("value") or 0)

        result[src]["budget"][idx]      += round(spend, 2)
        result[src]["leads"][idx]       += lead_count
        result[src]["clicks"][idx]      += clicks
        result[src]["impressions"][idx] += impressions

    return result


def _creative_form_id(creative: dict) -> str | None:
    """Extract lead_gen_form_id from a creative's video_data or link_data CTA."""
    spec = creative.get("object_story_spec") or {}
    for section in ("video_data", "link_data"):
        cta = (spec.get(section) or {}).get("call_to_action") or {}
        form_id = (cta.get("value") or {}).get("lead_gen_form_id")
        if form_id:
            return form_id
    return None


def _paginate(url: str, params: dict) -> list[dict]:
    rows: list[dict] = []
    while url:
        res = requests.get(url, params=params)
        data = res.json()
        if "error" in data:
            return rows
        rows.extend(data.get("data", []))
        url = data.get("paging", {}).get("next")
        params = {}
    return rows


def get_campaign_leadgen_forms(ad_account_id: str) -> list[dict]:
    """Return campaigns with their instant forms (OUTCOME_LEADS / LEAD_GENERATION).

    OUTCOME_LEADS campaigns store the form ID inside the ad creative's
    video_data/link_data call_to_action — not in the adset promoted_object.
    Fetches ads in a small request then resolves creatives, campaigns, adsets
    individually to stay within Meta's response-size limits.
    """
    token = _token()

    # Step 1: fetch ads (minimal fields to avoid "too much data" error)
    ads = _paginate(
        f"{GRAPH}/{ad_account_id}/ads",
        {
            "access_token": token,
            "fields": "id,name,adset_id,campaign_id,creative{id}",
            "limit": 200,
            "filtering": '[{"field":"campaign.objective","operator":"IN","value":["OUTCOME_LEADS","LEAD_GENERATION"]}]',
        },
    )

    # Step 2: resolve creatives, campaigns, adsets individually
    creative_ids = list({(ad.get("creative") or {}).get("id") for ad in ads if (ad.get("creative") or {}).get("id")})
    camp_ids     = list({ad.get("campaign_id") for ad in ads if ad.get("campaign_id")})
    adset_ids    = list({ad.get("adset_id")    for ad in ads if ad.get("adset_id")})

    def _fetch_one(node_id: str, fields: str) -> dict:
        r = requests.get(f"{GRAPH}/{node_id}", params={"access_token": token, "fields": fields})
        d = r.json()
        return d if "id" in d else {}

    creative_map = {cid: _fetch_one(cid, "id,object_story_spec")     for cid in creative_ids}
    camp_map     = {cid: _fetch_one(cid, "id,name,objective")         for cid in camp_ids}
    adset_map    = {aid: _fetch_one(aid, "id,name,status")            for aid in adset_ids}

    # Step 3: group by campaign → form
    campaign_map: dict = {}
    for ad in ads:
        creative = creative_map.get((ad.get("creative") or {}).get("id") or "", {})
        form_id  = _creative_form_id(creative)
        if not form_id:
            continue
        camp  = camp_map.get(ad.get("campaign_id") or "", {})
        adset = adset_map.get(ad.get("adset_id") or "", {})
        camp_id = camp.get("id") or ad.get("campaign_id", "")
        if camp_id not in campaign_map:
            campaign_map[camp_id] = {
                "campaign_id":   camp_id,
                "campaign_name": camp.get("name", ""),
                "objective":     camp.get("objective", ""),
                "forms": {},
            }
        campaign_map[camp_id]["forms"].setdefault(form_id, {
            "form_id":    form_id,
            "adset_id":   adset.get("id") or ad.get("adset_id", ""),
            "adset_name": adset.get("name", ""),
        })

    # Step 4: fetch form details
    all_form_ids = list({fid for c in campaign_map.values() for fid in c["forms"]})
    form_details: dict = {}
    for form_id in all_form_ids:
        d = _fetch_one(form_id, "id,name,status,leads_count,created_time")
        form_details[form_id] = d

    # Step 5: build result
    result = []
    for camp in campaign_map.values():
        forms_list = []
        for fid, adset_info in camp["forms"].items():
            fd = form_details.get(fid, {})
            forms_list.append({
                "form_id":      fid,
                "form_name":    fd.get("name", fid),
                "status":       fd.get("status", ""),
                "leads_count":  fd.get("leads_count"),
                "created_time": fd.get("created_time", ""),
                "adset_id":     adset_info["adset_id"],
                "adset_name":   adset_info["adset_name"],
            })
        result.append({
            "campaign_id":   camp["campaign_id"],
            "campaign_name": camp["campaign_name"],
            "objective":     camp["objective"],
            "forms": sorted(forms_list, key=lambda x: x["form_name"]),
        })
    result.sort(key=lambda x: x["campaign_name"])
    return result


if __name__ == "__main__":
    import json

    yesterday = date.today() - timedelta(days=1)
    since = until = yesterday.strftime("%Y-%m-%d")

    account = META_AD_ACCOUNT
    if not account:
        print("ERROR: META_AD_ACCOUNT_ID is not set in your .env file.")
        raise SystemExit(1)

    print(f"Fetching insights for {since} from account {account} ...")

    try:
        result = get_campaign_insights(account, since, until)
    except requests.exceptions.ConnectionError:
        print("ERROR: Network error — could not reach graph.facebook.com. Check your internet connection.")
        raise SystemExit(1)
    except requests.exceptions.Timeout:
        print("ERROR: Request timed out. Try again.")
        raise SystemExit(1)

    if isinstance(result, dict) and "error" in result:
        err = result["error"]
        code = err.get("code")
        msg  = err.get("message", "Unknown error")
        if code == 190:
            print(f"ERROR: Access token expired or invalid. Refresh META_USER_TOKEN.\n  Detail: {msg}")
        elif code in (17, 80000):
            print(f"ERROR: Rate limit hit. Wait a few minutes and try again.\n  Detail: {msg}")
        elif code in (10, 200, 270):
            print(f"ERROR: Permission denied. Ensure your token has 'ads_read' permission.\n  Detail: {msg}")
        else:
            print(f"ERROR (code {code}): {msg}")
        raise SystemExit(1)

    if not result:
        print("No data returned for yesterday. The account may have no active campaigns.")
    else:
        print(json.dumps(result, indent=2))

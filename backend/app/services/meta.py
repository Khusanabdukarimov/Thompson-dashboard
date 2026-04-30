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
        "fields": "publisher_platform,spend,impressions,clicks,reach,actions",
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

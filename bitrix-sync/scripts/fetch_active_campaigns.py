#!/usr/bin/env python3
"""
Fetch all ACTIVE Facebook ad campaigns with creator info.

Usage:
    python fetch_active_campaigns.py
    python fetch_active_campaigns.py --accounts act_111,act_222
    python fetch_active_campaigns.py --since 2026-06-01 --until 2026-06-18

Install deps:
    pip install requests python-dotenv tabulate
"""

import os
import csv
import sys
import time
import argparse
from datetime import datetime
from pathlib import Path

try:
    import requests
    from dotenv import load_dotenv
    from tabulate import tabulate
except ImportError as e:
    print(f"Missing dependency: {e}")
    print("Run: pip install requests python-dotenv tabulate")
    sys.exit(1)

# ── Config ────────────────────────────────────────────────────────────────────

# Load .env from parent dirs (bitrix-sync root or mountain root)
for env_path in [Path(__file__).parent.parent / ".env", Path(__file__).parent / ".env", Path(".env")]:
    if env_path.exists():
        load_dotenv(env_path)
        break

API_VERSION = os.getenv("FB_API_VERSION", "v21.0")
BASE_URL    = f"https://graph.facebook.com/{API_VERSION}"

# Support multiple tokens: FB_ACCESS_TOKEN or META_ACCESS_TOKEN
ACCESS_TOKEN = os.getenv("META_ACCESS_TOKEN") or os.getenv("FB_ACCESS_TOKEN")

# Support multiple accounts — comma-separated env var or individual vars
_env_accounts = os.getenv("AD_ACCOUNT_IDS", "")
DEFAULT_ACCOUNTS = [a.strip() for a in _env_accounts.split(",") if a.strip()] if _env_accounts else []
if not DEFAULT_ACCOUNTS:
    for var in ("META_AD_ACCOUNT_ID", "FB_AD_ACCOUNT_ID"):
        val = os.getenv(var, "")
        if val and val not in DEFAULT_ACCOUNTS:
            DEFAULT_ACCOUNTS.append(val)
# Always include the Abdujabbor account we discovered
EXTRA_ACCOUNTS = ["act_4321988244731379"]

CAMPAIGN_FIELDS = ",".join([
    "id", "name", "status", "objective",
    "created_time", "updated_time",
    "daily_budget", "lifetime_budget",
    "budget_remaining",
])

OUTPUT_CSV = Path(__file__).parent / "campaigns_report.csv"

# ── Error handling ─────────────────────────────────────────────────────────────

class FacebookAPIError(Exception):
    def __init__(self, code, message, subcode=None):
        self.code    = code
        self.subcode = subcode
        super().__init__(message)

def _raise_for_error(data: dict, account: str = ""):
    err = data.get("error")
    if not err:
        return
    code    = err.get("code")
    subcode = err.get("error_subcode")
    msg     = err.get("message", "Unknown error")
    ctx     = f" [{account}]" if account else ""

    if code == 190:
        raise FacebookAPIError(code, f"❌ Token expired or invalid{ctx}. Renew at developers.facebook.com → Tools → Graph API Explorer.")
    if code == 100 and subcode == 33:
        raise FacebookAPIError(code, f"❌ Ad account not found{ctx}: {account}")
    if code == 200 or code == 273:
        raise FacebookAPIError(code, f"❌ Missing permission{ctx}: {msg}\n   Grant 'ads_read' or 'ads_management' to the token.")
    if code == 17 or code == 80004:
        raise FacebookAPIError(code, f"⚠️  API rate limit hit{ctx}. Retry after 60s.")
    raise FacebookAPIError(code, f"API error {code}{ctx}: {msg}")

# ── Pagination ────────────────────────────────────────────────────────────────

def paginate(url: str, params: dict, max_pages: int = 20) -> list:
    results = []
    page    = 0
    while url and page < max_pages:
        resp = requests.get(url, params=params, timeout=30)
        data = resp.json()
        _raise_for_error(data)
        results.extend(data.get("data", []))
        next_page = data.get("paging", {}).get("next")
        url       = next_page
        params    = {}          # params are already encoded in the "next" URL
        page     += 1
    return results

# ── Creator lookup ────────────────────────────────────────────────────────────

_user_cache: dict[str, str] = {}

def resolve_user(user_id: str, token: str) -> str:
    """Fetch user name by ID, cached. Returns 'Unknown' on failure."""
    if not user_id:
        return "—"
    if user_id in _user_cache:
        return _user_cache[user_id]
    try:
        r = requests.get(
            f"{BASE_URL}/{user_id}",
            params={"fields": "name,email", "access_token": token},
            timeout=10,
        )
        d = r.json()
        name = d.get("name") or d.get("email") or user_id
    except Exception:
        name = user_id
    _user_cache[user_id] = name
    return name

# ── Budget formatting ─────────────────────────────────────────────────────────

def fmt_budget(campaign: dict) -> str:
    daily    = campaign.get("daily_budget")
    lifetime = campaign.get("lifetime_budget")
    if daily and int(daily) > 0:
        return f"${int(daily) / 100:.0f}/day"
    if lifetime and int(lifetime) > 0:
        return f"${int(lifetime) / 100:.0f} lifetime"
    return "—"

def fmt_date(iso: str | None) -> str:
    if not iso:
        return "—"
    try:
        return datetime.fromisoformat(iso.replace("Z", "+00:00")).strftime("%Y-%m-%d")
    except Exception:
        return iso[:10]

# ── Fetch campaigns ───────────────────────────────────────────────────────────

def fetch_campaigns(account_id: str, token: str, status_filter: str = "ACTIVE") -> list[dict]:
    """Fetch campaigns for one ad account, optionally filtered by status."""
    clean_id = account_id if account_id.startswith("act_") else f"act_{account_id}"
    url      = f"{BASE_URL}/{clean_id}/campaigns"
    params   = {
        "fields":       CAMPAIGN_FIELDS,
        "limit":        100,
        "access_token": token,
    }
    # API can pre-filter by status — reduces response size
    if status_filter and status_filter != "ALL":
        params["effective_status"] = f'["{status_filter}"]'

    try:
        rows = paginate(url, params)
    except FacebookAPIError as e:
        print(f"  {e}")
        return []

    result = []
    for c in rows:
        if status_filter and status_filter != "ALL" and c.get("status") != status_filter:
            continue  # double-check (API filter may return paused children)

        created_by_raw  = c.get("created_by") or {}
        creator_id      = created_by_raw.get("id", "")
        creator_name    = created_by_raw.get("name") or (resolve_user(creator_id, token) if creator_id else "—")

        result.append({
            "account":      clean_id,
            "id":           c["id"],
            "name":         c["name"],
            "status":       c.get("status", "—"),
            "objective":    c.get("objective", "—"),
            "created_by":   creator_name,
            "created_date": fmt_date(c.get("created_time")),
            "updated_date": fmt_date(c.get("updated_time")),
            "budget":       fmt_budget(c),
        })

    return result

# ── Display & export ──────────────────────────────────────────────────────────

def display_table(campaigns: list[dict]) -> None:
    if not campaigns:
        print("\n  No active campaigns found.\n")
        return

    # Group by account
    by_account: dict[str, list] = {}
    for c in campaigns:
        by_account.setdefault(c["account"], []).append(c)

    headers = ["#", "Campaign Name", "Campaign ID", "Created By", "Created", "Objective", "Budget"]

    for account, rows in by_account.items():
        print(f"\n{'─'*80}")
        print(f"  Ad Account: {account}  ({len(rows)} active campaigns)")
        print(f"{'─'*80}")

        table = []
        for i, c in enumerate(rows, 1):
            # Truncate long campaign names
            name = c["name"] if len(c["name"]) <= 48 else c["name"][:45] + "..."
            table.append([
                i,
                name,
                c["id"],
                c["created_by"],
                c["created_date"],
                c["objective"].replace("OUTCOME_", ""),
                c["budget"],
            ])

        print(tabulate(table, headers=headers, tablefmt="rounded_outline"))

    total = len(campaigns)
    total_spend_label = ""
    print(f"\n  Total active campaigns: {total}{total_spend_label}")

def export_csv(campaigns: list[dict], path: Path) -> None:
    if not campaigns:
        return
    fieldnames = ["account", "id", "name", "status", "objective",
                  "created_by", "created_date", "updated_date", "budget"]
    with open(path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(campaigns)
    print(f"\n  ✅ Exported {len(campaigns)} rows → {path}\n")

# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Fetch active Facebook ad campaigns")
    parser.add_argument("--accounts", help="Comma-separated ad account IDs (overrides .env)")
    parser.add_argument("--status",   default="ACTIVE", help="Filter by status: ACTIVE, PAUSED, ALL (default: ACTIVE)")
    parser.add_argument("--token",    help="Access token (overrides .env)")
    parser.add_argument("--output",   default=str(OUTPUT_CSV), help="CSV output path")
    parser.add_argument("--no-csv",   action="store_true", help="Skip CSV export")
    args = parser.parse_args()

    token = args.token or ACCESS_TOKEN
    if not token:
        print("❌ No access token found.\n"
              "   Set META_ACCESS_TOKEN in .env or pass --token YOUR_TOKEN")
        sys.exit(1)

    # Resolve account list
    if args.accounts:
        accounts = [a.strip() for a in args.accounts.split(",") if a.strip()]
    else:
        accounts = list(DEFAULT_ACCOUNTS)
        for a in EXTRA_ACCOUNTS:
            if a not in accounts:
                accounts.append(a)

    if not accounts:
        print("❌ No ad accounts configured.\n"
              "   Set META_AD_ACCOUNT_ID in .env or pass --accounts act_XXXXX")
        sys.exit(1)

    status = args.status.upper()
    label  = "ACTIVE" if status == "ACTIVE" else f"status={status}"
    print(f"\n  Fetching {label} campaigns from {len(accounts)} ad account(s)…")

    all_campaigns = []
    for acct in accounts:
        print(f"  → {acct} … ", end="", flush=True)
        rows = fetch_campaigns(acct, token, status_filter=status if status != "ALL" else "")
        print(f"{len(rows)} found")
        all_campaigns.extend(rows)
        time.sleep(0.3)   # be polite to the rate limiter

    display_table(all_campaigns)

    if not args.no_csv and all_campaigns:
        export_csv(all_campaigns, Path(args.output))

if __name__ == "__main__":
    main()

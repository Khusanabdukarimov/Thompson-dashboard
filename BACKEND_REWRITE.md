# Mountain — Backend Rewrite

---

## 1. CURRENT STATE

### File sizes (lines)
| File | Lines | Problem |
|---|---|---|
| `backend/app/main.py` | 1276 | All marketing/leads/deals/meta routes in one file |
| `backend/app/api/routes/payroll.py` | 1158 | Already extracted but still monolithic |
| `backend/app/services/bitrix.py` | 475 | `get_timeman_status` defined **twice** (line 207 and ~283) |
| `backend/app/services/meta.py` | 547 | Two parallel clients: async `MetaClient` + old sync `requests` functions |
| `backend/app/api/routes/call_stats.py` | ~450 | Live Bitrix24 fetch on every request — no DB cache |

### Two database engines
| Engine | File | Purpose | Tables |
|---|---|---|---|
| SQLite | `db.py` | Payroll data | `employees_extra`, `kpi_rules`, `bonus_rules`, `bonus_awards`, `attendance_log`, `report_log`, `penalty_config`, `monthly_targets`, `payroll_approvals`, `tariflar`, `kunlik_custom_sections`, `kunlik_plans`, `kunlik_overrides` |
| PostgreSQL | `db_bx.py` | Bitrix24 sync | `leads`, `deals`, `stages`, `responsibles`, `lead_phones`, `bx_users`, `bx_leads`, `bx_deals`, `bx_activities` |

### Auth system (`core/auth.py`)
- JWT HS256, 7-day expiry
- PBKDF2-SHA256 password hashing (stdlib, no bcrypt)
- `AUTH_ENABLED=true` env gate — when false, all `/api/*` routes are open
- Two credential paths: employee login (from DB) → fallback to `ADMIN_PASSWORD` env
- Tokens carry: `sub` (username), `role`, `emp_id`

### Environment variables
```bash
# Meta Ads
FB_AD_ACCOUNT_ID=act_...
FB_ACCESS_TOKEN=...
FB_API_VERSION=v21.0
FB_WEBHOOK_VERIFY_TOKEN=...
# Also accepts META_* aliases

# Bitrix24
BITRIX24_PORTAL=https://mountain.bitrix24.kz
BITRIX24_TOKEN=/rest/1/webhooktoken/
BITRIX24_WEBHOOK_URL=...     # Some routes use this

# Auth
AUTH_ENABLED=true
ADMIN_USERNAME=admin
ADMIN_PASSWORD=...
JWT_SECRET=...

# PostgreSQL (Bitrix sync DB)
DATABASE_URL=postgresql+psycopg2://user:pass@localhost/mountain_bx
```

### Known bugs
| # | Bug | Location |
|---|---|---|
| 1 | `get_timeman_status` defined twice | `services/bitrix.py:207` and `~283` — second definition shadows first |
| 2 | Meta async `MetaClient` and old sync `requests` functions coexist | `services/meta.py` — different API versions (`v21.0` vs `v19.0`) |
| 3 | `_migrate_columns()` — schema changes as raw SQL ALTER TABLE | `db.py` — should use Alembic |
| 4 | `main.py` imports from `app.services.meta` using both client styles | Mixed async/sync in same module |
| 5 | Call stats live-fetches Bitrix24 on every request (~10–30s) | `routes/call_stats.py` — no cache |
| 6 | `call-stats/` standalone module partially duplicates `call_stats.py` | `call-stats/` dir |
| 7 | Some routes in `main.py` use `bx_engine` directly (raw SQL) | Should go through repository layer |

---

## 2. TARGET ARCHITECTURE

```
backend/app/
├── main.py                  # App factory only: create_app(), mount routers
├── core/
│   ├── config.py            # pydantic-settings, all env vars in one place
│   ├── auth.py              # JWT + PBKDF2 (keep as-is, just clean up)
│   ├── db.py                # SQLite engine + get_session dep
│   └── db_bx.py             # PostgreSQL engine + get_bx_conn dep
├── models/
│   ├── payroll.py           # EmployeeExtra, KpiRule, BonusRule, BonusAward,
│   │                        #   MonthlyTarget, PayrollApproval, PenaltyConfig,
│   │                        #   AttendanceLog, ReportLog
│   ├── marketing.py         # KunlikCustomSection, KunlikPlan, KunlikOverride, Tarif
│   └── calls.py             # CallRecord (cache table — new)
├── services/
│   ├── bitrix.py            # Single clean client: list_users, list_leads,
│   │                        #   list_deals, get_timeman_status (once), etc.
│   └── meta.py              # Single MetaClient (async httpx, v21.0 only)
└── api/routes/
    ├── auth.py              # POST /api/auth/login, GET /api/auth/me, GET /api/auth/status
    ├── config.py            # GET /api/config
    ├── users.py             # GET /api/users, GET /api/users/timeman
    ├── leads.py             # GET /api/leads, POST /api/leads, GET /api/leads/{id}
    ├── deals.py             # GET /api/stats/deals, GET /api/stats/deals/by-source,
    │                        #   GET /api/deals/aggregate
    ├── meta.py              # GET /api/meta/insights, GET /api/meta/campaigns,
    │                        #   GET /api/meta/accounts, GET /api/meta/campaign-forms
    ├── marketing.py         # GET/PUT /api/marketing/kunlik*,
    │                        #   GET /api/marketing/lead-sources,
    │                        #   GET /api/marketing/kunlik-sections (CRUD)
    ├── payroll.py           # Keep existing (already extracted) — minor cleanup
    ├── call_stats.py        # GET /api/calls/stats (live),
    │                        #   GET /api/calls/stats-cached (from DB),
    │                        #   POST /api/calls/sync (trigger sync)
    └── webhooks.py          # POST /api/bitrix/handler, GET /install
```

---

## 3. ALL CURRENT ENDPOINTS (inventory)

### From `main.py` (to be split into route files)

```
GET  /api/config                            → routes/config.py
GET  /api/users                             → routes/users.py
GET  /api/users/timeman                     → routes/users.py
POST /api/leads                             → routes/leads.py
GET  /api/leads/{lead_id}                   → routes/leads.py
GET  /api/leads                             → routes/leads.py
GET  /api/deals/aggregate                   → routes/deals.py
GET  /api/dashboard/amocrm-sources          → routes/deals.py (or marketing.py)
GET  /api/stats/deals                       → routes/deals.py
GET  /api/stats/deals/by-source             → routes/deals.py
GET  /api/meta/campaign-forms               → routes/meta.py
GET  /api/meta/page-forms                   → routes/meta.py
GET  /api/meta/accounts                     → routes/meta.py
GET  /api/meta/insights                     → routes/meta.py
GET  /api/meta/campaigns                    → routes/meta.py
GET  /api/marketing/bitrix-daily            → routes/marketing.py
GET  /api/marketing/kunlik                  → routes/marketing.py
GET  /api/marketing/kunlik-meta             → routes/marketing.py
PUT  /api/marketing/kunlik-plan             → routes/marketing.py
PUT  /api/marketing/kunlik-override         → routes/marketing.py
GET  /api/marketing/lead-sources            → routes/marketing.py
GET  /api/marketing/kunlik-sections         → routes/marketing.py
POST /api/marketing/kunlik-sections         → routes/marketing.py
DELETE /api/marketing/kunlik-sections/{id}  → routes/marketing.py
GET  /api/marketing/kunlik-segment          → routes/marketing.py
GET/POST /api/v1/tolov                      → routes/webhooks.py (or drop)
GET/POST /install                           → routes/webhooks.py
POST /api/bitrix/handler                    → routes/webhooks.py
```

### From `routes/payroll.py` (keep, minor cleanup)

```
GET    /api/payroll/employees
PUT    /api/payroll/employees/{bitrix_user_id}
POST   /api/payroll/employees/{bitrix_user_id}/avatar
DELETE /api/payroll/employees/{bitrix_user_id}/avatar
GET    /api/payroll/kpi-rules
POST   /api/payroll/kpi-rules
PUT    /api/payroll/kpi-rules/{rule_id}
DELETE /api/payroll/kpi-rules/{rule_id}
GET    /api/payroll/bonus-rules
POST   /api/payroll/bonus-rules
PUT    /api/payroll/bonus-rules/{rule_id}
DELETE /api/payroll/bonus-rules/{rule_id}
GET    /api/payroll/bonus-awards
POST   /api/payroll/bonus-awards
DELETE /api/payroll/bonus-awards/{award_id}
GET    /api/payroll/target
PUT    /api/payroll/target
GET    /api/payroll/weekly-actuals
GET    /api/payroll/sales-trend
GET    /api/payroll/attendance-log
PUT    /api/payroll/attendance-log
DELETE /api/payroll/attendance-log/{log_id}
GET    /api/payroll/report-log
PUT    /api/payroll/report-log
DELETE /api/payroll/report-log/{log_id}
POST   /api/payroll/auto-sync
GET    /api/payroll/discipline-stats
GET    /api/payroll/penalty-config
PUT    /api/payroll/penalty-config
GET    /api/payroll/calculate
GET    /api/payroll/tariflar
POST   /api/payroll/tariflar
PUT    /api/payroll/tariflar/{tarif_id}
DELETE /api/payroll/tariflar/{tarif_id}
GET    /api/payroll/summary
GET    /api/payroll/approvals
POST   /api/payroll/approvals
PUT    /api/payroll/approvals/{approval_id}/status
DELETE /api/payroll/approvals/{approval_id}
```

### From `routes/call_stats.py` (extend with cache)

```
GET  /api/calls/stats          ← live Bitrix24 fetch (existing)
GET  /api/calls/stats-cached   ← from DB (new — fast)
POST /api/calls/sync           ← trigger sync for date range (new)
```

### Auth (from `core/auth.py`)

```
POST /api/auth/login
GET  /api/auth/me
GET  /api/auth/status
```

---

## 4. DATABASE

### SQLite (`mountain.db`) — payroll + marketing data

All existing tables (no changes to schema, just add Alembic):

```
employees_extra       → EmployeeExtra
kpi_rules             → KpiRule
bonus_rules           → BonusRule
bonus_awards          → BonusAward
attendance_log        → AttendanceLog
report_log            → ReportLog
penalty_config        → PenaltyConfig
monthly_targets       → MonthlyTarget
payroll_approvals     → PayrollApproval
tariflar              → Tarif
kunlik_custom_sections → KunlikCustomSection
kunlik_plans          → KunlikPlan
kunlik_overrides      → KunlikOverride
```

### PostgreSQL (`DATABASE_URL`) — Bitrix24 sync + call cache

Existing tables (managed by Node.js bitrix-sync service):
```
leads             — synced from Bitrix24 CRM
deals             — synced from Bitrix24 CRM
stages            — lead/deal stages
responsibles      — Bitrix24 users
lead_phones       — phone numbers per lead
```

**New tables to add (managed by FastAPI):**

```sql
-- Call records cache (avoids live Bitrix24 fetch on every request)
CREATE TABLE call_records (
    id                  BIGSERIAL PRIMARY KEY,
    call_id             TEXT UNIQUE NOT NULL,
    portal_user_id      INTEGER,
    full_name           TEXT,
    phone_number        TEXT,
    call_type           SMALLINT,
    -- 1=outbound, 2=inbound, 3=inbound_redir, 4=callback
    call_duration       INTEGER NOT NULL DEFAULT 0,
    call_start_time     TIMESTAMPTZ,
    call_failed_code    TEXT,
    call_status_code    INTEGER,
    synced_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON call_records (call_start_time);
CREATE INDEX ON call_records (portal_user_id, call_start_time);
CREATE INDEX ON call_records (phone_number, call_start_time);

-- Track which dates have been synced
CREATE TABLE call_sync_log (
    id              SERIAL PRIMARY KEY,
    synced_date     DATE NOT NULL UNIQUE,
    record_count    INTEGER NOT NULL DEFAULT 0,
    synced_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

---

## 5. SERVICE LAYER FIXES

### `services/bitrix.py` — fix duplicate and clean cache

**Problem:** `get_timeman_status` is defined twice. Remove the second definition (line ~283).

**Current structure (keep):**
```python
_CACHE: dict[str, tuple[Any, float]] = {}

def _get_fetch_lock(key: str) -> threading.Lock: ...
def _paginate(method, filter_dict, select, extra) -> tuple[list, int]: ...

def list_users(ttl=1800) -> list: ...          # cached
def list_leads(filter_dict, select, ttl) -> list: ...
def list_deals(filter_dict, select, ttl) -> list: ...
def get_timeman_status(user_id) -> str | None:  # KEEP ONLY ONE
    ...
def get_lead_details(lead_id) -> dict: ...
def create_lead(fields) -> dict: ...
def update_lead_status(lead_id, status_id) -> None: ...
# etc.
```

### `services/meta.py` — remove old sync functions

**Keep only:** `MetaClient` class (async httpx, v21.0)

**Remove:**
- `_token()` sync function
- `get_ad_accounts()` sync function
- `get_campaign_insights()` sync function (old `requests`-based)
- `get_ad_breakdown()` sync function (old `requests`-based)

**Keep:**
- `MetaClient.get_insights()` — async
- `MetaClient.get_campaigns()` — async
- `insights_to_monthly()` — pure aggregation helper
- `ads_to_table()` — pure aggregation helper
- `MONTH_NAMES` dict

**Routes that used the old sync functions** must be updated to use `MetaClient`:
```python
# Before (in main.py):
rows = meta_svc.get_campaign_insights(account_id, since, until)

# After (in routes/meta.py):
async with MetaClient() as client:
    rows = await client.get_insights(account_id, since, until)
```

---

## 6. CALL STATS — DB CACHE PLAN

### New sync endpoint

```python
# POST /api/calls/sync?date=YYYY-MM-DD
# POST /api/calls/sync?date_from=YYYY-MM-DD&date_to=YYYY-MM-DD
async def sync_call_records(date: str | None, date_from: str | None, date_to: str | None):
    # 1. Fetch from voximplant.statistic.get (existing _fetch_all logic)
    # 2. Upsert into call_records table (ON CONFLICT DO UPDATE)
    # 3. Mark date(s) in call_sync_log
    # Returns: { synced: N, dates: [...] }
```

### Cached stats endpoint

```python
# GET /api/calls/stats-cached?date_from=YYYY-MM-DD&date_to=YYYY-MM-DD
def get_cached_call_stats(date_from: str, date_to: str):
    # Query call_records via SQL (fast, <100ms)
    # Same aggregation logic as _compute() in call_stats.py
    # But reads from DB instead of live API
```

### Nightly cron (add to systemd timer or cron)
```bash
# /etc/cron.d/mountain-call-sync
0 3 * * * www-data curl -s -X POST http://localhost:8001/api/calls/sync?date=$(date -d yesterday +%F)
```

---

## 7. CLAUDE CODE PROMPT — Backend Rewrite

> Open Claude Code in `mountain/` directory. Copy this block entirely.

---

```
You are refactoring the Mountain FastAPI backend. The app is live in production — do not break existing endpoints. Every existing endpoint must continue to work at the same URL with the same response shape after the refactor.

## Current state

```
backend/app/
├── main.py              1276 lines — ALL marketing/leads/deals/meta routes here
├── core/auth.py         JWT + PBKDF2, install_auth_middleware(), router
├── db.py                SQLite engine, get_session(), init_db()
├── db_bx.py             PostgreSQL engine for Bitrix sync DB
├── models.py            All SQLModel tables (payroll + marketing)
├── bx_models.py         Bitrix sync tables (BxUser, BxLead, BxDeal, BxActivity)
├── services/
│   ├── bitrix.py        Bitrix24 REST client (sync, threading cache)
│   └── meta.py          Meta Ads: MetaClient (async) + OLD sync functions (remove these)
└── api/routes/
    ├── payroll.py        1158 lines — already extracted, keep as-is for now
    └── call_stats.py     Live Bitrix24 call stats — keep, but add DB cache endpoint
```

## Rules

1. **Never change endpoint URLs or response shapes** — frontend is in production.
2. **Sync routes only** — do not convert existing sync routes to async. Only new routes can be async.
3. **One change at a time** — implement each task below, run a quick sanity check, then proceed.
4. **No new external dependencies** — only what's in `requirements.txt` already.
5. When moving code from `main.py` to a route file, copy it exactly — don't refactor the logic, just relocate.

## Task 1 — Fix duplicate `get_timeman_status` in `services/bitrix.py`

Read `services/bitrix.py`. Find the two definitions of `get_timeman_status`. The first is at line ~207, the second at ~283. Delete the second definition entirely. Verify there are no other callers that relied on any difference between the two.

## Task 2 — Remove old sync Meta functions from `services/meta.py`

Read `services/meta.py`. Remove these old sync functions (they use `requests` library and `v19.0` API):
- `_token()` — the one that reads FB_ACCESS_TOKEN directly
- `get_ad_accounts()` — sync `requests.get` version
- `get_campaign_insights()` — sync version (NOT the MetaClient method)
- `get_ad_breakdown()` — sync version

Keep:
- `MetaClient` class (all methods)
- `insights_to_monthly()`
- `ads_to_table()`
- `_action_value()`
- `_creative_form_id()`
- `_paginate()`
- `MONTH_NAMES` dict
- `DailyInsight`, `FacebookAPIError` classes

After removing, update `main.py` — find every call to the removed functions and replace with `MetaClient`:

```python
# Pattern to find in main.py:
rows = meta_svc.get_campaign_insights(account_id, since, until)

# Replace with:
import asyncio
client = MetaClient(ad_account_id=account_id)
rows = asyncio.run(client._get_insights_raw(since, until))
# OR: make the route async and use `await client.get_insights(...)`
```

## Task 3 — Extract `routes/config.py`

Move this from `main.py` to `backend/app/api/routes/config.py`:

```python
from fastapi import APIRouter
from app.services import bitrix

router = APIRouter(tags=["config"])

@router.get("/api/config")
def api_config():
    portal = bitrix.BITRIX24_PORTAL or ""
    portal_base = portal.rstrip("/")
    if portal_base.endswith("/rest"):
        portal_base = portal_base[:-len("/rest")]
    return {
        "bitrix_portal": portal_base,
        "currency": {"primary": "UZS", "secondary": "USD"},
    }
```

In `main.py`: remove the `@app.get("/api/config")` handler, add:
```python
from app.api.routes import config as config_routes
app.include_router(config_routes.router)
```

## Task 4 — Extract `routes/users.py`

Move from `main.py`:
- `GET /api/users` (api_list_users)
- `GET /api/users/timeman` (api_users_timeman)

Create `backend/app/api/routes/users.py` with `router = APIRouter(tags=["users"])`. Copy the handlers exactly. Register in `main.py`.

## Task 5 — Extract `routes/leads.py`

Move from `main.py`:
- `POST /api/leads` (api_create_lead — with LeadCreate model)
- `GET /api/leads/{lead_id}` (api_get_lead)
- `GET /api/leads` (api_leads — paginated query against bx_engine)

Move the `LeadCreate` Pydantic model into this file. Copy the raw SQL query verbatim. Register in `main.py`.

## Task 6 — Extract `routes/deals.py`

Move from `main.py`:
- `GET /api/deals/aggregate` (api_deals_aggregate)
- `GET /api/dashboard/amocrm-sources` (api_amocrm_sources)
- `GET /api/stats/deals` (api_stats_deals — large raw SQL)
- `GET /api/stats/deals/by-source` (api_stats_deals_by_source)

Copy all raw SQL verbatim. Register in `main.py`.

## Task 7 — Extract `routes/meta.py`

Move from `main.py`:
- `GET /api/meta/campaign-forms`
- `GET /api/meta/page-forms`
- `GET /api/meta/accounts`
- `GET /api/meta/insights`
- `GET /api/meta/campaigns`

These call `meta_svc.*` functions. After Task 2 removed the old sync functions, update these to use `MetaClient`. Register in `main.py`.

## Task 8 — Extract `routes/marketing.py`

Move from `main.py`:
- All `GET/PUT /api/marketing/*` handlers (kunlik, kunlik-meta, kunlik-plan, kunlik-override, lead-sources, kunlik-sections, kunlik-segment, bitrix-daily)
- Move helper functions: `_classify_source()`, `_stage_is_won()`, `_parse_bitrix_day()`, `_UTM_TO_SOURCE`, `_SOURCE_ID_TO_BUCKET`, `_QUALIFIED_LEAD_STATUSES`
- Move Pydantic models: `KunlikPlanBody`, `KunlikOverrideBody`, `KunlikSectionBody`

Register in `main.py`.

## Task 9 — Extract `routes/webhooks.py`

Move from `main.py`:
- `GET/POST /api/v1/tolov`
- `GET/POST/HEAD /install`
- `POST /api/bitrix/handler`

Register in `main.py`.

## Task 10 — Add call records DB cache

### 10a — Add `models/calls.py`

Create `backend/app/models/calls.py`:

```python
from datetime import datetime
from typing import Optional
from sqlmodel import Field, SQLModel

class CallRecord(SQLModel, table=True):
    __tablename__ = "call_records"

    id: Optional[int] = Field(default=None, primary_key=True)
    call_id: str = Field(unique=True, index=True)
    portal_user_id: Optional[int] = Field(default=None, index=True)
    full_name: Optional[str] = None
    phone_number: Optional[str] = None
    call_type: Optional[int] = None  # 1=out,2=in,3=in_redir,4=callback
    call_duration: int = Field(default=0)
    call_start_time: Optional[datetime] = Field(default=None, index=True)
    call_failed_code: Optional[str] = None
    call_status_code: Optional[int] = None
    synced_at: datetime = Field(default_factory=datetime.utcnow)

class CallSyncLog(SQLModel, table=True):
    __tablename__ = "call_sync_log"

    id: Optional[int] = Field(default=None, primary_key=True)
    synced_date: str = Field(unique=True, index=True)  # YYYY-MM-DD
    record_count: int = Field(default=0)
    synced_at: datetime = Field(default_factory=datetime.utcnow)
```

Add `CallRecord` and `CallSyncLog` to `init_bx_db()` in `db_bx.py` so they are created in the PostgreSQL DB (not SQLite).

### 10b — Add sync endpoint to `routes/call_stats.py`

Add two new endpoints (keep the existing `/api/calls/stats` untouched):

```python
@router.post("/sync")
async def sync_calls(
    date: Optional[str] = Query(None, description="Single date YYYY-MM-DD"),
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
) -> dict:
    """Fetch calls from Bitrix24 and upsert into call_records table."""
    # 1. Determine date range
    # 2. Call _fetch_all(date_from, date_to) — already exists in this file
    # 3. For each record, upsert into call_records (ON CONFLICT ON call_id DO UPDATE)
    # 4. Upsert call_sync_log row for each synced date
    # 5. Return { synced: N, dates: [YYYY-MM-DD, ...] }

@router.get("/stats-cached")
def cached_call_stats(
    date_from: str = Query(...),
    date_to: str = Query(...),
) -> CallStatsResult:
    """Return call stats from DB cache (fast). Falls back to live if dates not synced."""
    # Query call_records WHERE call_start_time BETWEEN date_from AND date_to
    # Run same _compute() aggregation on results
    # If no records found in DB for this range, fall through to live API
```

## Task 11 — Clean up `main.py`

After all tasks above, `main.py` should only contain:

```python
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from pathlib import Path

from app.core import auth as auth_module
from app.db import init_db
from app.db_bx import init_bx_db
from app.api.routes import (
    auth as auth_routes,      # already exists via auth_module.router
    config as config_routes,  # Task 3
    users as users_routes,    # Task 4
    leads as leads_routes,    # Task 5
    deals as deals_routes,    # Task 6
    meta as meta_routes,      # Task 7
    marketing as mkt_routes,  # Task 8
    webhooks as wh_routes,    # Task 9
    payroll as payroll_routes,# existing
    call_stats as call_routes,# existing + Task 10
)

app = FastAPI(openapi_url="/api/openapi.json", docs_url="/api/docs")
auth_module.install_auth_middleware(app)

AVATAR_DIR = Path(__file__).resolve().parent.parent / "data" / "avatars"
AVATAR_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/avatars", StaticFiles(directory=str(AVATAR_DIR)), name="avatars")

@app.on_event("startup")
def _on_startup():
    init_db()
    init_bx_db()

app.include_router(auth_module.router)
app.include_router(config_routes.router)
app.include_router(users_routes.router)
app.include_router(leads_routes.router)
app.include_router(deals_routes.router)
app.include_router(meta_routes.router)
app.include_router(mkt_routes.router)
app.include_router(wh_routes.router)
app.include_router(payroll_routes.router)
app.include_router(call_routes.router)
```

## Verification after each task

After every task, run:
```bash
cd /var/www/mountain/backend
source .venv/bin/activate
python -c "from app.main import app; print('OK', len(app.routes), 'routes')"
```

This must print a route count ≥ 50 without errors. If it fails, fix before moving to next task.

After all tasks:
```bash
sudo systemctl restart mountain
curl -s http://localhost:8001/api/config | python3 -m json.tool
curl -s "http://localhost:8001/api/payroll/employees" -H "Authorization: Bearer $TOKEN" | python3 -m json.tool | head -20
```

## Start here

Begin with Task 1. Read `backend/app/services/bitrix.py`, find both definitions of `get_timeman_status`, show me the line numbers and the second definition, then delete the second one.
```

---

## 8. REQUIREMENTS.TXT (current — keep as-is)

```
fastapi
uvicorn
requests           # used in old Meta sync functions → can remove after Task 2
pydantic
python-dateutil
python-dotenv
httpx>=0.27
tenacity>=9.0
sqlmodel>=0.0.16
PyJWT>=2.8.0
python-multipart>=0.0.9
psycopg2-binary>=2.9
```

After Task 2 (removing old sync Meta functions), `requests` may be removable — verify no other code uses it first.

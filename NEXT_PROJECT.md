# Mountain — Project State & Claude Code Prompt

---

## 1. CURRENT STATE (Accurate)

### Architecture

```
Browser
  └── https://mountdashboard.data365verification.uz
        │
        ▼
   nginx (443)
     ├── /var/www/mountain/frontend/app/dist   ← React SPA (static)
     ├── /api/campaigns/*   → Node.js (port 3001)  ← bitrix-sync service
     ├── /api/dashboard/*   → Node.js (port 3001)
     ├── /api/reja/*        → Node.js (port 3001)
     ├── /webhook/*         → Node.js (port 3001)
     └── /api/*             → FastAPI  (port 8001)
```

**Three services:**
| Service | Port | Tech | Purpose |
|---|---|---|---|
| FastAPI | 8001 | Python + SQLModel + SQLite/PostgreSQL | Payroll, Meta Ads, Bitrix stats |
| Node.js sync | 3001 | Express/Node | CRM dashboard, campaigns (cached), reja plans, webhooks |
| nginx | 80/443 | nginx | Static SPA + reverse proxy |

### Frontend (`frontend/app/`) — The Real One

**Stack:** React 19 + Vite + TypeScript + **Tailwind CSS v3** + Radix UI + TanStack Query v5 + TanStack Table v8 + Recharts + lucide-react

**No axios** — uses custom `apiGet` / `authedFetch` in `src/lib/api/client.ts`

**Pages already built:**

| Section | Route | Page file |
|---|---|---|
| Marketing | `/lidlar` | `pages/marketing/LidlarPage.tsx` |
| Marketing | `/sdelkalar` | `pages/marketing/SdelkalarPage.tsx` |
| Marketing | `/kampaniyalar` | `pages/marketing/KampaniyalarPage.tsx` |
| Marketing | `/call-statistikasi` | `pages/marketing/CallStatistikasi.tsx` |
| Marketing | `/kunlik-hisobot` | `pages/marketing/KunlikPage.tsx` |
| Marketing | `/byudjet` | `pages/marketing/ByudjetPage.tsx` |  ← NOT in router yet
| Other | `/reja` | `pages/RejaPage.tsx` |
| Other | `/reja/new` | `pages/RejaCreatePage.tsx` |
| Other | `/sozlamalar` | `pages/SettingsPage.tsx` |
| Payroll | `/payroll` | `pages/payroll/PayrollCalcPage.tsx` |
| Payroll | `/payroll/dashboard` | `pages/payroll/DashboardPage.tsx` |
| Payroll | `/payroll/employees` | `pages/payroll/EmployeesPage.tsx` |
| Payroll | `/payroll/attendance` | `pages/payroll/AttendancePage.tsx` |
| Payroll | `/payroll/kpi` | `pages/payroll/KpiRulesPage.tsx` |
| Payroll | `/payroll/bonus` | `pages/payroll/BonusPage.tsx` |
| Payroll | `/payroll/tariflar` | `pages/payroll/TariflarPage.tsx` |
| Payroll | `/payroll/hisobot` | `pages/payroll/HisobotPage.tsx` |
| Payroll | `/payroll/reja` | `pages/payroll/RejaPage.tsx` |
| Payroll | `/taqsimot` | `pages/payroll/TaqsimotPage.tsx` |

**API modules in `src/lib/api/`:**
- `client.ts` — `apiGet<T>`, `authedFetch`, `API_URL_CRM` (port 3001), `API_URL_PAYROLL` (port 8001)
- `leads.ts` — leads list, dashboard stats, responsibles stats
- `deals.ts` — deals stats, deals by source
- `meta.ts` — Meta Ads insights, Kunlik hisobot (target/instagram), KunlikMeta (plans/overrides), custom sections
- `payroll.ts` — employees, KPI rules, bonus rules/awards, payroll calc, discipline stats, penalty config, tariflar, monthly target
- `reja.ts` — sales plan CRUD, distribution, sub-periods
- `config.ts` — `/api/config` bootstrap

**Components in `src/components/`:**
`AppLayout`, `Avatar`, `Badge`, `Button`, `CommandPalette`, `DataTable`, `EmptyState`, `ErrorBoundary`, `FilterBar`, `MetricCard`, `Sidebar`, `Skeleton`, `Toast`, `Topbar`, `charts` (CardChart, StackedBar, FunnelBars)

**Sidebar structure:**
- Main nav (flat): Lidlar, Sdelkalar, Call statistikasi, Kampaniyalar, Kunlik hisobot, Reja, Sozlamalar
- Payroll accordion: Payroll Hisoblash, Xodimlar, Davomat, KPI Qoidalari, Bonuslar, Tariflar, Taqsimot
- Dark/light toggle at bottom
- Collapsible (saves to localStorage)
- Role-based visibility (admin/owner/closer/marketolog/hunter)

**Auth:** JWT Bearer in `localStorage('auth.token')`. Role in `localStorage('auth.role')`. `ProtectedRoute` checks `/api/auth/status` on mount.

**Dev env:** `VITE_API_URL_CRM=http://localhost:3001`, `VITE_API_URL_PAYROLL=http://localhost:8000`  
**Prod env:** both empty → same-origin nginx proxy

### Backend (`backend/`) — FastAPI

- Python 3.12 + FastAPI + SQLModel
- Port 8001 in production, 8000 in dev
- Handles: auth, payroll, employees, KPI, Meta Ads insights, Bitrix stats, Kunlik hisobot
- SQLite (`backend/data/mountain.db`) + separate Bitrix DB (`db_bx` — PostgreSQL)

### Known Issues / What's Missing

| # | Issue | Location |
|---|---|---|
| 1 | `ByudjetPage` exists but **not wired into router** | `App.tsx` — no `/byudjet` route |
| 2 | `main.py` is 1230+ lines — all routes in one file | `backend/app/main.py` |
| 3 | Two Meta API clients (async + sync, different versions) | `backend/app/services/meta.py` |
| 4 | `get_timeman_status` defined twice | `backend/app/services/bitrix.py:82` and `:283` |
| 5 | Payroll calc shows 0 / loading — may be backend issue | `PayrollCalcPage.tsx` |
| 6 | `payroll-frontend/` is an outdated duplicate | `payroll-frontend/` — can be deleted |
| 7 | No DB migration system (Alembic) | backend |

---

## 1b. CALL STATISTICS — Backend Architecture

### Data flow

```
Browser (CallStatistikasi.tsx)
  │
  ├── getPyCallStats()  → GET /api/dashboard/call-stats-full  → Node.js :3001
  ├── getCallList()     → GET /api/dashboard/call-list        → Node.js :3001
  └── getCallFilterOptions() → GET /api/dashboard/call-filter-options → Node.js :3001

FastAPI also has its own call stats (separate, not used by frontend currently):
  └── GET /api/calls/stats?date_from&date_to  → backend/app/api/routes/call_stats.py
```

### Two parallel implementations

| | FastAPI (`/api/calls/stats`) | Node.js (`/api/dashboard/call-stats-full`) |
|---|---|---|
| File | `backend/app/api/routes/call_stats.py` | `bitrix-sync/` (server.js) |
| Source | `voximplant.statistic.get` + `crm.activity.list` fallback | Same Bitrix24 API |
| Features | ne_perezvonili, reaksiya_vaqti, missed_recalled/unrecalled | Used by frontend |
| DB tables | **None** — all in-memory from Bitrix24 | Unknown (Node.js side) |
| Active users | Fetches from `localhost:3001/api/dashboard/responsibles-list` | — |

### FastAPI call stats — `backend/app/api/routes/call_stats.py`

**Endpoint:** `GET /api/calls/stats?date_from=YYYY-MM-DD&date_to=YYYY-MM-DD`

**Bitrix24 sources:**
- Primary: `voximplant.statistic.get` — paginated (50/page), 0.5s delay between pages
- Fallback: `crm.activity.list` (TYPE_ID=2) — used if voximplant scope missing

**Call type mapping (voximplant):**
```
CALL_TYPE 1 = Outbound  (Chiquvchi)
CALL_TYPE 2 = Inbound   (Kiruvchi)
CALL_TYPE 3 = Inbound redirect (also inbound)
CALL_TYPE 4 = Callback  (Qayta qo'ng'iroq)
```

**Success detection logic:**
```python
is_success = CALL_FAILED_CODE in {"0", "200"}
# Fallback if CALL_FAILED_CODE absent: status_code==200 OR duration>=10s
is_missed  = is_inbound AND NOT is_success AND duration < 10s
is_ndz     = is_outbound AND NOT is_success  # "Ne do zvonka"
```

**ne_perezvonili (missed without callback) logic:**
```
For each missed inbound call:
  → look for any outbound to same phone within 24h window
  → if found: missed_recalled (resp_times measured)
  → if not:   ne_perezvonili count++
reaksiya_vaqti = avg seconds from missed → first callback
```

**Response shape (`CallStatsResult`):**
```typescript
{
  date_from, date_to,
  total_calls, inbound_calls, outbound_calls, callback_calls,
  success_calls, failed_calls, ndz_calls, missed_inbound,
  total_duration, avg_duration,   // seconds
  success_pct, failed_pct,        // 0–100
  ne_perezvonili,                 // missed with no callback in 24h
  reaksiya_vaqti,                 // avg seconds missed→callback
  responsibles: [{
    responsible_id, full_name, photo_url,
    total_calls, inbound_calls, outbound_calls, callback_calls,
    success_calls, failed_calls, ndz_calls, missed_inbound,
    missed_recalled, missed_unrecalled,
    total_duration, avg_duration, inbound_duration, outbound_duration,
    unique_inbound, unique_outbound, unique_total
  }]
}
```

### Standalone `call-stats/` module (legacy / separate service)

Located at `call-stats/` — a separate standalone FastAPI app, NOT mounted in the main backend.

- `client.py` — `fetch_all_calls()` — paginated voximplant fetch with retry/backoff
- `models.py` — `CallRecord`, `ResponsibleStats`, `StatsResult`
- `stats.py` — `compute_stats()` pure aggregation, `get_call_stats()` entry point
- `main.py` — `/stats?date_from&date_to` — simpler version (no ne_perezvonili logic)
- Status: **superseded by `backend/app/api/routes/call_stats.py`** which is more complete

### No DB tables for calls

Call stats are live-fetched from Bitrix24 on every request. There are **no SQL tables** for storing call records. This means:
- Every request hits Bitrix24 API and paginates through all records
- For a busy month (1000+ calls), this can take 10–30 seconds
- **Proposed improvement**: Add a `call_records` cache table (see DB section below)

### Proposed DB table for call caching

```sql
CREATE TABLE call_records (
    id                  BIGSERIAL PRIMARY KEY,
    call_id             TEXT UNIQUE NOT NULL,          -- voximplant CALL_ID
    portal_user_id      INTEGER,
    full_name           TEXT,
    phone_number        TEXT,
    call_type           SMALLINT,                      -- 1=out,2=in,3=in_redir,4=callback
    call_duration       INTEGER NOT NULL DEFAULT 0,    -- seconds
    call_start_time     TIMESTAMPTZ,
    call_failed_code    TEXT,
    call_status_code    INTEGER,
    is_success          BOOLEAN GENERATED ALWAYS AS (
                          call_failed_code IN ('0','200')
                        ) STORED,
    synced_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ON call_records (call_start_time);
CREATE INDEX ON call_records (portal_user_id, call_start_time);
CREATE INDEX ON call_records (phone_number, call_start_time);

-- Sync log: track what date ranges have been fetched
CREATE TABLE call_sync_log (
    id          SERIAL PRIMARY KEY,
    synced_date DATE NOT NULL UNIQUE,
    record_count INTEGER NOT NULL DEFAULT 0,
    synced_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

**With this table:**
- Nightly cron syncs yesterday's calls: `POST /api/calls/sync?date=YYYY-MM-DD`
- Stats endpoint queries DB instead of live Bitrix24 API → <100ms response
- Manual backfill: `POST /api/calls/sync?date_from=2026-01-01&date_to=2026-06-30`

---

## 2. SERVER SETUP REFERENCE

### nginx (`/etc/nginx/sites-available/mountain` or `nginx/mountain.conf`)

```nginx
server {
    listen 80;
    server_name mountdashboard.data365verification.uz;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name mountdashboard.data365verification.uz;

    ssl_certificate     /etc/letsencrypt/live/mountdashboard.data365verification.uz/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/mountdashboard.data365verification.uz/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    root /var/www/mountain/frontend/app/dist;
    index index.html;

    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Content-Security-Policy "frame-ancestors *" always;

    location ~* \.(env|git|sql|bak|sh|py|rb|pl)$ { return 404; }

    # Node.js sync service (Bitrix CRM, campaigns, reja, webhooks)
    location /webhook/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_connect_timeout 5s;
        proxy_send_timeout 10s;
        proxy_read_timeout 10s;
    }
    location /api/campaigns/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_read_timeout 180s;
    }
    location /api/dashboard/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_read_timeout 180s;
    }
    location /api/reja/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_read_timeout 60s;
    }

    # FastAPI backend
    location /api/ {
        proxy_pass http://127.0.0.1:8001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 180s;
        proxy_buffering on;
        proxy_buffer_size 16k;
        proxy_buffers 8 16k;
    }
    location = /install {
        proxy_pass http://127.0.0.1:8001;
        proxy_read_timeout 30s;
    }

    # Static assets cache
    location /assets/ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
    location = /index.html {
        add_header Cache-Control "no-cache, no-store, must-revalidate";
        expires 0;
        try_files $uri /index.html;
    }

    # SPA fallback
    location / {
        try_files $uri /index.html;
    }
}
```

### systemd units

```ini
# /etc/systemd/system/mountain.service  (FastAPI)
[Unit]
Description=Mountain FastAPI
After=network.target

[Service]
User=www-data
WorkingDirectory=/var/www/mountain/backend
ExecStart=/var/www/mountain/backend/.venv/bin/uvicorn app.main:app \
    --host 127.0.0.1 --port 8001 --workers 2
Restart=always
EnvironmentFile=/var/www/mountain/backend/.env

[Install]
WantedBy=multi-user.target
```

```ini
# /etc/systemd/system/mountain-sync.service  (Node.js CRM sync)
[Unit]
Description=Mountain Bitrix Sync
After=network.target

[Service]
User=www-data
WorkingDirectory=/var/www/mountain/bitrix-sync
ExecStart=/usr/bin/node server.js
Restart=always
EnvironmentFile=/var/www/mountain/bitrix-sync/.env

[Install]
WantedBy=multi-user.target
```

---

## 3. DATABASE (PostgreSQL — v2 migration target)

```sql
-- All existing SQLite tables, migrated to PostgreSQL:

CREATE TABLE employees (
    id                      SERIAL PRIMARY KEY,
    bitrix_user_id          INTEGER UNIQUE NOT NULL,
    full_name               TEXT NOT NULL,
    email                   TEXT,
    role                    TEXT NOT NULL DEFAULT 'closer',
    status                  TEXT NOT NULL DEFAULT 'active',
    fix_base_uzs            INTEGER NOT NULL DEFAULT 0,
    attendance_weekly_uzs   INTEGER NOT NULL DEFAULT 0,
    report_weekly_uzs       INTEGER NOT NULL DEFAULT 0,
    schedule_start          TEXT NOT NULL DEFAULT '09:00',
    schedule_end            TEXT NOT NULL DEFAULT '18:00',
    kpi_rule_id             INTEGER REFERENCES kpi_rules(id),
    dashboard_role          TEXT NOT NULL DEFAULT '',
    login                   TEXT UNIQUE,
    password_hash           TEXT,
    avatar_url              TEXT,
    notes                   TEXT,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE kpi_rules (
    id          SERIAL PRIMARY KEY,
    name        TEXT NOT NULL,
    role        TEXT NOT NULL DEFAULT 'closer',
    entity      TEXT NOT NULL DEFAULT 'deals',
    period      TEXT NOT NULL DEFAULT 'monthly',
    currency    TEXT NOT NULL DEFAULT 'USD',
    mode        TEXT NOT NULL DEFAULT 'single_tier',
    tiers       JSONB NOT NULL DEFAULT '[]',
    is_active   BOOLEAN NOT NULL DEFAULT true,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE bonus_rules (
    id              SERIAL PRIMARY KEY,
    name            TEXT NOT NULL,
    trigger_text    TEXT NOT NULL DEFAULT '',
    period          TEXT NOT NULL DEFAULT 'monthly',
    target_role     TEXT NOT NULL DEFAULT 'closer',
    rule_type       TEXT NOT NULL DEFAULT 'auto',
    value_kind      TEXT NOT NULL DEFAULT 'percent',
    value           NUMERIC(12,2) NOT NULL DEFAULT 0,
    is_active       BOOLEAN NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE bonus_awards (
    id              SERIAL PRIMARY KEY,
    employee_id     INTEGER NOT NULL REFERENCES employees(id),
    rule_id         INTEGER REFERENCES bonus_rules(id),
    rule_name       TEXT NOT NULL DEFAULT '',
    period_label    TEXT NOT NULL,
    amount_usd      NUMERIC(12,2) NOT NULL DEFAULT 0,
    note            TEXT,
    awarded_by      INTEGER REFERENCES employees(id),
    awarded_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE attendance_log (
    id              SERIAL PRIMARY KEY,
    employee_id     INTEGER NOT NULL REFERENCES employees(id),
    day             DATE NOT NULL,
    start_time      TEXT,
    end_time        TEXT,
    bucket          TEXT NOT NULL DEFAULT 'absent',
    note            TEXT,
    UNIQUE (employee_id, day)
);

CREATE TABLE report_log (
    id              SERIAL PRIMARY KEY,
    employee_id     INTEGER NOT NULL REFERENCES employees(id),
    day             DATE NOT NULL,
    submitted_at    TEXT,
    bucket          TEXT NOT NULL DEFAULT 'missed',
    note            TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (employee_id, day)
);

CREATE TABLE penalty_config (
    id                          INTEGER PRIMARY KEY DEFAULT 1,
    attendance_late_soft_uzs    INTEGER NOT NULL DEFAULT 0,
    attendance_late_uzs         INTEGER NOT NULL DEFAULT 0,
    attendance_penalty_uzs      INTEGER NOT NULL DEFAULT 0,
    attendance_absent_uzs       INTEGER NOT NULL DEFAULT 0,
    report_late_soft_uzs        INTEGER NOT NULL DEFAULT 0,
    report_late_uzs             INTEGER NOT NULL DEFAULT 0,
    report_penalty_uzs          INTEGER NOT NULL DEFAULT 0,
    report_missed_uzs           INTEGER NOT NULL DEFAULT 0,
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE monthly_targets (
    id                  SERIAL PRIMARY KEY,
    year                INTEGER NOT NULL,
    month               INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
    target_usd          NUMERIC(14,2) NOT NULL DEFAULT 0,
    weekly_breakdown    JSONB NOT NULL DEFAULT '[]',
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (year, month)
);

CREATE TABLE payroll_approvals (
    id                   SERIAL PRIMARY KEY,
    employee_id          INTEGER NOT NULL REFERENCES employees(id),
    year                 INTEGER NOT NULL,
    month                INTEGER NOT NULL,
    employee_name        TEXT NOT NULL DEFAULT '',
    fix_base_uzs         INTEGER NOT NULL DEFAULT 0,
    attendance_bonus_uzs INTEGER NOT NULL DEFAULT 0,
    kpi_payout_usd       NUMERIC(12,2) NOT NULL DEFAULT 0,
    bonus_total_usd      NUMERIC(12,2) NOT NULL DEFAULT 0,
    penalty_uzs          INTEGER NOT NULL DEFAULT 0,
    total_uzs            INTEGER NOT NULL DEFAULT 0,
    total_usd            NUMERIC(12,2) NOT NULL DEFAULT 0,
    note                 TEXT,
    approved_by          INTEGER REFERENCES employees(id),
    status               TEXT NOT NULL DEFAULT 'approved',
    approved_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (employee_id, year, month)
);

CREATE TABLE tariflar (
    id                  SERIAL PRIMARY KEY,
    service_type        TEXT NOT NULL,
    name                TEXT NOT NULL,
    loyiha_summasi      INTEGER NOT NULL DEFAULT 0,
    variant_klass       TEXT NOT NULL DEFAULT '',
    harf_oralighi       TEXT NOT NULL DEFAULT '',
    tekshiruvlar        INTEGER NOT NULL DEFAULT 0,
    deadline_mijoz      TEXT NOT NULL DEFAULT '',
    hudud               TEXT NOT NULL DEFAULT 'Mahalliy',
    jami_summa          INTEGER NOT NULL DEFAULT 0,
    sort_order          INTEGER NOT NULL DEFAULT 0,
    is_active           BOOLEAN NOT NULL DEFAULT true,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE kunlik_custom_sections (
    id              SERIAL PRIMARY KEY,
    title           TEXT NOT NULL,
    uf_field        TEXT NOT NULL,
    uf_field_deal   TEXT NOT NULL,
    source_names    JSONB NOT NULL DEFAULT '[]',
    color           TEXT NOT NULL DEFAULT '#6366f1',
    sort_order      INTEGER NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE kunlik_plans (
    id          SERIAL PRIMARY KEY,
    section     TEXT NOT NULL,
    metric_key  TEXT NOT NULL,
    month       TEXT NOT NULL,
    year        INTEGER NOT NULL,
    value       NUMERIC(14,2) NOT NULL DEFAULT 0,
    UNIQUE (section, metric_key, month, year)
);

CREATE TABLE kunlik_overrides (
    id          SERIAL PRIMARY KEY,
    section     TEXT NOT NULL,
    metric_key  TEXT NOT NULL,
    month       TEXT NOT NULL,
    year        INTEGER NOT NULL,
    day         INTEGER NOT NULL CHECK (day BETWEEN 1 AND 31),
    value       NUMERIC(14,2),
    UNIQUE (section, metric_key, month, year, day)
);

CREATE INDEX ON attendance_log (employee_id, day);
CREATE INDEX ON report_log (employee_id, day);
CREATE INDEX ON bonus_awards (employee_id, period_label);
CREATE INDEX ON payroll_approvals (employee_id, year, month);
CREATE INDEX ON kunlik_plans (section, year);
CREATE INDEX ON kunlik_overrides (section, year, month);
```

---

## 4. CLAUDE CODE PROMPT

> Open a new Claude Code session in the `/var/www/mountain` directory on the server (or in the local `mountain/` repo). Copy this block entirely.

---

```
You are continuing development on Mountain — an internal CRM analytics + payroll dashboard for a design agency. Read this brief carefully before touching any file.

## Project layout (server: /var/www/mountain, local: ~/mountain)

```
mountain/
├── frontend/app/        ← THE ONLY FRONTEND (React 19 + Vite + Tailwind + Radix UI)
│   ├── src/
│   │   ├── App.tsx              main router
│   │   ├── index.css            Tailwind + CSS variables (light/dark)
│   │   ├── components/          AppLayout, Sidebar, Button, Badge, MetricCard,
│   │   │                        DataTable, FilterBar, Topbar, charts, Skeleton, Toast
│   │   ├── pages/
│   │   │   ├── marketing/       LidlarPage, SdelkalarPage, KampaniyalarPage,
│   │   │   │                    CallStatistikasi, KunlikPage, ByudjetPage
│   │   │   ├── payroll/         DashboardPage, EmployeesPage, AttendancePage,
│   │   │   │                    KpiRulesPage, BonusPage, TariflarPage,
│   │   │   │                    PayrollCalcPage, HisobotPage, TaqsimotPage, RejaPage
│   │   │   ├── RejaPage.tsx     (top-level sales plan overview)
│   │   │   ├── RejaCreatePage.tsx
│   │   │   ├── SettingsPage.tsx
│   │   │   └── LoginPage.tsx
│   │   ├── lib/
│   │   │   ├── auth.ts          JWT localStorage, getStoredToken, getStoredRole
│   │   │   └── api/
│   │   │       ├── client.ts    apiGet<T>, authedFetch, API_URL_CRM, API_URL_PAYROLL
│   │   │       ├── leads.ts     listLeadsRich, getDashboardStats, getResponsiblesStats
│   │   │       ├── deals.ts     getDealsStats, getDealsBySource
│   │   │       ├── meta.ts      getMetaInsights, getKunlikHisobot, getKunlikMeta,
│   │   │       │                saveKunlikPlan, saveKunlikOverride, getKunlikSections
│   │   │       ├── payroll.ts   listEmployees, listKpiRules, calculatePayroll, etc.
│   │   │       ├── reja.ts      listRejaPlans, getRejaDistribution, etc.
│   │   │       └── config.ts    getConfig
│   │   └── hooks/               useDarkMode, useLocalStorage
│   ├── vite.config.ts           base: '/', proxy: /api → :8000 (dev)
│   ├── tailwind.config.js
│   └── package.json             recharts, @radix-ui/*, @tanstack/*, lucide-react
├── backend/                     FastAPI (port 8001 prod, 8000 dev)
├── bitrix-sync/                 Node.js (port 3001) — CRM sync, campaigns, reja plans
└── nginx/mountain.conf          nginx config (served from frontend/app/dist)
```

## API routing (production)

| URL prefix | Service |
|---|---|
| `/api/campaigns/*` | Node.js :3001 |
| `/api/dashboard/*` | Node.js :3001 |
| `/api/reja/*` | Node.js :3001 |
| `/webhook/*` | Node.js :3001 |
| `/api/*` (everything else) | FastAPI :8001 |

## Tech rules — MUST follow

1. **Frontend only uses `apiGet` and `authedFetch`** from `lib/api/client.ts`. No axios, no raw fetch in pages.
2. **Tailwind CSS** for all styling. Use existing CSS variables (`text-[color:var(--text)]`, `bg-[color:var(--bg2)]`, etc.) or Tailwind utility classes that reference them in `tailwind.config.js`.
3. **No new dependencies** unless absolutely required. recharts, Radix UI, TanStack are already installed.
4. **`apiGet<T>(path, params, baseUrl)`** — pass `API_URL_CRM` as 3rd arg for Node.js endpoints, omit for FastAPI endpoints.
5. All pages use `useQuery` from `@tanstack/react-query`. All queries in the page component directly (no separate hook file needed for simple queries).
6. Lazy-load all new pages in `App.tsx` using `const MyPage = lazy(() => import('@/pages/...'))`.
7. Role guard: wrap routes with `<RoleRoute roles={[...]}> ` — roles are: `"admin"`, `"owner"`, `"closer"`, `"marketolog"`, `"hunter"`.

## What to implement now

### Fix 1 — Wire ByudjetPage into the router

`frontend/app/src/App.tsx` is missing a route for `/byudjet`. The page `pages/marketing/ByudjetPage.tsx` is already fully built.

Add to `App.tsx`:
- Import: `const ByudjetPage = lazy(() => import('@/pages/marketing/ByudjetPage'));`
- Route: `<Route path="/byudjet" element={<RoleRoute roles={MKT}><S><ByudjetPage /></S></RoleRoute>} />`

Add to `Sidebar.tsx` MAIN_NAV array (after "Kunlik hisobot"):
`{ to: "/byudjet", label: "Byudjet", icon: DollarSign, roles: MKT }`

Import `DollarSign` from lucide-react in `Sidebar.tsx`.

### Fix 2 — Debug PayrollCalcPage loading issue

The `/payroll` page shows "Yuklanmoqda..." and 0 counts. Check:
1. Read `frontend/app/src/pages/payroll/PayrollCalcPage.tsx` fully
2. Check which API function it calls and what endpoint
3. Read the backend endpoint handler in `backend/app/api/routes/payroll.py` (or `backend/app/main.py`)
4. Test the endpoint with: `curl -s http://localhost:8001/api/payroll/calculate?bitrix_user_id=1&year=2026&month=6`
5. Report what the issue is, then fix it

### Fix 3 — Add Byudjet link to Sidebar nav label

Currently the sidebar shows "Kunlik hisobot" — after adding Byudjet in Fix 1, the marketing section should have 6 items:
Lidlar → Sdelkalar → Call statistikasi → Kampaniyalar → Kunlik hisobot → Byudjet

## Build and deploy

After making changes:

```bash
# Build frontend
cd /var/www/mountain/frontend/app
npm ci --silent
npm run build

# Verify build succeeded (should show dist/index.html)
ls dist/

# Reload nginx (no restart needed for frontend-only changes)
sudo systemctl reload nginx

# If backend changed:
sudo systemctl restart mountain
```

## Start here

Begin with Fix 1 (wire ByudjetPage into router). Read `App.tsx` first, then `Sidebar.tsx`, then make the two edits. Show me the diff before applying.
```

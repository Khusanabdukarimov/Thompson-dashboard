# Mountain

Marketing, sotuv va payroll dashboard. Bitrix24 CRM va Meta Ads ma'lumotlarini birlashtiradi.

## Struktura

```
mountain/
├── backend/      FastAPI servisi (Python + SQLite)
├── frontend/     React + Vite + Tailwind
├── docs/         arxitektura hujjatlari
└── deploy.sh     bitta buyruq deploy
```

To'liq tafsilot: [docs/architecture.md](docs/architecture.md) · [SERVER_SETUP.md](SERVER_SETUP.md)

## Foydali havolalar

- 📘 **GitHub repo:** https://github.com/JaysonKhan/mountain
- 📗 **Bitrix24 CRM portal:** https://mountain.bitrix24.kz/crm/
- 📙 **API Swagger UI (FastAPI):** http://207.180.198.41/api/docs
- 🌐 **Production URL:** http://207.180.198.41/
- 🛠 **Server:** `ssh mountain` (deploy: `./deploy.sh`)

## Tezkor ishga tushirish (lokal dev)

```bash
# backend
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.sample .env   # .env'da BITRIX/META tokenlarini to'ldiring
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000

# frontend
cd ../frontend/app
npm install
npm run dev    # http://127.0.0.1:5173
```

Vite proksisi `/api/*` ni avtomatik backend (8000)ga uzatadi.

## Productionga deploy

```bash
./deploy.sh                       # backend + frontend
./deploy.sh --backend-only
./deploy.sh --frontend-only
./deploy.sh "fix: ..."            # custom commit msg
```

Skript: ssh check → git push → server pull → backend pip install + restart → frontend npm ci + build → nginx reload → healthcheck. ~50–70s.

## Stack

- **Backend**: FastAPI + uvicorn + SQLModel/SQLite + httpx + tenacity (Bitrix24 + Meta Graph API)
- **Frontend**: React 18 + Vite + TypeScript + Tailwind 3 + TanStack Query/Table + Recharts + Radix UI
- **Auth**: opt-in JWT via `AUTH_ENABLED=true` + `ADMIN_PASSWORD=...` env'lari
- **Theme**: light + dark (CSS vars, sidebar toggle)
- **Server**: Ubuntu 22.04 + nginx + systemd + UFW + Fail2Ban + certbot (TLS tayyor)

## Sahifalar

**Marketing (5):** Kunlik hisobot · Kampaniyalar · Lidlar analitika · Sdelkalar · Byudjet

**Payroll (8):** Dashboard · Reja & Leadlar · Xodimlar · Davomat (realtime) · Hisobot intizomi · KPI qoidalar · Bonuslar · Oylik hisob

**Tizim:** Sozlamalar (jarima tariflari, system info)

## Ma'lumot manbalari

| Manba | Fayl | Endpoint'lar |
|---|---|---|
| **Bitrix24 CRM** | `backend/app/services/bitrix.py` | leads, deals, users, timeman, status names |
| **Meta Graph API** | `backend/app/services/meta.py` | spend, leads, clicks, impressions per platform/day |
| **SQLite DB** | `backend/data/mountain.db` | employees_extra, kpi_rules, bonus_rules, bonus_awards, monthly_targets, attendance_log, report_log, penalty_config |

## Backup

```bash
ssh mountain "/var/www/mountain/backend/scripts/backup_db.sh"
# yoki crontab:
0 3 * * * /var/www/mountain/backend/scripts/backup_db.sh >> /var/log/mountain-backup.log 2>&1
```

## Hotkeys

- `⌘K` / `Ctrl+K` — Komanda paleti (sahifalar bo'yicha tezkor navigatsiya)
- `/` — Filter qidiruvga fokus (FilterBar bor sahifalarda)
- `Esc` — Modal / palette yopish

## Auth yoqish

```bash
ssh mountain "cat >> /var/www/mountain/backend/.env <<EOF
AUTH_ENABLED=true
ADMIN_PASSWORD=<strong-password>
JWT_SECRET=$(openssl rand -hex 32)
EOF
systemctl restart mountain"
```

# Mountain

Marketing, sotuv va payroll dashboard. Bitrix24 CRM va Meta Ads ma'lumotlarini birlashtiradi.

## Struktura

```
mountain/
├── backend/      FastAPI servisi (Python)
├── frontend/     browser ilovasi (legacy HTML + redesign)
└── docs/         arxitektura va eslatmalar
```

To'liq tafsilot uchun: [docs/architecture.md](docs/architecture.md).

## Tezkor ishga tushirish

```bash
# backend
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.sample .env   # so'ng .env'da haqiqiy tokenlarni to'ldiring
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

So'ngra brauzerda:
- `http://127.0.0.1:8000/`         → marketing dashboard
- `http://127.0.0.1:8000/payroll`  → payroll dashboard
- `http://127.0.0.1:8000/api/docs` → Swagger UI

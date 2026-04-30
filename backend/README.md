# backend

FastAPI servisi. Bitrix24 va Meta (Facebook/Instagram Ads) APIs uchun proxy + agregator.

## Tuzilish

```
backend/
├── app/
│   ├── main.py          FastAPI entry — barcha route'lar (hozircha bitta faylda)
│   ├── core/            settings, deps (kelajakdagi qatlam)
│   ├── api/routes/      route'larni domenlar bo'yicha bo'lish (kelajakdagi qatlam)
│   ├── services/
│   │   ├── bitrix.py    Bitrix24 REST wrapper
│   │   └── meta.py      Meta Graph API client (async + legacy sync)
│   ├── schemas/         pydantic modellari (kelajakdagi qatlam)
│   └── domain/          konstantalar va enumlar (kelajakdagi qatlam)
├── scripts/             debug yordamchilari (token tekshirish va h.k.)
├── tests/
├── .env.sample
└── requirements.txt
```

`core/`, `api/routes/`, `schemas/`, `domain/` papkalari hozircha bo'sh —
`main.py`'ni keyingi qadamda ularga bo'lib chiqamiz.

## Ishga tushirish

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.sample .env
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

## Env

`.env.sample`'da minimum kerak bo'lgan kalitlar bor. To'liq ro'yxat:

| Kalit | Vazifasi |
|---|---|
| `FB_AD_ACCOUNT_ID` / `META_AD_ACCOUNT_ID` | Meta reklama hisobi (act_… prefiksi ixtiyoriy) |
| `FB_ACCESS_TOKEN` / `META_USER_TOKEN` | Meta Graph API token (`ads_read` ruxsati bilan) |
| `FB_API_VERSION` | Default `v21.0` |
| `BITRIX24_PORTAL` | masalan `https://your-portal.bitrix24.com/rest/` |
| `BITRIX24_TOKEN` | webhook tokeni |
| `TASHRIF_DATE` | tashrif sanasi uchun custom field nomi |
| `TASHRIF_VISTORS_COUNT` | tashriflar soni custom field nomi |
| `SERVER_IP` | uvicorn host (default `127.0.0.1`) |

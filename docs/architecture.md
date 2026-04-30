# Mountain — arxitektura

## Yuqori darajada

```
┌────────────────────┐      HTTPS      ┌──────────────────────────────┐
│  Browser (frontend)│  ─────────────► │  Backend  (FastAPI, Python)  │
│  marketing.html    │                 │  app/main.py                 │
│  payroll.html      │  ◄────────────  │                              │
└────────────────────┘    JSON, HTML   └──────┬─────────────┬─────────┘
                                              │             │
                                       ┌──────▼─────┐ ┌─────▼──────────┐
                                       │ Bitrix24   │ │ Meta Graph API │
                                       │ REST       │ │ (FB + IG Ads)  │
                                       └────────────┘ └────────────────┘
```

Frontend'da hech qanday biznes-mantiq yo'q (faqat ko'rinish + filtrlar).
Backend Bitrix va Meta'dan xom ma'lumotlarni oladi va sahifalarga qulay
shaklga keltirib qaytaradi.

## Backend qatlamlari (maqsadli)

```
app/main.py            FastAPI entrypoint, route registration
   │
   ▼
app/api/routes/*       endpointlar — domenlar bo'yicha bo'lingan
   │
   ▼
app/services/*         tashqi tizimlar bilan integratsiya
   ├── bitrix.py       crm.lead.*, crm.deal.*, timeman.*, status mapping
   └── meta.py         Graph API client (async + legacy sync)
   │
   ▼
app/schemas/*          pydantic modellari (so'rov/javob)
app/domain/*           konstantalar, enumlar, biznes qoidalar
```

> Hozir `main.py` ~520 qator va u barcha mantiqni o'zida saqlaydi.
> Keyingi refactor pasportlari: route'larni `api/routes/`'ga chiqarish va
> agregatsiya mantig'ini `services/`'dagi pure funksiyalarga ajratish.

## Frontend (joriy holat)

`frontend/legacy/` — bu vanilla HTML/JS SPA'lar to'plami. Backend ularni
to'g'ridan to'g'ri `FileResponse` orqali uzatadi.

| URL | Fayl | Sahifalar |
|---|---|---|
| `/`, `/marketing` | [marketing.html](../frontend/legacy/marketing.html) | Kunlik hisobot, Kampaniyalar, Lidlar, Sdelkalar, Byudjet, Sozlamalar |
| `/payroll` | [payroll.html](../frontend/legacy/payroll.html) | Dashboard, Reja, Employees, Attendance, Hisobot, KPI, Bonus, Payroll |

## Redesign rejasi

1. Yangi `frontend/` ostida zamonaviy stack (Vite + React yoki shunga o'xshash)
2. Backend OpenAPI spec'idan typed client generatsiyasi
3. Marketing va payroll ekranlarini bitta ilovaga birlashtirish
4. Backend tomonidan HTML uzatish endpointlari olib tashlanadi
   (`/`, `/marketing`, `/payroll`); frontend alohida deploy qilinadi va
   `/api`'ga so'rov yuboradi
5. Legacy HTML'lar redesign qoplagan ekranlar bilan birga olib tashlanadi

## Endpoint xaritasi

Bugungi holat (`backend/app/main.py`):

| Endpoint | Frontend foydalanuvchisi | Eslatma |
|---|---|---|
| `GET /api/users` | (yo'q) | Bitrix users |
| `GET /api/users/timeman` | (yo'q) | kim hozir ishda |
| `GET /api/leads` | (yo'q) | xom lead ro'yxati |
| `POST /api/leads` | (yo'q) | yangi lead yaratish |
| `GET /api/leads/{id}` | (yo'q) | bitta lead |
| `GET /api/stats/leads` | marketing > Lidlar | agregatsiya + UTM facets |
| `GET /api/stats/lead-quality` | marketing > Lidlar | sifatsiz/bekor/sandiq sabablari |
| `GET /api/stats/deals` | marketing > Sdelkalar | bosqich bo'yicha agregatsiya |
| `GET /api/stats/deals/by-source` | marketing > Sdelkalar | manba bo'yicha bo'linish |
| `GET /api/deals/aggregate` | (yo'q) | bitta foydalanuvchi bo'yicha sum |
| `GET /api/attendance` | (yo'q) | tashriflar |
| `GET /api/facebook/insights` | (yo'q) | xom hisob darajasidagi insights |
| `GET /api/meta/insights` | marketing > Kunlik/Kampaniyalar/Byudjet | oylik agregatsiya |
| `GET /api/meta/accounts` | (yo'q) | ad accountlar ro'yxati |
| `GET /api/dashboard/daily` | marketing > Kunlik | bir kunlik birlashma |
| `GET /api/payroll/{emp_id}` | (yo'q, **demo data**) | hozircha hardcoded |

## Ma'lum bo'lgan texnik qarzlar

- `services/bitrix.py`'da `get_timeman_status` ikki marta aniqlangan
  ([82-qator](../backend/app/services/bitrix.py#L82) va [283-qator](../backend/app/services/bitrix.py#L283))
- `services/meta.py`'da ikkita parallel client yashaydi: yangi async `MetaClient`
  va eski sync `requests`-asosli funksiyalar. Ular boshqa `FB_API_VERSION`/`v19`
  versiyalarini va boshqa env nomlarini ishlatadi
- `services/bitrix.py` `helper.config` modulini import qilishga urinadi (mavjud emas,
  `.env`'ga fallback bor)
- `main.py` payroll endpointi hardcoded demo qaytaradi
- Frontend lokal `config.js`'da real Meta tokenini saqlaydi — uzoq muddatda
  backend orqali uzatish to'g'riroq

Bu barchasi keyingi refactor uchun ro'yxatga olingan; rename bosqichida tegilmadi.

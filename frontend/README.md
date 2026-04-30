# frontend

Browser ilovasi. Hozirda bu papkada faqat legacy statik HTML'lar bor;
redesign keyingi qadamda alohida arxitekturada (Vite + React/Next yoki shunga o'xshash) qurilishi rejalashtirilgan.

## Tuzilish

```
frontend/
└── legacy/                 hozirgi statik HTML'lar — backend tomonidan to'g'ridan to'g'ri uzatiladi
    ├── marketing.html      marketing/sotuv dashboard (5 sahifa SPA, vanilla JS)
    ├── payroll.html        payroll dashboard (7 sahifa, hozircha hardcoded ma'lumotlar)
    ├── meta-api.js         frontend Meta Graph API ES-moduli
    ├── config.example.js   token uchun shablon
    └── config.js           (gitignored) haqiqiy tokenlar bilan lokal nusxa
```

Backend route'lari:
- `GET /`         → `legacy/marketing.html`
- `GET /marketing` → `legacy/marketing.html`
- `GET /payroll`  → `legacy/payroll.html`
- `GET /meta-api.js`, `GET /config.js` → tegishli statik fayllar

## Redesign rejasi (qisqa)

- Marketing va payroll'ni umumiy frontend ilovasiga birlashtirish
- Komponentli arxitektura (router, state-management, design system)
- Backend bilan typed API client (OpenAPI'dan generatsiya)
- Payroll'ni `/api/payroll/*` orqali real ma'lumotlarga ulash
- Vite dev server backend bilan parallel ishlaydi (proxy `/api`)

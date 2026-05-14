# Full Dashboard Redesign — 9 Pages + Dark/Light Mode

## Reference

See the attached design image showing all 9 pages. Match layouts exactly.

---

## THEME SYSTEM (implement first)

### Dark/Light mode toggle
Add a theme provider with CSS variables. Toggle button in sidebar footer.

```tsx
// src/lib/theme.tsx
const themes = {
  dark: {
    '--bg-primary': '#0a0e1a',
    '--bg-secondary': '#111827',
    '--bg-card': '#1a1f35',
    '--bg-input': '#1e2438',
    '--text-primary': '#ffffff',
    '--text-secondary': '#9ca3af',
    '--text-muted': '#6b7280',
    '--border': 'rgba(255,255,255,0.08)',
    '--accent-blue': '#3b82f6',
    '--accent-green': '#10b981',
    '--accent-red': '#ef4444',
    '--accent-orange': '#f59e0b',
    '--accent-purple': '#8b5cf6',
    '--accent-teal': '#06b6d4',
  },
  light: {
    '--bg-primary': '#f8fafc',
    '--bg-secondary': '#ffffff',
    '--bg-card': '#ffffff',
    '--bg-input': '#f1f5f9',
    '--text-primary': '#1e293b',
    '--text-secondary': '#64748b',
    '--text-muted': '#94a3b8',
    '--border': 'rgba(0,0,0,0.08)',
    '--accent-blue': '#2563eb',
    '--accent-green': '#059669',
    '--accent-red': '#dc2626',
    '--accent-orange': '#d97706',
    '--accent-purple': '#7c3aed',
    '--accent-teal': '#0891b2',
  }
}
```

Store preference in localStorage. Apply class `dark` or `light` to `<html>`.
ALL components must use CSS variables — no hardcoded colors.

---

## SIDEBAR

Fixed left sidebar, collapsible:

```
Logo: LIDLAR (icon + text)
─────────────────
📊 Bosh sahifa
📈 Lidlar          ← current "Lidlar analitika"
🏷️ Sdelkalar       ← new
📣 Kampaniyalar    ← existing
📋 Kunlik hisobot  ← new
💰 Byudjet         ← new
📅 Reja            ← new
📊 Hisobot         ← new
💵 Payroll         ← existing
⚙️ Sozlamalar      ← new
─────────────────
🌙/☀️ Dark/Light toggle
```

- Active page highlighted with accent color + left border
- Collapsed state shows only icons
- Sidebar width: 240px expanded, 64px collapsed
- Use Lucide React icons

---

## PAGE 1: LIDLAR ANALITIKA (already built — keep as is)

Keep the current implementation. Only ensure it uses CSS variables for theming.

---

## PAGE 2: SDELKALAR

### Header stats (4 cards):
| Card | Label | Color |
|------|-------|-------|
| Yangi Sdelkalar | count of new deals | blue |
| Yutqizilgan Sdelkalar | failed deals | red |
| Jami Sotuv | SUM(opportunity) for won deals | green |
| O'rtacha Chek | AVG(opportunity) for won deals | orange |
| Konversiya | won / total * 100 | purple |

### Deals table:
Columns: #, Sdelka nomi, Mas'ul, Mijoz, Summa, Manba, Sana, Status (color badge)
- Sortable, searchable, paginated
- Status badges: Yutuldi (green), Bekor (red), Jarayonda (yellow)

### Backend endpoint:
```
GET /api/dashboard/deals-stats?from=&to=
GET /api/dashboard/deals-list?from=&to=&page=1&limit=20
```

Query from existing `deals` table.

---

## PAGE 3: KAMPANIYALAR (already built — enhance)

Keep existing implementation. Ensure it uses CSS variables.
Add pie chart for "Manbalar kesimida" (leads by source: Facebook, Instagram, Telegram).

---

## PAGE 4: KUNLIK HISOBOT

### Header stats (3 cards):
| Card | Label | Data |
|------|-------|------|
| Jami Oylik Byudjet | monthly budget target | from monthly_targets table |
| Jami Leadlar | leads this month | from leads table |
| Umumiy ROAS | revenue / spend | calculated |

### ROAS ko'rsatkich (left section):
Table: Kanal | ROAS | Status (Yaxshi/Yomon/O'rtacha)
- Instagram, Facebook, Telegram, Google Ads rows

### Kunlik ko'rsatkichlar (right table):
Columns: Sana, Spend, Leadlar, Sotuvlar, ROAS
- Last 7 days, one row per day

### Bitrix integratsiya status:
- Show sync status: "Sinxronizatsiya muvaffaqiyatli" (green) or error (red)
- Last sync time from webhook_logs

### Trend chart:
Line chart showing daily leads by channel over the month.
Use recharts LineChart.

### Backend:
```
GET /api/dashboard/daily-report?month=5&year=2026
```

---

## PAGE 5: BYUDJET

### Header stats (4 cards):
| Card | Label |
|------|-------|
| Oylik Maqsad (Target) | from monthly_targets table |
| Joriy Xarajat | total spend this month |
| Qolgan Byudjet | target - spent |
| Sarflanish (%) | spent / target * 100 |

### Burn Rate gauge:
- Semicircle gauge showing % of budget consumed
- Warning text: "15-kun 30 kundan: Siz X% byudjet sarfladingiz"
- Color: green (<50%), yellow (50-80%), red (>80%)
- "Over Pace" indicator

### Kunlik o'rtacha xarajat:
- Daily average spend
- Rejalashtilgan vs actual

### Kanal kesimida byudjet taqsimoti:
Table: Kanal | Maqsad | Sarflangan | Qolgan | Progress bar
- Instagram, Facebook, Telegram, Google Ads

### Backend:
```
GET /api/dashboard/budget?month=5&year=2026
```

Uses monthly_targets + campaign_cache tables.

---

## PAGE 6: REJA (Plan)

### Left: Filter panel
- Reja qo'shish form
- Filters: Manba, Status, Lid manbasi dropdowns
- Kutilgan sana date picker
- "Reja Ajoylash" submit button

### Right: Reja ro'yxati table
Columns: #, Xodim, Vazifa, Maqsad, Muddat, Status
- Status: Yangi, Jarayonda, Tugatilgan
- Editable rows

### Bottom: JAMI MAQSAD total

### Backend:
Create new table:
```sql
CREATE TABLE IF NOT EXISTS plans (
  id SERIAL PRIMARY KEY,
  responsible_id INT REFERENCES responsibles(id),
  task TEXT NOT NULL,
  target INT DEFAULT 0,
  actual INT DEFAULT 0,
  deadline DATE,
  status VARCHAR(50) DEFAULT 'new',
  source VARCHAR(100),
  created_at TIMESTAMP DEFAULT NOW()
);
```

Endpoints:
```
GET /api/plans?month=5&year=2026
POST /api/plans
PUT /api/plans/:id
DELETE /api/plans/:id
```

---

## PAGE 7: PAYROLL HISOBLASH (already exists — enhance)

Keep existing payroll calculation. Ensure theming with CSS variables.
Add:
- Export CSV and Export PDF buttons
- Header cards: Jami Xodimlar, Jami Komissiya, O'rtacha Komissiya, Eng Yuqori

---

## PAGE 8: HISOBOT (Xodim Disiplinali)

### Two tabs: "Umumiy ko'rinish" | "Trend ko'rinish"

### Umumiy ko'rinish tab:
**Disiplina reytingi table:**
Columns: #, Xodim, Joriy Reyting (score), O'zgarish (up/down arrow)
- Score out of 100
- Colored: green (>80), yellow (60-80), red (<60)
- Sort by rating descending

### Trend ko'rinish tab:
**6 oylik trend line chart:**
- X axis: months (Dec 2024 — May 2025)
- Y axis: score (0-100)
- One line per employee
- Use recharts LineChart

### Date range selector: "Oxirgi 6 oy" dropdown

### Backend:
Uses existing attendance_log + report_log tables.
```
GET /api/reports/discipline?months=6
```
Calculate score: 100 - (penalties * weight)

---

## PAGE 9: SOZLAMALAR (Settings)

### Layout: Sidebar tabs + content area

### Tabs (left):
- Bosh sahifa (Profile)
- Lidlar
- Sdelkalar
- Kampaniyalar
- Byudjet
- Reja
- Hisobot
- Payroll
- Sozlamalar (active)

### Content sections:

**Profil sozlamalari:**
- Foydalanuvchi nomi input
- Email input
- "Saqlash" save button

**Bildirishnomalar:**
- Email bildirishnomalar toggle
- Telegram bildirishnomalar toggle
- Brauzer bildirishnomalar toggle

**Integratsiyalar:**
- qBitrix: status badge (Ulangan/Ulanmagan)
- Meta (Facebook): status badge
- Telegram Bot: status badge
- "Qayta ulash" reconnect buttons

**Xavfsizlik:**
- Parolni o'zgartirish form
- Oxirgi kirish: timestamp

**Tizim:**
- Ma'lumotlar zaxirasi: last backup time
- "Zaxira yaratish" button

### Backend:
```
GET /api/settings
PUT /api/settings
```
Uses existing user preferences or create simple key-value table:
```sql
CREATE TABLE IF NOT EXISTS settings (
  key VARCHAR(100) PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMP DEFAULT NOW()
);
```

---

## SHARED COMPONENTS TO CREATE

```
src/components/
  layout/
    Sidebar.tsx          — collapsible sidebar with nav links
    ThemeProvider.tsx     — dark/light mode context
    PageHeader.tsx       — page title + date filter + action buttons
  ui/
    StatCard.tsx          — gradient stat card (reuse across all pages)
    DataTable.tsx         — sortable/filterable table
    LineChart.tsx         — recharts wrapper
    BarChart.tsx          — recharts wrapper
    PieChart.tsx          — recharts wrapper
    GaugeChart.tsx        — semicircle gauge for budget
    StatusBadge.tsx       — colored status pill
    DateRangePicker.tsx   — from/to date selector
    ExportButtons.tsx     — CSV/PDF export
```

---

## ROUTING

```tsx
/                    → redirect to /lidlar
/lidlar              → Lidlar Analitika
/sdelkalar           → Sdelkalar
/kampaniyalar        → Kampaniyalar
/kunlik-hisobot      → Kunlik Hisobot
/byudjet             → Byudjet
/reja                → Reja (Plan)
/hisobot             → Hisobot (Xodim Disiplinali)
/payroll             → Payroll Hisoblash
/sozlamalar          → Sozlamalar (Settings)
```

---

## NGINX: Add proxies for new endpoints

```bash
# Already covered by /api/dashboard/ block:
# deals-stats, deals-list, daily-report, budget, tasks-summary

# New endpoints need proxy:
location /api/plans/ { proxy_pass http://localhost:3001; proxy_set_header Host $host; }
location /api/reports/ { proxy_pass http://localhost:3001; proxy_set_header Host $host; }
location /api/settings { proxy_pass http://localhost:3001; proxy_set_header Host $host; }
```

---

## IMPLEMENTATION ORDER

1. Theme system + Sidebar (affects everything)
2. Sdelkalar (uses existing deals data)
3. Kunlik Hisobot (uses existing data)
4. Byudjet (uses monthly_targets + campaign data)
5. Reja (new table + CRUD)
6. Hisobot (uses existing attendance/report data)
7. Sozlamalar (new settings table)
8. Enhance Kampaniyalar and Payroll with theming
9. Light mode polish

## DO NOT
- Do not delete existing Lidlar Analitika page — keep it
- Do not modify webhook handlers
- Do not change database schema for leads/deals/stages/responsibles
- Do not remove existing API endpoints
- Build incrementally — deploy after each page works

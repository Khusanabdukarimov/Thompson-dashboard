# Dashboard Pages Reference — LidlarPage, SdelkalarPage & CallStatistikasi

Use this document as a blueprint when building new analytics dashboard pages in this project.

---

## Architecture Overview

```
Page
├── Topbar (title, subtitle, refresh button)
├── Filter Panel (collapsible, localStorage-persisted)
│   ├── Date presets + manual range
│   ├── MultiSelect dropdowns (responsibles, stages, sources)
│   └── Mode toggle: default | bitrix24 | amocrm
├── KPI Cards row (4–6 gradient cards with sparklines)
├── Funnel row (3 metric boxes + 1 warning card)
└── Tables section
    ├── Conversion table (manager × funnel columns + donut)
    ├── Stage breakdown table (manager × all stage columns)
    ├── Reasons cards (cancel + junk side by side)
    └── UTM / Source breakdown table
```

---

## Reusable Local Components

These components are defined inline in LidlarPage / SdelkalarPage. Extract them to `src/components/` when needed.

### AvatarCircle
```tsx
function AvatarCircle({ name, size = 32 }: { name: string; size?: number }) {}
```
- Generates 1–2 initials from name (first letter of each word)
- Picks background color deterministically: `AVATAR_COLORS[hash(name) % 10]`
- **AVATAR_COLORS** (10 values):
  `['#2196F3','#E91E63','#9C27B0','#00BCD4','#FF9800','#4CAF50','#FF5722','#3F51B5','#009688','#795548']`

### MiniBar
```tsx
function MiniBar({ value, max, color, height = 3 }: MiniBarProps) {}
```
- Renders a thin colored bar proportional to `value/max`
- 5px top margin, placed below the number in a table cell
- Hidden when `max === 0`

### ConversionDonut
```tsx
function ConversionDonut({ pct, size = 38 }: { pct: number; size?: number }) {}
```
- SVG circle, `strokeDasharray` driven by pct
- Green (`#4CAF50`) when pct > 0, grey dash when 0
- Formats: `< 10` → `"X.X%"`, `≥ 10` → `"X%"`

### GradCard (KPI Card)
```tsx
function GradCard({ gradient, icon, title, children, sparkColor, sparkVariant? }) {}
```
- Gradient dark background + sparkline at bottom
- Supports dark/light mode via `useDarkMode()`
- Sparkline uses 4 preset wave patterns (variants 0–3)

### MultiSelect
```tsx
function MultiSelect({ label, icon, options, values, onChange, loading? }) {}
```
- Custom dropdown with checkboxes
- Click-outside close
- Blue accent (`#2196F3`), max-height 220px with scroll

---

## Table CSS Patterns

```tsx
// Header cell — accepts color for the column
const TH = (color: string, minW = 140): CSSProperties => ({
  padding: "11px 14px",
  textAlign: "left",
  fontSize: 12,
  fontWeight: 700,
  color,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  background: "var(--bg2)",
  borderBottom: "1px solid var(--border)",
  whiteSpace: "nowrap",
  minWidth: minW,
});

// Body cell
const TD: CSSProperties = {
  padding: "10px 14px",
  verticalAlign: "middle",
  borderBottom: "1px solid var(--border)",
};
```

Table container:
```tsx
<div style={{ background: "var(--bg2)", borderRadius: 12, overflow: "hidden" }}>
  <div style={{ overflowX: "auto" }}>
    <table style={{ width: "100%", borderCollapse: "collapse" }}>
```

Sticky columns (first 2):
```tsx
position: "sticky", left: 0, zIndex: 2, background: "var(--bg2)"
// Second sticky:
position: "sticky", left: 44, zIndex: 2
```

Row alternating + hover:
```tsx
backgroundColor: i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.015)"
// On hover: rgba(255,255,255,0.03)
```

JAMI (totals) row:
```tsx
fontWeight: 700, fontSize: 15,
borderTop: "1px solid var(--border)",
background: "var(--bg3)"
```

---

## Standard Color Map (use consistently across all tables)

| Status | Color | Hex |
|--------|-------|-----|
| Total / Primary | Blue | `#2196F3` |
| New | Blue | `#2196F3` |
| In progress | Orange | `#FF9800` |
| Callback / Quality | Cyan | `#00BCD4` |
| Thinking | Pink | `#E91E63` |
| Consultation scheduled | Purple | `#9C27B0` |
| Not transferred | Magenta | `#FF00FF` |
| Consultation completed | Green | `#4CAF50` |
| Archived | Light blue | `#42A5F5` |
| Junk / Sifatsiz | Red | `#F44336` |
| Cancelled | Amber | `#FFC107` |
| Revenue | Cyan | `#00BCD4` |
| Conversion % | Green | `#4CAF50` |

---

## Filter System

### Filter state shape
```tsx
type DashFilter = {
  start_date?: string;   // "YYYY-MM-DD"
  end_date?: string;
  responsible_ids?: number[];
  stages?: string[];
  sources?: string[];
  form_ids?: string[];
  mode?: 'default' | 'amocrm' | 'bitrix24';
};
```

### Persisting to localStorage
```tsx
const [applied, setApplied] = useLocalStorage<DashFilter>("page-name.filter.v1", {});
```

### Default filter (no date = all time)
```tsx
const getDefaultFilter = (): DashFilter => ({});
```

### Date helpers
```tsx
const localISO = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const todayISO   = () => localISO(new Date());
const daysAgoISO = (n: number) => { const d = new Date(); d.setDate(d.getDate()-n); return localISO(d); };
```

### Quick presets
```tsx
const PRESETS = [
  { label: "Bugun",  start: todayISO(), end: todayISO() },
  { label: "7 kun",  start: daysAgoISO(7),  end: todayISO() },
  { label: "30 kun", start: daysAgoISO(30), end: todayISO() },
  { label: "90 kun", start: daysAgoISO(90), end: todayISO() },
  { label: "Barchasi", start: "", end: "" },
];
```

### Mode toggle buttons (three inline)
```
[ Hammasi ]  [ Bitrix24 ]  [ AmoCRM ]
```
`mode` is kept in `useState`, merged into filter at query time:
```tsx
const appliedWithMode = { ...applied, mode };
```

### AmoCRM mode behavior
- When `mode === 'amocrm'`: source dropdown shows values from `/api/dashboard/amocrm-sources` (uf_filial)
- Date filter uses `COALESCE(l.uf_amo_date, l.date_create)` — original amoCRM creation date
- SQL adds `AND l.source_id = 'UC_1WUFJB'`

---

## React Query Pattern

```tsx
// All queries receive the same filter object so they refetch together
const appliedWithMode = { ...applied, mode };

const statsQ = useQuery({
  queryKey: ["stats/dashboard", appliedWithMode],
  queryFn: () => getDashboardStats(appliedWithMode),
});

// Conditional sub-queries (drilldown)
const campaignQ = useQuery({
  queryKey: ["stats/utm-campaigns", selectedUtmSource, appliedWithMode],
  queryFn: () => getUtmCampaignStats(selectedUtmSource!, appliedWithMode),
  enabled: selectedUtmSource !== null,
});
```

Refetch all on demand:
```tsx
const queries = [statsQ, respQ, conversionQ, ...];
const refetchAll = () => queries.forEach(q => q.refetch());
```

---

## Expandable Row Pattern (LidlarPage)

Manager row click → fetch that manager's individual leads, render sub-table inline:

```tsx
const [selectedResp, setSelectedResp] = useState<{ id: number; name: string } | null>(null);

const leadsQ = useQuery({
  queryKey: ["responsible-leads", selectedResp?.id, appliedWithMode],
  queryFn: () => getResponsibleLeads(selectedResp!.id, appliedWithMode),
  enabled: selectedResp !== null,
});

// In the table row onClick:
onClick={() => setSelectedResp(prev => prev?.id === row.id ? null : { id: row.id, name: row.full_name })}

// Sub-row (conditional, next sibling tr):
{selectedResp?.id === row.responsible_id && (
  <tr>
    <td colSpan={TOTAL_COLS}>
      {/* inner table with individual leads */}
    </td>
  </tr>
)}
```

Sub-lead columns: `#`, LID title (linked to Bitrix), SANA (date), TASHRIF SANASI, BOSQICH (stage badge).

Stage badge color mapping:
```tsx
const stageBadgeColor = (bid: string) => {
  if (['NEW','IN_PROCESS'].includes(bid)) return '#2196F3';
  if (bid === 'UC_1KPATX') return '#FF9800';
  if (['UC_KXC3ZW','UC_L28G68'].includes(bid)) return '#9C27B0';
  if (bid === 'CONVERTED') return '#4CAF50';
  if (bid === 'UC_F8K4GI') return '#F44336';
  return '#9E9E9E';
};
```

---

## 3-Level UTM Drilldown Pattern (LidlarPage)

```
UTM Sources table
  └── (click row) → Campaigns table for that source
        └── (click row) → Responsibles table for that campaign
```

State:
```tsx
const [selectedUtmSource,   setSelectedUtmSource]   = useState<string | null>(null);
const [selectedUtmCampaign, setSelectedUtmCampaign] = useState<{ source: string; campaign: string } | null>(null);
```

Each level is a separate React Query (enabled by the parent selection).
Rendered as stacked cards below the parent table, not as inline rows.

---

## Excluded Responsibles

These are always filtered out of manager tables:
```tsx
const EXCLUDED_RESPONSIBLES = ["Data365", "Data365 Support", "Shaxzod Turanov", "Murodjon"];
const isExcluded = (name: string) =>
  EXCLUDED_RESPONSIBLES.some(ex => name.trim().toLowerCase() === ex.toLowerCase());
```

---

## LidlarPage — Table Column Definitions

### Lid va Konversiya (conversion table)
| Key | Color | Formula |
|-----|-------|---------|
| total | `#2196F3` | all leads |
| jarayonda | `#FF9800` | in-process stages |
| sifatsiz_lid | `#F44336` | junk + cancelled |
| tashrif_buyurdi | `#4CAF50` | consultation completed |
| konversiya | `#4CAF50` | tashrif_buyurdi / total × 100 |

### Lid mas'ullar kesimida (12 stage columns)
```tsx
const RESPONSIBLE_COLS = [
  { key: "qongiroqlar",         label: "Qo'ng'iroqlar",            color: "#9E9E9E" },
  { key: "yangi_lid",           label: "Yangi lid",                color: "#2196F3" },
  { key: "propushenniy",        label: "Propushenniy",             color: "#9E9E9E" },
  { key: "javob_bermadi",       label: "Javob bermadi",            color: "#FF9800" },
  { key: "qayta_aloqa",         label: "Qayta aloqa",              color: "#00BCD4" },
  { key: "oylab_koradi",        label: "O'ylab ko'radi",           color: "#E91E63" },
  { key: "konsultatsiya",       label: "Kons. belgilandi",         color: "#9C27B0" },
  { key: "otkazilmadi",         label: "O'tkazilmadi",             color: "#FF00FF" },
  { key: "konsultatsiya_otkazildi", label: "Kons. o'tkazildi",    color: "#4CAF50" },
  { key: "sandiq",              label: "Sandiq",                   color: "#42A5F5" },
  { key: "sifatsiz",            label: "Sifatsiz",                 color: "#F44336" },
  { key: "bekor_boldi",         label: "Bekor bo'ldi",             color: "#FFC107" },
];
```

### UTM funnel columns (7, reused at all 3 levels)
```tsx
const UTM_COLS_DEF = [
  { key: "umumiy_lidlar",            label: "Umumiy Lidlar",            color: "#2196F3" },
  { key: "jarayonda",                label: "Jarayonda",                color: "#FF9800" },
  { key: "sifatli_lid",             label: "Sifatli Lid",              color: "#9C27B0" },
  { key: "konsultatsiya_belgilandi", label: "Kons. Belgilandi",         color: "#2196F3" },
  { key: "konsultatsiya_otkazildi",  label: "Kons. O'tkazildi",         color: "#4CAF50" },
  { key: "sifatsiz",                label: "Sifatsiz",                 color: "#F44336" },
  { key: "bekor_boldi",             label: "Bekor Bo'ldi",             color: "#FFC107" },
];
```

---

## SdelkalarPage — Table Column Definitions

### Sdelka va Konversiya
| Key | Color |
|-----|-------|
| total | `#2196F3` |
| jarayonda | `#FF9800` |
| sotuv_boldi | `#4CAF50` |
| bekor_boldi | `#F44336` |
| jami_sotuv ($) | `#00BCD4` |
| konversiya | `#4CAF50` |

### Sdelka mas'ullar kesimida (11 stage columns)
```tsx
const DEAL_STAGE_COLS = [
  { key: "konsultatsiya",   label: "Konsultatsiyadan o'tdi",   color: "#2196F3" },
  { key: "jarayonda",       label: "Jarayonda",                color: "#FF9800" },
  { key: "taklif",          label: "Taklif tayyorlash",        color: "#00BCD4" },
  { key: "taqdimot",        label: "Taqdimot qilindi",         color: "#9C27B0" },
  { key: "manzur",          label: "Mijozga manzur bo'ldi",    color: "#E91E63" },
  { key: "shartnoma",       label: "Shartnoma yuborildi",      color: "#009688" },
  { key: "kelishuv",        label: "Kelishuv bo'ldi",          color: "#4CAF50" },
  { key: "tolov",           label: "To'lov qisman",            color: "#FFC107" },
  { key: "ish_boshlandi",   label: "Ish boshlandi",            color: "#3F51B5" },
  { key: "sotuv_boldi",     label: "Sotuv bo'ldi",             color: "#8BC34A" },
  { key: "bekor_boldi",     label: "Bekor bo'ldi",             color: "#F44336" },
];
```

---

## Formatters

```tsx
import { fmtNum } from "@/lib/utils";   // adds thousand separators

function fmtMoney(v: number) {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000)     return `$${(v / 1_000).toFixed(0)}K`;
  return `$${fmtNum(Math.round(v))}`;
}
```

---

## API Endpoints Reference

### Lead analytics (all on `/api/dashboard/`)
| Endpoint | Params | Returns |
|----------|--------|---------|
| `lead-stats` | from, to, responsible_id, stage, source, mode | header KPIs + funnel |
| `lead-responsibles` | from, to, responsible_id, stage, source, mode | per-manager stage breakdown |
| `lead-conversion` | same | per-manager conversion (total, jarayonda, sifatsiz, tashrif) |
| `responsible-leads` | responsible_id, from, to, mode | individual leads for expand |
| `tasks-summary` | from, to, mode | per-manager task stats |
| `cancel-reasons` | from, to, responsible_id, mode | list of cancel reasons + count |
| `junk-reasons` | from, to, responsible_id, mode | list of junk reasons + count |
| `utm-stats` | from, to, mode, form_id | UTM source level |
| `utm-campaign-stats` | utm_source, from, to, mode | UTM campaign level |
| `utm-responsible-stats` | utm_source, utm_campaign, from, to, mode | UTM responsible level |
| `source-stats` | from, to, responsible_id, mode | by source breakdown |
| `lead-filter-options` | — | responsibles, stages, sources, forms |
| `amocrm-sources` | — | uf_filial values for amoCRM |

### Deal analytics (all on `/api/dashboard/`)
| Endpoint | Params | Returns |
|----------|--------|---------|
| `deals-stats` | from, to, responsible_id, stage_id, source, mode | KPI aggregates |
| `deals-list` | from, to, search, status, page, limit, mode | paginated deal list |
| `deals-conversion` | from, to, mode | per-manager conversion |
| `deals-responsibles` | from, to, mode | per-manager stage breakdown |
| `deal-cancel-reasons` | from, to, responsible_id | cancel reasons |
| `deal-filter-options` | mode | responsibles, stages, sources |
| `deals-source-stats` | from, to, mode | by source |

---

## Bitrix24 Lead Field → DB Column Map

| Bitrix field | DB column | AmoCRM override |
|-------------|-----------|-----------------|
| `DATE_CREATE` | `date_create` | — |
| `UF_CRM_1778310745831` | `uf_amo_date` | Original amoCRM creation date ← **use for date filter in amocrm mode** |
| `UF_CRM_1778260858916` | `uf_filial` | Segment: Instagram/Target/etc (via AMOCRM_SEGMENT_MAP) |
| `UF_CRM_1778261535982` | `uf_segment` | Branch/filial name (raw string) |
| `UF_CRM_1770693781846` | `uf_tashrif_sanasi` | Visit date |
| `UF_CRM_1770976355232` | `uf_cancel_reason` | Cancel reason (enum) |
| `UF_CRM_1770282341169` | `uf_junk_reason` | Junk reason (enum) |

**Date filter SQL (dashboard.js):**
- bitrix24 mode / default: `l.date_create`
- amocrm mode: `COALESCE(l.uf_amo_date, l.date_create)`

**AmoCRM source_id in Bitrix:** `UC_1WUFJB`

---

## Checklist When Building a New Dashboard Page

- [ ] Define filter state type + localStorage key (bump version `v1`, `v2` etc.)
- [ ] Add mode toggle buttons (default / bitrix24 / amocrm)
- [ ] Use `appliedWithMode = { ...applied, mode }` as react-query key
- [ ] Add quick date presets
- [ ] KPI cards use `GradCard` with sparkline
- [ ] Tables: TH helper for colored headers, TD for body cells
- [ ] First 2 columns sticky for wide tables
- [ ] Add JAMI (totals) row with `borderTop`
- [ ] Use `MiniBar` under each numeric cell (pass column max)
- [ ] Use `ConversionDonut` for % columns
- [ ] Use `AvatarCircle` for manager names
- [ ] Filter excluded responsibles from manager tables
- [ ] Row numbers 2-digit padded: `String(i+1).padStart(2, '0')`
- [ ] Link manager name to Bitrix24: `https://b24.domain/crm/lead/list/?responsible_id=X`

---

---

## CallStatistikasi Page

**File:** `src/pages/marketing/CallStatistikasi.tsx`

A call analytics dashboard showing per-operator telephony statistics with an expandable individual call list.

---

### Page Architecture

```
CallStatistikasi
├── Topbar ("Call statistikasi" + Filtrlar button with badge)
├── FilterDrawer (slide-in right panel — not collapsible inline)
├── KPI Cards row 1 (5 cards)
├── KPI Cards row 2 (5 cards)
└── Main table: "Xodimlar bo'yicha hisobot"
    └── (click row) → CallSubTable — individual calls for that operator
```

---

### KPI Cards (10 total, 5 per row)

**Row 1:**

| Label | Value | Icon | Color |
|-------|-------|------|-------|
| Qo'ng'iroq jami | total_calls + total_duration (sub) | Phone | `#2196F3` |
| Chiquvchi qo'ng'iroq | outbound_calls + outbound_duration (sub) | PhoneOutgoing | `#2196F3` |
| Kiruvchi qo'ng'iroq | inbound_calls + inbound_duration (sub) | PhoneIncoming | `#4CAF50` |
| Muvaffaqiyatli | success_calls + success_pct badge | CheckCircle | `#4CAF50` |
| Muvaffaqiyatsiz | failed_calls + failed_pct badge | XCircle | `#F44336` |

**Row 2:**

| Label | Value | Icon | Color |
|-------|-------|------|-------|
| O'rtacha davomiyligi | avg_duration (fmtDurMin) | Timer | `#9C27B0` |
| NDZ (javob berilmagan) | ndz_calls | PhoneOff | `#607D8B` |
| Propushenniy | missed_inbound | PhoneMissed | `#FF9800` |
| Reaksiya vaqti | reaksiya_vaqti (fmtDur) | Clock | `#607D8B` |
| Ne perezvonili | ne_perezvonili | PhoneMissed | `#F44336` |

**Card component:**
```tsx
function Card({ label, value, sub, icon, iconBg, badge, badgeColor, valueColor, accentColor }) {}
```
- `sub` renders bottom-right pill with Clock icon and duration text
- `badge` renders inline colored pill next to the value (e.g. "47%")
- Background: `linear-gradient(145deg, ${accent}12 0%, var(--bg) 42%)`
- Border: `1px solid ${accent}33`

---

### Main Table — Grouped Column Headers (2-row thead)

The table uses `colSpan` + `rowSpan` for column groups:

```
OPERATORLAR (rowspan=2) | QO'NG'IROQLAR SONI (colspan=3) | UNIKAL QO'NG'IROQLAR (colspan=3) | DAVOMIYLIK (colspan=3) | PROPUSHENNIY (colspan=3)
                        | Kiruvchi | Chiquvchi | Umumiy    | Kiruvchi | Chiquvchi | Umumiy    | Kiruvchi | Chiquvchi | Jami | Umumiy | Qayta chiqilgan | Chiqilmagan
```

Group header colors + left-border accent:
```tsx
// Group header style
TH({ color: "#2196F3", borderLeft: "2px solid rgba(33,150,243,0.2)" })  // Calls count
TH({ color: "#4CAF50", borderLeft: "2px solid rgba(76,175,80,0.2)"  })  // Unique
TH({ color: "#9C27B0", borderLeft: "2px solid rgba(156,39,176,0.2)" })  // Duration
TH({ color: "#FF9800", borderLeft: "2px solid rgba(255,152,0,0.24)" })  // Missed
```

Sub-column left borders (lighter, data rows):
```tsx
borderLeft: "2px solid rgba(33,150,243,0.10)"   // first col of each group in tbody
```

Duration cells use monospace font + `fontSize: 12`.

---

### Expandable Row → CallSubTable

Click a manager row → sub-table appears below the main table (not inline). Page auto-scrolls to it.

```tsx
// Auto-scroll on expand
useEffect(() => {
  if (!selectedResp) return;
  const t = window.setTimeout(() => {
    pageScrollRef.current?.scrollTo({
      top: Math.max(0, detailRef.current?.offsetTop - 16),
      behavior: "smooth",
    });
  }, 80);
  return () => window.clearTimeout(t);
}, [selectedResp?.id]);
```

**CallSubTable columns:**

| # | Telefon | Turi | Davomiylik | Sana va vaqt | Status | Lead |
|---|---------|------|-----------|-------------|--------|------|

Call type badges:
```tsx
const CALL_TYPE_LABEL = {
  1: { label: "Chiquvchi", color: "#2196F3" },
  2: { label: "Kiruvchi",  color: "#4CAF50" },
  3: { label: "Kiruvchi",  color: "#4CAF50" },
  4: { label: "Callback",  color: "#607D8B" },
};
```

Status: `ok = status_code === 200 || duration >= 10`
- Muvaffaqiyatli → green `#4CAF50`
- Muvaffaqiyatsiz → red `#F44336`

Lead cell: external link `https://mountain.bitrix24.kz/crm/lead/details/${c.lead_id}/`

Sub-table max-height: `min(64vh, 640px)`, with `overscrollBehavior: "contain"`.

---

### Filter System — Drawer Pattern

This page uses a **slide-in right drawer** instead of a collapsible inline panel.

```tsx
// Draft/applied split — edits don't take effect until "Qo'llash" is pressed
const [filters,      setFilters]      = useState(defaultCallFilters());  // applied
const [draftFilters, setDraftFilters] = useState(defaultCallFilters());  // editing copy

// Open drawer:
onClick={() => { setDraftFilters(filters); setFilterOpen(true); }}

// Apply:
onApply={() => { setFilters(draftFilters); setFilterOpen(false); }}

// Reset:
onReset={() => setDraftFilters(defaultCallFilters())}
```

**Drawer layout:**
- Fixed right panel, `width: 336px`
- Backdrop button closes on outside click
- Bottom sticky action bar: "Tozalash" + "Qo'llash"
- Scrollable body with `paddingBottom: 142px` to clear action bar

**Filter fields:**

| Field | Type | Default |
|-------|------|---------|
| start_date / end_date | `DateRangePicker` | 30 days ago → today |
| responsible_id | `<select>` from API | "all" |
| status | `<select>` (7 options) | "all" |
| phone | `<input>` text | "" |
| source | `<select>` from API | "all" |
| call_kind | `<select>` (4 options) | "all" |
| duration_from / duration_to | `<input>` number (seconds) | "" |

Status options:
```tsx
const callStatusOptions = [
  { value: "all",       label: "Barchasi" },
  { value: "success",   label: "Muvaffaqiyatli" },
  { value: "failed",    label: "Muvaffaqiyatsiz" },
  { value: "missed",    label: "Propushenniy" },
  { value: "ndz",       label: "NDZ" },
  { value: "recalled",  label: "Qayta chiqilgan" },
  { value: "unrecalled",label: "Qayta chiqilmagan" },
];
```

Call kind options:
```tsx
const callKindOptions = [
  { value: "all",      label: "Barchasi" },
  { value: "inbound",  label: "Kiruvchi" },
  { value: "outbound", label: "Chiquvchi" },
  { value: "callback", label: "Callback" },
];
```

Active filter count badge (excluding date range):
```tsx
function activeFilterCount(filter: CallFilterState) {
  return [
    filter.responsible_id !== "all",
    Boolean(filter.phone.trim()),
    filter.source !== "all",
    filter.call_kind !== "all",
    filter.status !== "all",
    Boolean(filter.duration_from.trim()),
    Boolean(filter.duration_to.trim()),
  ].filter(Boolean).length;
}
```

---

### DateRangePicker Component

A self-contained rich date picker — reuse this in any page that needs advanced date selection.

```tsx
function DateRangePicker({
  startDate: string,
  endDate: string,
  onChange: (range: { start_date: string; end_date: string }) => void,
}) {}
```

**5 selection modes** (tab bar at top):

| Mode | Behavior |
|------|----------|
| Kun (day) | Click first date → click second date → closes. Shows multi-month calendar. |
| Hafta (week) | Click any day → selects Mon–Sun of that week. Closes immediately. |
| Oy (month) | Grid of months × years. Click month → selects full month. |
| Kvartal (quarter) | Grid of Q1–Q4 × years. |
| Yil (year) | 4-column year grid. |

**Quick presets (left sidebar):**
- Bugun, Kecha, Bu hafta, O'tgan hafta, Bu oy, O'tgan oy

**Calendar rendering:**
- Week starts Monday: `leading = (first.getDay() + 6) % 7`
- Weekends in red `#ff665c`
- Selected range highlighted `rgba(33,150,243,0.18)`
- Start/end dates: solid blue `#2196F3` background
- Today: blue border

**Popover positioning** — smart viewport-aware placement:
```tsx
function updatePopoverPosition() {
  const width = Math.min(540, Math.max(320, window.innerWidth - 24));
  const left  = Math.max(12, Math.min(rect.right - width, window.innerWidth - width - 12));
  const top   = Math.max(12, Math.min(rect.bottom + 8, window.innerHeight - height - 12));
}
// Also repositions on window resize and scroll
```

Popover is `position: fixed` — works correctly inside overflow:hidden containers.

---

### Formatters (call-specific)

```tsx
// HH:MM:SS from seconds
function fmtDur(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  return [h, m, s].map((v) => String(v).padStart(2, "0")).join(":");
}

// "X,Y min" from seconds
function fmtDurMin(secs: number): string {
  const m = Math.floor(secs / 60);
  const frac = Math.round((secs % 60) / 6);
  return frac > 0 ? `${m},${frac} min` : `${m} min`;
}

// Percentage, handles <1%
function fmtPct(pct: number): string {
  if (pct > 0 && pct < 1) return "<1%";
  return `${Math.round(pct)}%`;
}

// Display as "DD.MM.YYYY"
function formatInputDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}
```

---

### Date Utility Functions

```tsx
function parseISODate(iso: string): Date      // "YYYY-MM-DD" → Date (no timezone shift)
function addDays(date: Date, days: number)
function addMonths(date: Date, months: number)
function startOfMonth(date: Date) / endOfMonth(date: Date)
function startOfWeek(date: Date)              // Monday-based
function endOfWeek(date: Date)
function startOfQuarter(date: Date) / endOfQuarter(date: Date)
function startOfYear(date: Date) / endOfYear(date: Date)
function monthDiff(a: Date, b: Date): number  // used to size the multi-month calendar
```

Locale arrays:
```tsx
const MONTH_NAMES       = ["Yanvar","Fevral","Mart","Aprel","May","Iyun","Iyul","Avgust","Sentabr","Oktabr","Noyabr","Dekabr"];
const MONTH_SHORT_NAMES = ["Yan","Fev","Mar","Apr","May","Iyn","Iyl","Avg","Sen","Okt","Noy","Dek"];
const WEEK_DAYS         = ["Du","Se","Ch","Pa","Ju","Sh","Ya"];   // Monday first
```

---

### State Management

```tsx
// Applied (used for queries) vs draft (edited in drawer)
const [filters,      setFilters]      = useState<CallFilterState>(defaultCallFilters);
const [draftFilters, setDraftFilters] = useState<CallFilterState>(defaultCallFilters);
const [filterOpen,   setFilterOpen]   = useState(false);
const [selectedResp, setSelectedResp] = useState<{ id: number; name: string } | null>(null);

// Refs for scroll behavior
const pageScrollRef = useRef<HTMLDivElement>(null);  // on the scrollable wrapper
const detailRef     = useRef<HTMLDivElement>(null);  // on the sub-table card
```

**Two-step filter apply** — prevents data from changing while editing:
1. Open drawer → copy `filters` into `draftFilters`
2. User edits `draftFilters` only
3. "Qo'llash" → copy `draftFilters` into `filters` (triggers query refetch)
4. "Tozalash" → reset `draftFilters` to defaults (does NOT reset applied filters)

---

### React Query Hooks

```tsx
// Main stats — refetches when apiFilter changes
const statsQ = useQuery({
  queryKey: ["py-call-stats", apiFilter],
  queryFn:  () => getPyCallStats(apiFilter),
});

// Filter dropdown options — fetched once
const filterOptionsQ = useQuery({
  queryKey: ["call-filter-options"],
  queryFn:  getCallFilterOptions,
});

// Sub-table — inside CallSubTable component (isolated)
const q = useQuery({
  queryKey: ["call-list", responsibleId, filter],
  queryFn:  () => getCallList(responsibleId, filter),
});
```

---

### API Endpoints

| Endpoint | Params | Returns |
|----------|--------|---------|
| `GET /api/dashboard/call-stats-full` | from, to, responsible_id, phone, source, call_kind, status, duration_from, duration_to | `PyCallStatsResult` (global totals + per-operator rows) |
| `GET /api/dashboard/call-list` | same + responsible_id (required) | `CallListRow[]` |
| `GET /api/dashboard/call-filter-options` | — | `{ responsibles, sources }` |

**`PyCallStatsResult` shape:**
```ts
type PyCallStatsResult = {
  date_from, date_to: string;
  total_calls, inbound_calls, outbound_calls, callback_calls: number;
  success_calls, failed_calls, ndz_calls, missed_inbound: number;
  total_duration, avg_duration: number;
  success_pct, failed_pct: number;
  ne_perezvonili, reaksiya_vaqti: number;
  responsibles: PyResponsibleCallStats[];
};

type PyResponsibleCallStats = {
  responsible_id: number | null;
  full_name: string;
  photo_url: string | null;
  total_calls, inbound_calls, outbound_calls, callback_calls: number;
  success_calls, failed_calls, ndz_calls, missed_inbound: number;
  missed_recalled, missed_unrecalled: number;
  total_duration, avg_duration: number;
  inbound_duration, outbound_duration: number;
  unique_inbound, unique_outbound, unique_total: number;
};
```

---

### TH / TD Helpers (call page variant)

Unlike LidlarPage which uses factory functions with positional args, CallStatistikasi passes style spreads:

```tsx
const TH = (extra?: CSSProperties): CSSProperties => ({
  padding: "10px 14px",
  textAlign: "center",    // ← center-aligned (not left)
  fontSize: 11,
  fontWeight: 700,
  color: "var(--text2)",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  background: "var(--bg2)",
  borderBottom: "1px solid var(--border)",
  whiteSpace: "nowrap",
  ...extra,               // ← override per-column (color, borderLeft, minWidth)
});

const TD = (extra?: CSSProperties): CSSProperties => ({
  padding: "11px 14px",
  verticalAlign: "middle",
  borderBottom: "1px solid var(--border)",
  textAlign: "center",    // ← center-aligned
  ...extra,
});
```

---

### Checklist — Call Stats Page

- [ ] Use `draft`/`applied` filter split — don't apply on every keystroke
- [ ] `FilterDrawer` renders as `position: fixed` right panel with backdrop
- [ ] Active filter count excludes date range (date is always set)
- [ ] Use `DateRangePicker` component for date selection (5 modes + quick presets)
- [ ] KPI cards use `accentColor` prop for gradient + border
- [ ] `sub` prop on Card = bottom-right clock pill (total duration)
- [ ] `badge` prop on Card = inline colored pill (percentage)
- [ ] Main table thead uses `colSpan` groups with color-coded group headers
- [ ] Group separator: `borderLeft: "2px solid rgba(color, 0.2)"` on first sub-col
- [ ] Duration columns: `fontFamily: "monospace", fontSize: 12`
- [ ] Expandable row renders sub-table BELOW the main table card (not inline)
- [ ] Auto-scroll: 80ms timeout after expand, `scrollTo` on `pageScrollRef`
- [ ] `CallSubTable` fetches independently inside its own component
- [ ] Sub-table max-height: `min(64vh, 640px)` with `overscrollBehavior: contain`
- [ ] `parseISODate()` for timezone-safe date parsing (avoids UTC offset shift)

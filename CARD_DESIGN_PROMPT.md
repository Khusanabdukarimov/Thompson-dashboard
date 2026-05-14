# Implement New Lidlar Analitika Dashboard Design

## Overview

Redesign the stats cards section of the Lidlar analitika page to match
the attached design mockup exactly. This is a premium dark-theme dashboard
with gradient cards, circular icons, and mini sparkline charts.

The data already comes from `/api/dashboard/stats` — only the frontend
component needs to change. Do NOT modify the backend.

---

## Layout Structure

### Row 1 — 4 equal-width cards in a horizontal row:

**Card 1: Total Leads**
- Background: dark blue gradient (left-to-right, #1a237e → #0d47a1)
- Border: subtle blue glow/border (#2196F3 at 30% opacity)
- Icon: circular blue badge with people/group icon (top-left)
- Title: "Total Leads" (white, 14px, semi-bold)
- Value: large number (white, 48px, bold) — e.g. "13,632"
- Subtitle: "Umumiy Lid" (gray, 12px)
- Sparkline: thin blue line at bottom of card
- Data: `stats.umumiy_lid`

**Card 2: Qualified Leads**
- Background: dark teal gradient (#004d40 → #00695c)
- Border: teal glow (#00BCD4 at 30%)
- Icon: circular teal badge with star icon
- Title: "Qualified Leads"
- Value: large number (white/cyan) — e.g. "13,550"
- Subtitle: "Sifatli Lid"
- Sparkline: thin teal line
- Data: `stats.sifatli_lid`

**Card 3: Consultations**
- Background: dark purple gradient (#1a0033 → #4a148c)
- Border: purple glow (#9C27B0 at 30%)
- Icon: circular purple badge with calendar icon
- Title: "Consultations"
- Value: TWO numbers separated by "/" — e.g. "81 / 9"
  - Left number (green): konsultatsiya_belgilandi (Scheduled)
  - Right number (white): konsultatsiya_otkazildi (Conducted)
- Labels under the numbers: "Scheduled / Conducted" in small green text
- Subtitle: "Konsultatsiya Belgilandi / O'tkazildi" (gray, 12px)
- Sparkline: thin purple line
- Data: `stats.konsultatsiya_belgilandi` / `stats.konsultatsiya_otkazildi`

**Card 4: Final Conversion**
- Background: dark green gradient (#1b5e20 → #2e7d32)
- Border: green glow (#4CAF50 at 30%)
- Icon: circular green badge with trending-up chart icon
- Title: "Final Conversion"
- Value: percentage (white, large) — e.g. "0.1%"
- Subtitle: "Konversiya"
- Sparkline: thin green line
- Formula: `(konsultatsiya_otkazildi / umumiy_lid * 100).toFixed(1)`
- Data: calculated from stats

### Row 2 — 2 sections (left takes ~70% width, right takes ~30%):

**Left Section: Funnel Efficiency**
- Background: dark card (#1a1a2e or similar dark)
- Border: subtle gray border
- Header: funnel icon + "Funnel Efficiency" (white, 16px, bold)
- Subheader: "Konversiya ko'rsatkichlari" (gray, 12px)
- Contains 3 metrics side-by-side:

  **Metric 1: Sifatli Konversiya**
  - Icon: circular dark badge with "%" symbol
  - Value: large percentage (teal/cyan, 32px) — e.g. "99.4%"
  - Label: "Qualified / Total Leads" (gray, 12px)
  - Formula: `(sifatli_lid / umumiy_lid * 100).toFixed(1)`

  **Metric 2: Lead to Consultation**
  - Icon: circular dark badge with arrows (↔) icon
  - Value: percentage (green, 32px) — e.g. "0.6%"
  - Label: "Umumiy → K.Belgilandi" (gray, 12px)
  - Formula: `(konsultatsiya_belgilandi / umumiy_lid * 100).toFixed(1)`

  **Metric 3: Overall Conversion**
  - Icon: circular dark badge with target/bullseye icon
  - Value: percentage (green, 32px) — e.g. "0.1%"
  - Label: "Umumiy → K.O'tkazildi" (gray, 12px)
  - Formula: `(konsultatsiya_otkazildi / umumiy_lid * 100).toFixed(1)`

**Right Section: Discarded / Cancelled**
- Background: dark red gradient (#3e0000 → #b71c1c)
- Border: red glow (#F44336 at 30%)
- Icon: circular red badge with X icon
- Title: "Discarded / Cancelled" (white, 14px)
- Value: large number (red/white, 48px) — e.g. "82"
- Subtitle: "Sifatsiz / Bekor" (gray, 12px)
- Sparkline: thin red line at bottom
- Data: `stats.sifatsiz_bekor`

---

## Design System Rules

### Colors (CSS variables or constants):
```
--card-blue:    linear-gradient(135deg, #0d1b4a 0%, #1a3a7a 100%)
--card-teal:    linear-gradient(135deg, #002a2a 0%, #005555 100%)
--card-purple:  linear-gradient(135deg, #1a0033 0%, #3d1a6e 100%)
--card-green:   linear-gradient(135deg, #0a2e0a 0%, #1b5e20 100%)
--card-red:     linear-gradient(135deg, #2a0000 0%, #6e1a1a 100%)

--accent-blue:   #2196F3
--accent-teal:   #00BCD4
--accent-purple: #9C27B0
--accent-green:  #4CAF50
--accent-red:    #F44336

--text-primary:   #FFFFFF
--text-secondary: #9E9E9E
--text-subtitle:  #B0BEC5
--bg-dark:        #0a0a1a
--bg-card:        #111827
```

### Typography:
- Card title: 14px, semi-bold, white
- Card value: 48px (row 1) or 32px (row 2), bold
- Card subtitle: 12px, gray (#9E9E9E)
- Use system font or Inter if available

### Card styling:
- Border radius: 16px
- Padding: 24px
- Border: 1px solid with accent color at 20-30% opacity
- Box shadow: 0 4px 20px rgba(accent, 0.15)
- Hover: slightly increase shadow/glow

### Icons:
- Use Lucide React icons (already available):
  - Total Leads: `Users`
  - Qualified Leads: `Star`
  - Consultations: `Calendar`
  - Final Conversion: `TrendingUp`
  - Sifatli Konversiya: `Percent`
  - Lead to Consultation: `ArrowLeftRight`
  - Overall Conversion: `Target`
  - Discarded: `X` or `XCircle`
  - Funnel Efficiency: `Filter`
- Icon container: 48px circle, background matches accent color at 20% opacity
- Icon size: 24px, color matches accent

### Sparklines:
- SVG path, 60px tall, full card width
- Positioned at the bottom of the card, overlapping slightly
- Use the accent color at 50% opacity for the line
- Fill under the line with accent color at 10% opacity
- Generate fake sparkline data (7-10 points, gentle curve) —
  this is decorative, not real time-series data
- Sparkline is subtle — should not distract from the numbers

### Responsive:
- Row 1: 4 columns on desktop, 2 columns on tablet, 1 on mobile
- Row 2: 2 columns on desktop (70/30 split), stack on mobile
- Minimum card width: 280px

---

## Date Filter

Replace the current button group (Bugun, 7 kun, 30 kun, 90 kun, Barchasi)
with a dropdown select:

```
📅 Oxirgi 30 kun  ▾
```

Options:
- Bugun (today / 1 day)
- Oxirgi 7 kun (7 days)
- Oxirgi 30 kun (30 days, default)
- Oxirgi 90 kun (90 days)
- Barchasi (all)

Style: dark dropdown with rounded corners, matching the card theme.
When changed, re-fetch stats from the API with the new range parameter.

---

## Component Structure

Create or update these components:
```
src/components/dashboard/
  StatsCards.tsx        — the full 2-row card grid
  StatCard.tsx          — single card with gradient, icon, sparkline
  FunnelEfficiency.tsx  — the left section of row 2
  Sparkline.tsx         — reusable SVG sparkline component
```

Import Lucide icons:
```tsx
import { Users, Star, Calendar, TrendingUp, Percent,
         ArrowLeftRight, Target, XCircle, Filter } from 'lucide-react'
```

---

## Data Flow

The stats API already returns all needed fields. Map them:

```tsx
const stats = await getDashboardStats(range)

// Row 1
const totalLeads = stats.umumiy_lid
const qualifiedLeads = stats.sifatli_lid
const scheduled = stats.konsultatsiya_belgilandi
const conducted = stats.konsultatsiya_otkazildi
const finalConversion = totalLeads > 0
  ? (conducted / totalLeads * 100).toFixed(1) : '0.0'

// Row 2 - Funnel Efficiency
const qualifiedPct = totalLeads > 0
  ? (qualifiedLeads / totalLeads * 100).toFixed(1) : '0.0'
const leadToConsult = totalLeads > 0
  ? (scheduled / totalLeads * 100).toFixed(1) : '0.0'
const overallConversion = totalLeads > 0
  ? (conducted / totalLeads * 100).toFixed(1) : '0.0'

// Discarded
const discarded = stats.sifatsiz_bekor
```

---

## DO NOT

- Do not change the backend API or database
- Do not touch the "Lid va Konversiya" table or "Lid mas'ullar kesimida" table
- Do not remove the search bar (Qidirish)
- Do not change any payroll components
- Keep the existing dark theme — enhance it with the gradient cards

# Redesign: Lid va Konversiya & Lid mas'ullar Tables

## 1. LID VA KONVERSIYA TABLE

Redesign the conversion table to match the reference design exactly.

### Table structure:

| Column | Header | Color | Data |
|--------|--------|-------|------|
| # | # | gray | Row number (01, 02, 03...) |
| Menejer | Menejer | white | Avatar circle (initials, colored) + full name |
| Jami Lid | Jami Lid | blue (#2196F3) | Total leads count + progress bar |
| Jarayonda | Jarayonda | orange (#FF9800) | In-process leads + progress bar |
| Sifatsiz Lid | Sifatsiz Lid | red (#F44336) | Junk + cancelled leads + progress bar |
| Konsultatsiya O'tkazildi | Konsultatsiya O'tkazildi | green (#4CAF50) | Consultation done + progress bar |
| Konversiya | Konversiya | green | Circular donut percentage |

### Row design:
- Each row height ~56px
- Number column: 2-digit padded (01, 02, 03), gray text, 14px
- Avatar: 36px circle with 2-letter initials (first letter of first + last name)
  - Each person gets a unique background color from a preset palette:
    colors = ['#2196F3', '#E91E63', '#9C27B0', '#00BCD4', '#FF9800',
              '#4CAF50', '#FF5722', '#3F51B5', '#009688', '#795548']
  - White text inside circle, 13px bold
- Name: white text, 14px, next to avatar with 10px gap
- Number values: white text, 16px semi-bold, right-aligned in column
- Progress bar: underneath each number, 4px height, rounded
  - Bar width = proportional to the max value in that column
  - Bar color matches the column header color
  - Bar background: transparent (no gray track)
- Row separator: very subtle line (rgba(255,255,255,0.05))
- Row hover: slight background change (rgba(255,255,255,0.03))

### Konversiya column (circular donut):
- 32px diameter circle
- Stroke width: 3px
- If konversiya > 0: green stroke showing percentage, number inside (e.g. "0.1%")
  - Text: 11px, green (#4CAF50)
- If konversiya = 0: gray circle with "—" dash inside
  - Text: gray (#666)
- Formula: `(konsultatsiya_otkazildi / jami_lid * 100).toFixed(1)`

### ИТОГО (totals) row:
- Label: "ИТОГО" in left columns (change to "JAMI" for Uzbek)
- Bold text, slightly larger (16px)
- Sum all values per column
- Full-width progress bars (100% width since they are the max)
- Konversiya shows overall: total_otkazildi / total_jami * 100
- Slight top border to separate from data rows

### Header row:
- Sticky on scroll
- Background: same dark as card (#111827)
- Column headers: colored text matching their column
- Font: 13px, semi-bold, uppercase

### Table container:
- Dark card background (#111827)
- Border radius: 12px
- Title: "Lid va Konversiya" — white, 18px bold, 16px padding
- No outer border, subtle inner borders only

### Sorting:
- Default sort: Jami Lid descending
- Rows numbered after sorting (01 = most leads)

---

## 2. LID MAS'ULLAR KESIMIDA TABLE

Update the existing responsible table with these fixes:

### Column order (must match exactly):
1. Qo'ng'iroqlar (gray)
2. Yangi lid (blue #2196F3)
3. Propushenniy (light gray #9E9E9E)
4. Javob bermadi (orange #FF9800)
5. Qayta aloqa (cyan #00BCD4)
6. O'ylab ko'radi (pink #E91E63)
7. Konsultatsiya belgilandi (purple #9C27B0)
8. O'tkazilmadi (magenta #FF00FF)
9. Konsultatsiya o'tkazildi (green #4CAF50)
10. Sandiq (light blue #42A5F5)
11. Sifatsiz (red #F44336)
12. Bekor bo'ldi (yellow #FFC107)

### Same design rules as Lid va Konversiya:
- Avatar circles with initials and unique colors
- Numbers with mini progress bars underneath
- JAMI totals row at bottom
- Dark card container
- Sticky header with colored column names
- Sort by JAMI descending
- Row numbers (01, 02, 03...)

### Each cell with a number:
- Number: white, 14px
- Mini progress bar: 3px height, colored, width proportional to column max
- If value is 0: show "—" in gray, no bar

---

## 3. SHARED COMPONENTS

Create reusable components:

```
src/components/dashboard/
  DataTable.tsx          — shared table shell (dark card, sticky header)
  TableProgressBar.tsx   — mini progress bar under a number
  AvatarCircle.tsx       — initials circle with color
  ConversionDonut.tsx    — circular donut for percentage
```

### AvatarCircle props:
```tsx
{ name: string, size?: number }
// Generates initials from name, picks color from palette by hash
```

### TableProgressBar props:
```tsx
{ value: number, max: number, color: string }
// width = (value / max) * 100%
```

### ConversionDonut props:
```tsx
{ percentage: number, size?: number }
// Shows donut with percentage text, or "—" if 0
```

---

## DO NOT
- Do not change backend API endpoints
- Do not change the stats cards (already redesigned)
- Do not modify database or webhooks
- Do not remove any existing functionality

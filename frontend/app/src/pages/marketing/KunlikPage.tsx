import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Topbar } from "@/components/Topbar";
import { Button } from "@/components/Button";
import { ChartCardSkeleton } from "@/components/Skeleton";
import { FilterBar } from "@/components/FilterBar";
import type { FilterField, FilterPreset, FilterValues } from "@/components/FilterBar";
import {
  getMetaInsights,
  getKunlikHisobot,
  MONTH_KEYS,
  MONTH_LABELS,
} from "@/lib/api/meta";
import type { MonthKey } from "@/lib/api/meta";
import { fmtNum, fmtMoney, fmtPct, cn } from "@/lib/utils";

const now = new Date();
const DEFAULT_MONTH = MONTH_KEYS[now.getMonth()];
const DEFAULT_YEAR  = now.getFullYear();

type SourceKey = "all" | "target" | "instagram";
type Period    = "all" | "this_week" | "last_week";

const SOURCE_PRESETS: FilterPreset[] = [
  { id: "all",       label: "Hammasi",       pinned: true },
  { id: "target",    label: "Target reklama", pinned: true },
  { id: "instagram", label: "Instagram",      pinned: true },
];

const PERIOD_OPTIONS: { value: Period; label: string }[] = [
  { value: "all",       label: "Barchasi"      },
  { value: "this_week", label: "Bu hafta"       },
  { value: "last_week", label: "O'tgan hafta"   },
];

type MetricKey =
  | "budget" | "leads" | "qual_leads" | "meetings"
  | "deals"  | "deals_sum" | "sales_count" | "sales_sum" | "cancelled"
  | "lid_to_qual_pct" | "qual_to_meeting_pct" | "meeting_to_sale_pct" | "qual_to_sale_pct"
  | "roas" | "qual_lead_cost" | "customer_cost" | "avg_check";

type MetricRow = {
  key: MetricKey;
  label: string;
  format: "money" | "num" | "pct";
  important?: boolean;
  divider?: boolean; // thin separator above this row
};

const METRIC_ROWS: MetricRow[] = [
  // ── raw metrics ──
  { key: "budget",        label: "Byudjet ($)",            format: "money", important: true },
  { key: "leads",         label: "Lidlar soni",            format: "num",   important: true },
  { key: "qual_leads",    label: "Maqsadli lidlar soni",   format: "num",   important: true },
  { key: "meetings",      label: "Uchrashuvlar soni",      format: "num" },
  { key: "deals",         label: "Kelishuvlar soni",       format: "num" },
  { key: "deals_sum",     label: "Kelishuvlar summasi",    format: "money" },
  { key: "sales_count",   label: "Sotuvlar soni",          format: "num",   important: true },
  { key: "sales_sum",     label: "Sotuvlar summasi",       format: "money", important: true },
  { key: "cancelled",     label: "Bekor bo'ldi",           format: "num" },
  // ── conversion % ──
  { key: "lid_to_qual_pct",      label: "Lid → Maqsadli lid %",        format: "pct", divider: true },
  { key: "qual_to_meeting_pct",  label: "Maqsadli lid → uchrashuv %",  format: "pct" },
  { key: "meeting_to_sale_pct",  label: "Uchrashuv → Sotuv %",         format: "pct" },
  { key: "qual_to_sale_pct",     label: "Maqsadli lid → Sotuv %",      format: "pct" },
  // ── KPI ──
  { key: "roas",           label: "ROAS",                  format: "pct",   important: true, divider: true },
  { key: "qual_lead_cost", label: "Maqsadli lid narxi",    format: "money", important: true },
  { key: "customer_cost",  label: "Mijoz narxi",           format: "money", important: true },
  { key: "avg_check",      label: "O'rtacha chek",         format: "money", important: true },
];

const SECTION_META = {
  target:    { label: "TARGET REKLAMA", color: "var(--orange)" },
  instagram: { label: "INSTAGRAM",      color: "#d63384" },
} as const;

const PERIOD_FIELDS: FilterField[] = [
  {
    key: "period", label: "Davr", type: "select",
    options: PERIOD_OPTIONS.map(o => ({ value: o.value, label: o.label })),
  },
];

function daysInMonth(month: MonthKey, year: number) {
  return new Date(year, MONTH_KEYS.indexOf(month) + 1, 0).getDate();
}
function isCurrentMonth(month: MonthKey, year: number) {
  return month === DEFAULT_MONTH && year === DEFAULT_YEAR;
}
function periodMask(month: MonthKey, year: number, period: Period): boolean[] {
  const days = daysInMonth(month, year);
  if (period === "all") return new Array<boolean>(days).fill(true);
  const today = new Date(); today.setHours(0,0,0,0);
  const mondayOf = (d: Date) => { const x = new Date(d); x.setDate(x.getDate() - ((x.getDay()+6)%7)); return x; };
  const start = mondayOf(today);
  if (period === "last_week") start.setDate(start.getDate() - 7);
  const end = new Date(start); end.setDate(end.getDate() + 6);
  return Array.from({ length: days }, (_, i) => {
    const day = new Date(year, MONTH_KEYS.indexOf(month), i + 1);
    return day >= start && day <= end;
  });
}

function fmtVal(v: number | undefined | null, fmt: MetricRow["format"]) {
  if (v == null || Number.isNaN(v)) return "";
  if (fmt === "money") return fmtMoney(v);
  if (fmt === "pct")   return fmtPct(v);
  return fmtNum(v);
}

export default function KunlikPage() {
  const [month, setMonth]             = useState<MonthKey>(DEFAULT_MONTH);
  const [year, setYear]               = useState<number>(DEFAULT_YEAR);
  const [activePreset, setActivePreset] = useState<string | null>("all");
  const [search, setSearch]           = useState("");
  const [values, setValues]           = useState<FilterValues>({});

  const todayDay = new Date().getDate();
  const source: SourceKey =
    activePreset === "target" || activePreset === "instagram" ? activePreset : "all";
  const period: Period = (values.period as Period) || "all";

  const qMeta = useQuery({
    queryKey: ["meta/insights", month, year],
    queryFn:  () => getMetaInsights(month, year),
  });
  const qCrm = useQuery({
    queryKey: ["marketing/kunlik", month, year],
    queryFn:  () => getKunlikHisobot(month, year),
  });

  const days = daysInMonth(month, year);
  const mask = useMemo(() => periodMask(month, year, period), [month, year, period]);

  // Merge meta + crm into one unified block per source
  const blockBySource = useMemo(() => {
    const empty = () => new Array<number>(days).fill(0);
    const build = (src: "target" | "instagram") => {
      const meta = qMeta.data?.data?.[src];
      const crm  = qCrm.data?.data?.[src];
      return {
        budget:      (meta?.budget      ?? empty()) as number[],
        leads:       (crm?.leads        ?? empty()) as number[],
        qual_leads:  (crm?.qual_leads   ?? empty()) as number[],
        meetings:    (crm?.meetings     ?? empty()) as number[],
        deals:       (crm?.deals        ?? empty()) as number[],
        deals_sum:   (crm?.deals_sum    ?? empty()) as number[],
        sales_count: (crm?.sales_count  ?? empty()) as number[],
        sales_sum:   (crm?.sales_sum    ?? empty()) as number[],
        cancelled:   (crm?.cancelled    ?? empty()) as number[],
      };
    };
    return { target: build("target"), instagram: build("instagram") };
  }, [qMeta.data, qCrm.data, days]);

  function valueFor(src: "target" | "instagram", key: MetricKey, i: number): number | undefined {
    const b = blockBySource[src];
    const safe = (v: number) => v > 0 ? v : undefined;

    switch (key) {
      case "budget":      return safe(b.budget[i]);
      case "leads":       return safe(b.leads[i]);
      case "qual_leads":  return safe(b.qual_leads[i]);
      case "meetings":    return safe(b.meetings[i]);
      case "deals":       return safe(b.deals[i]);
      case "deals_sum":   return safe(b.deals_sum[i]);
      case "sales_count": return safe(b.sales_count[i]);
      case "sales_sum":   return safe(b.sales_sum[i]);
      case "cancelled":   return safe(b.cancelled[i]);
      case "lid_to_qual_pct":
        return b.leads[i] > 0 ? (b.qual_leads[i] / b.leads[i]) * 100 : undefined;
      case "qual_to_meeting_pct":
        return b.qual_leads[i] > 0 ? (b.meetings[i] / b.qual_leads[i]) * 100 : undefined;
      case "meeting_to_sale_pct":
        return b.meetings[i] > 0 ? (b.sales_count[i] / b.meetings[i]) * 100 : undefined;
      case "qual_to_sale_pct":
        return b.qual_leads[i] > 0 ? (b.sales_count[i] / b.qual_leads[i]) * 100 : undefined;
      case "roas":
        return b.budget[i] > 0 ? (b.sales_sum[i] / b.budget[i]) * 100 : undefined;
      case "qual_lead_cost":
        return b.qual_leads[i] > 0 ? b.budget[i] / b.qual_leads[i] : undefined;
      case "customer_cost":
        return b.sales_count[i] > 0 ? b.budget[i] / b.sales_count[i] : undefined;
      case "avg_check":
        return b.sales_count[i] > 0 ? b.sales_sum[i] / b.sales_count[i] : undefined;
    }
  }

  function rowTotal(src: "target" | "instagram", metric: MetricRow): number | undefined {
    const b = blockBySource[src];

    // For ratio/computed metrics: sum numerator and denominator across masked days
    const sumMasked = (arr: number[]) =>
      arr.reduce((s, v, i) => s + (mask[i] ? v : 0), 0);

    const computeRatio = (num: number[], den: number[], scale = 100): number | undefined => {
      const n = sumMasked(num), d = sumMasked(den);
      return d > 0 ? (n / d) * scale : undefined;
    };

    switch (metric.key) {
      case "lid_to_qual_pct":     return computeRatio(b.qual_leads,  b.leads);
      case "qual_to_meeting_pct": return computeRatio(b.meetings,    b.qual_leads);
      case "meeting_to_sale_pct": return computeRatio(b.sales_count, b.meetings);
      case "qual_to_sale_pct":    return computeRatio(b.sales_count, b.qual_leads);
      case "roas":                return computeRatio(b.sales_sum,   b.budget);
      case "qual_lead_cost": {
        const q = sumMasked(b.qual_leads);
        return q > 0 ? sumMasked(b.budget) / q : undefined;
      }
      case "customer_cost": {
        const s = sumMasked(b.sales_count);
        return s > 0 ? sumMasked(b.budget) / s : undefined;
      }
      case "avg_check": {
        const s = sumMasked(b.sales_count);
        return s > 0 ? sumMasked(b.sales_sum) / s : undefined;
      }
      default: {
        const arr = b[metric.key as keyof typeof b] as number[] | undefined;
        if (!arr) return undefined;
        const total = arr.reduce((s, v, i) => s + (mask[i] ? v : 0), 0);
        return total > 0 ? total : undefined;
      }
    }
  }

  const sectionsToShow: ("target" | "instagram")[] =
    source === "all" ? ["target", "instagram"] : [source];

  const filteredMetrics = useMemo(() => {
    const s = search.trim().toLowerCase();
    return s ? METRIC_ROWS.filter(m => m.label.toLowerCase().includes(s)) : METRIC_ROWS;
  }, [search]);

  const yearOptions = [DEFAULT_YEAR, DEFAULT_YEAR - 1, DEFAULT_YEAR - 2];
  const periodLabel = PERIOD_OPTIONS.find(o => o.value === period)?.label;
  const sourceLabel = activePreset && activePreset !== "all"
    ? SOURCE_PRESETS.find(p => p.id === activePreset)?.label
    : undefined;
  const isLoading = qMeta.isLoading || qCrm.isLoading;

  return (
    <>
      <Topbar
        title="Kunlik hisobot"
        sub={`${MONTH_LABELS[month]} ${year} — kundalik ko'rsatkichlar jadvali`}
        actions={
          <>
            <select
              className="px-2.5 py-1.5 rounded border border-border2 bg-bg2 text-[12px] text-text shadow-xs"
              value={month}
              onChange={e => setMonth(e.target.value as MonthKey)}
            >
              {MONTH_KEYS.map(mm => <option key={mm} value={mm}>{MONTH_LABELS[mm]}</option>)}
            </select>
            <select
              className="px-2.5 py-1.5 rounded border border-border2 bg-bg2 text-[12px] text-text shadow-xs"
              value={year}
              onChange={e => setYear(Number(e.target.value))}
            >
              {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
            <Button onClick={() => { qMeta.refetch(); qCrm.refetch(); }}>Yangilash</Button>
          </>
        }
      />

      <div className="flex-1 overflow-y-auto px-[22px] py-[18px] bg-bg">
        <div className="bg-bg2 border border-border rounded-lg shadow p-3 mb-4 flex items-center gap-3 flex-wrap">
          <FilterBar
            presets={SOURCE_PRESETS}
            activePreset={activePreset}
            onPresetChange={setActivePreset}
            searchValue={search}
            onSearchChange={setSearch}
            fields={PERIOD_FIELDS}
            values={values}
            onChange={(k, v) => setValues(s => ({ ...s, [k]: v }))}
            onClear={() => { setSearch(""); setValues({}); setActivePreset("all"); }}
            onApply={() => { qMeta.refetch(); qCrm.refetch(); }}
            activeChipLabel={sourceLabel}
            onActiveChipClear={() => setActivePreset("all")}
          />
          {periodLabel && period !== "all" && (
            <span className="text-[12px] text-text2 inline-flex items-center gap-1">
              <span className="text-text3">Davr:</span>
              <span className="font-medium">{periodLabel}</span>
            </span>
          )}
        </div>

        {isLoading && !qMeta.data ? (
          <ChartCardSkeleton height={520} />
        ) : (
          <div className="bg-bg2 border border-border rounded-lg shadow overflow-hidden">
            <div className="px-4 py-3 border-b border-border">
              <div className="text-[14px] font-semibold">Kunlik ma'lumotlar jadvali</div>
              <div className="text-[11px] text-text3 mt-0.5">
                Byudjet — Meta Ads · Qolganlar — Bitrix24 CRM · Bugun ustun ko'k bilan ajratilgan
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[12px]">
                <thead>
                  <tr className="bg-bg3 text-text3 uppercase tracking-wider text-[10.5px] font-semibold">
                    <th className="text-left px-3 py-2 sticky left-0 bg-bg3 z-10 min-w-[200px] border-b border-border">
                      Manba / Ko'rsatkich
                    </th>
                    <th className="text-right px-3 py-2 min-w-[96px] border-b border-border">
                      {period === "all" ? "Oylik" : "Davr jami"}
                    </th>
                    {Array.from({ length: days }, (_, i) => i + 1).map(d => {
                      const isToday = isCurrentMonth(month, year) && d === todayDay;
                      const dim = !mask[d - 1];
                      return (
                        <th
                          key={d}
                          className={cn(
                            "text-center px-1.5 py-2 min-w-[36px] border-b border-border font-mono",
                            isToday && "bg-blue-bg text-blue",
                            dim && "opacity-30",
                          )}
                        >
                          {d}
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {sectionsToShow.map(src => (
                    <SectionBlock
                      key={src}
                      src={src}
                      meta={SECTION_META[src]}
                      days={days}
                      isCurrent={isCurrentMonth(month, year)}
                      todayDay={todayDay}
                      mask={mask}
                      metrics={filteredMetrics}
                      valueFor={valueFor}
                      rowTotal={rowTotal}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {(qMeta.error || qCrm.error) && (
          <div className="mt-4 p-3 bg-red-bg border border-red-border text-red rounded-lg text-[12.5px]">
            Xatolik: {((qMeta.error || qCrm.error) as Error).message}
          </div>
        )}
      </div>
    </>
  );
}

function SectionBlock({
  src, meta, days, isCurrent, todayDay, mask, metrics, valueFor, rowTotal,
}: {
  src: "target" | "instagram";
  meta: { label: string; color: string };
  days: number;
  isCurrent: boolean;
  todayDay: number;
  mask: boolean[];
  metrics: MetricRow[];
  valueFor: (src: "target" | "instagram", key: MetricKey, i: number) => number | undefined;
  rowTotal: (src: "target" | "instagram", metric: MetricRow) => number | undefined;
}) {
  return (
    <>
      <tr>
        <td
          colSpan={days + 2}
          className="px-3 py-1.5 text-white font-bold text-[11px] uppercase tracking-wider"
          style={{ background: meta.color }}
        >
          {meta.label}
        </td>
      </tr>
      {metrics.map(metric => {
        const total = rowTotal(src, metric);
        return (
          <tr
            key={metric.key}
            className={cn(
              "border-b border-border last:border-b-0",
              metric.divider && "border-t-2 border-t-border2",
              !metric.important && "text-text2",
            )}
          >
            <td className={cn(
              "px-3 py-2 sticky left-0 bg-bg2 z-[1] whitespace-nowrap border-r border-border",
              metric.important ? "font-semibold" : "text-text2 text-[11.5px]",
            )}>
              {metric.label}
            </td>
            <td className={cn(
              "px-3 py-2 text-right mono border-r border-border",
              metric.important ? "text-[13px] font-bold text-text" : "text-[12px] font-medium",
            )}>
              {fmtVal(total, metric.format) || "—"}
            </td>
            {Array.from({ length: days }, (_, i) => {
              const day = i + 1;
              const isToday = isCurrent && day === todayDay;
              const dim = !mask[i];
              const v = valueFor(src, metric.key, i);
              const filled = typeof v === "number";
              return (
                <td
                  key={day}
                  className={cn(
                    "px-1 py-1.5 text-center mono text-[11px] border-l border-border",
                    isToday && "bg-blue-bg/60",
                    filled && "bg-green-bg/40",
                    dim && "opacity-25",
                    metric.important && filled && "text-[12px] font-semibold",
                  )}
                >
                  {filled ? fmtVal(v, metric.format) : ""}
                </td>
              );
            })}
          </tr>
        );
      })}
    </>
  );
}

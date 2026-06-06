import { useMemo, useState, useRef, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Topbar } from "@/components/Topbar";
import { Button } from "@/components/Button";
import { ChartCardSkeleton } from "@/components/Skeleton";
import {
  getMetaInsights, getKunlikHisobot, getKunlikMeta,
  saveKunlikPlan, saveKunlikOverride,
  MONTH_KEYS, MONTH_LABELS,
} from "@/lib/api/meta";
import type { MonthKey } from "@/lib/api/meta";
import { fmtNum, fmtMoney, fmtPct, cn } from "@/lib/utils";

const now           = new Date();
const DEFAULT_MONTH = MONTH_KEYS[now.getMonth()];
const DEFAULT_YEAR  = now.getFullYear();

type Section = "target" | "instagram";

type MetricKey =
  | "budget" | "leads" | "qual_leads" | "meetings"
  | "deals"  | "deals_sum" | "sales_count" | "sales_sum" | "cancelled"
  | "roas" | "qual_lead_cost" | "customer_cost";

type MetricDef = {
  key: MetricKey;
  label: string;
  format: "money" | "num" | "pct";
  computed?: boolean;
};

const METRICS: MetricDef[] = [
  { key: "budget",         label: "Byudjet ($)",          format: "money" },
  { key: "leads",          label: "Lidlar soni",          format: "num"   },
  { key: "qual_leads",     label: "Maqsadli lidlar soni", format: "num"   },
  { key: "meetings",       label: "Uchrashuvlar soni",    format: "num"   },
  { key: "deals",          label: "Kelishuvlar soni",     format: "num"   },
  { key: "deals_sum",      label: "Kelishuvlar summasi",  format: "money" },
  { key: "sales_count",    label: "Sotuvlar soni",        format: "num"   },
  { key: "sales_sum",      label: "Sotuvlar summasi",     format: "money" },
  { key: "cancelled",      label: "Bekor bo'ldi",         format: "num"   },
  { key: "roas",           label: "ROAS",                 format: "pct",  computed: true },
  { key: "qual_lead_cost", label: "Maqsadli lid narxi",   format: "money", computed: true },
  { key: "customer_cost",  label: "Mijoz narxi",          format: "money", computed: true },
];

const SECTIONS: { key: Section; label: string; color: string }[] = [
  { key: "target",    label: "Facebook", color: "#1877f2" },
  { key: "instagram", label: "Instagram", color: "#d63384" },
];

function daysInMonth(month: MonthKey, year: number) {
  return new Date(year, MONTH_KEYS.indexOf(month) + 1, 0).getDate();
}
function isCurrentMonth(month: MonthKey, year: number) {
  return month === DEFAULT_MONTH && year === DEFAULT_YEAR;
}

function fmt(v: number | undefined | null, format: MetricDef["format"]): string {
  if (v == null || isNaN(v) || !isFinite(v) || v === 0) return "—";
  if (format === "money") return fmtMoney(v);
  if (format === "pct")   return fmtPct(v);
  return fmtNum(v);
}

function varPct(fakt: number, plan: number | undefined): number | null {
  if (!plan || plan === 0) return null;
  return Math.round((fakt / plan) * 100);
}

export default function KunlikPage() {
  const [month,   setMonth]   = useState<MonthKey>(DEFAULT_MONTH);
  const [year,    setYear]    = useState(DEFAULT_YEAR);
  const [active,  setActive]  = useState<"all" | Section>("target");
  const qc = useQueryClient();

  const todayDay  = now.getDate();
  const days      = daysInMonth(month, year);
  const isCurrent = isCurrentMonth(month, year);

  const qMeta = useQuery({ queryKey: ["meta/insights",       month, year], queryFn: () => getMetaInsights(month, year) });
  const qCrm  = useQuery({ queryKey: ["marketing/kunlik",    month, year], queryFn: () => getKunlikHisobot(month, year) });
  const qPlan = useQuery({ queryKey: ["marketing/kunlik-meta", month, year], queryFn: () => getKunlikMeta(month, year) });

  const autoData = useMemo(() => {
    const empty = () => Array(days).fill(0) as number[];
    const build = (src: Section) => {
      const meta = qMeta.data?.data?.[src];
      const crm  = qCrm.data?.data?.[src];
      return {
        budget:      (meta?.budget     ?? empty()) as number[],
        leads:       (crm?.leads       ?? empty()) as number[],
        qual_leads:  (crm?.qual_leads  ?? empty()) as number[],
        meetings:    (crm?.meetings    ?? empty()) as number[],
        deals:       (crm?.deals       ?? empty()) as number[],
        deals_sum:   (crm?.deals_sum   ?? empty()) as number[],
        sales_count: (crm?.sales_count ?? empty()) as number[],
        sales_sum:   (crm?.sales_sum   ?? empty()) as number[],
        cancelled:   (crm?.cancelled   ?? empty()) as number[],
      };
    };
    return { target: build("target"), instagram: build("instagram") };
  }, [qMeta.data, qCrm.data, days]);

  const plans    = qPlan.data?.plans    ?? { target: {}, instagram: {} };
  const overrides = qPlan.data?.overrides ?? { target: {}, instagram: {} };

  function cellValue(src: Section, metric: MetricDef, i: number): number {
    const b  = autoData[src];
    const ov = overrides[src]?.[metric.key];
    const day = i + 1;
    if (!metric.computed && ov?.[day] !== undefined) return ov[day];
    switch (metric.key) {
      case "budget":      return b.budget[i];
      case "leads":       return b.leads[i];
      case "qual_leads":  return b.qual_leads[i];
      case "meetings":    return b.meetings[i];
      case "deals":       return b.deals[i];
      case "deals_sum":   return b.deals_sum[i];
      case "sales_count": return b.sales_count[i];
      case "sales_sum":   return b.sales_sum[i];
      case "cancelled":   return b.cancelled[i];
      case "roas":
        return b.budget[i] > 0 ? (b.sales_sum[i] / b.budget[i]) * 100 : 0;
      case "qual_lead_cost":
        return b.qual_leads[i] > 0 ? b.budget[i] / b.qual_leads[i] : 0;
      case "customer_cost":
        return b.sales_count[i] > 0 ? b.budget[i] / b.sales_count[i] : 0;
    }
    return 0;
  }

  function faktTotal(src: Section, metric: MetricDef): number {
    const b = autoData[src];
    switch (metric.key) {
      case "roas":
        { const s = b.sales_sum.reduce((a,v)=>a+v,0), bg = b.budget.reduce((a,v)=>a+v,0);
          return bg > 0 ? (s / bg) * 100 : 0; }
      case "qual_lead_cost":
        { const q = b.qual_leads.reduce((a,v)=>a+v,0), bg = b.budget.reduce((a,v)=>a+v,0);
          return q > 0 ? bg / q : 0; }
      case "customer_cost":
        { const sc = b.sales_count.reduce((a,v)=>a+v,0), bg = b.budget.reduce((a,v)=>a+v,0);
          return sc > 0 ? bg / sc : 0; }
      default:
        return Array.from({length: days}, (_, i) => cellValue(src, metric, i)).reduce((a,v)=>a+v,0);
    }
  }

  const visibleSections = SECTIONS.filter(s => active === "all" || s.key === active);
  const isLoading = (qMeta.isLoading && !qMeta.data) || (qCrm.isLoading && !qCrm.data);
  const yearOptions = [DEFAULT_YEAR, DEFAULT_YEAR - 1, DEFAULT_YEAR - 2];

  return (
    <>
      <Topbar
        title="Kunlik hisobot"
        sub={`${MONTH_LABELS[month]} ${year} — kundalik ko'rsatkichlar jadvali`}
        actions={
          <>
            <select className="px-2.5 py-1.5 rounded border border-border2 bg-bg2 text-[12px] text-text shadow-xs"
              value={month} onChange={e => setMonth(e.target.value as MonthKey)}>
              {MONTH_KEYS.map(mm => <option key={mm} value={mm}>{MONTH_LABELS[mm]}</option>)}
            </select>
            <select className="px-2.5 py-1.5 rounded border border-border2 bg-bg2 text-[12px] text-text shadow-xs"
              value={year} onChange={e => setYear(Number(e.target.value))}>
              {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
            <Button onClick={() => { qMeta.refetch(); qCrm.refetch(); qPlan.refetch(); }}>
              Yangilash
            </Button>
          </>
        }
      />

      <div className="flex-1 overflow-y-auto px-3 sm:px-[22px] py-3 sm:py-[18px] bg-bg">
        {/* Toggle */}
        <div className="flex items-center gap-2 mb-4">
          {([
            { id: "target",    label: "Facebook" },
            { id: "instagram", label: "Instagram"      },
          ] as { id: "all" | Section; label: string }[]).map(opt => (
            <button key={opt.id} onClick={() => setActive(opt.id)}
              className={cn(
                "px-4 py-1.5 rounded-lg text-[12.5px] font-semibold border transition-all",
                active === opt.id
                  ? "bg-blue border-blue text-white"
                  : "bg-bg2 border-border text-text2 hover:bg-bg3",
              )}>
              {opt.label}
            </button>
          ))}
        </div>

        {isLoading ? (
          <ChartCardSkeleton height={520} />
        ) : (
          <div className="bg-bg2 border border-border rounded-xl shadow overflow-hidden">
            <div className="px-5 py-4 border-b border-border">
              <div className="text-[16px] font-bold text-text">Targeted Ads Metrics</div>
              <div className="text-[11.5px] text-text3 mt-0.5">
                Byudjet — Meta Ads · Qolganlar — Bitrix24 CRM · Bugun ustun ko'k bilan ajratilgan
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[12px]">
                <thead>
                  <tr className="bg-bg3 text-text3 uppercase text-[10px] font-bold tracking-widest">
                    <th className="text-left px-4 py-2.5 sticky left-0 bg-bg3 z-10 min-w-[180px] border-b border-border">
                      Metric Name
                    </th>
                    <th className="text-right px-3 py-2.5 min-w-[100px] border-b border-border border-l border-border">
                      Oylik reja
                    </th>
                    <th className="text-right px-3 py-2.5 min-w-[88px] border-b border-border border-l border-border text-green-600">
                      Fakt
                    </th>
                    <th className="text-center px-3 py-2.5 min-w-[70px] border-b border-border border-l border-border">
                      Var %
                    </th>
                    {Array.from({length: days}, (_, i) => i + 1).map(d => (
                      <th key={d} className={cn(
                        "text-center px-1 py-2.5 min-w-[36px] border-b border-border border-l border-border font-mono",
                        isCurrent && d === todayDay && "bg-blue-bg text-blue",
                      )}>{d}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visibleSections.map(sec => (
                    <SectionRows
                      key={sec.key}
                      section={sec}
                      metrics={METRICS}
                      days={days}
                      isCurrent={isCurrent}
                      todayDay={todayDay}
                      plans={plans[sec.key]}
                      overrides={overrides[sec.key]}
                      cellValue={(m, i) => cellValue(sec.key, m, i)}
                      faktTotal={(m) => faktTotal(sec.key, m)}
                      onPlanSave={async (key, val) => {
                        await saveKunlikPlan(sec.key, key, month, year, val);
                        void qc.invalidateQueries({ queryKey: ["marketing/kunlik-meta", month, year] });
                      }}
                      onCellSave={async (key, day, val) => {
                        await saveKunlikOverride(sec.key, key, month, year, day, val);
                        void qc.invalidateQueries({ queryKey: ["marketing/kunlik-meta", month, year] });
                      }}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

function SectionRows({
  section, metrics, days, isCurrent, todayDay, plans, overrides,
  cellValue, faktTotal, onPlanSave, onCellSave,
}: {
  section:    { key: Section; label: string; color: string };
  metrics:    MetricDef[];
  days:       number;
  isCurrent:  boolean;
  todayDay:   number;
  plans:      Partial<Record<string, number>>;
  overrides:  Partial<Record<string, Record<number, number>>>;
  cellValue:  (m: MetricDef, i: number) => number;
  faktTotal:  (m: MetricDef) => number;
  onPlanSave: (key: string, val: number) => Promise<void>;
  onCellSave: (key: string, day: number, val: number | null) => Promise<void>;
}) {
  const totalCols = days + 4; // name + reja + fakt + var%
  return (
    <>
      {/* Section header */}
      <tr>
        <td colSpan={totalCols}
          className="px-4 py-2 text-white font-bold text-[11px] uppercase tracking-widest"
          style={{ background: section.color }}>
          {section.label}
        </td>
      </tr>

      {metrics.map(metric => (
        <MetricRow
          key={metric.key}
          metric={metric}
          days={days}
          isCurrent={isCurrent}
          todayDay={todayDay}
          planValue={plans?.[metric.key]}
          faktValue={faktTotal(metric)}
          overrides={overrides?.[metric.key]}
          cellValue={cellValue}
          onPlanSave={(val) => onPlanSave(metric.key, val)}
          onCellSave={(day, val) => onCellSave(metric.key, day, val)}
        />
      ))}
    </>
  );
}

function MetricRow({
  metric, days, isCurrent, todayDay,
  planValue, faktValue, overrides, cellValue,
  onPlanSave, onCellSave,
}: {
  metric:      MetricDef;
  days:        number;
  isCurrent:   boolean;
  todayDay:    number;
  planValue:   number | undefined;
  faktValue:   number;
  overrides:   Record<number, number> | undefined;
  cellValue:   (m: MetricDef, i: number) => number;
  onPlanSave:  (val: number) => Promise<void>;
  onCellSave:  (day: number, val: number | null) => Promise<void>;
}) {
  const [editingPlan, setEditingPlan] = useState(false);
  const [planDraft,   setPlanDraft]   = useState("");
  const [editingDay,  setEditingDay]  = useState<number | null>(null);
  const [dayDraft,    setDayDraft]    = useState("");
  const planRef        = useRef<HTMLInputElement>(null);
  const dayRef         = useRef<HTMLInputElement>(null);
  const planCommitting = useRef(false);

  const vp = varPct(faktValue, planValue);
  const vpBg = vp == null ? "transparent"
    : vp >= 90  ? "rgba(22,163,74,0.18)"
    : vp >= 50  ? "rgba(217,119,6,0.18)"
    : "rgba(239,68,68,0.18)";
  const vpColor = vp == null ? "var(--text3)"
    : vp >= 90  ? "#16a34a"
    : vp >= 50  ? "#d97706"
    : "#ef4444";

  const openPlan = useCallback(() => {
    if (metric.computed) return;
    planCommitting.current = false;
    setPlanDraft(planValue != null ? String(planValue) : "");
    setEditingPlan(true);
    setTimeout(() => planRef.current?.select(), 0);
  }, [planValue, metric.computed]);

  const commitPlan = useCallback(async () => {
    if (planCommitting.current) return;
    planCommitting.current = true;
    setEditingPlan(false);
    const n = parseFloat(planDraft);
    if (!isNaN(n)) await onPlanSave(n);
  }, [planDraft, onPlanSave]);

  const openDay = useCallback((day: number) => {
    if (metric.computed) return;
    setDayDraft(overrides?.[day] != null ? String(overrides[day]) : "");
    setEditingDay(day);
    setTimeout(() => dayRef.current?.select(), 0);
  }, [overrides, metric.computed]);

  const commitDay = useCallback(async () => {
    if (editingDay == null) return;
    const day = editingDay;
    setEditingDay(null);
    const n = dayDraft.trim() === "" ? null : parseFloat(dayDraft);
    await onCellSave(day, isNaN(n as number) ? null : n);
  }, [editingDay, dayDraft, onCellSave]);

  const hasFakt = faktValue > 0;

  return (
    <tr className="border-b border-border last:border-b-0 hover:bg-bg3/30 transition-colors">

      {/* Metric name */}
      <td className="px-4 py-2 sticky left-0 bg-bg2 z-[1] border-r border-border whitespace-nowrap font-medium text-[12.5px]">
        {metric.label}
      </td>

      {/* Oylik reja */}
      <td className="px-2 py-1.5 border-l border-border text-right min-w-[120px]">
        {editingPlan ? (
          <div className="flex items-center gap-1">
            <input ref={planRef} autoFocus
              className="flex-1 min-w-0 text-right text-[12px] bg-blue-bg border border-blue rounded px-1.5 py-0.5 outline-none"
              value={planDraft}
              onChange={e => setPlanDraft(e.target.value)}
              onBlur={commitPlan}
              onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); void commitPlan(); } if (e.key === "Escape") setEditingPlan(false); }}
            />
            <button
              onMouseDown={e => e.preventDefault()}
              onClick={() => void commitPlan()}
              className="shrink-0 text-[10px] px-1.5 py-0.5 bg-blue text-white rounded whitespace-nowrap hover:opacity-80"
            >
              Saqlash
            </button>
          </div>
        ) : (
          <span onClick={openPlan}
            className={cn(
              "mono text-[12.5px] font-bold block text-right",
              !metric.computed && "cursor-text",
              planValue != null ? "text-text" : "text-text3 font-normal text-[11px]",
            )}>
            {planValue != null ? fmt(planValue, metric.format) : metric.computed ? "—" : "Kiriting…"}
          </span>
        )}
      </td>

      {/* Fakt */}
      <td className="px-3 py-2 border-l border-border text-right">
        <span className={cn("mono text-[12.5px] font-bold", hasFakt ? "text-text" : "text-text3 font-normal")}>
          {hasFakt ? fmt(faktValue, metric.format) : "—"}
        </span>
      </td>

      {/* Var % */}
      <td className="px-3 py-2 border-l border-border text-center">
        {vp != null ? (
          <span className="text-[11.5px] font-bold px-2.5 py-0.5 rounded"
            style={{ color: vpColor, background: vpBg }}>
            {vp}%
          </span>
        ) : <span className="text-text3 text-[11px]">—</span>}
      </td>

      {/* Daily cells */}
      {Array.from({length: days}, (_, i) => {
        const day = i + 1;
        const isToday = isCurrent && day === todayDay;
        const raw = cellValue(metric, i);
        const hasVal = raw > 0;
        const isOverride = !metric.computed && overrides?.[day] !== undefined;

        return (
          <td key={day}
            onClick={() => !metric.computed && openDay(day)}
            className={cn(
              "px-1 py-2 text-center mono text-[11px] border-l border-border",
              isToday && "bg-blue-bg/50",
              hasVal && !isOverride && "text-text",
              hasVal && isOverride && "text-amber-400",
              !hasVal && "text-text3",
              !metric.computed && "cursor-text",
            )}
          >
            {editingDay === day && !metric.computed ? (
              <input ref={dayRef} autoFocus
                className="w-full text-center text-[11px] bg-transparent border-b border-blue outline-none"
                value={dayDraft}
                onChange={e => setDayDraft(e.target.value)}
                onBlur={commitDay}
                onKeyDown={e => { if (e.key === "Enter") commitDay(); if (e.key === "Escape") setEditingDay(null); }}
              />
            ) : (
              hasVal ? fmt(raw, metric.format) : "-"
            )}
          </td>
        );
      })}
    </tr>
  );
}

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { Topbar } from "@/components/Topbar";
import { MetricCard } from "@/components/MetricCard";
import { Button } from "@/components/Button";
import { CardChart, StackedBar, FunnelBars } from "@/components/charts";
import { FilterBar } from "@/components/FilterBar";
import type {
  FilterField,
  FilterPreset,
  FilterValues,
} from "@/components/FilterBar";
import {
  MetricRowSkeleton,
  ChartCardSkeleton,
  FunnelSkeleton,
} from "@/components/Skeleton";
import { getMetaInsights, MONTH_KEYS, MONTH_LABELS } from "@/lib/api/meta";
import type { MonthKey } from "@/lib/api/meta";
import { fmtNum, fmtMoney, fmtPct } from "@/lib/utils";
import { useLocalStorage } from "@/hooks/useLocalStorage";

const PLATFORM_PRESETS: FilterPreset[] = [
  { id: "all", label: "Hammasi", pinned: true },
  { id: "facebook", label: "Facebook", pinned: true },
  { id: "instagram", label: "Instagram", pinned: true },
];

const FILTER_FIELDS: FilterField[] = [
  { key: "target", label: "Oylik maqsad ($)", type: "amount" },
];

const now = new Date();
const DEFAULT_MONTH = MONTH_KEYS[now.getMonth()];
const DEFAULT_YEAR = now.getFullYear();
const todayDay = now.getDate();

export default function ByudjetPage() {
  const [month, setMonth] = useState<MonthKey>(DEFAULT_MONTH);
  const [year, setYear] = useState<number>(DEFAULT_YEAR);

  const [activePreset, setActivePreset] = useLocalStorage<string | null>(
    "byudjet.preset",
    "all",
  );
  const [search, setSearch] = useState("");
  const [values, setValues] = useLocalStorage<FilterValues>(
    "byudjet.filter",
    {},
  );
  const target = values.target ?? "";

  const platform: "facebook" | "instagram" | null =
    activePreset === "facebook" || activePreset === "instagram"
      ? activePreset
      : null;

  const q = useQuery({
    queryKey: ["meta/insights", month, year],
    queryFn: () => getMetaInsights(month, year),
  });

  const m = q.data?.data;

  const totals = useMemo(() => {
    if (!m)
      return {
        fbBudget: 0,
        igBudget: 0,
        fbLeads: 0,
        igLeads: 0,
        fbToday: 0,
        igToday: 0,
        days: 0,
      };
    const days = m.target.budget.length;
    const sum = (a: number[]) => a.reduce((s, v) => s + (v ?? 0), 0);
    const fbBudget = platform === "instagram" ? 0 : sum(m.target.budget);
    const igBudget = platform === "facebook" ? 0 : sum(m.instagram.budget);
    const fbLeads = platform === "instagram" ? 0 : sum(m.target.leads);
    const igLeads = platform === "facebook" ? 0 : sum(m.instagram.leads);
    const isCurrent = month === DEFAULT_MONTH && year === DEFAULT_YEAR;
    const td = isCurrent ? todayDay - 1 : days - 1;
    const fbToday = platform === "instagram" ? 0 : (m.target.budget[td] ?? 0);
    const igToday = platform === "facebook" ? 0 : (m.instagram.budget[td] ?? 0);
    return { fbBudget, igBudget, fbLeads, igLeads, fbToday, igToday, days };
  }, [m, month, year, platform]);

  const totalSpend = totals.fbBudget + totals.igBudget;
  const totalLeads = totals.fbLeads + totals.igLeads;
  const cpl = totalLeads ? totalSpend / totalLeads : 0;
  const targetN = Number(target) || 0;
  const remaining = targetN > 0 ? Math.max(0, targetN - totalSpend) : 0;
  const burn = targetN > 0 ? (totalSpend / targetN) * 100 : 0;

  const stackedData = useMemo(() => {
    if (!m) return [];
    return m.target.budget.map((_, i) => ({
      name: String(i + 1),
      Facebook:
        platform === "instagram"
          ? 0
          : Math.round((m.target.budget[i] ?? 0) * 100) / 100,
      Instagram:
        platform === "facebook"
          ? 0
          : Math.round((m.instagram.budget[i] ?? 0) * 100) / 100,
    }));
  }, [m, platform]);

  const platformBreakdown = [
    {
      label: "Facebook",
      value: Math.round(totals.fbBudget * 100) / 100,
      color: "var(--blue)",
    },
    {
      label: "Instagram",
      value: Math.round(totals.igBudget * 100) / 100,
      color: "var(--purple)",
    },
  ].filter((p) => p.value > 0 || !platform);

  const yearOptions = [DEFAULT_YEAR, DEFAULT_YEAR - 1, DEFAULT_YEAR - 2];

  return (
    <>
      <Topbar
        title="Byudjet"
        sub={`Reklama byudjeti — ${MONTH_LABELS[month]} ${year}`}
      />
      <div className="flex-1 overflow-y-auto px-[22px] py-[18px] bg-bg">
        <div className="bg-bg2 border border-border rounded-lg shadow p-3 mb-4 flex items-center gap-3 flex-wrap">
          <FilterBar
            presets={PLATFORM_PRESETS}
            activePreset={activePreset}
            onPresetChange={setActivePreset}
            searchValue={search}
            onSearchChange={setSearch}
            fields={FILTER_FIELDS}
            values={values}
            onChange={(k, v) => setValues((s) => ({ ...s, [k]: v }))}
            onClear={() => {
              setSearch("");
              setValues({});
              setActivePreset("all");
            }}
            onApply={() => {
              /* client-side */
            }}
            activeChipLabel={
              activePreset && activePreset !== "all"
                ? PLATFORM_PRESETS.find((p) => p.id === activePreset)?.label
                : undefined
            }
            onActiveChipClear={() => setActivePreset("all")}
            storageKey="marketing.byudjet"
            onApplySavedFilter={(v) => setValues(v as typeof values)}
          />
          <div className="flex items-center gap-2 ml-auto">
            <select
              className="px-2.5 py-1.5 rounded border border-border2 bg-bg2 text-[12px] text-text shadow-xs"
              value={month}
              onChange={(e) => setMonth(e.target.value as MonthKey)}
            >
              {MONTH_KEYS.map((mm) => (
                <option key={mm} value={mm}>
                  {MONTH_LABELS[mm]}
                </option>
              ))}
            </select>
            <select
              className="px-2.5 py-1.5 rounded border border-border2 bg-bg2 text-[12px] text-text shadow-xs"
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
            >
              {yearOptions.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
            <Button onClick={() => q.refetch()}>
              <RefreshCw className="w-3.5 h-3.5" /> Yangilash
            </Button>
          </div>
        </div>

        {q.isLoading && !q.data ? (
          <MetricRowSkeleton count={5} />
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5 mb-4">
            <MetricCard
              label="Jami sarf"
              value={fmtMoney(totalSpend)}
              tone="orange"
              hint={`${totals.days} ta kun`}
            />
            <MetricCard
              label="Jami lid"
              value={fmtNum(totalLeads)}
              tone="green"
            />
            <MetricCard
              label="CPL"
              value={totalLeads ? fmtMoney(cpl) : "—"}
              tone="amber"
              hint="sarf / lid"
            />
            <MetricCard
              label={target ? "Maqsad qoldi" : "Maqsad"}
              value={target ? fmtMoney(remaining) : "belgilanmagan"}
              tone={burn > 100 ? "red" : "blue"}
              hint={target ? `${fmtPct(burn, 1)} sarflandi` : "—"}
            />
            <MetricCard
              label="Bugungi sarf"
              value={fmtMoney(totals.fbToday + totals.igToday)}
              hint={`FB ${fmtMoney(totals.fbToday)} · IG ${fmtMoney(totals.igToday)}`}
            />
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mb-4">
          {q.isLoading && !q.data ? (
            <ChartCardSkeleton height={280} />
          ) : (
            <CardChart title="Kunlik sarf (FB + IG stacked)" height={280}>
              <StackedBar
                data={stackedData as never}
                series={[
                  { dataKey: "Facebook", fill: "var(--blue)" },
                  { dataKey: "Instagram", fill: "var(--purple)" },
                ]}
              />
            </CardChart>
          )}
          <div className="bg-bg2 border border-border rounded-lg shadow overflow-hidden">
            <div className="px-4 py-3 border-b border-border flex items-center justify-between">
              <span className="text-[13px] font-semibold">
                Platform bo'yicha sarf
              </span>
              <span className="text-[11px] text-text3">
                jami {fmtMoney(totalSpend)}
              </span>
            </div>
            <div className="p-4">
              {q.isLoading && !q.data ? (
                <FunnelSkeleton rows={2} />
              ) : (
                <FunnelBars
                  steps={platformBreakdown}
                  formatValue={(v) =>
                    `$${v.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                  }
                />
              )}

              {target && (
                <div className="mt-4 pt-4 border-t border-border">
                  <div className="flex items-center justify-between text-[12px] mb-2">
                    <span className="text-text2">Maqsad bajarilishi</span>
                    <span
                      className={`mono font-semibold ${burn > 100 ? "text-red" : burn > 80 ? "text-amber" : "text-green"}`}
                    >
                      {fmtPct(burn, 1)}
                    </span>
                  </div>
                  <div className="h-2 bg-bg4 rounded overflow-hidden">
                    <div
                      className={`h-full rounded ${burn > 100 ? "bg-red" : burn > 80 ? "bg-amber" : "bg-green"}`}
                      style={{ width: `${Math.min(100, burn)}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-text3 mt-2">
                    <span>0</span>
                    <span className="mono">
                      {fmtMoney(totalSpend)} / {fmtMoney(targetN)}
                    </span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {q.error && (
          <div className="mt-4 p-3 bg-red-bg border border-red-bd text-red rounded-lg text-[12.5px]">
            Xatolik: {(q.error as Error).message}
          </div>
        )}
      </div>
    </>
  );
}

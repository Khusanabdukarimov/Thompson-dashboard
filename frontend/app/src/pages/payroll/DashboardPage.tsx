import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { RefreshCw, Tv, X } from "lucide-react";
import { Topbar } from "@/components/Topbar";
import { Button } from "@/components/Button";
import { Badge } from "@/components/Badge";
import { Avatar } from "@/components/Avatar";
import { MetricCard } from "@/components/MetricCard";
import { CardChart, FunnelBars, SimpleBar } from "@/components/charts";
import { FilterBar } from "@/components/FilterBar";
import type {
  FilterField,
  FilterPreset,
  FilterValues,
} from "@/components/FilterBar";
import {
  MetricRowSkeleton,
  FunnelSkeleton,
  DataTableSkeleton,
  ChartCardSkeleton,
} from "@/components/Skeleton";
import {
  listEmployees,
  getMonthlyTarget,
  listTimeman,
  getSalesTrend,
  listBonusAwards,
} from "@/lib/api/payroll";
import type { TimemanUser } from "@/lib/api/payroll";
import { getDealsStats } from "@/lib/api/deals";
import { fmtMoney, fmtNum, fmtPct } from "@/lib/utils";
import { MONTH_KEYS, MONTH_LABELS } from "@/lib/api/meta";
import { useLocalStorage } from "@/hooks/useLocalStorage";

const SCOPE_PRESETS: FilterPreset[] = [
  { id: "all", label: "Hammasi", pinned: true },
  { id: "working", label: "Hozir ishda", pinned: true },
  { id: "paused", label: "Pauzada" },
  { id: "closed", label: "Ish yakunlangan" },
];

const now = new Date();
const DEFAULT_YEAR = now.getFullYear();
const DEFAULT_MONTH = now.getMonth() + 1;

function classifyTimeman(u: TimemanUser): {
  bucket: "opened" | "paused" | "closed" | "unknown";
  label: string;
  tone: "green" | "amber" | "gray";
} {
  const t = u.timeman as unknown;
  let status: string | null | undefined = null;
  if (t && typeof t === "object" && "STATUS" in (t as object)) {
    status = (t as { STATUS?: string }).STATUS ?? null;
  } else if (typeof t === "string") status = t;
  switch (status) {
    case "OPENED":
      return { bucket: "opened", label: "Ishda", tone: "green" };
    case "PAUSED":
      return { bucket: "paused", label: "Pauza", tone: "amber" };
    case "CLOSED":
      return { bucket: "closed", label: "Yakunladi", tone: "gray" };
    default:
      return { bucket: "unknown", label: "—", tone: "gray" };
  }
}

function isoFirstOfMonth(year: number, month: number) {
  return `${year}-${String(month).padStart(2, "0")}-01`;
}
function isoLastOfMonth(year: number, month: number) {
  const d = new Date(year, month, 0).getDate();
  return `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export default function DashboardPage() {
  const [year, setYear] = useState(DEFAULT_YEAR);
  const [month, setMonth] = useState(DEFAULT_MONTH);
  const [tvMode, setTvMode] = useState(false);

  const [activePreset, setActivePreset] = useLocalStorage<string | null>(
    "dashboard.preset",
    "all",
  );
  const [search, setSearch] = useState("");
  const [values, setValues] = useLocalStorage<FilterValues>(
    "dashboard.filter",
    {},
  );

  const empQ = useQuery({
    queryKey: ["payroll/employees"],
    queryFn: listEmployees,
  });
  const targetQ = useQuery({
    queryKey: ["payroll/target", year, month],
    queryFn: () => getMonthlyTarget(year, month),
  });
  const tmQ = useQuery({
    queryKey: ["users/timeman"],
    queryFn: listTimeman,
    refetchInterval: 30_000,
  });
  const dealsQ = useQuery({
    queryKey: ["stats/deals", year, month],
    queryFn: () =>
      getDealsStats({
        start_date: isoFirstOfMonth(year, month),
        end_date: isoLastOfMonth(year, month),
      }),
  });
  const trendQ = useQuery({
    queryKey: ["payroll/sales-trend", 6],
    queryFn: () => getSalesTrend(6),
  });
  const periodLabel = `${year}-${String(month).padStart(2, "0")}`;
  const bonusesQ = useQuery({
    queryKey: ["payroll/bonus-awards", periodLabel],
    queryFn: () => listBonusAwards(periodLabel),
  });

  const target = targetQ.data?.target_usd ?? 0;
  const wonRev = dealsQ.data?.total_won_revenue ?? 0;
  const remaining = Math.max(0, target - wonRev);
  const progress = target > 0 ? (wonRev / target) * 100 : 0;

  const funnelSteps = useMemo(() => {
    const r = dealsQ.data;
    return [
      { label: "Maqsad", value: Math.round(target), color: "var(--blue)" },
      {
        label: "Hozirgi savdo",
        value: Math.round(wonRev),
        color: "var(--green)",
      },
      { label: "Won (count)", value: r?.won_count ?? 0, color: "var(--green)" },
      { label: "Lost (count)", value: r?.lost_count ?? 0, color: "var(--red)" },
    ];
  }, [dealsQ.data, target, wonRev]);

  const topSellers = useMemo(() => {
    const list = dealsQ.data?.by_user ?? [];
    return [...list].sort((a, b) => b.won_revenue - a.won_revenue).slice(0, 5);
  }, [dealsQ.data]);

  // Apply scope preset + search to today's user list (timeman bucket)
  const filteredTimemanUsers = useMemo(() => {
    const all = tmQ.data?.users ?? [];
    let list = all;
    if (activePreset && activePreset !== "all") {
      const wanted =
        activePreset === "working"
          ? "opened"
          : activePreset === "paused"
            ? "paused"
            : activePreset === "closed"
              ? "closed"
              : null;
      if (wanted)
        list = list.filter((u) => classifyTimeman(u).bucket === wanted);
    }
    const minRev = values.min_revenue ? Number(values.min_revenue) : 0;
    if (minRev) {
      const byUser = new Map(
        (dealsQ.data?.by_user ?? []).map((u) => [String(u.id), u.won_revenue]),
      );
      list = list.filter((u) => (byUser.get(String(u.id)) ?? 0) >= minRev);
    }
    const s = search.trim().toLowerCase();
    if (s) list = list.filter((u) => (u.name || "").toLowerCase().includes(s));
    return list;
  }, [tmQ.data, activePreset, values, dealsQ.data, search]);

  const todayUsers = filteredTimemanUsers.slice(0, 6);

  // Top sellers also reflect search and min_revenue (preset doesn't apply since deals don't have timeman state)
  const topSellersFiltered = useMemo(() => {
    let list = topSellers;
    const minRev = values.min_revenue ? Number(values.min_revenue) : 0;
    if (minRev) list = list.filter((u) => u.won_revenue >= minRev);
    const s = search.trim().toLowerCase();
    if (s) list = list.filter((u) => (u.name || "").toLowerCase().includes(s));
    return list;
  }, [topSellers, values, search]);

  const filterFields: FilterField[] = useMemo(
    () => [{ key: "min_revenue", label: "Min savdo ($)", type: "amount" }],
    [],
  );

  const trendData = useMemo(() => {
    const months = trendQ.data?.months ?? [];
    return months.map((m) => ({
      name: `${MONTH_LABELS[MONTH_KEYS[m.month - 1]].slice(0, 3)} ${String(m.year).slice(-2)}`,
      value: Math.round(m.won_revenue),
    }));
  }, [trendQ.data]);

  // Top bonus recipients in current period
  const topBonusRecipients = useMemo(() => {
    const awards = bonusesQ.data?.awards ?? [];
    const byUser = new Map<
      number,
      { uid: number; name: string; total: number; count: number }
    >();
    for (const a of awards) {
      const emp = empQ.data?.employees.find((e) => e.id === a.bitrix_user_id);
      const name = emp?.name ?? `User ${a.bitrix_user_id}`;
      const cur = byUser.get(a.bitrix_user_id) ?? {
        uid: a.bitrix_user_id,
        name,
        total: 0,
        count: 0,
      };
      cur.total += a.amount_usd;
      cur.count += 1;
      byUser.set(a.bitrix_user_id, cur);
    }
    return Array.from(byUser.values())
      .sort((a, b) => b.total - a.total)
      .slice(0, 5);
  }, [bonusesQ.data, empQ.data]);

  // TV Mode overlay — fullscreen large metrics
  if (tvMode) {
    return (
      <div className="fixed inset-0 bg-[#0a0e1a] z-[500] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-8 py-4 border-b border-white/10">
          <div>
            <div className="text-white/50 text-[13px] font-medium mono">
              MOUNTAIN · TV MODE
            </div>
            <div className="text-white text-[18px] font-bold mt-0.5">
              {MONTH_LABELS[MONTH_KEYS[month - 1]]} {year}
            </div>
          </div>
          <button
            onClick={() => setTvMode(false)}
            className="flex items-center gap-2 text-white/60 hover:text-white text-[13px] border border-white/20 rounded-lg px-3 py-2"
          >
            <X className="w-4 h-4" /> Chiqish
          </button>
        </div>
        <div className="flex-1 grid grid-cols-2 gap-6 p-8">
          <TVCard
            label="OYLIK MAQSAD"
            value={fmtMoney(target)}
            hint={target ? "" : "belgilanmagan"}
            color="text-blue-400"
          />
          <TVCard
            label="HOZIRGI SAVDO"
            value={fmtMoney(wonRev)}
            hint={target ? `${fmtPct(progress, 1)} bajarildi` : "—"}
            color="text-emerald-400"
          />
          <TVCard
            label="QOLDI"
            value={fmtMoney(remaining)}
            color={progress >= 100 ? "text-emerald-400" : "text-amber-400"}
          />
          <TVCard
            label={`${MONTH_LABELS[MONTH_KEYS[month - 1]].toUpperCase()} MAQSAD`}
            value={target ? fmtPct(progress, 1) : "—"}
            color={
              progress >= 100
                ? "text-emerald-400"
                : progress >= 70
                  ? "text-amber-400"
                  : "text-orange-400"
            }
            progress={target ? Math.min(100, progress) : undefined}
          />
        </div>
      </div>
    );
  }

  return (
    <>
      <Topbar
        title="Dashboard"
        sub={`${MONTH_LABELS[MONTH_KEYS[month - 1]]} ${year} · Mountain umumiy holat`}
        actions={
          <Button onClick={() => setTvMode(true)}>
            <Tv className="w-3.5 h-3.5" /> TV rejim
          </Button>
        }
      />
      <div className="flex-1 overflow-y-auto px-3 sm:px-[22px] py-3 sm:py-[18px] bg-bg">
        <div className="bg-bg2 border border-border rounded-lg shadow p-3 mb-4 flex items-center gap-3 flex-wrap">
          <FilterBar
            presets={SCOPE_PRESETS}
            activePreset={activePreset}
            onPresetChange={setActivePreset}
            searchValue={search}
            onSearchChange={setSearch}
            fields={filterFields}
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
                ? SCOPE_PRESETS.find((p) => p.id === activePreset)?.label
                : undefined
            }
            onActiveChipClear={() => setActivePreset("all")}
            storageKey="payroll.dashboard"
            onApplySavedFilter={(v) => setValues(v as typeof values)}
          />
          <div className="flex items-center gap-2 ml-auto">
            <select
              className="px-2.5 py-1.5 rounded border border-border2 bg-bg2 text-[12px] shadow-xs"
              value={month}
              onChange={(e) => setMonth(Number(e.target.value))}
            >
              {MONTH_KEYS.map((m, i) => (
                <option key={m} value={i + 1}>
                  {MONTH_LABELS[m]}
                </option>
              ))}
            </select>
            <select
              className="px-2.5 py-1.5 rounded border border-border2 bg-bg2 text-[12px] shadow-xs"
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
            >
              {[DEFAULT_YEAR, DEFAULT_YEAR - 1].map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
            <Button
              onClick={() => {
                dealsQ.refetch();
                tmQ.refetch();
                targetQ.refetch();
              }}
            >
              <RefreshCw className="w-3.5 h-3.5" /> Yangilash
            </Button>
          </div>
        </div>

        {/* ── Top 4 metrics ───────────────────────────── */}
        {dealsQ.isLoading && !dealsQ.data ? (
          <MetricRowSkeleton count={4} />
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
            <MetricCard
              size="lg"
              label="Oylik maqsad"
              value={fmtMoney(target)}
              tone="blue"
              hint={target ? "" : "belgilanmagan"}
            />
            <MetricCard
              size="lg"
              label="Hozirgi savdo"
              value={fmtMoney(wonRev)}
              tone="green"
              hint={target ? `${fmtPct(progress, 1)} bajarildi` : "—"}
            />
            <MetricCard
              size="lg"
              label="Qolgan"
              value={fmtMoney(remaining)}
              tone={progress >= 100 ? "green" : "amber"}
            />
            <MetricCard
              size="lg"
              label="Xodimlar"
              value={fmtNum(empQ.data?.count ?? 0)}
              hint="aktiv + ta'tilda"
            />
          </div>
        )}

        {/* ── Maqsad bajarilishi — katta, to'liq qator ─── */}
        <div className="bg-bg2 border border-border rounded-xl shadow mb-4 overflow-hidden">
          <div className="px-5 py-3.5 border-b border-border flex items-center justify-between">
            <div>
              <span className="text-[15px] font-bold">
                {MONTH_LABELS[MONTH_KEYS[month - 1]]} {year} — Maqsad
                bajarilishi
              </span>
              <span className="text-[12px] text-text3 ml-3">
                oylik reja vs fakt
              </span>
            </div>
            <span
              className={`text-[22px] mono font-bold ${progress >= 100 ? "text-green" : progress >= 70 ? "text-amber" : "text-orange"}`}
            >
              {target ? fmtPct(progress, 1) : "—"}
            </span>
          </div>
          <div className="p-5">
            <div className="grid grid-cols-3 gap-6 mb-4">
              <div>
                <div className="text-[11px] text-text3 uppercase tracking-wider mb-1.5 font-medium">
                  Bajarildi
                </div>
                <div className="mono text-blue font-bold text-[28px] leading-none">
                  {fmtMoney(wonRev)}
                </div>
              </div>
              <div className="text-center">
                <div className="text-[11px] text-text3 uppercase tracking-wider mb-1.5 font-medium">
                  Oylik maqsad
                </div>
                <div className="mono text-text font-bold text-[28px] leading-none">
                  {target > 0 ? fmtMoney(target) : "belgilanmagan"}
                </div>
              </div>
              <div className="text-right">
                <div className="text-[11px] text-text3 uppercase tracking-wider mb-1.5 font-medium">
                  Qoldi
                </div>
                <div
                  className={`mono font-bold text-[28px] leading-none ${progress >= 100 ? "text-green" : "text-amber"}`}
                >
                  {fmtMoney(remaining)}
                </div>
              </div>
            </div>
            <div className="h-4 bg-bg4 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-blue-2 to-cyan-400 transition-all"
                style={{ width: `${Math.min(100, progress)}%` }}
              />
            </div>
            <div className="flex justify-between text-[11px] text-text3 mt-1.5">
              <span>$0</span>
              <span className="mono font-medium text-blue">
                {fmtMoney(wonRev)} / {fmtMoney(target)}
              </span>
              <span>{fmtMoney(target)}</span>
            </div>
          </div>
        </div>

        {/* ── Trend + Voronka ───────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mb-4">
          {trendQ.isLoading && !trendQ.data ? (
            <ChartCardSkeleton height={220} />
          ) : (
            <CardChart
              title="Sotuv trendi"
              hint="oxirgi 6 oy · won daromad"
              height={220}
            >
              <SimpleBar
                data={trendData as never}
                dataKey="value"
                fill="var(--blue)"
              />
            </CardChart>
          )}
          <div className="bg-bg2 border border-border rounded-lg shadow overflow-hidden">
            <div className="px-4 py-3 border-b border-border">
              <span className="text-[13px] font-semibold">Voronka</span>
              <span className="text-[11px] text-text3 ml-2">
                maqsad → savdo → won/lost
              </span>
            </div>
            <div className="p-4">
              {dealsQ.isLoading && !dealsQ.data ? (
                <FunnelSkeleton rows={4} />
              ) : (
                <FunnelBars steps={funnelSteps} />
              )}
            </div>
          </div>
        </div>

        {/* ── Top savdo + Bugungi davomat ───────────────── */}
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div className="bg-bg2 border border-border rounded-lg shadow overflow-hidden">
            <div className="px-4 py-3 border-b border-border">
              <span className="text-[13px] font-semibold">
                Top savdo — {MONTH_LABELS[MONTH_KEYS[month - 1]]}
              </span>
              <span className="text-[11px] text-text3 ml-2">
                won daromad bo'yicha
              </span>
            </div>
            {dealsQ.isLoading && !dealsQ.data ? (
              <DataTableSkeleton rows={5} cols={4} />
            ) : (
              <table className="w-full">
                <thead>
                  <tr className="bg-bg3 text-text3 text-[11px] uppercase tracking-wider">
                    <th className="text-left px-4 py-2.5">#</th>
                    <th className="text-left px-4 py-2.5">Xodim</th>
                    <th className="text-right px-4 py-2.5">Savdo</th>
                    <th className="text-right px-4 py-2.5">Sdelka</th>
                  </tr>
                </thead>
                <tbody>
                  {topSellersFiltered.length === 0 && (
                    <tr>
                      <td
                        colSpan={4}
                        className="px-4 py-8 text-center text-text3 text-[12.5px]"
                      >
                        Mos keladigan natija yo'q
                      </td>
                    </tr>
                  )}
                  {topSellersFiltered.map((u, i) => (
                    <tr
                      key={u.id}
                      className="border-b border-border last:border-0 hover:bg-bg3"
                    >
                      <td className="px-4 py-2.5 mono text-amber font-bold">
                        {i + 1}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2.5">
                          <Avatar name={u.name || `User ${u.id}`} />
                          <span className="font-medium">
                            {u.name || `User ${u.id}`}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-right mono text-green font-semibold">
                        {fmtMoney(u.won_revenue)}
                      </td>
                      <td className="px-4 py-2.5 text-right mono text-text2">
                        {u.total}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="bg-bg2 border border-border rounded-lg shadow overflow-hidden">
            <div className="px-4 py-3 border-b border-border flex items-center justify-between">
              <span className="text-[13px] font-semibold">Bugungi davomat</span>
              <span className="text-[11px] text-text3">
                realtime ·{" "}
                {tmQ.isFetching ? "yangilanmoqda…" : "30s da yangilanadi"}
              </span>
            </div>
            {tmQ.isLoading && !tmQ.data ? (
              <DataTableSkeleton rows={5} cols={3} />
            ) : (
              <table className="w-full">
                <thead>
                  <tr className="bg-bg3 text-text3 text-[11px] uppercase tracking-wider">
                    <th className="text-left px-4 py-2.5">Xodim</th>
                    <th className="text-left px-4 py-2.5">Lavozim</th>
                    <th className="text-right px-4 py-2.5">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {todayUsers.length === 0 && (
                    <tr>
                      <td
                        colSpan={3}
                        className="px-4 py-8 text-center text-text3 text-[12.5px]"
                      >
                        —
                      </td>
                    </tr>
                  )}
                  {todayUsers.map((u) => {
                    const c = classifyTimeman(u);
                    return (
                      <tr
                        key={u.id}
                        className="border-b border-border last:border-0 hover:bg-bg3"
                      >
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-2.5">
                            <Avatar name={u.name || `User ${u.id}`} />
                            <span className="font-medium">
                              {u.name || `User ${u.id}`}
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-2.5 text-text2 text-[11px]">
                          {u.work_position || "—"}
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <Badge tone={c.tone}>{c.label}</Badge>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* ── Top bonus oluvchilar — oxirda ─────────────── */}
        <div className="bg-bg2 border border-border rounded-lg shadow overflow-hidden">
          <div className="px-4 py-3 border-b border-border flex items-center justify-between">
            <span className="text-[13px] font-semibold">
              Top bonus oluvchilar
            </span>
            <span className="text-[11px] text-text3">{periodLabel}</span>
          </div>
          <div className="p-2">
            {bonusesQ.isLoading && !bonusesQ.data ? (
              <div className="space-y-2 p-2">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="skeleton h-9 w-full rounded" />
                ))}
              </div>
            ) : topBonusRecipients.length === 0 ? (
              <div className="text-text3 text-[12px] text-center py-8">
                Bu davr uchun bonus berilmagan
              </div>
            ) : (
              <table className="w-full">
                <tbody>
                  {topBonusRecipients.map((u, i) => (
                    <tr
                      key={u.uid}
                      className="border-b border-border last:border-0 hover:bg-bg3"
                    >
                      <td className="px-3 py-2 mono text-amber font-bold w-6">
                        {i + 1}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2.5">
                          <Avatar name={u.name} />
                          <span className="font-medium">{u.name}</span>
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right text-[11px] text-text3">
                        {u.count} bonus
                      </td>
                      <td className="px-3 py-2 text-right mono text-green font-semibold">
                        +{fmtMoney(u.total)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

function TVCard({
  label,
  value,
  hint,
  color,
  progress,
}: {
  label: string;
  value: string;
  hint?: string;
  color: string;
  progress?: number;
}) {
  return (
    <div className="bg-white/5 border border-white/10 rounded-2xl p-8 flex flex-col justify-between">
      <div className="text-white/40 text-[13px] font-semibold tracking-widest uppercase mb-4">
        {label}
      </div>
      <div className={`font-bold text-[64px] leading-none mono ${color}`}>
        {value}
      </div>
      {hint && (
        <div className="text-white/50 text-[15px] mt-3 font-medium">{hint}</div>
      )}
      {progress !== undefined && (
        <div className="mt-4">
          <div className="h-3 bg-white/10 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${color.includes("emerald") ? "bg-emerald-400" : color.includes("amber") ? "bg-amber-400" : "bg-orange-400"}`}
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

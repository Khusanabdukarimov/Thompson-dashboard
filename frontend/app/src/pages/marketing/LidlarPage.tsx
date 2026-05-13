import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { Topbar } from "@/components/Topbar";
import { MetricCard } from "@/components/MetricCard";
import { Button } from "@/components/Button";
import { FilterBar } from "@/components/FilterBar";
import type {
  FilterField,
  FilterPreset,
  FilterValues,
} from "@/components/FilterBar";
import { MetricRowSkeleton } from "@/components/Skeleton";
import { getDashboardStats, getResponsiblesStats } from "@/lib/api/leads";
import { fmtNum, fmtPct, fmtMoney } from "@/lib/utils";
import { useLocalStorage } from "@/hooks/useLocalStorage";

const PRESETS: FilterPreset[] = [
  { id: "all", label: "Barcha leadlar", pinned: true },
];

const localISO = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const todayISO = () => localISO(new Date());
const daysAgoISO = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return localISO(d);
};
const EMPTY_FILTER: FilterValues = { start_date: undefined, end_date: undefined };
const DEFAULT_FILTER: FilterValues = {
  start_date: daysAgoISO(30),
  end_date: todayISO(),
};

const DATE_PRESETS = [
  { label: "Bugun",   start: () => todayISO(),    end: () => todayISO() },
  { label: "7 kun",   start: () => daysAgoISO(7),  end: () => todayISO() },
  { label: "30 kun",  start: () => daysAgoISO(30), end: () => todayISO() },
  { label: "90 kun",  start: () => daysAgoISO(90), end: () => todayISO() },
  { label: "Barchasi", start: () => "",             end: () => "" },
];

// Funnel colors
const PALETTE = [
  "#f59e0b", "#a78bfa", "#22d3ee", "#fb923c",
  "#f472b6", "#34d399", "#60a5fa", "#e879f9",
];
function sColor(idx: number) {
  return PALETTE[idx % PALETTE.length];
}

// Stage headers for responsibles table
const RESPONSIBLE_COLS = [
  { key: "yangi_lid", label: "Yangi lid" },
  { key: "javob_bermadi", label: "Javob bermadi" },
  { key: "qayta_aloqa", label: "Qayta aloqa" },
  { key: "oylab_koradi", label: "O'ylab ko'radi" },
  { key: "konsultatsiya", label: "Konsultatsiya" },
  { key: "otkazilmadi", label: "O'tkazilmadi" },
  { key: "sandiq", label: "Sandiq" },
  { key: "sifatsiz", label: "Sifatsiz" },
  { key: "bekor_boldi", label: "Bekor bo'ldi" },
] as const;

export default function LidlarPage() {
  const [activePreset, setActivePreset] = useLocalStorage<string | null>("lidlar.preset", "all");
  const [search, setSearch] = useState("");
  const [values, setValues] = useLocalStorage<FilterValues>("lidlar.filter", DEFAULT_FILTER);

  const apiFilter = useMemo(() => ({
    start_date: values.start_date,
    end_date: values.end_date,
  }), [values]);

  const statsQ = useQuery({
    queryKey: ["stats/dashboard", apiFilter],
    queryFn: () => getDashboardStats(apiFilter),
  });

  const respQ = useQuery({
    queryKey: ["stats/responsibles", apiFilter],
    queryFn: () => getResponsiblesStats(apiFilter),
  });

  const fields: FilterField[] = [
    { key: "start_date", label: "Sanadan", type: "date" },
    { key: "end_date", label: "Sanagacha", type: "date" },
  ];

  const header = statsQ.data?.header;
  const funnel = statsQ.data?.funnel ?? [];
  const responsibles = respQ.data?.responsibles ?? [];

  const total           = header?.total_leads         ?? 0;
  const sifatliLid      = header?.sifatli_lid_count   ?? 0;
  const konsultatsiya   = header?.konsultatsiya_count  ?? 0;
  const muvaffaqiyatsiz = header?.muvaffaqiyatsiz_count ?? 0;

  const sifatliKonv          = total      > 0 ? (sifatliLid    / total)      * 100 : 0;
  const sifatliToKonsult     = sifatliLid > 0 ? (konsultatsiya / sifatliLid) * 100 : 0;
  const umumiyToKonsult      = total      > 0 ? (konsultatsiya / total)      * 100 : 0;

  const byUserFiltered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return s ? responsibles.filter((u) => u.full_name.toLowerCase().includes(s)) : responsibles;
  }, [responsibles, search]);

  const colMaxes = useMemo(() => {
    const m: Record<string, number> = {};
    for (const col of RESPONSIBLE_COLS) {
      m[col.key] = Math.max(1, ...responsibles.map((u) => u[col.key as keyof typeof u] as number));
    }
    return m;
  }, [responsibles]);

  const totalsRow = useMemo(() => {
    const bs: Record<string, number> = {};
    for (const u of responsibles) {
      for (const col of RESPONSIBLE_COLS) {
        bs[col.key] = (bs[col.key] ?? 0) + (u[col.key as keyof typeof u] as number);
      }
    }
    return bs;
  }, [responsibles]);

  const maxFunnelCount = Math.max(1, ...funnel.map((f) => f.lead_count));

  return (
    <>
      <Topbar
        title="Lidlar analitika"
        sub={
          values.start_date || values.end_date
            ? `${values.start_date ?? "—"} → ${values.end_date ?? "—"}`
            : "Barcha vaqt"
        }
        actions={
          <Button onClick={() => { statsQ.refetch(); respQ.refetch(); }}>
            <RefreshCw className="w-3.5 h-3.5" /> Yangilash
          </Button>
        }
      />
      <div className="flex-1 overflow-y-auto px-[22px] py-[18px] bg-bg">
        {/* Filter */}
        <div className="bg-bg2 border border-border rounded-lg shadow p-3 mb-4 flex items-center gap-3 flex-wrap">
          <FilterBar
            presets={PRESETS}
            activePreset={activePreset}
            onPresetChange={setActivePreset}
            searchValue={search}
            onSearchChange={setSearch}
            fields={fields}
            values={values}
            onChange={(k, v) => setValues((s) => ({ ...s, [k]: v }))}
            onClear={() => {
              setSearch("");
              setValues(EMPTY_FILTER);
              setActivePreset("all");
            }}
            onApply={() => { statsQ.refetch(); respQ.refetch(); }}
            activeChipLabel={activePreset && activePreset !== "all" ? PRESETS.find((p) => p.id === activePreset)?.label : undefined}
            onActiveChipClear={() => setActivePreset("all")}
            storageKey="marketing.lidlar"
            onApplySavedFilter={(v) => setValues(v as typeof values)}
          />
          {/* Quick date range buttons */}
          <div className="flex items-center gap-1 ml-auto flex-shrink-0">
            {DATE_PRESETS.map((dp) => {
              const s = dp.start();
              const e = dp.end();
              const active = (values.start_date ?? "") === s && (values.end_date ?? "") === e;
              return (
                <button
                  key={dp.label}
                  type="button"
                  onClick={() => {
                    setValues((prev) => ({ ...prev, start_date: s || undefined, end_date: e || undefined }));
                    statsQ.refetch(); respQ.refetch();
                  }}
                  className={`px-2.5 py-1 rounded-md text-[11.5px] font-medium transition-colors border ${
                    active
                      ? "bg-blue text-white border-blue"
                      : "bg-bg3 text-text2 border-border hover:border-border2 hover:text-text"
                  }`}
                >
                  {dp.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* KPI Row 1 — 5 cards */}
        {statsQ.isLoading && !header ? (
          <MetricRowSkeleton count={5} />
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-3">
            <MetricCard label="Umumiy lid"               value={fmtNum(total)}                                             tone="blue"   />
            <MetricCard label="Sifatli lid"              value={fmtNum(sifatliLid)}                                        tone="blue"   />
            <MetricCard label="Sifatli konversiya"       value={sifatliKonv    > 0 ? fmtPct(sifatliKonv,    1) : "—"}     tone="green"  />
            <MetricCard label="Konsultatsiya o'tkazildi" value={fmtNum(konsultatsiya)}                                     tone="purple" />
            <MetricCard label="Sifatli → Konsultatsiya"  value={sifatliToKonsult > 0 ? fmtPct(sifatliToKonsult, 1) : "—"} tone="purple" />
          </div>
        )}

        {/* KPI Row 2 */}
        {!statsQ.isLoading && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-4">
            <MetricCard label="Sifatsiz/bekor"          value={fmtNum(muvaffaqiyatsiz)}                                   tone="red"    />
            <div className="hidden lg:block" />
            <MetricCard label="Umumiy → Konsultatsiya"   value={umumiyToKonsult > 0 ? fmtPct(umumiyToKonsult, 1) : "—"}   tone="blue"   />
            <div className="hidden lg:block" />
            <MetricCard label="Konversiya"               value={fmtPct(header?.conversion_pct ?? 0, 1)}                   tone="green"  />
          </div>
        )}

        {/* Stage Funnel Visual */}
        <div className="bg-bg2 border border-border rounded-lg shadow mb-4 overflow-hidden">
          <div className="px-4 py-3 border-b border-border">
            <span className="text-[13px] font-semibold">Sotuv voronkasi (Funnel)</span>
          </div>
          <div className="p-4 flex flex-col gap-2">
            {funnel.map((stage, i) => {
              const pct = maxFunnelCount ? (stage.lead_count / maxFunnelCount) * 100 : 0;
              return (
                <div key={stage.bitrix_id} className="flex items-center gap-3">
                  <span className="text-[12px] text-text2 w-48 shrink-0 truncate">{stage.name_uz}</span>
                  <div className="flex-1 h-6 rounded overflow-hidden bg-bg3">
                    <div className="h-full rounded transition-all" style={{ width: `${pct}%`, background: sColor(i) }} />
                  </div>
                  <span className="mono text-[12px] font-semibold w-12 text-right">{stage.lead_count}</span>
                  <span className="mono text-[11px] text-text3 w-20 text-right">{fmtMoney(stage.total_opportunity)}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Lid mas'ullar kesimida */}
        <div className="bg-bg2 border border-border rounded-lg shadow mb-4 overflow-hidden">
          <div className="px-4 py-3 border-b border-border flex justify-between items-center">
            <span className="text-[13px] font-semibold">Lid mas'ullar kesimida</span>
            <span className="text-[11px] text-text3 ml-2">{byUserFiltered.length} ta xodim</span>
          </div>
          {respQ.isLoading && !responsibles.length ? (
            <div className="p-6 text-text3 text-[12px]">Yuklanmoqda…</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[11.5px] border-collapse">
                <thead>
                  <tr className="border-b border-border bg-bg">
                    <th className="sticky left-0 bg-bg px-4 py-2.5 text-left font-medium text-text3 uppercase tracking-wider text-[10px] min-w-[160px] z-10">
                      Mas'ul
                    </th>
                    <th className="px-3 py-2.5 text-right font-medium text-text3 uppercase tracking-wider text-[10px] min-w-[56px]">
                      Jami
                    </th>
                    {RESPONSIBLE_COLS.map((col, i) => (
                      <th key={col.key} className="px-3 py-2.5 text-left font-medium text-[10px] uppercase tracking-wider min-w-[88px]" style={{ color: sColor(i) }}>
                        {col.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {byUserFiltered.map((u) => (
                    <tr key={u.responsible_id} className="border-b border-border hover:bg-bg3 transition-colors">
                      <td className="sticky left-0 bg-bg2 px-4 py-2.5 z-10">
                        <div className="flex items-center gap-2">
                          <div className="w-6 h-6 rounded-full bg-blue-bg text-blue text-[9px] font-bold flex items-center justify-center shrink-0">
                            {(u.full_name || `U${u.responsible_id}`).split(" ").filter(Boolean).slice(0, 2).map((s) => s[0]).join("").toUpperCase() || "?"}
                          </div>
                          <span className="font-medium text-[12px] whitespace-nowrap">{u.full_name || `User ${u.responsible_id}`}</span>
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <span className="mono font-semibold text-[13px]">{fmtNum(u.total)}</span>
                      </td>
                      {RESPONSIBLE_COLS.map((col, i) => {
                        const cnt = u[col.key as keyof typeof u] as number ?? 0;
                        const color = sColor(i);
                        return (
                          <td key={col.key} className="px-3 py-2.5">
                            {cnt > 0 ? (
                              <div>
                                <span className="mono text-[12px]">{fmtNum(cnt)}</span>
                                <div className="h-[3px] rounded mt-1 bg-bg4 overflow-hidden">
                                  <div className="h-full rounded" style={{ width: `${(cnt / colMaxes[col.key]) * 100}%`, background: color }} />
                                </div>
                              </div>
                            ) : (
                              <span className="text-text3">—</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                  <tr className="bg-bg3 border-t-2 border-border">
                    <td className="sticky left-0 bg-bg3 px-4 py-2.5 text-[10px] text-text3 uppercase tracking-wider font-semibold z-10">Jami</td>
                    <td className="px-3 py-2.5 text-right"><span className="mono font-bold text-[13px]">{fmtNum(responsibles.reduce((sum, u) => sum + u.total, 0))}</span></td>
                    {RESPONSIBLE_COLS.map((col) => (
                      <td key={col.key} className="px-3 py-2.5"><span className="mono text-[12px] font-semibold">{fmtNum(totalsRow[col.key] ?? 0)}</span></td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </div>

        {statsQ.error && (
          <div className="mt-4 p-3 bg-red-bg border border-red-bd text-red rounded-lg text-[12.5px]">
            Xatolik: {(statsQ.error as Error).message}
          </div>
        )}
      </div>
    </>
  );
}

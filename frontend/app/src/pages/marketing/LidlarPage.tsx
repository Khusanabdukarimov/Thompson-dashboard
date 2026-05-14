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
import { getDashboardStats, getResponsiblesStats, getConversionStats } from "@/lib/api/leads";
import { fmtNum, fmtPct } from "@/lib/utils";
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

// Stage headers for responsibles table
const RESPONSIBLE_COLS = [
  { key: "qongiroqlar",            label: "Qo'ng'iroqlar",           color: "#9E9E9E" },
  { key: "yangi_lid",              label: "Yangi lid",               color: "#2196F3" },
  { key: "propushenniy",           label: "Propushenniy",            color: "#B0BEC5" },
  { key: "javob_bermadi",          label: "Javob bermadi",           color: "#FF9800" },
  { key: "qayta_aloqa",            label: "Qayta aloqa",             color: "#00BCD4" },
  { key: "oylab_koradi",           label: "O'ylab ko'radi",          color: "#E91E63" },
  { key: "konsultatsiya",          label: "Konsultatsiya belgilandi", color: "#9C27B0" },
  { key: "otkazilmadi",            label: "O'tkazilmadi",            color: "#FF00FF" },
  { key: "konsultatsiya_otkazildi", label: "Konsultatsiya o'tkazildi", color: "#4CAF50" },
  { key: "sandiq",                 label: "Sandiq",                  color: "#90CAF9" },
  { key: "sifatsiz",               label: "Sifatsiz",                color: "#F44336" },
  { key: "bekor_boldi",            label: "Bekor bo'ldi",            color: "#FFC107" },
] as const;

type RespColKey = typeof RESPONSIBLE_COLS[number]["key"];

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

  const conversionQ = useQuery({
    queryKey: ["stats/conversion", apiFilter],
    queryFn: () => getConversionStats(apiFilter),
  });

  const fields: FilterField[] = [
    { key: "start_date", label: "Sanadan", type: "date" },
    { key: "end_date", label: "Sanagacha", type: "date" },
  ];

  const header = statsQ.data?.header;
  const responsibles = respQ.data?.responsibles ?? [];

  const total              = header?.total_leads                    ?? 0;
  const sifatsizBekor      = header?.sifatsiz_bekor_count           ?? 0;
  const sifatliLid         = header?.sifatli_lid_count              ?? 0;
  const konsultBelgilandi  = header?.konsultatsiya_belgilandi_count  ?? 0;
  const konsultOtkazildi   = header?.konsultatsiya_otkazildi_count   ?? 0;

  const sifatliKonv         = total      > 0 ? (sifatliLid       / total)      * 100 : 0;
  const sifatliToBelgilandi = sifatliLid > 0 ? (konsultBelgilandi/ sifatliLid) * 100 : 0;
  const sifatliToOtkazildi  = sifatliLid > 0 ? (konsultOtkazildi / sifatliLid) * 100 : 0;
  const umumiyToBelgilandi  = total      > 0 ? (konsultBelgilandi / total)      * 100 : 0;
  const konversiya          = total      > 0 ? (konsultOtkazildi  / total)      * 100 : 0;

  const byUserFiltered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return s ? responsibles.filter((u) => u.full_name.toLowerCase().includes(s)) : responsibles;
  }, [responsibles, search]);

  const colMaxes = useMemo(() => {
    const m: Partial<Record<RespColKey, number>> = {};
    for (const col of RESPONSIBLE_COLS) {
      m[col.key] = Math.max(1, ...responsibles.map((u) => (u as unknown as Record<string, number>)[col.key] ?? 0));
    }
    return m;
  }, [responsibles]);

  const totalsRow = useMemo(() => {
    const bs: Partial<Record<RespColKey, number>> = {};
    for (const u of responsibles) {
      for (const col of RESPONSIBLE_COLS) {
        bs[col.key] = (bs[col.key] ?? 0) + ((u as unknown as Record<string, number>)[col.key] ?? 0);
      }
    }
    return bs;
  }, [responsibles]);

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
          <Button onClick={() => { statsQ.refetch(); respQ.refetch(); conversionQ.refetch(); }}>
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
            onApply={() => { statsQ.refetch(); respQ.refetch(); conversionQ.refetch(); }}
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
                    statsQ.refetch(); respQ.refetch(); conversionQ.refetch();
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

        {/* KPI Row 1 — 7 cards */}
        {statsQ.isLoading && !header ? (
          <MetricRowSkeleton count={7} />
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3 mb-3">
            <MetricCard label="Umumiy lid"                value={fmtNum(total)}                                                        tone="blue"   />
            <MetricCard label="Sifatli lid"               value={fmtNum(sifatliLid)}                                                   tone="blue"   />
            <MetricCard label="Sifatli konversiya"        value={sifatliKonv         > 0 ? fmtPct(sifatliKonv,         1) : "—"}       tone="green"  />
            <MetricCard label="Konsultatsiya belgilandi"  value={fmtNum(konsultBelgilandi)}                                            tone="purple" />
            <MetricCard label="Sifatli → K.belgilandi"   value={sifatliToBelgilandi > 0 ? fmtPct(sifatliToBelgilandi, 1) : "—"}       tone="purple" />
            <MetricCard label="Konsultatsiya o'tkazildi" value={fmtNum(konsultOtkazildi)}                                             tone="green"  />
            <MetricCard label="Sifatli → K.o'tkazildi"  value={sifatliToOtkazildi  > 0 ? fmtPct(sifatliToOtkazildi,  1) : "—"}       tone="green"  />
          </div>
        )}

        {/* KPI Row 2 */}
        {!statsQ.isLoading && (
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3 mb-4">
            <MetricCard label="Sifatsiz/bekor"        value={fmtNum(sifatsizBekor)}                                            tone="red"    />
            <div className="hidden lg:block lg:col-span-3" />
            <MetricCard label="Umumiy → K.belgilandi" value={umumiyToBelgilandi > 0 ? fmtPct(umumiyToBelgilandi, 1) : "—"}  tone="blue"   />
            <div className="hidden lg:block" />
            <MetricCard label="Konversiya"             value={konversiya > 0 ? fmtPct(konversiya, 1) : "—"}                  tone="green"  />
          </div>
        )}

        {/* Lid va Konversiya funnel table */}
        <div className="bg-bg2 border border-border rounded-lg shadow mb-4 overflow-hidden">
          <div className="px-4 py-3 border-b border-border">
            <span className="text-[13px] font-semibold">Lid va Konversiya</span>
          </div>
          {conversionQ.isLoading ? (
            <div className="p-6 text-text3 text-[12px]">Yuklanmoqda…</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[11.5px] border-collapse">
                <thead>
                  <tr className="border-b border-border bg-bg">
                    <th className="px-4 py-2.5 text-left font-medium text-text3 uppercase tracking-wider text-[10px] min-w-[160px]">Mas'ul</th>
                    <th className="px-3 py-2.5 text-right font-medium text-[10px] uppercase tracking-wider min-w-[80px]" style={{ color: "#60a5fa" }}>Jami lid</th>
                    <th className="px-3 py-2.5 text-right font-medium text-[10px] uppercase tracking-wider min-w-[80px]" style={{ color: "#f59e0b" }}>Jarayonda</th>
                    <th className="px-3 py-2.5 text-right font-medium text-[10px] uppercase tracking-wider min-w-[80px]" style={{ color: "#f87171" }}>Sifatsiz lid</th>
                    <th className="px-3 py-2.5 text-right font-medium text-[10px] uppercase tracking-wider min-w-[120px]" style={{ color: "#34d399" }}>Konsultatsiya o'tkazildi</th>
                    <th className="px-3 py-2.5 text-right font-medium text-[10px] uppercase tracking-wider min-w-[80px]" style={{ color: "#4ade80" }}>Konversiya</th>
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    const rows = conversionQ.data?.conversion ?? [];
                    const maxTotal = Math.max(1, ...rows.map((r) => r.total));
                    const totTotal = rows.reduce((s, r) => s + r.total, 0);
                    const totJarayonda = rows.reduce((s, r) => s + r.jarayonda, 0);
                    const totSifatsiz = rows.reduce((s, r) => s + r.sifatsiz_lid, 0);
                    const totTashrif = rows.reduce((s, r) => s + r.tashrif_buyurdi, 0);
                    return (
                      <>
                        {rows.map((r) => {
                          const konv = r.total > 0 ? (r.tashrif_buyurdi / r.total) * 100 : 0;
                          return (
                            <tr key={r.responsible_id} className="border-b border-border hover:bg-bg3 transition-colors">
                              <td className="px-4 py-2.5">
                                <div className="flex items-center gap-2">
                                  <div className="w-6 h-6 rounded-full bg-blue-bg text-blue text-[9px] font-bold flex items-center justify-center shrink-0">
                                    {(r.full_name || "?").split(" ").filter(Boolean).slice(0, 2).map((s) => s[0]).join("").toUpperCase() || "?"}
                                  </div>
                                  <span className="font-medium text-[12px] whitespace-nowrap">{r.full_name}</span>
                                </div>
                              </td>
                              <td className="px-3 py-2.5 text-right">
                                <div>
                                  <span className="mono font-semibold text-[12px]">{fmtNum(r.total)}</span>
                                  <div className="h-[3px] rounded mt-1 bg-bg4 overflow-hidden">
                                    <div className="h-full rounded" style={{ width: `${(r.total / maxTotal) * 100}%`, background: "#60a5fa" }} />
                                  </div>
                                </div>
                              </td>
                              <td className="px-3 py-2.5 text-right">
                                <div>
                                  <span className="mono text-[12px]">{fmtNum(r.jarayonda)}</span>
                                  <div className="h-[3px] rounded mt-1 bg-bg4 overflow-hidden">
                                    <div className="h-full rounded" style={{ width: r.total > 0 ? `${(r.jarayonda / r.total) * 100}%` : "0%", background: "#f59e0b" }} />
                                  </div>
                                </div>
                              </td>
                              <td className="px-3 py-2.5 text-right">
                                <div>
                                  <span className="mono text-[12px]">{fmtNum(r.sifatsiz_lid)}</span>
                                  <div className="h-[3px] rounded mt-1 bg-bg4 overflow-hidden">
                                    <div className="h-full rounded" style={{ width: r.total > 0 ? `${(r.sifatsiz_lid / r.total) * 100}%` : "0%", background: "#f87171" }} />
                                  </div>
                                </div>
                              </td>
                              <td className="px-3 py-2.5 text-right">
                                <div>
                                  <span className="mono text-[12px]">{fmtNum(r.tashrif_buyurdi)}</span>
                                  <div className="h-[3px] rounded mt-1 bg-bg4 overflow-hidden">
                                    <div className="h-full rounded" style={{ width: r.total > 0 ? `${(r.tashrif_buyurdi / r.total) * 100}%` : "0%", background: "#34d399" }} />
                                  </div>
                                </div>
                              </td>
                              <td className="px-3 py-2.5 text-right">
                                <span className="mono font-semibold text-[12px]" style={{ color: "#4ade80" }}>
                                  {konv > 0 ? fmtPct(konv, 1) : "—"}
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                        <tr className="bg-bg3 border-t-2 border-border">
                          <td className="px-4 py-2.5 text-[10px] text-text3 uppercase tracking-wider font-semibold">Итого</td>
                          <td className="px-3 py-2.5 text-right"><span className="mono font-bold text-[13px]">{fmtNum(totTotal)}</span></td>
                          <td className="px-3 py-2.5 text-right"><span className="mono font-semibold text-[12px]">{fmtNum(totJarayonda)}</span></td>
                          <td className="px-3 py-2.5 text-right"><span className="mono font-semibold text-[12px]">{fmtNum(totSifatsiz)}</span></td>
                          <td className="px-3 py-2.5 text-right"><span className="mono font-semibold text-[12px]">{fmtNum(totTashrif)}</span></td>
                          <td className="px-3 py-2.5 text-right">
                            <span className="mono font-semibold text-[12px]" style={{ color: "#4ade80" }}>
                              {totTotal > 0 ? fmtPct((totTashrif / totTotal) * 100, 1) : "—"}
                            </span>
                          </td>
                        </tr>
                      </>
                    );
                  })()}
                </tbody>
              </table>
            </div>
          )}
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
                    {RESPONSIBLE_COLS.map((col) => (
                      <th key={col.key} className="px-3 py-2.5 text-left font-medium text-[10px] uppercase tracking-wider min-w-[88px]" style={{ color: col.color }}>
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
                      {RESPONSIBLE_COLS.map((col) => {
                        const cnt = (u as unknown as Record<string, number>)[col.key] ?? 0;
                        const max = colMaxes[col.key] ?? 1;
                        return (
                          <td key={col.key} className="px-3 py-2.5">
                            {cnt > 0 ? (
                              <div>
                                <span className="mono text-[12px]">{fmtNum(cnt)}</span>
                                <div className="h-[3px] rounded mt-1 bg-bg4 overflow-hidden">
                                  <div className="h-full rounded" style={{ width: `${(cnt / max) * 100}%`, background: col.color }} />
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

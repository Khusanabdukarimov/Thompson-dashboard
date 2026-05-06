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
import { getLeadsStats, getLeadQuality } from "@/lib/api/leads";
import type { LeadFilter } from "@/lib/api/leads";
import { fmtNum, fmtPct } from "@/lib/utils";
import { useLocalStorage } from "@/hooks/useLocalStorage";

const STATUS_COLORS: Record<string, string> = {
  NEW: "#6b7280",
  IN_PROCESS: "#3b82f6",
  PROCESSED: "#8b5cf6",
  UC_F8K4GI: "#ef4444",
  UC_NAZK5J: "#ef4444",
  JUNK: "#6b7280",
  CONVERTED: "#22c55e",
};
const PALETTE = [
  "#f59e0b",
  "#a78bfa",
  "#22d3ee",
  "#fb923c",
  "#f472b6",
  "#34d399",
  "#60a5fa",
  "#e879f9",
];
function sColor(id: string, idx: number) {
  return STATUS_COLORS[id] ?? PALETTE[idx % PALETTE.length];
}

const JARAYON = new Set([
  "NEW",
  "IN_PROCESS",
  "PROCESSED",
  "UC_1KPATX",
  "UC_Q2U9EL",
  "UC_KXC3ZW",
  "UC_L28G68",
]);

const PRESETS: FilterPreset[] = [
  { id: "all", label: "Barcha leadlar", pinned: true },
  { id: "jarayonda", label: "Jarayondagi", pinned: true },
  { id: "yopilgan", label: "Yopilgan" },
  { id: "sifatsiz", label: "Sifatsiz" },
];
const STATUS_BY_PRESET: Record<string, string | undefined> = {
  all: undefined,
  jarayonda: "IN_PROCESS",
  yopilgan: "CONVERTED",
  sifatsiz: "UC_F8K4GI",
};

const todayISO = () => new Date().toISOString().slice(0, 10);
const oneYearAgoISO = () => {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 1);
  return d.toISOString().slice(0, 10);
};

export default function LidlarPage() {
  const [activePreset, setActivePreset] = useLocalStorage<string | null>(
    "lidlar.preset",
    "all",
  );
  const [search, setSearch] = useState("");
  const [values, setValues] = useLocalStorage<FilterValues>("lidlar.filter", {
    start_date: oneYearAgoISO(),
    end_date: todayISO(),
  });

  const apiFilter: LeadFilter = useMemo(
    () => ({
      start_date: values.start_date,
      end_date: values.end_date,
      assigned_by: values.assigned_by ? Number(values.assigned_by) : undefined,
      status_id: activePreset ? STATUS_BY_PRESET[activePreset] : undefined,
      source_id: values.source_id,
      utm_source: values.utm_source,
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }),
    [values, activePreset],
  );

  const statsQ = useQuery({
    queryKey: ["stats/leads", apiFilter],
    queryFn: () => getLeadsStats(apiFilter),
  });
  const qualityQ = useQuery({
    queryKey: ["stats/lead-quality", apiFilter],
    queryFn: () => getLeadQuality(apiFilter),
  });

  const fields: FilterField[] = useMemo(() => {
    const users = statsQ.data?.users ?? [];
    const sources = statsQ.data?.sources ?? [];
    return [
      { key: "start_date", label: "Sanadan", type: "date" },
      { key: "end_date", label: "Sanagacha", type: "date" },
      {
        key: "assigned_by",
        label: "Mas'ul",
        type: "select",
        options: users.map((u) => ({
          value: u.id,
          label: u.name || `User ${u.id}`,
        })),
      },
      {
        key: "source_id",
        label: "Manba",
        type: "select",
        options: sources.map((s) => ({ value: s.id, label: s.label })),
      },
    ];
  }, [statsQ.data]);

  const d = statsQ.data;
  const total = d?.total ?? 0;
  const converted = d?.converted ?? 0;
  const jarayon = d?.jarayon_total ?? 0;
  const byStatus = d?.by_status ?? {};
  const statusNames = d?.status_names ?? {};

  const failed = Object.entries(byStatus)
    .filter(([k]) => !JARAYON.has(k) && k !== "CONVERTED" && k !== "CLOSED")
    .reduce((s, [, v]) => s + v, 0);

  const tashrifBelgId = Object.entries(statusNames).find(([, n]) =>
    n.toLowerCase().includes("belgiland"),
  )?.[0];
  const tashrifBuyId = Object.entries(statusNames).find(([, n]) =>
    n.toLowerCase().includes("buyur"),
  )?.[0];
  const tashrifBelg = tashrifBelgId ? (byStatus[tashrifBelgId] ?? 0) : 0;
  const tashrifBuy = tashrifBuyId ? (byStatus[tashrifBuyId] ?? 0) : converted;

  const orderedStatuses = useMemo(
    () =>
      Object.entries(byStatus)
        .sort(([, a], [, b]) => b - a)
        .map(([id]) => id)
        .slice(0, 14),
    [byStatus],
  );

  const colMaxes = useMemo(() => {
    const m: Record<string, number> = {};
    for (const sid of orderedStatuses) {
      m[sid] = Math.max(
        1,
        ...(d?.by_user ?? []).map((u) => u.by_status[sid] ?? 0),
      );
    }
    return m;
  }, [orderedStatuses, d?.by_user]);

  const byUserFiltered = useMemo(() => {
    const list = d?.by_user ?? [];
    const s = search.trim().toLowerCase();
    return s ? list.filter((u) => u.name.toLowerCase().includes(s)) : list;
  }, [d?.by_user, search]);

  const totalsRow = useMemo(() => {
    const bs: Record<string, number> = {};
    for (const u of d?.by_user ?? []) {
      for (const [sid, cnt] of Object.entries(u.by_status)) {
        bs[sid] = (bs[sid] ?? 0) + cnt;
      }
    }
    return bs;
  }, [d?.by_user]);

  return (
    <>
      <Topbar
        title="Lidlar analitika"
        sub={`${values.start_date ?? "—"} → ${values.end_date ?? "—"}`}
        actions={
          <Button
            onClick={() => {
              statsQ.refetch();
              qualityQ.refetch();
            }}
          >
            <RefreshCw className="w-3.5 h-3.5" /> Yangilash
          </Button>
        }
      />
      <div className="flex-1 overflow-y-auto px-[22px] py-[18px] bg-bg">
        {/* Filter */}
        <div className="bg-bg2 border border-border rounded-lg shadow p-3 mb-4 flex items-center gap-3">
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
              setValues({ start_date: oneYearAgoISO(), end_date: todayISO() });
              setActivePreset("all");
            }}
            onApply={() => {
              statsQ.refetch();
              qualityQ.refetch();
            }}
            activeChipLabel={
              activePreset && activePreset !== "all"
                ? PRESETS.find((p) => p.id === activePreset)?.label
                : undefined
            }
            onActiveChipClear={() => setActivePreset("all")}
            storageKey="marketing.lidlar"
            onApplySavedFilter={(v) => setValues(v as typeof values)}
          />
        </div>

        {/* KPI Row 1 — 5 large cards */}
        {statsQ.isLoading && !d ? (
          <MetricRowSkeleton count={5} />
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-3">
            <MetricCard
              size="lg"
              label="Barcha lidlar"
              value={fmtNum(total)}
              tone="blue"
            />
            <MetricCard
              size="lg"
              label="Jarayonda"
              value={fmtNum(jarayon)}
              tone="amber"
            />
            <MetricCard
              size="lg"
              label="Muvaffaqiyatsiz"
              value={fmtNum(failed)}
              tone="red"
            />
            <MetricCard
              size="lg"
              label="Sdelkaga"
              value={fmtNum(converted)}
              tone="green"
            />
            <MetricCard
              size="lg"
              label="Konversiya"
              value={fmtPct(d?.conversion_rate ?? 0, 2)}
            />
          </div>
        )}

        {/* KPI Row 2 — 4 medium cards */}
        {!statsQ.isLoading && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
            <MetricCard
              label="Tashrif belgilandi"
              value={fmtNum(tashrifBelg)}
              hint={tashrifBelgId ? statusNames[tashrifBelgId] : "—"}
              tone="blue"
            />
            <MetricCard
              label="Konv. → Tashrif belgilandi"
              value={total ? fmtPct((tashrifBelg / total) * 100, 2) : "—"}
            />
            <MetricCard
              label="Konv. → Tashrif buyurdi"
              value={total ? fmtPct((tashrifBuy / total) * 100, 2) : "—"}
              tone="green"
            />
            <MetricCard
              label="Sifatli konversiya"
              value={
                tashrifBelg ? fmtPct((tashrifBuy / tashrifBelg) * 100, 2) : "—"
              }
              tone="green"
            />
          </div>
        )}

        {/* Lid mas'ullar kesimida */}
        <div className="bg-bg2 border border-border rounded-lg shadow mb-4 overflow-hidden">
          <div className="px-4 py-3 border-b border-border">
            <span className="text-[13px] font-semibold">
              Lid mas'ullar kesimida
            </span>
            <span className="text-[11px] text-text3 ml-2">
              {byUserFiltered.length} ta xodim
            </span>
          </div>
          {statsQ.isLoading && !d ? (
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
                    {orderedStatuses.map((sid, i) => (
                      <th
                        key={sid}
                        className="px-3 py-2.5 text-left font-medium text-[10px] uppercase tracking-wider min-w-[88px]"
                        style={{ color: sColor(sid, i) }}
                      >
                        {statusNames[sid] || sid}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {byUserFiltered.map((u) => (
                    <tr
                      key={u.id}
                      className="border-b border-border hover:bg-bg3 transition-colors"
                    >
                      <td className="sticky left-0 bg-bg2 px-4 py-2.5 z-10">
                        <div className="flex items-center gap-2">
                          <div className="w-6 h-6 rounded-full bg-blue-bg text-blue text-[9px] font-bold flex items-center justify-center shrink-0">
                            {(u.name || `U${u.id}`)
                              .split(" ")
                              .filter(Boolean)
                              .slice(0, 2)
                              .map((s) => s[0])
                              .join("")
                              .toUpperCase() || "?"}
                          </div>
                          <span className="font-medium text-[12px] whitespace-nowrap">
                            {u.name || `User ${u.id}`}
                          </span>
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <span className="mono font-semibold text-[13px]">
                          {fmtNum(u.total)}
                        </span>
                      </td>
                      {orderedStatuses.map((sid, i) => {
                        const cnt = u.by_status[sid] ?? 0;
                        const col = sColor(sid, i);
                        return (
                          <td key={sid} className="px-3 py-2.5">
                            {cnt > 0 ? (
                              <div>
                                <span className="mono text-[12px]">
                                  {fmtNum(cnt)}
                                </span>
                                <div className="h-[3px] rounded mt-1 bg-bg4 overflow-hidden">
                                  <div
                                    className="h-full rounded"
                                    style={{
                                      width: `${(cnt / colMaxes[sid]) * 100}%`,
                                      background: col,
                                    }}
                                  />
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
                    <td className="sticky left-0 bg-bg3 px-4 py-2.5 text-[10px] text-text3 uppercase tracking-wider font-semibold z-10">
                      Jami
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <span className="mono font-bold text-[13px]">
                        {fmtNum(total)}
                      </span>
                    </td>
                    {orderedStatuses.map((sid) => (
                      <td key={sid} className="px-3 py-2.5">
                        <span className="mono text-[12px] font-semibold">
                          {fmtNum(totalsRow[sid] ?? 0)}
                        </span>
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Quality breakdowns */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <QualityList
            title="Sifatsiz sabablari"
            items={qualityQ.data?.sifatsiz ?? []}
            loading={qualityQ.isLoading}
          />
          <QualityList
            title="Bekor sabablari"
            items={qualityQ.data?.bekor ?? []}
            loading={qualityQ.isLoading}
          />
          <QualityList
            title="Sandiq (junk)"
            items={qualityQ.data?.sandiq ?? []}
            loading={qualityQ.isLoading}
          />
          <QualityList
            title="UTM source"
            items={qualityQ.data?.utm ?? []}
            loading={qualityQ.isLoading}
          />
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

function QualityList({
  title,
  items,
  loading,
}: {
  title: string;
  items: { label: string; val: number }[];
  loading: boolean;
}) {
  const max = Math.max(1, ...items.map((i) => i.val));
  return (
    <div className="bg-bg2 border border-border rounded-lg shadow overflow-hidden">
      <div className="px-4 py-3 border-b border-border">
        <span className="text-[13px] font-semibold">{title}</span>
        <span className="text-[11px] text-text3 ml-2">
          {loading ? "yuklanmoqda…" : `${items.length} ta`}
        </span>
      </div>
      <div className="p-3">
        {loading && items.length === 0 ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 py-1.5">
                <div
                  className="skeleton h-3 flex-1"
                  style={{ maxWidth: 100 + i * 18 }}
                />
                <div className="skeleton h-1.5 w-24" />
                <div className="skeleton h-3 w-10" />
              </div>
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="text-text3 text-[12px] text-center py-6">Bo'sh</div>
        ) : (
          items.map((it, i) => (
            <div key={i} className="flex items-center gap-3 py-1.5">
              <span className="text-[12px] text-text2 flex-1 truncate">
                {it.label}
              </span>
              <div className="w-24 h-1.5 bg-bg4 rounded overflow-hidden">
                <div
                  className="h-full rounded bg-blue"
                  style={{ width: `${(it.val / max) * 100}%` }}
                />
              </div>
              <span className="mono text-[12px] font-semibold w-10 text-right">
                {it.val}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

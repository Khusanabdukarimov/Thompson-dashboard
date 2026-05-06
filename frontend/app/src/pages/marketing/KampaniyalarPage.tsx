import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { RefreshCw } from "lucide-react";
import { Topbar } from "@/components/Topbar";
import { MetricCard } from "@/components/MetricCard";
import { Button } from "@/components/Button";
import { CardChart, MultiLine, StackedBar } from "@/components/charts";
import { DataTable } from "@/components/DataTable";
import { FilterBar } from "@/components/FilterBar";
import type {
  FilterField,
  FilterPreset,
  FilterValues,
} from "@/components/FilterBar";
import { MetricRowSkeleton, ChartCardSkeleton } from "@/components/Skeleton";
import {
  getMetaInsights,
  getMetaCampaigns,
  MONTH_KEYS,
  MONTH_LABELS,
} from "@/lib/api/meta";
import type { MonthKey, CampaignAdRow } from "@/lib/api/meta";
import { fmtNum, fmtMoney } from "@/lib/utils";
import { useLocalStorage } from "@/hooks/useLocalStorage";

const PLATFORM_PRESETS: FilterPreset[] = [
  { id: "all", label: "Hammasi", pinned: true },
  { id: "facebook", label: "Facebook", pinned: true },
  { id: "instagram", label: "Instagram", pinned: true },
];

type DayRow = {
  day: number;
  fb_budget: number;
  ig_budget: number;
  fb_leads: number;
  ig_leads: number;
  fb_clicks: number;
  ig_clicks: number;
  fb_impr: number;
  ig_impr: number;
  total_budget: number;
  total_leads: number;
};

const now = new Date();
const DEFAULT_MONTH = MONTH_KEYS[now.getMonth()];
const DEFAULT_YEAR = now.getFullYear();

export default function KampaniyalarPage() {
  const [month, setMonth] = useState<MonthKey>(DEFAULT_MONTH);
  const [year, setYear] = useState<number>(DEFAULT_YEAR);

  const q = useQuery({
    queryKey: ["meta/insights", month, year],
    queryFn: () => getMetaInsights(month, year),
  });

  const qCamp = useQuery({
    queryKey: ["meta/campaigns", month, year],
    queryFn: () => getMetaCampaigns(month, year),
  });

  const [activePreset, setActivePreset] = useLocalStorage<string | null>(
    "kampaniyalar.preset",
    "all",
  );
  const [search, setSearch] = useState("");
  const [values, setValues] = useLocalStorage<FilterValues>(
    "kampaniyalar.filter",
    {},
  );

  const platform: "facebook" | "instagram" | null =
    activePreset === "facebook" || activePreset === "instagram"
      ? activePreset
      : null;

  // Build objective options from data so the popover stays in sync.
  const objectiveOptions = useMemo(() => {
    const set = new Set<string>();
    (qCamp.data?.rows ?? []).forEach((r) => {
      if (r.objective) set.add(r.objective);
    });
    return [...set].sort();
  }, [qCamp.data]);

  const filterFields: FilterField[] = useMemo(
    () => [
      {
        key: "objective",
        label: "Maqsad",
        type: "select",
        options: objectiveOptions.map((v) => ({ value: v, label: v })),
      },
      { key: "min_spend", label: "Min sarf ($)", type: "amount" },
      { key: "min_leads", label: "Min lid", type: "amount" },
    ],
    [objectiveOptions],
  );

  const campaignRows = useMemo<CampaignAdRow[]>(() => {
    const all = qCamp.data?.rows ?? [];
    const q = search.trim().toLowerCase();
    const minSpend = values.min_spend ? Number(values.min_spend) : 0;
    const minLeads = values.min_leads ? Number(values.min_leads) : 0;
    const objective = values.objective || "";
    return all.filter((r) => {
      if (platform && r.platform !== platform) return false;
      if (objective && r.objective !== objective) return false;
      if (minSpend && r.spend < minSpend) return false;
      if (minLeads && r.leads < minLeads) return false;
      if (q) {
        const hay =
          `${r.campaign_name} ${r.adset_name} ${r.ad_name}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [qCamp.data, platform, search, values]);

  // Daily series — apply platform filter only (daily data has no campaign attribution).
  const rows = useMemo<DayRow[]>(() => {
    const m = q.data?.data;
    if (!m) return [];
    const t = m.target;
    const i = m.instagram;
    const days = Math.max(t.budget.length, i.budget.length);
    return Array.from({ length: days }, (_, idx) => {
      const fb_budget = platform === "instagram" ? 0 : (t.budget[idx] ?? 0);
      const ig_budget = platform === "facebook" ? 0 : (i.budget[idx] ?? 0);
      const fb_leads = platform === "instagram" ? 0 : (t.leads[idx] ?? 0);
      const ig_leads = platform === "facebook" ? 0 : (i.leads[idx] ?? 0);
      const fb_clicks = platform === "instagram" ? 0 : (t.clicks[idx] ?? 0);
      const ig_clicks = platform === "facebook" ? 0 : (i.clicks[idx] ?? 0);
      const fb_impr = platform === "instagram" ? 0 : (t.impressions[idx] ?? 0);
      const ig_impr = platform === "facebook" ? 0 : (i.impressions[idx] ?? 0);
      return {
        day: idx + 1,
        fb_budget,
        ig_budget,
        fb_leads,
        ig_leads,
        fb_clicks,
        ig_clicks,
        fb_impr,
        ig_impr,
        total_budget: fb_budget + ig_budget,
        total_leads: fb_leads + ig_leads,
      };
    });
  }, [q.data, platform]);

  // Metric cards — derive from filtered campaign rows so they match the table.
  const totals = useMemo(
    () =>
      campaignRows.reduce(
        (acc, r) => ({
          spend: acc.spend + r.spend,
          leads: acc.leads + r.leads,
          clicks: acc.clicks + r.clicks,
          impr: acc.impr + r.impressions,
        }),
        { spend: 0, leads: 0, clicks: 0, impr: 0 },
      ),
    [campaignRows],
  );

  const cpl = totals.leads ? totals.spend / totals.leads : 0;
  const ctr = totals.impr ? (totals.clicks / totals.impr) * 100 : 0;

  const trendData = rows.map((r) => ({
    name: String(r.day),
    "FB sarf": Math.round(r.fb_budget * 100) / 100,
    "IG sarf": Math.round(r.ig_budget * 100) / 100,
    "FB lid": r.fb_leads,
    "IG lid": r.ig_leads,
  }));
  const stackedData = rows.map((r) => ({
    name: String(r.day),
    Facebook: Math.round(r.fb_budget * 100) / 100,
    Instagram: Math.round(r.ig_budget * 100) / 100,
  }));

  const PlatformBadge = ({ p }: { p: "facebook" | "instagram" }) => (
    <span
      className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold ${p === "instagram" ? "bg-purple/15 text-purple" : "bg-blue/15 text-blue"}`}
    >
      {p === "instagram" ? "IG" : "FB"}
    </span>
  );

  const campaignColumns = useMemo<ColumnDef<CampaignAdRow, unknown>[]>(
    () => [
      {
        header: "Platforma",
        accessorKey: "platform",
        cell: (c) => (
          <PlatformBadge p={c.getValue<"facebook" | "instagram">()} />
        ),
      },
      {
        header: "Kampaniya",
        accessorKey: "campaign_name",
        cell: (c) => (
          <span className="text-[12px]">{c.getValue<string>() || "—"}</span>
        ),
      },
      {
        header: "Ad to'plam",
        accessorKey: "adset_name",
        cell: (c) => (
          <span className="text-[12px] text-text2">
            {c.getValue<string>() || "—"}
          </span>
        ),
      },
      {
        header: "Reklama",
        accessorKey: "ad_name",
        cell: (c) => (
          <span className="text-[12px] text-text2">
            {c.getValue<string>() || "—"}
          </span>
        ),
      },
      {
        header: "Sarf ($)",
        accessorKey: "spend",
        cell: (c) => (
          <span className="mono font-semibold">
            {fmtMoney(c.getValue<number>())}
          </span>
        ),
      },
      {
        header: "Impressiya",
        accessorKey: "impressions",
        cell: (c) => (
          <span className="mono">{fmtNum(c.getValue<number>())}</span>
        ),
      },
      {
        header: "Qamrov",
        accessorKey: "reach",
        cell: (c) => (
          <span className="mono">{fmtNum(c.getValue<number>())}</span>
        ),
      },
      {
        header: "Chastota",
        accessorKey: "frequency",
        cell: (c) => (
          <span className="mono text-text2">
            {c.getValue<number>().toFixed(2)}
          </span>
        ),
      },
      {
        header: "Klik",
        accessorKey: "clicks",
        cell: (c) => (
          <span className="mono">{fmtNum(c.getValue<number>())}</span>
        ),
      },
      {
        header: "Noyob klik",
        accessorKey: "unique_clicks",
        cell: (c) => (
          <span className="mono text-text2">
            {fmtNum(c.getValue<number>())}
          </span>
        ),
      },
      {
        header: "Havola kliki",
        accessorKey: "link_clicks",
        cell: (c) => (
          <span className="mono">{fmtNum(c.getValue<number>())}</span>
        ),
      },
      {
        header: "Landing sahifa",
        accessorKey: "landing_page_views",
        cell: (c) => (
          <span className="mono">{fmtNum(c.getValue<number>())}</span>
        ),
      },
      {
        header: "Lead",
        accessorKey: "leads",
        cell: (c) => (
          <span className="mono font-semibold text-green">
            {fmtNum(c.getValue<number>())}
          </span>
        ),
      },
      {
        header: "CPM ($)",
        accessorKey: "cpm",
        cell: (c) => (
          <span className="mono text-text2">
            {fmtMoney(c.getValue<number>())}
          </span>
        ),
      },
      {
        header: "CPC ($)",
        accessorKey: "cpc",
        cell: (c) => (
          <span className="mono">{fmtMoney(c.getValue<number>())}</span>
        ),
      },
      {
        header: "CPL ($)",
        accessorKey: "cpl",
        cell: (c) => (
          <span className="mono">{fmtMoney(c.getValue<number>() ?? 0)}</span>
        ),
      },
      {
        header: "CTR %",
        accessorKey: "ctr",
        cell: (c) => (
          <span className="mono">{c.getValue<number>().toFixed(2)}%</span>
        ),
      },
      {
        header: "Hook %",
        accessorKey: "hook_rate",
        cell: (c) => (
          <span className="mono text-text2">
            {c.getValue<number>().toFixed(2)}%
          </span>
        ),
      },
      {
        header: "Visit %",
        accessorKey: "visit_rate",
        cell: (c) => (
          <span className="mono text-text2">
            {c.getValue<number>().toFixed(2)}%
          </span>
        ),
      },
      {
        header: "Lead %",
        accessorKey: "lid_rate",
        cell: (c) => (
          <span className="mono">{c.getValue<number>().toFixed(2)}%</span>
        ),
      },
    ],
    [],
  );

  const yearOptions = [DEFAULT_YEAR, DEFAULT_YEAR - 1, DEFAULT_YEAR - 2];

  return (
    <>
      <Topbar
        title="Kampaniyalar"
        sub={`Meta Ads (FB + Instagram) — ${MONTH_LABELS[month]} ${year}`}
      />
      <div className="flex-1 overflow-y-auto px-[22px] py-[18px] bg-bg">
        {/* Unified filter row — search/preset/popover + period selectors */}
        <div className="bg-bg2 border border-border rounded-lg shadow p-3 mb-4 flex items-center gap-3 flex-wrap">
          <FilterBar
            presets={PLATFORM_PRESETS}
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
              /* client-side filtering */
            }}
            activeChipLabel={
              activePreset && activePreset !== "all"
                ? PLATFORM_PRESETS.find((p) => p.id === activePreset)?.label
                : undefined
            }
            onActiveChipClear={() => setActivePreset("all")}
            storageKey="marketing.kampaniyalar"
            onApplySavedFilter={(v) => setValues(v as typeof values)}
          />
          <div className="flex items-center gap-2 ml-auto">
            <select
              className="px-2.5 py-1.5 rounded border border-border2 bg-bg2 text-[12px] text-text shadow-xs"
              value={month}
              onChange={(e) => setMonth(e.target.value as MonthKey)}
            >
              {MONTH_KEYS.map((m) => (
                <option key={m} value={m}>
                  {MONTH_LABELS[m]}
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
            <Button
              onClick={() => {
                q.refetch();
                qCamp.refetch();
              }}
            >
              <RefreshCw className="w-3.5 h-3.5" /> Yangilash
            </Button>
          </div>
        </div>

        {qCamp.isLoading && !qCamp.data ? (
          <MetricRowSkeleton count={6} />
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 mb-4">
            <MetricCard
              label="Jami sarf"
              value={fmtMoney(totals.spend)}
              tone="orange"
            />
            <MetricCard
              label="Jami lidlar"
              value={fmtNum(totals.leads)}
              tone="green"
            />
            <MetricCard
              label="CPL"
              value={totals.leads ? fmtMoney(cpl) : "—"}
              tone="amber"
              hint="sarf / 1 lid"
            />
            <MetricCard
              label="CTR"
              value={totals.impr ? `${ctr.toFixed(2)}%` : "—"}
              tone="blue"
              hint="klik/impr"
            />
            <MetricCard
              label="Klikllar"
              value={fmtNum(totals.clicks)}
              hint="jami klik"
            />
            <MetricCard
              label="Impressiyalar"
              value={fmtNum(totals.impr)}
              hint="ko'rishlar"
            />
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mb-4">
          {q.isLoading && !q.data ? (
            <>
              <ChartCardSkeleton height={260} />
              <ChartCardSkeleton height={260} />
            </>
          ) : (
            <>
              <CardChart title="Kunlik sarf" hint="FB + IG stack" height={260}>
                <StackedBar
                  data={stackedData as never}
                  series={[
                    { dataKey: "Facebook", fill: "var(--blue)" },
                    { dataKey: "Instagram", fill: "var(--purple)" },
                  ]}
                />
              </CardChart>
              <CardChart
                title="Sarf vs Lidlar (kunlik)"
                hint="line"
                height={260}
              >
                <MultiLine
                  data={trendData as never}
                  lines={[
                    { dataKey: "FB sarf", stroke: "var(--blue)" },
                    { dataKey: "IG sarf", stroke: "var(--purple)" },
                    { dataKey: "FB lid", stroke: "var(--green)" },
                    { dataKey: "IG lid", stroke: "var(--amber)" },
                  ]}
                />
              </CardChart>
            </>
          )}
        </div>

        <div className="mb-2 flex items-center gap-2">
          <span className="text-[12.5px] font-semibold">
            Kampaniyalar bo'yicha (Meta Ads)
          </span>
          <span className="text-[11px] text-text3">
            · {campaignRows.length} / {qCamp.data?.rows.length ?? 0} ta qator
          </span>
        </div>
        <DataTable<CampaignAdRow>
          columns={campaignColumns}
          data={campaignRows}
          pageSize={20}
          maxBodyHeight={520}
          loading={qCamp.isLoading}
          storageKey="kampaniyalar.cols"
          defaultHidden={[
            "unique_clicks",
            "reach",
            "frequency",
            "cpm",
            "hook_rate",
            "visit_rate",
          ]}
        />

        {(q.error || qCamp.error) && (
          <div className="mt-4 p-3 bg-red-bg border border-red-bd text-red rounded-lg text-[12.5px]">
            Xatolik: {((q.error || qCamp.error) as Error).message}
          </div>
        )}
      </div>
    </>
  );
}

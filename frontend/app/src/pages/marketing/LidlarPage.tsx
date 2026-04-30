import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { Topbar } from '@/components/Topbar';
import { MetricCard } from '@/components/MetricCard';
import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { FilterBar } from '@/components/FilterBar';
import type { FilterField, FilterPreset, FilterValues } from '@/components/FilterBar';
import { DataTable } from '@/components/DataTable';
import { FunnelBars } from '@/components/charts';
import { MetricRowSkeleton, FunnelSkeleton } from '@/components/Skeleton';
import { getLeadsStats, getLeadQuality } from '@/lib/api/leads';
import type { StatsLeadsByUser, LeadFilter } from '@/lib/api/leads';
import { fmtNum, fmtMoney, fmtPct } from '@/lib/utils';
import { useLocalStorage } from '@/hooks/useLocalStorage';

const PRESETS: FilterPreset[] = [
  { id: 'all',       label: 'Barcha leadlar', pinned: true },
  { id: 'jarayonda', label: 'Jarayondagi leadlar', pinned: true },
  { id: 'yopilgan',  label: 'Yopilgan leadlar' },
  { id: 'sifatsiz',  label: 'Sifatsiz leadlar' },
];

const todayISO = () => new Date().toISOString().slice(0, 10);
const oneYearAgoISO = () => {
  const d = new Date(); d.setFullYear(d.getFullYear() - 1);
  return d.toISOString().slice(0, 10);
};

export default function LidlarPage() {
  const [activePreset, setActivePreset] = useLocalStorage<string | null>('lidlar.preset', 'all');
  const [search, setSearch] = useState('');
  const [values, setValues] = useLocalStorage<FilterValues>('lidlar.filter', {
    start_date: oneYearAgoISO(),
    end_date: todayISO(),
  });

  // Apply preset → derive status filter
  const statusByPreset: Record<string, string | undefined> = {
    all: undefined,
    jarayonda: 'IN_PROCESS',
    yopilgan: 'CONVERTED',
    sifatsiz: 'UC_F8K4GI',
  };

  const apiFilter: LeadFilter = useMemo(() => ({
    start_date: values.start_date,
    end_date: values.end_date,
    assigned_by: values.assigned_by ? Number(values.assigned_by) : undefined,
    status_id: activePreset ? statusByPreset[activePreset] : undefined,
    source_id: values.source_id,
    utm_source: values.utm_source,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [values, activePreset]);

  const statsQ = useQuery({
    queryKey: ['stats/leads', apiFilter],
    queryFn: () => getLeadsStats(apiFilter),
  });

  const qualityQ = useQuery({
    queryKey: ['stats/lead-quality', apiFilter],
    queryFn: () => getLeadQuality(apiFilter),
  });

  // Build dynamic filter fields once stats are available
  const fields: FilterField[] = useMemo(() => {
    const users = statsQ.data?.users ?? [];
    const sources = statsQ.data?.sources ?? [];
    const utmSources = statsQ.data?.utm_sources ?? [];
    return [
      { key: 'start_date', label: 'Sanadan',     type: 'date' },
      { key: 'end_date',   label: 'Sanagacha',   type: 'date' },
      { key: 'assigned_by', label: 'Mas\'ul',    type: 'select', options: users.map(u => ({ value: u.id, label: u.name || `User ${u.id}` })) },
      { key: 'source_id',  label: 'Manba',       type: 'select', options: sources.map(s => ({ value: s.id, label: s.label })) },
      { key: 'utm_source', label: 'UTM source',  type: 'select', options: utmSources.map(v => ({ value: v, label: v })) },
    ];
  }, [statsQ.data]);

  // Filter by user "name" search client-side on byUser table
  const byUserFiltered = useMemo(() => {
    const list = statsQ.data?.by_user ?? [];
    const s = search.trim().toLowerCase();
    if (!s) return list;
    return list.filter(u => u.name.toLowerCase().includes(s));
  }, [statsQ.data, search]);

  const userColumns = useMemo<ColumnDef<StatsLeadsByUser, unknown>[]>(() => [
    {
      header: 'Mas\'ul',
      accessorKey: 'name',
      cell: (c) => {
        const name = c.getValue<string>() || `User ${c.row.original.id}`;
        const initials = name.split(' ').filter(Boolean).slice(0, 2).map(s => s[0]).join('').toUpperCase() || '?';
        return (
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-full bg-blue-bg text-blue text-[10px] font-bold flex items-center justify-center border-2 border-bg2 shadow-xs">{initials}</div>
            <span className="font-medium">{name}</span>
          </div>
        );
      },
    },
    {
      header: 'Lidlar',
      accessorKey: 'total',
      cell: (c) => <span className="mono">{fmtNum(c.getValue<number>())}</span>,
    },
    {
      header: 'Daromad',
      accessorKey: 'revenue',
      cell: (c) => <span className="mono text-green font-semibold">{fmtMoney(c.getValue<number>())}</span>,
    },
    {
      header: 'Konversiya',
      accessorFn: (row) => {
        const won = (row.by_status['CONVERTED'] ?? 0) + (row.by_status['WON'] ?? 0);
        return row.total ? (won / row.total) * 100 : 0;
      },
      cell: (c) => {
        const v = c.getValue<number>();
        const tone = v > 5 ? 'green' : v > 1 ? 'amber' : 'gray';
        return <Badge tone={tone}>{fmtPct(v, 2)}</Badge>;
      },
    },
  ], []);

  const total = statsQ.data?.total ?? 0;
  const revenue = statsQ.data?.total_revenue ?? 0;
  const converted = statsQ.data?.converted ?? 0;
  const jarayon = statsQ.data?.jarayon_total ?? 0;
  const conv = statsQ.data?.conversion_rate ?? 0;

  const funnelSteps = useMemo(() => {
    const byStatus = statsQ.data?.by_status ?? {};
    const statusNames = statsQ.data?.status_names ?? {};
    const sifatsiz = byStatus['UC_F8K4GI'] ?? 0;
    const bekor    = byStatus['UC_NAZK5J'] ?? 0;
    const junk     = byStatus['JUNK']      ?? 0;
    return [
      { label: 'Jami lidlar', value: total,     color: 'var(--blue)' },
      { label: 'Jarayonda',   value: jarayon,   color: 'var(--amber)' },
      { label: statusNames['UC_F8K4GI'] || 'Sifatsiz', value: sifatsiz, color: 'var(--orange)' },
      { label: statusNames['UC_NAZK5J'] || 'Bekor',    value: bekor,    color: 'var(--red)' },
      { label: 'Sandiq (junk)', value: junk,    color: 'var(--text3)' },
      { label: 'Konversiya',    value: converted, color: 'var(--green)' },
    ];
  }, [statsQ.data, total, jarayon, converted]);

  const topStatuses = useMemo(() => {
    const byStatus = statsQ.data?.by_status ?? {};
    const statusNames = statsQ.data?.status_names ?? {};
    return Object.entries(byStatus)
      .map(([k, v]) => ({ label: statusNames[k] || k, val: v }))
      .sort((a, b) => b.val - a.val)
      .slice(0, 8);
  }, [statsQ.data]);

  return (
    <>
      <Topbar
        title="Lidlar analitika"
        sub={`Davr: ${values.start_date ?? '—'} → ${values.end_date ?? '—'}`}
        actions={
          <>
            <Button onClick={() => statsQ.refetch()}>Yangilash</Button>
          </>
        }
      />
      <div className="flex-1 overflow-y-auto px-[22px] py-[18px] bg-bg">
        {/* Filter row */}
        <div className="bg-bg2 border border-border rounded-lg shadow p-3 mb-4 flex items-center gap-3">
          <FilterBar
            presets={PRESETS}
            activePreset={activePreset}
            onPresetChange={(id) => setActivePreset(id)}
            searchValue={search}
            onSearchChange={setSearch}
            fields={fields}
            values={values}
            onChange={(k, v) => setValues((s) => ({ ...s, [k]: v }))}
            onClear={() => { setSearch(''); setValues({ start_date: oneYearAgoISO(), end_date: todayISO() }); setActivePreset('all'); }}
            onApply={() => statsQ.refetch()}
            activeChipLabel={PRESETS.find(p => p.id === activePreset)?.label}
            onActiveChipClear={() => setActivePreset('all')}
          />
        </div>

        {/* Metrics */}
        {statsQ.isLoading && !statsQ.data ? <MetricRowSkeleton count={5} /> : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5 mb-4">
            <MetricCard label="Jami lidlar" value={fmtNum(total)} tone="blue" />
            <MetricCard label="Jarayonda" value={fmtNum(jarayon)} tone="amber" />
            <MetricCard label="Konversiya" value={fmtNum(converted)} tone="green" />
            <MetricCard label="Konv. foiz" value={fmtPct(conv, 2)} />
            <MetricCard label="Daromad" value={fmtMoney(revenue)} tone="green" />
          </div>
        )}

        {/* Funnel + Status breakdown */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mb-4">
          <div className="bg-bg2 border border-border rounded-lg shadow overflow-hidden">
            <div className="px-4 py-3 border-b border-border">
              <span className="text-[13px] font-semibold">Voronka</span>
              <span className="text-[11px] text-text3 ml-2">jami → jarayon → konversiya</span>
            </div>
            <div className="p-4">
              {statsQ.isLoading && !statsQ.data ? <FunnelSkeleton rows={6} /> : <FunnelBars steps={funnelSteps} />}
            </div>
          </div>
          <div className="bg-bg2 border border-border rounded-lg shadow overflow-hidden">
            <div className="px-4 py-3 border-b border-border">
              <span className="text-[13px] font-semibold">Status bo'yicha (top 8)</span>
              <span className="text-[11px] text-text3 ml-2">{statsQ.isLoading && !statsQ.data ? 'yuklanmoqda…' : `${topStatuses.length} ta`}</span>
            </div>
            <div className="p-4">
              {statsQ.isLoading && !statsQ.data ? (
                <div className="space-y-2">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className="flex items-center gap-3 py-1.5">
                      <div className="skeleton h-3 flex-1" style={{ maxWidth: 140 + (i * 12) }} />
                      <div className="skeleton h-1.5 w-24" />
                      <div className="skeleton h-3 w-10" />
                    </div>
                  ))}
                </div>
              ) : topStatuses.length === 0 ? (
                <div className="text-text3 text-[12px] text-center py-6">Bo'sh</div>
              ) : topStatuses.map((it, i) => {
                const max = Math.max(1, ...topStatuses.map(s => s.val));
                return (
                  <div key={i} className="flex items-center gap-3 py-1.5">
                    <span className="text-[12px] text-text2 flex-1 truncate">{it.label}</span>
                    <div className="w-24 h-1.5 bg-bg4 rounded overflow-hidden">
                      <div className="h-full rounded bg-blue" style={{ width: `${(it.val / max) * 100}%` }} />
                    </div>
                    <span className="mono text-[12px] font-semibold w-10 text-right">{fmtNum(it.val)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Mas'ullar kesimida */}
        <SectionHead title="Mas'ullar kesimida" hint={`${byUserFiltered.length} ta xodim`} />
        <DataTable<StatsLeadsByUser>
          columns={userColumns}
          data={byUserFiltered}
          pageSize={10}
          loading={statsQ.isLoading}
        />

        {/* Quality breakdowns */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4">
          <QualityList title="Sifatsiz sabablari" items={qualityQ.data?.sifatsiz ?? []} loading={qualityQ.isLoading} />
          <QualityList title="Bekor sabablari"   items={qualityQ.data?.bekor    ?? []} loading={qualityQ.isLoading} />
          <QualityList title="Sandiq (junk)"     items={qualityQ.data?.sandiq   ?? []} loading={qualityQ.isLoading} />
          <QualityList title="UTM source"        items={qualityQ.data?.utm      ?? []} loading={qualityQ.isLoading} />
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

function SectionHead({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex items-center gap-2 mb-2 mt-1">
      <span className="text-[12.5px] font-semibold text-text">{title}</span>
      {hint && <span className="text-[11px] text-text3">· {hint}</span>}
    </div>
  );
}

function QualityList({ title, items, loading }: { title: string; items: { label: string; val: number }[]; loading: boolean }) {
  const max = Math.max(1, ...items.map(i => i.val));
  return (
    <div className="bg-bg2 border border-border rounded-lg shadow overflow-hidden">
      <div className="px-4 py-3 border-b border-border">
        <span className="text-[13px] font-semibold">{title}</span>
        <span className="text-[11px] text-text3 ml-2">{loading ? 'yuklanmoqda…' : `${items.length} ta`}</span>
      </div>
      <div className="p-3">
        {loading && items.length === 0 ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 py-1.5">
                <div className="skeleton h-3 flex-1" style={{ maxWidth: 100 + (i * 18) }} />
                <div className="skeleton h-1.5 w-24" />
                <div className="skeleton h-3 w-10" />
              </div>
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="text-text3 text-[12px] text-center py-6">Bo'sh</div>
        ) : items.map((it, i) => (
          <div key={i} className="flex items-center gap-3 py-1.5">
            <span className="text-[12px] text-text2 flex-1 truncate">{it.label}</span>
            <div className="w-24 h-1.5 bg-bg4 rounded overflow-hidden">
              <div className="h-full rounded bg-blue" style={{ width: `${(it.val / max) * 100}%` }} />
            </div>
            <span className="mono text-[12px] font-semibold w-10 text-right">{it.val}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

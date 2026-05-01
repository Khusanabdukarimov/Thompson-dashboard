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
import { CardChart, SimpleBar, FunnelBars } from '@/components/charts';
import { MetricRowSkeleton, FunnelSkeleton, ChartCardSkeleton } from '@/components/Skeleton';
import { getDealsStats, getDealsBySource } from '@/lib/api/deals';
import type { StatsDealsByUser, DealsBySource, DealsFilter } from '@/lib/api/deals';
import { fmtNum, fmtMoney, fmtPct } from '@/lib/utils';

const PRESETS: FilterPreset[] = [
  { id: 'all',  label: 'Barcha sdelkalar', pinned: true },
  { id: 'won',  label: 'Yopildi (won)', pinned: true },
  { id: 'lost', label: 'Yo\'qotildi (lost)' },
];

const todayISO = () => new Date().toISOString().slice(0, 10);
const oneYearAgoISO = () => {
  const d = new Date(); d.setFullYear(d.getFullYear() - 1);
  return d.toISOString().slice(0, 10);
};

export default function SdelkalarPage() {
  const [activePreset, setActivePreset] = useState<string | null>('all');
  const [search, setSearch] = useState('');
  const [values, setValues] = useState<FilterValues>({
    start_date: oneYearAgoISO(),
    end_date: todayISO(),
  });

  const apiFilter: DealsFilter = useMemo(() => ({
    start_date: values.start_date,
    end_date: values.end_date,
    assigned_by: values.assigned_by ? Number(values.assigned_by) : undefined,
    stage_id: values.stage_id,
    source_id: values.source_id,
  }), [values]);

  const statsQ = useQuery({
    queryKey: ['stats/deals', apiFilter],
    queryFn: () => getDealsStats(apiFilter),
  });

  const sourceQ = useQuery({
    queryKey: ['stats/deals/by-source', apiFilter],
    queryFn: () => getDealsBySource(apiFilter),
  });

  const fields: FilterField[] = useMemo(() => {
    const users = statsQ.data?.users ?? [];
    const stages = statsQ.data?.stage_names ?? {};
    const sources = sourceQ.data?.source_names ?? {};
    return [
      { key: 'start_date', label: 'Sanadan',   type: 'date' },
      { key: 'end_date',   label: 'Sanagacha', type: 'date' },
      { key: 'assigned_by', label: 'Mas\'ul',  type: 'select', options: users.map(u => ({ value: u.id, label: u.name || `User ${u.id}` })) },
      { key: 'stage_id',   label: 'Bosqich',   type: 'select', options: Object.entries(stages).map(([v, l]) => ({ value: v, label: l })) },
      { key: 'source_id',  label: 'Manba',     type: 'select', options: Object.entries(sources).map(([v, l]) => ({ value: v, label: l })) },
    ];
  }, [statsQ.data, sourceQ.data]);

  const byUserFiltered = useMemo(() => {
    let list = statsQ.data?.by_user ?? [];
    if (activePreset === 'won') {
      list = list.filter(u => Object.entries(u.by_stage).some(([k, v]) => k.toUpperCase().includes('WON') && v > 0));
    } else if (activePreset === 'lost') {
      list = list.filter(u => Object.entries(u.by_stage).some(([k, v]) => k.toUpperCase().includes('LOSE') && v > 0));
    }
    const s = search.trim().toLowerCase();
    return s ? list.filter(u => u.name.toLowerCase().includes(s)) : list;
  }, [statsQ.data, search, activePreset]);

  const userColumns = useMemo<ColumnDef<StatsDealsByUser, unknown>[]>(() => [
    {
      header: 'Mas\'ul', accessorKey: 'name',
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
    { header: 'Sdelkalar', accessorKey: 'total', cell: (c) => <span className="mono">{fmtNum(c.getValue<number>())}</span> },
    {
      header: 'Won', accessorFn: (r) => Object.entries(r.by_stage).reduce((acc, [k, v]) => acc + (k.toUpperCase().includes('WON') ? v : 0), 0),
      cell: (c) => <Badge tone="green">{fmtNum(c.getValue<number>())}</Badge>,
    },
    {
      header: 'Lost', accessorFn: (r) => Object.entries(r.by_stage).reduce((acc, [k, v]) => acc + (k.toUpperCase().includes('LOSE') ? v : 0), 0),
      cell: (c) => <Badge tone="red">{fmtNum(c.getValue<number>())}</Badge>,
    },
    {
      header: 'Won daromad', accessorKey: 'won_revenue',
      cell: (c) => <span className="mono text-green font-semibold">{fmtMoney(c.getValue<number>())}</span>,
    },
    {
      header: 'Konversiya', accessorFn: (r) => {
        const won = Object.entries(r.by_stage).reduce((acc, [k, v]) => acc + (k.toUpperCase().includes('WON') ? v : 0), 0);
        return r.total ? (won / r.total) * 100 : 0;
      },
      cell: (c) => {
        const v = c.getValue<number>();
        const tone = v >= 30 ? 'green' : v >= 10 ? 'amber' : 'gray';
        return <Badge tone={tone}>{fmtPct(v, 1)}</Badge>;
      },
    },
  ], []);

  const sourceColumns = useMemo<ColumnDef<DealsBySource, unknown>[]>(() => [
    { header: 'Manba', accessorKey: 'label', cell: (c) => <span className="font-medium">{c.getValue<string>()}</span> },
    { header: 'Jarayonda', accessorKey: 'ishlaydi', cell: (c) => <span className="mono">{fmtNum(c.getValue<number>())}</span> },
    { header: 'Won', accessorKey: 'success', cell: (c) => <Badge tone="green">{fmtNum(c.getValue<number>())}</Badge> },
    { header: 'Lost', accessorKey: 'provodka', cell: (c) => <Badge tone="red">{fmtNum(c.getValue<number>())}</Badge> },
    { header: 'Daromad', accessorKey: 'revenue', cell: (c) => <span className="mono text-green font-semibold">{fmtMoney(c.getValue<number>())}</span> },
    {
      header: 'Konversiya', accessorKey: 'conversion',
      cell: (c) => {
        const v = c.getValue<number>();
        const tone = v >= 30 ? 'green' : v >= 10 ? 'amber' : 'gray';
        return <Badge tone={tone}>{fmtPct(v, 1)}</Badge>;
      },
    },
  ], []);

  const total = statsQ.data?.total ?? 0;
  const won = statsQ.data?.won_count ?? 0;
  const lost = statsQ.data?.lost_count ?? 0;
  const wonRev = statsQ.data?.total_won_revenue ?? 0;
  const conv = statsQ.data?.conversion_rate ?? 0;

  const stageChartData = useMemo(() => {
    const byStage = statsQ.data?.by_stage ?? {};
    const stageNames = statsQ.data?.stage_names ?? {};
    return Object.entries(byStage)
      .map(([k, v]) => ({ name: stageNames[k] ?? k, value: v }))
      .sort((a, b) => Number(b.value) - Number(a.value))
      .slice(0, 8);
  }, [statsQ.data]);

  const funnelSteps = useMemo(() => {
    const byStage = statsQ.data?.by_stage ?? {};
    const inProcess = Object.entries(byStage).reduce((a, [k, v]) => a + (k.toUpperCase().includes('WON') || k.toUpperCase().includes('LOSE') ? 0 : v), 0);
    return [
      { label: 'Jami sdelkalar', value: total, color: 'var(--blue)' },
      { label: 'Jarayonda',       value: inProcess, color: 'var(--amber)' },
      { label: 'Won',             value: won,  color: 'var(--green)' },
      { label: 'Lost',            value: lost, color: 'var(--red)' },
    ];
  }, [statsQ.data, total, won, lost]);

  return (
    <>
      <Topbar
        title="Sdelkalar"
        sub={`Davr: ${values.start_date ?? '—'} → ${values.end_date ?? '—'}`}
        actions={<Button onClick={() => { statsQ.refetch(); sourceQ.refetch(); }}>Yangilash</Button>}
      />
      <div className="flex-1 overflow-y-auto px-[22px] py-[18px] bg-bg">
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
            onClear={() => { setSearch(''); setValues({ start_date: oneYearAgoISO(), end_date: todayISO() }); setActivePreset('all'); }}
            onApply={() => { statsQ.refetch(); sourceQ.refetch(); }}
            activeChipLabel={PRESETS.find(p => p.id === activePreset)?.label}
            onActiveChipClear={() => setActivePreset('all')}
          />
        </div>

        {statsQ.isLoading && !statsQ.data ? <MetricRowSkeleton count={5} /> : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5 mb-4">
            <MetricCard label="Jami sdelkalar" value={fmtNum(total)} tone="blue" />
            <MetricCard label="Yopildi (won)" value={fmtNum(won)} tone="green" />
            <MetricCard label="Yo'qotildi" value={fmtNum(lost)} tone="red" />
            <MetricCard label="Won daromad" value={fmtMoney(wonRev)} tone="green" />
            <MetricCard label="Konversiya" value={fmtPct(conv, 1)} tone="amber" />
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mb-4">
          {statsQ.isLoading && !statsQ.data ? <ChartCardSkeleton height={260} /> : (
            <CardChart title="Bosqichlar bo'yicha" hint={`${stageChartData.length} ta bosqich`} height={260}>
              <SimpleBar data={stageChartData as never} dataKey="value" />
            </CardChart>
          )}
          <div className="bg-bg2 border border-border rounded-lg shadow overflow-hidden">
            <div className="px-4 py-3 border-b border-border">
              <span className="text-[13px] font-semibold">Voronka</span>
              <span className="text-[11px] text-text3 ml-2">jami → won/lost</span>
            </div>
            <div className="p-4">
              {statsQ.isLoading && !statsQ.data ? <FunnelSkeleton rows={4} /> : <FunnelBars steps={funnelSteps} />}
            </div>
          </div>
        </div>

        <SectionHead title="Mas'ullar kesimida" hint={`${byUserFiltered.length} ta xodim`} />
        <DataTable<StatsDealsByUser>
          columns={userColumns}
          data={byUserFiltered}
          pageSize={10}
          loading={statsQ.isLoading}
        />

        <div className="mt-4">
          <SectionHead title="Manbalar bo'yicha" hint={`${sourceQ.data?.sources.length ?? 0} ta manba`} />
          <DataTable<DealsBySource>
            columns={sourceColumns}
            data={sourceQ.data?.sources ?? []}
            pageSize={10}
            loading={sourceQ.isLoading}
          />
        </div>

        {(statsQ.error || sourceQ.error) && (
          <div className="mt-4 p-3 bg-red-bg border border-red-bd text-red rounded-lg text-[12.5px]">
            Xatolik: {((statsQ.error ?? sourceQ.error) as Error).message}
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

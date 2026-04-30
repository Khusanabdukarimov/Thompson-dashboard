import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { Topbar } from '@/components/Topbar';
import { MetricCard } from '@/components/MetricCard';
import { Button } from '@/components/Button';
import { CardChart, MultiLine, StackedBar } from '@/components/charts';
import { DataTable } from '@/components/DataTable';
import { MetricRowSkeleton, ChartCardSkeleton } from '@/components/Skeleton';
import { getMetaInsights, MONTH_KEYS, MONTH_LABELS } from '@/lib/api/meta';
import type { MonthKey } from '@/lib/api/meta';
import { fmtNum, fmtMoney } from '@/lib/utils';

type DayRow = {
  day: number;
  fb_budget: number; ig_budget: number;
  fb_leads: number;  ig_leads: number;
  fb_clicks: number; ig_clicks: number;
  fb_impr: number;   ig_impr: number;
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
    queryKey: ['meta/insights', month, year],
    queryFn: () => getMetaInsights(month, year),
  });

  const rows = useMemo<DayRow[]>(() => {
    const m = q.data?.data;
    if (!m) return [];
    const t = m.target;
    const i = m.instagram;
    const days = Math.max(t.budget.length, i.budget.length);
    return Array.from({ length: days }, (_, idx) => {
      const fb_budget = t.budget[idx] ?? 0;
      const ig_budget = i.budget[idx] ?? 0;
      const fb_leads = t.leads[idx] ?? 0;
      const ig_leads = i.leads[idx] ?? 0;
      return {
        day: idx + 1,
        fb_budget, ig_budget,
        fb_leads, ig_leads,
        fb_clicks: t.clicks[idx] ?? 0, ig_clicks: i.clicks[idx] ?? 0,
        fb_impr:   t.impressions[idx] ?? 0, ig_impr:   i.impressions[idx] ?? 0,
        total_budget: fb_budget + ig_budget,
        total_leads:  fb_leads + ig_leads,
      };
    });
  }, [q.data]);

  const totals = useMemo(() => rows.reduce((acc, r) => ({
    fb_budget: acc.fb_budget + r.fb_budget,
    ig_budget: acc.ig_budget + r.ig_budget,
    fb_leads:  acc.fb_leads  + r.fb_leads,
    ig_leads:  acc.ig_leads  + r.ig_leads,
    clicks:    acc.clicks    + r.fb_clicks + r.ig_clicks,
    impr:      acc.impr      + r.fb_impr + r.ig_impr,
  }), { fb_budget: 0, ig_budget: 0, fb_leads: 0, ig_leads: 0, clicks: 0, impr: 0 }), [rows]);

  const totalSpend = totals.fb_budget + totals.ig_budget;
  const totalLeads = totals.fb_leads + totals.ig_leads;
  const cpl = totalLeads ? totalSpend / totalLeads : 0;
  const ctr = totals.impr ? (totals.clicks / totals.impr) * 100 : 0;

  const trendData = rows.map(r => ({ name: String(r.day), 'FB sarf': Math.round(r.fb_budget * 100) / 100, 'IG sarf': Math.round(r.ig_budget * 100) / 100, 'FB lid': r.fb_leads, 'IG lid': r.ig_leads }));
  const stackedData = rows.map(r => ({ name: String(r.day), 'Facebook': Math.round(r.fb_budget * 100) / 100, 'Instagram': Math.round(r.ig_budget * 100) / 100 }));

  const columns = useMemo<ColumnDef<DayRow, unknown>[]>(() => [
    { header: 'Kun', accessorKey: 'day', cell: (c) => <span className="mono">{c.getValue<number>()}</span> },
    { header: 'FB sarf', accessorKey: 'fb_budget', cell: (c) => <span className="mono">{fmtMoney(c.getValue<number>())}</span> },
    { header: 'IG sarf', accessorKey: 'ig_budget', cell: (c) => <span className="mono">{fmtMoney(c.getValue<number>())}</span> },
    { header: 'Jami sarf', accessorKey: 'total_budget', cell: (c) => <span className="mono font-semibold">{fmtMoney(c.getValue<number>())}</span> },
    { header: 'FB lid', accessorKey: 'fb_leads', cell: (c) => <span className="mono">{fmtNum(c.getValue<number>())}</span> },
    { header: 'IG lid', accessorKey: 'ig_leads', cell: (c) => <span className="mono">{fmtNum(c.getValue<number>())}</span> },
    {
      header: 'Jami lid', accessorKey: 'total_leads',
      cell: (c) => <span className="mono font-semibold text-green">{fmtNum(c.getValue<number>())}</span>,
    },
    { header: 'Klik (FB+IG)', accessorFn: (r) => r.fb_clicks + r.ig_clicks, cell: (c) => <span className="mono">{fmtNum(c.getValue<number>())}</span> },
  ], []);

  const yearOptions = [DEFAULT_YEAR, DEFAULT_YEAR - 1, DEFAULT_YEAR - 2];

  return (
    <>
      <Topbar
        title="Kampaniyalar"
        sub={`Meta Ads (FB + Instagram) — ${MONTH_LABELS[month]} ${year}`}
        actions={
          <>
            <select
              className="px-2.5 py-1.5 rounded border border-border2 bg-bg2 text-[12px] text-text shadow-xs"
              value={month}
              onChange={(e) => setMonth(e.target.value as MonthKey)}
            >
              {MONTH_KEYS.map(m => <option key={m} value={m}>{MONTH_LABELS[m]}</option>)}
            </select>
            <select
              className="px-2.5 py-1.5 rounded border border-border2 bg-bg2 text-[12px] text-text shadow-xs"
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
            >
              {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
            <Button onClick={() => q.refetch()}>Yangilash</Button>
          </>
        }
      />
      <div className="flex-1 overflow-y-auto px-[22px] py-[18px] bg-bg">
        {q.isLoading && !q.data ? <MetricRowSkeleton count={5} /> : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5 mb-4">
            <MetricCard label="Jami sarf" value={fmtMoney(totalSpend)} tone="orange" />
            <MetricCard label="Jami lidlar" value={fmtNum(totalLeads)} tone="green" />
            <MetricCard label="CPL (1 lid)" value={totalLeads ? fmtMoney(cpl) : '—'} tone="amber" hint="sarf / lidlar" />
            <MetricCard label="CTR" value={totals.impr ? `${ctr.toFixed(2)}%` : '—'} tone="blue" hint="klik / impressiya" />
            <MetricCard label="Klik / Impr." value={`${fmtNum(totals.clicks)} / ${fmtNum(totals.impr)}`} hint="jami" />
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
                <StackedBar data={stackedData as never} series={[
                  { dataKey: 'Facebook',  fill: 'var(--blue)' },
                  { dataKey: 'Instagram', fill: 'var(--purple)' },
                ]} />
              </CardChart>
              <CardChart title="Sarf vs Lidlar (kunlik)" hint="line" height={260}>
                <MultiLine data={trendData as never} lines={[
                  { dataKey: 'FB sarf', stroke: 'var(--blue)' },
                  { dataKey: 'IG sarf', stroke: 'var(--purple)' },
                  { dataKey: 'FB lid',  stroke: 'var(--green)' },
                  { dataKey: 'IG lid',  stroke: 'var(--amber)' },
                ]} />
              </CardChart>
            </>
          )}
        </div>

        <div className="mb-2 flex items-center gap-2">
          <span className="text-[12.5px] font-semibold">Kunlik jadval</span>
          <span className="text-[11px] text-text3">· {rows.length} ta kun</span>
        </div>
        <DataTable<DayRow>
          columns={columns}
          data={rows}
          pageSize={31}
          maxBodyHeight={520}
          loading={q.isLoading}
        />

        {q.error && (
          <div className="mt-4 p-3 bg-red-bg border border-red-bd text-red rounded-lg text-[12.5px]">
            Xatolik: {(q.error as Error).message}
          </div>
        )}
      </div>
    </>
  );
}

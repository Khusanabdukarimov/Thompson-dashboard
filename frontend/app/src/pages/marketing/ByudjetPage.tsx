import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Topbar } from '@/components/Topbar';
import { MetricCard } from '@/components/MetricCard';
import { Button } from '@/components/Button';
import { CardChart, StackedBar, FunnelBars } from '@/components/charts';
import { MetricRowSkeleton, ChartCardSkeleton, FunnelSkeleton } from '@/components/Skeleton';
import { getMetaInsights, MONTH_KEYS, MONTH_LABELS } from '@/lib/api/meta';
import type { MonthKey } from '@/lib/api/meta';
import { fmtNum, fmtMoney, fmtPct } from '@/lib/utils';

const now = new Date();
const DEFAULT_MONTH = MONTH_KEYS[now.getMonth()];
const DEFAULT_YEAR = now.getFullYear();
const todayDay = now.getDate();

export default function ByudjetPage() {
  const [month, setMonth] = useState<MonthKey>(DEFAULT_MONTH);
  const [year, setYear] = useState<number>(DEFAULT_YEAR);
  const [target, setTarget] = useState<string>(''); // optional monthly target $

  const q = useQuery({
    queryKey: ['meta/insights', month, year],
    queryFn: () => getMetaInsights(month, year),
  });

  const m = q.data?.data;

  const totals = useMemo(() => {
    if (!m) return { fbBudget: 0, igBudget: 0, fbLeads: 0, igLeads: 0, fbToday: 0, igToday: 0, days: 0 };
    const days = m.target.budget.length;
    const sum = (a: number[]) => a.reduce((s, v) => s + (v ?? 0), 0);
    const fbBudget = sum(m.target.budget);
    const igBudget = sum(m.instagram.budget);
    const fbLeads = sum(m.target.leads);
    const igLeads = sum(m.instagram.leads);
    const isCurrent = month === DEFAULT_MONTH && year === DEFAULT_YEAR;
    const td = isCurrent ? todayDay - 1 : days - 1;
    const fbToday = m.target.budget[td] ?? 0;
    const igToday = m.instagram.budget[td] ?? 0;
    return { fbBudget, igBudget, fbLeads, igLeads, fbToday, igToday, days };
  }, [m, month, year]);

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
      'Facebook':  Math.round((m.target.budget[i] ?? 0) * 100) / 100,
      'Instagram': Math.round((m.instagram.budget[i] ?? 0) * 100) / 100,
    }));
  }, [m]);

  const platformBreakdown = [
    { label: 'Facebook',  value: Math.round(totals.fbBudget * 100) / 100, color: 'var(--blue)' },
    { label: 'Instagram', value: Math.round(totals.igBudget * 100) / 100, color: 'var(--purple)' },
  ];

  const yearOptions = [DEFAULT_YEAR, DEFAULT_YEAR - 1, DEFAULT_YEAR - 2];

  return (
    <>
      <Topbar
        title="Byudjet"
        sub={`Reklama byudjeti — ${MONTH_LABELS[month]} ${year}`}
        actions={
          <>
            <select
              className="px-2.5 py-1.5 rounded border border-border2 bg-bg2 text-[12px] text-text shadow-xs"
              value={month}
              onChange={(e) => setMonth(e.target.value as MonthKey)}
            >
              {MONTH_KEYS.map(mm => <option key={mm} value={mm}>{MONTH_LABELS[mm]}</option>)}
            </select>
            <select
              className="px-2.5 py-1.5 rounded border border-border2 bg-bg2 text-[12px] text-text shadow-xs"
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
            >
              {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
            <input
              className="px-2.5 py-1.5 rounded border border-border2 bg-bg2 text-[12px] text-text shadow-xs w-32 placeholder:text-text3"
              type="number"
              placeholder="Oylik maqsad $"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
            />
            <Button onClick={() => q.refetch()}>Yangilash</Button>
          </>
        }
      />
      <div className="flex-1 overflow-y-auto px-[22px] py-[18px] bg-bg">
        {q.isLoading && !q.data ? <MetricRowSkeleton count={5} /> : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5 mb-4">
            <MetricCard label="Jami sarf" value={fmtMoney(totalSpend)} tone="orange" hint={`${totals.days} ta kun`} />
            <MetricCard label="Jami lid" value={fmtNum(totalLeads)} tone="green" />
            <MetricCard label="CPL" value={totalLeads ? fmtMoney(cpl) : '—'} tone="amber" hint="sarf / lid" />
            <MetricCard label={target ? 'Maqsad qoldi' : 'Maqsad'} value={target ? fmtMoney(remaining) : 'belgilanmagan'} tone={burn > 100 ? 'red' : 'blue'} hint={target ? `${fmtPct(burn, 1)} foyda` : '—'} />
            <MetricCard label="Bugungi sarf" value={fmtMoney(totals.fbToday + totals.igToday)} hint={`FB ${fmtMoney(totals.fbToday)} · IG ${fmtMoney(totals.igToday)}`} />
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mb-4">
          {q.isLoading && !q.data ? <ChartCardSkeleton height={280} /> : (
            <CardChart title="Kunlik sarf (FB + IG stacked)" height={280}>
              <StackedBar data={stackedData as never} series={[
                { dataKey: 'Facebook',  fill: 'var(--blue)' },
                { dataKey: 'Instagram', fill: 'var(--purple)' },
              ]} />
            </CardChart>
          )}
          <div className="bg-bg2 border border-border rounded-lg shadow overflow-hidden">
            <div className="px-4 py-3 border-b border-border flex items-center justify-between">
              <span className="text-[13px] font-semibold">Platform bo'yicha sarf</span>
              <span className="text-[11px] text-text3">jami {fmtMoney(totalSpend)}</span>
            </div>
            <div className="p-4">
              {q.isLoading && !q.data ? <FunnelSkeleton rows={2} /> : <FunnelBars steps={platformBreakdown} />}

              {target && (
                <div className="mt-4 pt-4 border-t border-border">
                  <div className="flex items-center justify-between text-[12px] mb-2">
                    <span className="text-text2">Maqsad bajarilishi</span>
                    <span className={`mono font-semibold ${burn > 100 ? 'text-red' : burn > 80 ? 'text-amber' : 'text-green'}`}>{fmtPct(burn, 1)}</span>
                  </div>
                  <div className="h-2 bg-bg4 rounded overflow-hidden">
                    <div
                      className={`h-full rounded ${burn > 100 ? 'bg-red' : burn > 80 ? 'bg-amber' : 'bg-green'}`}
                      style={{ width: `${Math.min(100, burn)}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-text3 mt-2">
                    <span>0</span>
                    <span className="mono">{fmtMoney(totalSpend)} / {fmtMoney(targetN)}</span>
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

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Topbar } from '@/components/Topbar';
import { MetricCard } from '@/components/MetricCard';
import { Button } from '@/components/Button';
import { Badge } from '@/components/Badge';
import { CardChart, MultiLine } from '@/components/charts';
import { MetricRowSkeleton, ChartCardSkeleton } from '@/components/Skeleton';
import { getDashboardDaily, getMetaInsights, MONTH_KEYS, MONTH_LABELS } from '@/lib/api/meta';
import type { MonthKey } from '@/lib/api/meta';
import { fmtNum, fmtMoney } from '@/lib/utils';

const todayISO = () => new Date().toISOString().slice(0, 10);
const monthOf = (iso: string): MonthKey => MONTH_KEYS[Number(iso.slice(5, 7)) - 1];
const yearOf = (iso: string) => Number(iso.slice(0, 4));
const dayOf = (iso: string) => Number(iso.slice(8, 10));

export default function KunlikPage() {
  const [date, setDate] = useState(todayISO());

  const dayQ = useQuery({
    queryKey: ['dashboard/daily', date],
    queryFn: () => getDashboardDaily(date),
  });

  const monthQ = useQuery({
    queryKey: ['meta/insights', monthOf(date), yearOf(date)],
    queryFn: () => getMetaInsights(monthOf(date), yearOf(date)),
  });

  // Build month-to-date trend (target + instagram budget & leads up to selected day)
  const trendData = useMemo(() => {
    const m = monthQ.data?.data;
    if (!m) return [];
    const upTo = dayOf(date);
    return Array.from({ length: upTo }, (_, i) => ({
      name: String(i + 1),
      'FB sarf': Math.round((m.target.budget[i] ?? 0) * 100) / 100,
      'IG sarf': Math.round((m.instagram.budget[i] ?? 0) * 100) / 100,
      'FB lid':  m.target.leads[i] ?? 0,
      'IG lid':  m.instagram.leads[i] ?? 0,
    }));
  }, [monthQ.data, date]);

  const fb = dayQ.data?.facebook;
  const fbSpend = Number((fb && !fb.error) ? fb.spend ?? 0 : 0);
  const fbLeads = (fb && !fb.error) ? fb.leads_count ?? 0 : 0;
  const bx = dayQ.data?.bitrix;

  return (
    <>
      <Topbar
        title="Kunlik hisobot"
        sub={`Bir kunlik birlashtirilgan hisobot — Meta + Bitrix24`}
        actions={
          <>
            <input
              type="date"
              className="px-2.5 py-1.5 rounded border border-border2 bg-bg2 text-[12px] text-text shadow-xs"
              value={date}
              onChange={(e) => setDate(e.target.value || todayISO())}
            />
            <Button onClick={() => { dayQ.refetch(); monthQ.refetch(); }}>Yangilash</Button>
          </>
        }
      />
      <div className="flex-1 overflow-y-auto px-[22px] py-[18px] bg-bg">
        {dayQ.isLoading && !dayQ.data ? <MetricRowSkeleton count={5} /> : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5 mb-4">
            <MetricCard label="Sana" value={date} tone="default" hint={dayQ.isFetching ? 'yuklanmoqda…' : undefined} />
            <MetricCard label="Meta sarf" value={fmtMoney(fbSpend)} tone="orange" hint={`FB+IG account-level`} />
            <MetricCard label="Meta lidlar" value={fmtNum(fbLeads)} tone="amber" />
            <MetricCard label="Bitrix tashriflar" value={fmtNum(bx?.visits_count)} tone="blue" />
            <MetricCard label="Bitrix yopilgan" value={fmtMoney(bx?.closed_deals.sum)} tone="green" hint={`${bx?.closed_deals.count ?? 0} ta deal`} />
          </div>
        )}

        {monthQ.isLoading && !monthQ.data ? <ChartCardSkeleton height={300} /> : (
          <CardChart title={`${MONTH_LABELS[monthOf(date)]} ${yearOf(date)} — kunlik trend (oydagi 1-${dayOf(date)} kunlar)`} height={300}>
            <MultiLine
              data={trendData}
              lines={[
                { dataKey: 'FB sarf', stroke: 'var(--blue)' },
                { dataKey: 'IG sarf', stroke: 'var(--purple)' },
                { dataKey: 'FB lid',  stroke: 'var(--green)' },
                { dataKey: 'IG lid',  stroke: 'var(--amber)' },
              ]}
            />
          </CardChart>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4">
          <div className="bg-bg2 border border-border rounded-lg shadow overflow-hidden">
            <div className="px-4 py-3 border-b border-border flex items-center justify-between">
              <span className="text-[13px] font-semibold">Meta (FB + IG)</span>
              <Badge tone={fb?.error ? 'red' : 'gray'}>{fb?.error ? 'Xato' : 'Account-level'}</Badge>
            </div>
            <div className="p-4 space-y-2">
              <Row label="Sarf"   value={fmtMoney(fbSpend)} />
              <Row label="Lidlar" value={fmtNum(fbLeads)} />
              {fb?.error && (
                <div className="text-[11px] text-red bg-red-bg border border-red-bd rounded p-2 mt-2">{fb.error}</div>
              )}
            </div>
          </div>

          <div className="bg-bg2 border border-border rounded-lg shadow overflow-hidden">
            <div className="px-4 py-3 border-b border-border">
              <span className="text-[13px] font-semibold">Bitrix24</span>
            </div>
            <div className="p-4 space-y-2">
              <Row label="Tashriflar (CRM)" value={fmtNum(bx?.visits_count)} />
              <Row label="Lidlar (jami)"     value={fmtNum(bx?.leads_count)} />
              <Row label="Yopilgan dealar"  value={fmtNum(bx?.closed_deals.count)} />
              <Row label="Yopilgan summa"   value={fmtMoney(bx?.closed_deals.sum)} valueClass="text-green font-semibold" />
            </div>
          </div>
        </div>

        {(dayQ.error || monthQ.error) && (
          <div className="mt-4 p-3 bg-red-bg border border-red-bd text-red rounded-lg text-[12.5px]">
            Xatolik: {((dayQ.error ?? monthQ.error) as Error).message}
          </div>
        )}
      </div>
    </>
  );
}

function Row({ label, value, valueClass = '' }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-border last:border-b-0">
      <span className="text-[12px] text-text2">{label}</span>
      <span className={`mono text-[13px] font-medium ${valueClass}`}>{value}</span>
    </div>
  );
}

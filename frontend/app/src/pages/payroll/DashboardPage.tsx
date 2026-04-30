import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Topbar } from '@/components/Topbar';
import { Button } from '@/components/Button';
import { Badge } from '@/components/Badge';
import { Avatar } from '@/components/Avatar';
import { MetricCard } from '@/components/MetricCard';
import { CardChart, FunnelBars, SimpleBar } from '@/components/charts';
import { MetricRowSkeleton, FunnelSkeleton, DataTableSkeleton, ChartCardSkeleton } from '@/components/Skeleton';
import { listEmployees, getMonthlyTarget, listTimeman, getSalesTrend, listBonusAwards } from '@/lib/api/payroll';
import type { TimemanUser } from '@/lib/api/payroll';
import { getDealsStats } from '@/lib/api/deals';
import { fmtMoney, fmtNum, fmtPct } from '@/lib/utils';
import { MONTH_KEYS, MONTH_LABELS } from '@/lib/api/meta';

const now = new Date();
const DEFAULT_YEAR = now.getFullYear();
const DEFAULT_MONTH = now.getMonth() + 1;

function classifyTimeman(u: TimemanUser): { bucket: 'opened' | 'paused' | 'closed' | 'unknown'; label: string; tone: 'green' | 'amber' | 'gray' } {
  const t = u.timeman as unknown;
  let status: string | null | undefined = null;
  if (t && typeof t === 'object' && 'STATUS' in (t as object)) {
    status = (t as { STATUS?: string }).STATUS ?? null;
  } else if (typeof t === 'string') status = t;
  switch (status) {
    case 'OPENED': return { bucket: 'opened', label: 'Ishda',     tone: 'green' };
    case 'PAUSED': return { bucket: 'paused', label: 'Pauza',     tone: 'amber' };
    case 'CLOSED': return { bucket: 'closed', label: 'Yakunladi', tone: 'gray'  };
    default:       return { bucket: 'unknown', label: '—',         tone: 'gray' };
  }
}

function isoFirstOfMonth(year: number, month: number) { return `${year}-${String(month).padStart(2, '0')}-01`; }
function isoLastOfMonth(year: number, month: number) {
  const d = new Date(year, month, 0).getDate();
  return `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export default function DashboardPage() {
  const [year, setYear] = useState(DEFAULT_YEAR);
  const [month, setMonth] = useState(DEFAULT_MONTH);

  const empQ = useQuery({ queryKey: ['payroll/employees'], queryFn: listEmployees });
  const targetQ = useQuery({
    queryKey: ['payroll/target', year, month],
    queryFn: () => getMonthlyTarget(year, month),
  });
  const tmQ = useQuery({
    queryKey: ['users/timeman'],
    queryFn: listTimeman,
    refetchInterval: 30_000,
  });
  const dealsQ = useQuery({
    queryKey: ['stats/deals', year, month],
    queryFn: () => getDealsStats({ start_date: isoFirstOfMonth(year, month), end_date: isoLastOfMonth(year, month) }),
  });
  const trendQ = useQuery({ queryKey: ['payroll/sales-trend', 6], queryFn: () => getSalesTrend(6) });
  const periodLabel = `${year}-${String(month).padStart(2, '0')}`;
  const bonusesQ = useQuery({ queryKey: ['payroll/bonus-awards', periodLabel], queryFn: () => listBonusAwards(periodLabel) });

  const target = targetQ.data?.target_usd ?? 0;
  const wonRev = dealsQ.data?.total_won_revenue ?? 0;
  const remaining = Math.max(0, target - wonRev);
  const progress = target > 0 ? (wonRev / target) * 100 : 0;

  const funnelSteps = useMemo(() => {
    const r = dealsQ.data;
    return [
      { label: 'Maqsad',     value: Math.round(target),    color: 'var(--blue)' },
      { label: 'Hozirgi savdo', value: Math.round(wonRev), color: 'var(--green)' },
      { label: 'Won (count)',   value: r?.won_count ?? 0,  color: 'var(--green)' },
      { label: 'Lost (count)',  value: r?.lost_count ?? 0, color: 'var(--red)' },
    ];
  }, [dealsQ.data, target, wonRev]);

  const topSellers = useMemo(() => {
    const list = dealsQ.data?.by_user ?? [];
    return [...list]
      .sort((a, b) => b.won_revenue - a.won_revenue)
      .slice(0, 5);
  }, [dealsQ.data]);

  const todayUsers = (tmQ.data?.users ?? []).slice(0, 6);

  const trendData = useMemo(() => {
    const months = trendQ.data?.months ?? [];
    return months.map(m => ({
      name: `${MONTH_LABELS[MONTH_KEYS[m.month - 1]].slice(0, 3)} ${String(m.year).slice(-2)}`,
      value: Math.round(m.won_revenue),
    }));
  }, [trendQ.data]);

  // Top bonus recipients in current period
  const topBonusRecipients = useMemo(() => {
    const awards = bonusesQ.data?.awards ?? [];
    const byUser = new Map<number, { uid: number; name: string; total: number; count: number }>();
    for (const a of awards) {
      const emp = empQ.data?.employees.find(e => e.id === a.bitrix_user_id);
      const name = emp?.name ?? `User ${a.bitrix_user_id}`;
      const cur = byUser.get(a.bitrix_user_id) ?? { uid: a.bitrix_user_id, name, total: 0, count: 0 };
      cur.total += a.amount_usd;
      cur.count += 1;
      byUser.set(a.bitrix_user_id, cur);
    }
    return Array.from(byUser.values()).sort((a, b) => b.total - a.total).slice(0, 5);
  }, [bonusesQ.data, empQ.data]);

  return (
    <>
      <Topbar
        title="Dashboard"
        sub={`${MONTH_LABELS[MONTH_KEYS[month - 1]]} ${year} · Mountain umumiy holat`}
        actions={
          <>
            <select className="px-2.5 py-1.5 rounded border border-border2 bg-bg2 text-[12px] shadow-xs" value={month} onChange={(e) => setMonth(Number(e.target.value))}>
              {MONTH_KEYS.map((m, i) => <option key={m} value={i + 1}>{MONTH_LABELS[m]}</option>)}
            </select>
            <select className="px-2.5 py-1.5 rounded border border-border2 bg-bg2 text-[12px] shadow-xs" value={year} onChange={(e) => setYear(Number(e.target.value))}>
              {[DEFAULT_YEAR, DEFAULT_YEAR - 1].map(y => <option key={y} value={y}>{y}</option>)}
            </select>
            <Button onClick={() => { dealsQ.refetch(); tmQ.refetch(); targetQ.refetch(); }}>Yangilash</Button>
          </>
        }
      />
      <div className="flex-1 overflow-y-auto px-[22px] py-[18px] bg-bg">
        {dealsQ.isLoading && !dealsQ.data ? <MetricRowSkeleton count={4} /> : (
          <div className="grid grid-cols-4 gap-2.5 mb-4">
            <MetricCard label="Oylik maqsad" value={fmtMoney(target)} tone="blue" hint={target ? '' : 'belgilanmagan'} />
            <MetricCard label="Hozirgi savdo" value={fmtMoney(wonRev)} tone="green" hint={target ? `${fmtPct(progress, 1)} bajarildi` : '—'} />
            <MetricCard label="Qolgan" value={fmtMoney(remaining)} tone={progress >= 100 ? 'green' : 'amber'} />
            <MetricCard label="Xodimlar" value={fmtNum(empQ.data?.count ?? 0)} hint="aktiv + ta'tilda" />
          </div>
        )}

        {/* ── Trend + Top bonus row ───────────────────────────── */}
        <div className="grid grid-cols-2 gap-3 mb-4">
          {trendQ.isLoading && !trendQ.data ? <ChartCardSkeleton height={220} /> : (
            <CardChart title="Sotuv trendi" hint="oxirgi 6 oy · won daromad" height={220}>
              <SimpleBar data={trendData as never} dataKey="value" fill="var(--blue)" />
            </CardChart>
          )}
          <div className="bg-bg2 border border-border rounded-lg shadow overflow-hidden">
            <div className="px-4 py-3 border-b border-border flex items-center justify-between">
              <span className="text-[13px] font-semibold">Top bonus oluvchilar</span>
              <span className="text-[11px] text-text3">{periodLabel}</span>
            </div>
            <div className="p-2">
              {bonusesQ.isLoading && !bonusesQ.data ? (
                <div className="space-y-2 p-2">
                  {Array.from({ length: 4 }).map((_, i) => <div key={i} className="skeleton h-9 w-full rounded" />)}
                </div>
              ) : topBonusRecipients.length === 0 ? (
                <div className="text-text3 text-[12px] text-center py-8">Bu davr uchun bonus berilmagan</div>
              ) : (
                <table className="w-full">
                  <tbody>
                    {topBonusRecipients.map((u, i) => (
                      <tr key={u.uid} className="border-b border-border last:border-0 hover:bg-bg3">
                        <td className="px-3 py-2 mono text-amber font-bold w-6">{i + 1}</td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-2.5">
                            <Avatar name={u.name} />
                            <span className="font-medium">{u.name}</span>
                          </div>
                        </td>
                        <td className="px-3 py-2 text-right text-[11px] text-text3">{u.count} bonus</td>
                        <td className="px-3 py-2 text-right mono text-green font-semibold">+{fmtMoney(u.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 mb-4">
          <CardChart title={`${MONTH_LABELS[MONTH_KEYS[month - 1]]} ${year} — Maqsad bajarilishi`} hint={target ? fmtPct(progress, 1) : '—'} height={180}>
            <div className="h-full flex flex-col justify-center px-1">
              <div className="flex items-center justify-between text-[11px] text-text3 mb-1">
                <span>Bajarildi: <strong className="text-blue">{fmtMoney(wonRev)}</strong></span>
                <span className="font-semibold text-text">{target ? fmtPct(progress, 1) : '—'} · {fmtMoney(target)} maqsad</span>
                <span>Qoldi: <strong className="text-amber">{fmtMoney(remaining)}</strong></span>
              </div>
              <div className="h-2.5 bg-bg4 rounded overflow-hidden">
                <div className="h-full rounded bg-gradient-to-r from-blue-2 to-cyan-400" style={{ width: `${Math.min(100, progress)}%` }} />
              </div>
            </div>
          </CardChart>
          <div className="bg-bg2 border border-border rounded-lg shadow overflow-hidden">
            <div className="px-4 py-3 border-b border-border">
              <span className="text-[13px] font-semibold">Voronka</span>
              <span className="text-[11px] text-text3 ml-2">maqsad → savdo → won/lost</span>
            </div>
            <div className="p-4">
              {dealsQ.isLoading && !dealsQ.data ? <FunnelSkeleton rows={4} /> : <FunnelBars steps={funnelSteps} />}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="bg-bg2 border border-border rounded-lg shadow overflow-hidden">
            <div className="px-4 py-3 border-b border-border">
              <span className="text-[13px] font-semibold">Top savdo — {MONTH_LABELS[MONTH_KEYS[month - 1]]}</span>
              <span className="text-[11px] text-text3 ml-2">won daromad bo'yicha</span>
            </div>
            {dealsQ.isLoading && !dealsQ.data ? <DataTableSkeleton rows={5} cols={4} /> : (
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
                {topSellers.length === 0 && (
                  <tr><td colSpan={4} className="px-4 py-8 text-center text-text3 text-[12.5px]">Bu oy savdo topilmadi</td></tr>
                )}
                {topSellers.map((u, i) => (
                  <tr key={u.id} className="border-b border-border last:border-0 hover:bg-bg3">
                    <td className="px-4 py-2.5 mono text-amber font-bold">{i + 1}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2.5">
                        <Avatar name={u.name || `User ${u.id}`} />
                        <span className="font-medium">{u.name || `User ${u.id}`}</span>
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-right mono text-green font-semibold">{fmtMoney(u.won_revenue)}</td>
                    <td className="px-4 py-2.5 text-right mono text-text2">{u.total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            )}
          </div>

          <div className="bg-bg2 border border-border rounded-lg shadow overflow-hidden">
            <div className="px-4 py-3 border-b border-border flex items-center justify-between">
              <span className="text-[13px] font-semibold">Bugungi davomat</span>
              <span className="text-[11px] text-text3">realtime · {tmQ.isFetching ? 'yangilanmoqda…' : '30s da yangilanadi'}</span>
            </div>
            {tmQ.isLoading && !tmQ.data ? <DataTableSkeleton rows={5} cols={3} /> : (
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
                  <tr><td colSpan={3} className="px-4 py-8 text-center text-text3 text-[12.5px]">—</td></tr>
                )}
                {todayUsers.map(u => {
                  const c = classifyTimeman(u);
                  return (
                    <tr key={u.id} className="border-b border-border last:border-0 hover:bg-bg3">
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2.5">
                          <Avatar name={u.name || `User ${u.id}`} />
                          <span className="font-medium">{u.name || `User ${u.id}`}</span>
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-text2 text-[11px]">{u.work_position || '—'}</td>
                      <td className="px-4 py-2.5 text-right"><Badge tone={c.tone}>{c.label}</Badge></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

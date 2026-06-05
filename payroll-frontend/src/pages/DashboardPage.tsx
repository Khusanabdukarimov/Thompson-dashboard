import { useQuery } from '@tanstack/react-query';
import { Topbar } from '../components/Topbar';
import { MetricCard } from '../components/MetricCard';
import { Card } from '../components/Card';
import { getSalesTrend, listEmployees } from '../lib/api/payroll';
import { fmtUzs, fmtUsd, monthLabel } from '../lib/utils';

const MONTH_ABBR = ['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

export default function DashboardPage() {
  const empQ  = useQuery({ queryKey: ['employees'], queryFn: listEmployees });
  const trend = useQuery({ queryKey: ['sales-trend'], queryFn: () => getSalesTrend(6) });

  const employees = empQ.data?.employees ?? [];
  const months    = trend.data?.months ?? [];

  const totalFix  = employees.reduce((s, e) => s + e.fix_base_uzs, 0);
  const activeEmp = employees.filter(e => e.status === 'active').length;

  const maxRev = Math.max(...months.map(m => m.won_revenue), 1);

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
      <Topbar title="Dashboard" />
      <div style={{ padding: 24, flex: 1 }}>

        {/* Metrics */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 24 }}>
          <MetricCard label="Faol xodimlar" value={activeEmp} sub={`${employees.length} ta jami`} />
          <MetricCard label="Umumiy Fix Base" value={fmtUzs(totalFix)} sub="oylik" color="var(--accent)" />
          <MetricCard label="Xodimlar soni" value={employees.length} sub="barcha statuslar" />
          <MetricCard label="Oxirgi oy savdo" value={months[0] ? fmtUsd(months[0].won_revenue) : '—'} sub={months[0] ? `${months[0].won_count} ta deal` : ''} color="var(--green)" />
        </div>

        {/* Sales trend */}
        <Card style={{ padding: 24, marginBottom: 24 }}>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 20 }}>6 Oylik Savdo Dinamikasi</div>
          {trend.isLoading ? (
            <div style={{ height: 160, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>Yuklanmoqda...</div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, height: 160 }}>
              {[...months].reverse().map((m, i) => {
                const h = Math.round((m.won_revenue / maxRev) * 130);
                const isLast = i === months.length - 1;
                return (
                  <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)' }}>
                      {fmtUsd(m.won_revenue)}
                    </div>
                    <div style={{
                      width: '100%', height: h || 4, borderRadius: 6,
                      background: isLast ? 'var(--accent)' : '#cbd5e0',
                      transition: 'height .3s',
                    }} />
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                      {MONTH_ABBR[m.month]} {String(m.year).slice(2)}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        {/* Employees table */}
        <Card style={{ padding: 24 }}>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 16 }}>Xodimlar</div>
          {empQ.isLoading ? (
            <p style={{ color: 'var(--text-muted)' }}>Yuklanmoqda...</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  {['Xodim', 'Lavozim', 'Fix Base', 'KPI', 'Holat'].map(h => (
                    <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {employees.slice(0, 8).map(e => (
                  <tr key={e.id} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '10px 12px', fontWeight: 600, fontSize: 13 }}>{e.name}</td>
                    <td style={{ padding: '10px 12px', color: 'var(--text-muted)', fontSize: 13 }}>{e.work_position || '—'}</td>
                    <td style={{ padding: '10px 12px', fontSize: 13 }}>{fmtUzs(e.fix_base_uzs)}</td>
                    <td style={{ padding: '10px 12px', fontSize: 13 }}>{e.role}</td>
                    <td style={{ padding: '10px 12px' }}>
                      <span style={{
                        padding: '2px 8px', borderRadius: 4, fontSize: 12, fontWeight: 600,
                        background: e.status === 'active' ? '#dcfce7' : '#fee2e2',
                        color: e.status === 'active' ? '#15803d' : '#b91c1c',
                      }}>
                        {e.status === 'active' ? 'Faol' : e.status === 'leave' ? 'Ta\'tilda' : 'Chiqarildi'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </div>
  );
}

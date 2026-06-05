import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Calendar } from 'lucide-react';
import { Topbar } from '../components/Topbar';
import { Card } from '../components/Card';
import { Badge } from '../components/Badge';
import { listEmployees, calculatePayroll, getSalesTrend } from '../lib/api/payroll';
import { fmtUzs, fmtUsd, monthLabel } from '../lib/utils';

const now = new Date();
const MONTH_ABBR = ['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

export default function EmployeeProfilePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear]   = useState(now.getFullYear());

  const empQ    = useQuery({ queryKey: ['employees'], queryFn: listEmployees });
  const trendQ  = useQuery({ queryKey: ['sales-trend'], queryFn: () => getSalesTrend(6) });
  const emp = empQ.data?.employees.find(e => String(e.id) === id);

  const calcQ = useQuery({
    queryKey: ['payroll-calc', id, year, month],
    queryFn: () => calculatePayroll(Number(id), year, month),
    enabled: !!id,
  });

  const calc   = calcQ.data;
  const months = trendQ.data?.months ?? [];
  const maxRev = Math.max(...months.map(m => m.won_revenue), 1);

  if (empQ.isLoading) return <div style={{ padding: 40, color: 'var(--text-muted)' }}>Yuklanmoqda...</div>;
  if (!emp) return <div style={{ padding: 40 }}>Xodim topilmadi</div>;

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
      <Topbar title="Xodim Profili" breadcrumb={emp.name} />
      <div style={{ padding: 24, flex: 1 }}>

        <button onClick={() => navigate(-1)} style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-muted)', marginBottom: 20, fontSize: 13 }}>
          <ArrowLeft size={16} /> Orqaga
        </button>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 24 }}>
          {/* Profile card */}
          <Card style={{ padding: 24, display: 'flex', alignItems: 'center', gap: 20 }}>
            <div style={{
              width: 80, height: 80, borderRadius: '50%', background: 'var(--accent)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#fff', fontWeight: 700, fontSize: 28, flexShrink: 0,
            }}>
              {emp.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}
            </div>
            <div>
              <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>{emp.name}</h2>
              <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 8 }}>{emp.work_position || emp.role}</p>
              <Badge label={emp.status === 'active' ? 'FAOL' : emp.status.toUpperCase()} tone={emp.status === 'active' ? 'green' : 'red'} />
            </div>
          </Card>

          {/* Estimated salary */}
          <Card style={{ padding: 24, background: 'var(--sidebar-bg)', color: '#fff' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#8899a6', marginBottom: 8 }}>
              <Calendar size={14} />
              TAXMINIY OYLIK ({monthLabel(month, year).toUpperCase()})
            </div>
            <div style={{ fontSize: 32, fontWeight: 700, marginBottom: 4 }}>
              {calc ? fmtUzs(calc.total_uzs) : '—'}
            </div>
            {calc && calc.total_usd > 0 && (
              <div style={{ color: '#8899a6', fontSize: 13 }}>+ {fmtUsd(calc.total_usd)}</div>
            )}
            <div style={{ marginTop: 16 }}>
              <select value={month} onChange={e => setMonth(Number(e.target.value))}
                style={{ background: 'rgba(255,255,255,0.1)', border: 'none', color: '#fff', padding: '5px 10px', borderRadius: 6, fontSize: 13, marginRight: 8 }}>
                {Array.from({ length: 12 }, (_, i) => i + 1).map(m => (
                  <option key={m} value={m}>{MONTH_ABBR[m]}</option>
                ))}
              </select>
              <select value={year} onChange={e => setYear(Number(e.target.value))}
                style={{ background: 'rgba(255,255,255,0.1)', border: 'none', color: '#fff', padding: '5px 10px', borderRadius: 6, fontSize: 13 }}>
                {[2024, 2025, 2026].map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
          </Card>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
          {/* Hisoblash modeli */}
          <Card style={{ padding: 24 }}>
            <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
              Hisoblash Modeli
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: 12, background: '#f8fafc', borderRadius: 8 }}>
                <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>Asosiy Fix (Maosh)</span>
                <span style={{ fontWeight: 700, color: 'var(--accent)' }}>{fmtUzs(emp.fix_base_uzs)}</span>
              </div>
              {calc && (
                <div style={{ padding: 12, background: '#f8fafc', borderRadius: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
                    <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>KPI Ko'rsatkichlari</span>
                    <span style={{ fontWeight: 700, color: 'var(--green)' }}>+{fmtUsd(calc.kpi.payout_usd)}</span>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', paddingLeft: 8 }}>
                    <div>Savdo hajmi (WON): {fmtUsd(calc.revenue_usd)}</div>
                    {calc.kpi.rule_name && <div>Qoida: {calc.kpi.rule_name}</div>}
                  </div>
                </div>
              )}
              {calc && (
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: 12, background: '#f0fdf4', borderRadius: 8 }}>
                  <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>Bonuslar ({calc.bonuses.length} ta)</span>
                  <span style={{ fontWeight: 700, color: 'var(--green)' }}>+{fmtUsd(calc.bonuses_total_usd)}</span>
                </div>
              )}
              {calc && calc.penalties_uzs > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: 12, background: '#fff5f5', borderRadius: 8 }}>
                  <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>Jarimalar</span>
                  <span style={{ fontWeight: 700, color: 'var(--red)' }}>−{fmtUzs(calc.penalties_uzs)}</span>
                </div>
              )}
            </div>
          </Card>

          {/* 6 Oylik Dinamika */}
          <Card style={{ padding: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <h3 style={{ fontSize: 14, fontWeight: 700 }}>6 Oylik Dinamika</h3>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>BIRLIK: UZS (min)</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 140 }}>
              {[...months].reverse().map((m, i) => {
                const h = Math.max(Math.round((m.won_revenue / maxRev) * 110), 4);
                const isLast = i === months.length - 1;
                return (
                  <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                    <div style={{ fontSize: 10, fontWeight: 600, color: isLast ? 'var(--text)' : 'transparent' }}>
                      {(m.won_revenue / 1000).toFixed(1)}
                    </div>
                    <div style={{
                      width: '100%', height: h, borderRadius: 6,
                      background: isLast ? 'var(--sidebar-bg)' : '#dde3ee',
                    }} />
                    <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                      {MONTH_ABBR[m.month].toUpperCase()}
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

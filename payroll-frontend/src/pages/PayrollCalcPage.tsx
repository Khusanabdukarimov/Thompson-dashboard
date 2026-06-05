import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Topbar } from '../components/Topbar';
import { Card } from '../components/Card';
import { Btn } from '../components/Btn';
import { listEmployees, calculatePayroll } from '../lib/api/payroll';
import { fmtUzs, fmtUsd, monthLabel } from '../lib/utils';

const now = new Date();

export default function PayrollCalcPage() {
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear]   = useState(now.getFullYear());
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const empQ  = useQuery({ queryKey: ['employees'], queryFn: listEmployees });
  const calcQ = useQuery({
    queryKey: ['payroll-calc', selectedId, year, month],
    queryFn: () => calculatePayroll(selectedId!, year, month),
    enabled: !!selectedId,
  });

  const employees = empQ.data?.employees?.filter(e => e.status === 'active') ?? [];
  const calc      = calcQ.data;

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
      <Topbar title="Payroll Hisoblash" month={month} year={year} onMonthChange={(m, y) => { setMonth(m); setYear(y); }} />
      <div style={{ padding: 24, flex: 1, display: 'grid', gridTemplateColumns: '320px 1fr', gap: 20, alignItems: 'start' }}>

        {/* Employee list */}
        <Card>
          <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)', fontSize: 13, fontWeight: 600 }}>
            Oylik hisob-kitoblar
            <div style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 400, marginTop: 2 }}>
              {monthLabel(month, year)} uchun xodimlar bo'yicha payroll tahlili
            </div>
          </div>
          <div style={{ padding: '8px 0' }}>
            {empQ.isLoading ? (
              <div style={{ padding: 20, color: 'var(--text-muted)', textAlign: 'center' }}>Yuklanmoqda...</div>
            ) : employees.map(e => (
              <button
                key={e.id}
                onClick={() => setSelectedId(e.id)}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: 12,
                  padding: '12px 16px', textAlign: 'left',
                  background: selectedId === e.id ? 'var(--accent)' : 'transparent',
                  color: selectedId === e.id ? '#fff' : 'var(--text)',
                  borderBottom: '1px solid var(--border)',
                }}
              >
                <div style={{
                  width: 36, height: 36, borderRadius: '50%', background: selectedId === e.id ? 'rgba(255,255,255,0.2)' : 'var(--accent)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: '#fff', fontWeight: 700, fontSize: 12, flexShrink: 0,
                }}>
                  {e.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.name}</div>
                  <div style={{ fontSize: 12, opacity: 0.7 }}>{e.work_position || e.role}</div>
                </div>
              </button>
            ))}
          </div>
        </Card>

        {/* Calc detail */}
        {!selectedId ? (
          <Card style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
            Chap tarafdan xodim tanlang
          </Card>
        ) : calcQ.isLoading ? (
          <Card style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>Hisoblanmoqda...</Card>
        ) : calcQ.isError ? (
          <Card style={{ padding: 40, textAlign: 'center', color: 'var(--red)' }}>Xatolik yuz berdi</Card>
        ) : calc ? (
          <Card>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 700 }}>
                Hisob-kitob tafsiloti
              </span>
              <span style={{ background: '#dbeafe', color: 'var(--accent)', fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 4 }}>DRAFT</span>
              <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-muted)' }}>
                Xodim: {employees.find(e => e.id === selectedId)?.name} • ID: #{selectedId}
              </span>
            </div>

            <div style={{ padding: '0 20px' }}>
              {/* Fix base */}
              <div style={{ display: 'flex', alignItems: 'center', padding: '16px 0', borderBottom: '1px solid var(--border)' }}>
                <div style={{ width: 32, height: 32, borderRadius: 8, background: '#dbeafe', display: 'flex', alignItems: 'center', justifyContent: 'center', marginRight: 12, fontSize: 16 }}>💼</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>Base Fix (Oklad)</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Shartnoma bo'yicha asosiy stavka</div>
                </div>
                <div style={{ fontWeight: 700 }}>{fmtUzs(calc.fix_base_uzs)}</div>
              </div>

              {/* Bitrix savdo */}
              <div style={{ display: 'flex', alignItems: 'center', padding: '16px 0', borderBottom: '1px solid var(--border)' }}>
                <div style={{ width: 32, height: 32, borderRadius: 8, background: '#f0fdf4', display: 'flex', alignItems: 'center', justifyContent: 'center', marginRight: 12, fontSize: 16 }}>✅</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>Bitrix savdo (deal won)</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{calc.deal_count} ta deal · {calc.kpi.rule_name ? `${calc.kpi.rule_name} qoidasi` : 'maqsad belgilanmagan'}</div>
                </div>
                <div style={{ fontWeight: 700, color: 'var(--accent)' }}>{fmtUsd(calc.revenue_usd)}</div>
              </div>

              {/* KPI */}
              <div style={{ display: 'flex', alignItems: 'center', padding: '16px 0', borderBottom: '1px solid var(--border)' }}>
                <div style={{ width: 32, height: 32, borderRadius: 8, background: '#dbeafe', display: 'flex', alignItems: 'center', justifyContent: 'center', marginRight: 12, fontSize: 16 }}>📈</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>KPI payout</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    {calc.kpi.rule_name ? `${calc.kpi.percent}% stavka` : '— qoidasiz —'}
                  </div>
                  {calc.kpi.payout_usd > 0 && (
                    <div style={{ marginTop: 6, height: 6, background: '#dbeafe', borderRadius: 3, position: 'relative', overflow: 'hidden' }}>
                      <div style={{ position: 'absolute', left: 0, top: 0, height: '100%', width: `${Math.min((calc.kpi.payout_usd / calc.revenue_usd) * 100, 100)}%`, background: 'var(--accent)', borderRadius: 3 }} />
                    </div>
                  )}
                </div>
                <div style={{ fontWeight: 700, color: 'var(--green)' }}>{fmtUsd(calc.kpi.payout_usd)}</div>
              </div>

              {/* Bonuses */}
              <div style={{ display: 'flex', alignItems: 'center', padding: '16px 0', borderBottom: '1px solid var(--border)' }}>
                <div style={{ width: 32, height: 32, borderRadius: 8, background: '#fef3c7', display: 'flex', alignItems: 'center', justifyContent: 'center', marginRight: 12, fontSize: 16 }}>⭐</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>Bonuslar</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{calc.bonuses.length} ta</div>
                </div>
                <div style={{ fontWeight: 700, color: 'var(--amber)' }}>{fmtUsd(calc.bonuses_total_usd)}</div>
              </div>

              {/* Penalties */}
              <div style={{ display: 'flex', alignItems: 'center', padding: '16px 0', borderBottom: '1px solid var(--border)' }}>
                <div style={{ width: 32, height: 32, borderRadius: 8, background: '#fee2e2', display: 'flex', alignItems: 'center', justifyContent: 'center', marginRight: 12, fontSize: 16 }}>⚠️</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>Jarimalar</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>kechikish + boshqalar</div>
                </div>
                <div style={{ fontWeight: 700, color: 'var(--red)' }}>
                  {calc.penalties_uzs > 0 ? `−${fmtUzs(calc.penalties_uzs)}` : '—'}
                </div>
              </div>
            </div>

            {/* Taxes */}
            <div style={{ padding: '12px 20px', color: 'var(--text-muted)', fontSize: 13, borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between' }}>
              <span>Soliqlar va ushlanmalar (12%)</span>
              <span>{fmtUzs(calc.total_uzs * 0.12)}</span>
            </div>

            {/* Total */}
            <div style={{ margin: '0 20px 20px', background: 'var(--sidebar-bg)', borderRadius: 10, padding: '16px 20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ color: '#fff', fontWeight: 700, fontSize: 14 }}>JAMI TO'LANISHI KERAK</div>
                  <div style={{ color: '#8899a6', fontSize: 12, marginTop: 2 }}>Hisoblangan barcha bonuslar bilan birga</div>
                </div>
                <div style={{ color: '#fff', fontWeight: 800, fontSize: 20 }}>
                  {fmtUzs(calc.total_uzs)}
                  {calc.total_usd > 0 && <span style={{ fontSize: 14, marginLeft: 8, color: '#8899a6' }}>+ {fmtUsd(calc.total_usd)}</span>}
                </div>
              </div>
            </div>

            <div style={{ padding: '0 20px 20px', display: 'flex', gap: 10 }}>
              <Btn variant="ghost" style={{ flex: 1, justifyContent: 'center' }}>O'zgartirish kiritish</Btn>
              <Btn variant="primary" style={{ flex: 1, justifyContent: 'center' }}>✓ Tasdiqlab yuborish</Btn>
            </div>
          </Card>
        ) : null}
      </div>
    </div>
  );
}

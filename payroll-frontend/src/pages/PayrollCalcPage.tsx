import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { MoreVertical, Pencil, CheckCircle2, ChevronDown } from 'lucide-react';
import { Topbar } from '../components/Topbar';
import { listEmployees, calculatePayroll } from '../lib/api/payroll';
import { fmtUzs, fmtUsd, monthLabel } from '../lib/utils';

const now = new Date();
type Tab = 'all' | 'pending' | 'paid';

function statusLabel(status: string) {
  if (status === 'active') return 'Kutilmoqda';
  return 'To\'langan';
}
function statusColor(status: string) {
  if (status === 'active') return { bg: '#fef3c7', color: '#d97706' };
  return { bg: '#dcfce7', color: '#16a34a' };
}

function initials(name: string) {
  return name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
}

export default function PayrollCalcPage() {
  const qc = useQueryClient();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear]   = useState(now.getFullYear());
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [tab, setTab] = useState<Tab>('all');

  const empQ  = useQuery({ queryKey: ['employees'], queryFn: listEmployees });
  const calcQ = useQuery({
    queryKey: ['payroll-calc', selectedId, year, month],
    queryFn: () => calculatePayroll(selectedId!, year, month),
    enabled: !!selectedId,
  });

  const allEmp = empQ.data?.employees ?? [];
  const filtered = tab === 'all' ? allEmp
    : tab === 'pending' ? allEmp.filter(e => e.status === 'active')
    : allEmp.filter(e => e.status !== 'active');

  const calc = calcQ.data;
  const selectedEmp = allEmp.find(e => e.id === selectedId);

  const counts = {
    all: allEmp.length,
    pending: allEmp.filter(e => e.status === 'active').length,
    paid: allEmp.filter(e => e.status !== 'active').length,
  };

  const tabs: { key: Tab; label: string }[] = [
    { key: 'all',     label: `Barchasi (${counts.all})` },
    { key: 'pending', label: `Kutilmoqda (${counts.pending})` },
    { key: 'paid',    label: `To'langan (${counts.paid})` },
  ];

  async function handleApprove() {
    if (!selectedId) return;
    // TODO: approve endpoint
    qc.invalidateQueries({ queryKey: ['employees'] });
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, background: 'var(--content-bg)' }}>
      <Topbar title="Oylik Payroll Hisoblash" month={month} year={year} onMonthChange={(m, y) => { setMonth(m); setYear(y); }} />

      <div style={{ padding: 24, flex: 1, display: 'grid', gridTemplateColumns: '340px 1fr', gap: 20, alignItems: 'start' }}>

        {/* Left: employee list */}
        <div style={{ background: '#fff', borderRadius: 14, border: '1px solid var(--border)', overflow: 'hidden' }}>
          {/* Header */}
          <div style={{ padding: '16px 18px', borderBottom: '1px solid var(--border)' }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#0f172a', marginBottom: 3 }}>Oylik hisob-kitoblar</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              {monthLabel(month, year)} uchun xodimlar bo'yicha payroll tahlili
            </div>
          </div>

          {/* Tabs */}
          <div style={{ display: 'flex', padding: '10px 12px', gap: 6, borderBottom: '1px solid var(--border)' }}>
            {tabs.map(t => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                style={{
                  padding: '6px 12px', borderRadius: 7, fontSize: 12, fontWeight: 500, border: 'none',
                  background: tab === t.key ? 'var(--accent)' : '#f1f5f9',
                  color: tab === t.key ? '#fff' : '#64748b', cursor: 'pointer', transition: 'all .15s',
                }}
              >{t.label}</button>
            ))}
          </div>

          {/* Employee rows */}
          <div style={{ overflowY: 'auto', maxHeight: 'calc(100vh - 280px)' }}>
            {empQ.isLoading ? (
              <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>Yuklanmoqda...</div>
            ) : filtered.length === 0 ? (
              <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>Xodimlar yo'q</div>
            ) : filtered.map(e => {
              const active = selectedId === e.id;
              const st = statusColor(e.status);
              return (
                <button
                  key={e.id}
                  onClick={() => setSelectedId(e.id)}
                  style={{
                    width: '100%', display: 'block', padding: '14px 18px', textAlign: 'left',
                    background: active ? 'var(--accent)' : '#fff', borderBottom: '1px solid var(--border)',
                    cursor: 'pointer', transition: 'background .15s',
                  }}
                  onMouseEnter={e2 => { if (!active) (e2.currentTarget as HTMLButtonElement).style.background = '#f8fafc'; }}
                  onMouseLeave={e2 => { if (!active) (e2.currentTarget as HTMLButtonElement).style.background = '#fff'; }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
                    <div style={{
                      width: 36, height: 36, borderRadius: '50%', flexShrink: 0,
                      background: active ? 'rgba(255,255,255,0.2)' : 'var(--accent)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      color: '#fff', fontWeight: 700, fontSize: 12,
                    }}>{initials(e.name)}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 13, color: active ? '#fff' : '#0f172a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.name}</div>
                      <div style={{ fontSize: 11, color: active ? 'rgba(255,255,255,0.7)' : '#64748b' }}>{e.work_position || e.role}</div>
                    </div>
                    <span style={{
                      padding: '3px 9px', borderRadius: 20, fontSize: 11, fontWeight: 600,
                      background: active ? 'rgba(255,255,255,0.2)' : st.bg,
                      color: active ? '#fff' : st.color,
                    }}>
                      {e.status === 'active' ? 'Hisoblangan' : "To'langan"}
                    </span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', paddingLeft: 48 }}>
                    <span style={{ fontSize: 11, color: active ? 'rgba(255,255,255,0.6)' : '#94a3b8' }}>Jami oylik:</span>
                    <span style={{ fontSize: 14, fontWeight: 700, color: active ? '#fff' : '#0f172a' }}>
                      {fmtUzs(e.fix_base_uzs * 1.2)}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Right: calc detail */}
        {!selectedId ? (
          <div style={{ background: '#fff', borderRadius: 14, border: '1px solid var(--border)', padding: 48, textAlign: 'center', color: 'var(--text-muted)', fontSize: 14 }}>
            Chap tarafdan xodim tanlang
          </div>
        ) : calcQ.isLoading ? (
          <div style={{ background: '#fff', borderRadius: 14, border: '1px solid var(--border)', padding: 48, textAlign: 'center', color: 'var(--text-muted)' }}>Hisoblanmoqda...</div>
        ) : calcQ.isError ? (
          <div style={{ background: '#fff', borderRadius: 14, border: '1px solid var(--border)', padding: 48, textAlign: 'center', color: '#ef4444' }}>Xatolik yuz berdi</div>
        ) : calc ? (
          <div style={{ background: '#fff', borderRadius: 14, border: '1px solid var(--border)', overflow: 'hidden' }}>
            {/* Detail header */}
            <div style={{ padding: '16px 22px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 13.5, fontWeight: 700, color: '#0f172a' }}>Hisob-kitob tafsiloti</span>
              <span style={{ background: '#dbeafe', color: '#2563eb', fontSize: 10.5, fontWeight: 700, padding: '2px 8px', borderRadius: 5 }}>DRAFT</span>
              <span style={{ marginLeft: 'auto', fontSize: 12, color: '#94a3b8' }}>
                Xodim: <strong style={{ color: '#475569' }}>{selectedEmp?.name}</strong> · ID: #{selectedId}
              </span>
              <button style={{ color: '#94a3b8', background: 'none', padding: 4 }}><MoreVertical size={16} /></button>
            </div>

            {/* Items */}
            <div style={{ padding: '4px 22px' }}>
              {[
                { icon: '💼', bg: '#dbeafe', title: 'Base Fix (Oklad)', sub: 'Shartnoma bo\'yicha asosiy stavka', value: fmtUzs(calc.fix_base_uzs), color: '#0f172a' },
                { icon: '✅', bg: '#f0fdf4', title: 'Attendance Bonus', sub: 'Kechikishlarsiz to\'liq davomat uchun', value: fmtUzs(calc.fix_base_uzs * 0.1), color: '#16a34a' },
                { icon: '📈', bg: '#dbeafe', title: 'Sales KPI (Bonusi)', sub: `${calc.kpi?.rule_name || ''}${calc.revenue_usd > 0 ? ` · $${calc.revenue_usd.toLocaleString()} tushumdan ${calc.kpi?.percent || 0}% stavka` : ''}`, value: fmtUsd(calc.kpi?.payout_usd ?? 0), color: '#2563eb' },
                { icon: '⭐', bg: '#fef3c7', title: 'Extra Bonuses', sub: calc.bonuses?.length > 0 ? `${calc.bonuses.length} ta bonus` : '—', value: fmtUzs(calc.bonuses_total_usd ?? 0), color: '#d97706' },
              ].map((row, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', padding: '15px 0', borderBottom: '1px solid #f1f5f9' }}>
                  <div style={{
                    width: 36, height: 36, borderRadius: 9, background: row.bg,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 17, marginRight: 14, flexShrink: 0,
                  }}>{row.icon}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: 13, color: '#0f172a' }}>{row.title}</div>
                    <div style={{ fontSize: 11.5, color: '#94a3b8', marginTop: 1 }}>{row.sub}</div>
                  </div>
                  <div style={{ fontWeight: 700, fontSize: 14, color: row.color }}>{row.value}</div>
                </div>
              ))}
            </div>

            {/* Tax line */}
            <div style={{ padding: '10px 22px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid #f1f5f9' }}>
              <span style={{ fontSize: 13, color: '#94a3b8' }}>Soliqlar va ushlanmalar (12%)</span>
              <span style={{ fontSize: 13, color: '#94a3b8' }}>−{fmtUzs(Math.round(calc.total_uzs * 0.12))}</span>
            </div>

            {/* Total block */}
            <div style={{ margin: '0 22px 22px', background: '#0d1b2a', borderRadius: 12, padding: '18px 22px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ color: '#fff', fontWeight: 800, fontSize: 13, letterSpacing: '0.04em', textTransform: 'uppercase' }}>Jami to'lanishi kerak</div>
                <div style={{ color: '#64748b', fontSize: 11.5, marginTop: 3, fontStyle: 'italic' }}>Hisoblangan barcha bonuslar bilan birga</div>
              </div>
              <div style={{ color: '#fff', fontWeight: 800, fontSize: 20 }}>
                {fmtUzs(calc.total_uzs)}
                {calc.total_usd > 0 && <div style={{ fontSize: 12, color: '#64748b', textAlign: 'right', marginTop: 2 }}>+ {fmtUsd(calc.total_usd)}</div>}
              </div>
            </div>

            {/* Actions */}
            <div style={{ padding: '0 22px 22px', display: 'flex', gap: 12 }}>
              <button style={{
                flex: 1, padding: '11px', borderRadius: 10, fontSize: 13, fontWeight: 600,
                border: '1.5px solid var(--border)', background: '#f8fafc', color: '#475569',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, cursor: 'pointer',
              }}>
                <Pencil size={14} /> O'zgartirish kiritish
              </button>
              <button
                onClick={handleApprove}
                style={{
                  flex: 1, padding: '11px', borderRadius: 10, fontSize: 13, fontWeight: 600,
                  border: 'none', background: 'var(--accent)', color: '#fff',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, cursor: 'pointer',
                }}
              >
                <CheckCircle2 size={14} /> Tasdiqlab yuborish
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

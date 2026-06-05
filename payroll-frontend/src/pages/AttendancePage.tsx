import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Download, FileSpreadsheet } from 'lucide-react';
import { listEmployees, getPenaltyConfig, setPenaltyConfig } from '../lib/api/payroll';

const now = new Date();
const monthTitle = `${now.toLocaleString('uz-UZ', { month: 'long' })} ${now.getFullYear()} Davomat Hisoboti`;

const STATUS: Record<string, { label: string; bg: string; color: string }> = {
  active:     { label: 'Tayyor',      bg: '#dbeafe', color: '#2563eb' },
  leave:      { label: "To'liq emas", bg: '#fee2e2', color: '#dc2626' },
  terminated: { label: 'Tayyor',      bg: '#dbeafe', color: '#2563eb' },
};

export default function AttendancePage() {
  const qc = useQueryClient();
  const empQ = useQuery({ queryKey: ['employees'], queryFn: listEmployees });
  const penQ = useQuery({ queryKey: ['penalty-config'], queryFn: getPenaltyConfig });
  const [saving, setSaving] = useState(false);

  const employees = empQ.data?.employees ?? [];
  const pen = penQ.data;

  async function savePenalties(updated: typeof pen) {
    if (!updated) return;
    setSaving(true);
    try {
      const { id: _id, updated_at: _ua, ...body } = updated;
      await setPenaltyConfig(body);
      qc.invalidateQueries({ queryKey: ['penalty-config'] });
    } finally { setSaving(false); }
  }

  const workDays = 21;
  const workHours = 168;
  const avgAttendance = 96;
  const pendingFixes = 4;

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, background: 'var(--content-bg)' }}>
      {/* Header */}
      <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--border)', background: '#fff', display: 'flex', alignItems: 'center', gap: 12 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, color: '#94a3b8', margin: 0 }}>{monthTitle}</h2>
      </div>

      <div style={{ padding: 24 }}>
        {/* Back + title */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 22 }}>
          <button style={{ display: 'flex', alignItems: 'center', color: '#94a3b8', background: 'none', border: 'none', cursor: 'pointer' }}>
            <ArrowLeft size={18} />
          </button>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: '#0f172a', margin: 0 }}>Davomat Hisobotini Shakllantirish</h1>
        </div>

        {/* Stats */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 24 }}>
          {[
            { label: 'Jami Xodimlar',          value: employees.length || 52 },
            { label: 'Jami Ish Kunlari',        value: workDays },
            { label: "O'rtacha Davomat (%)",    value: `${avgAttendance}%` },
            { label: 'Kutilayotgan Tuzatishlar', value: pendingFixes },
          ].map(s => (
            <div key={s.label} style={{ background: '#fff', borderRadius: 12, border: '1px solid var(--border)', padding: '18px 20px' }}>
              <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 8 }}>{s.label}</div>
              <div style={{ fontSize: 26, fontWeight: 800, color: '#0f172a' }}>{s.value}</div>
            </div>
          ))}
        </div>

        {/* Table */}
        <div style={{ background: '#fff', borderRadius: 14, border: '1px solid var(--border)', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#f8fafc' }}>
                {['Xodim', 'Ishlagan kunlar', 'Kechikishlar (soni/daq)', 'Erta ketishlar', 'Jami soatlar', 'Status', ''].map(h => (
                  <th key={h} style={{ padding: '12px 16px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: '#94a3b8', letterSpacing: '0.05em' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {empQ.isLoading ? (
                <tr><td colSpan={7} style={{ padding: 24, textAlign: 'center', color: '#94a3b8' }}>Yuklanmoqda...</td></tr>
              ) : (employees.length === 0 ? [
                { name: 'Azizov Temur', days: 21, late: '2/15', early: 0, hours: 168, status: 'active' },
                { name: 'Karimova Dildora', days: 20, late: '4/45', early: 1, hours: 160, status: 'leave' },
                { name: 'Allanı Dayis', days: 21, late: '2/30', early: 0, hours: 168, status: 'active' },
                { name: 'Nashova Aszahad', days: 20, late: '0/15', early: 1, hours: 168, status: 'active' },
              ] : employees.map(e => ({
                name: e.name, days: workDays - Math.floor(Math.random() * 2),
                late: `${Math.floor(Math.random() * 4)}/${Math.floor(Math.random() * 45) + 5}`,
                early: Math.floor(Math.random() * 2), hours: workHours - Math.floor(Math.random() * 8),
                status: e.status,
              }))).map((row, i) => {
                const st = STATUS[row.status] || STATUS.active;
                return (
                  <tr key={i} style={{ borderTop: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '13px 16px', fontWeight: 600, fontSize: 13, color: '#0f172a' }}>{row.name}</td>
                    <td style={{ padding: '13px 16px', fontSize: 13, color: '#475569' }}>{row.days}</td>
                    <td style={{ padding: '13px 16px', fontSize: 13, color: '#475569' }}>{row.late}</td>
                    <td style={{ padding: '13px 16px', fontSize: 13, color: '#475569' }}>{row.early}</td>
                    <td style={{ padding: '13px 16px', fontSize: 13, color: '#475569' }}>{row.hours}</td>
                    <td style={{ padding: '13px 16px' }}>
                      <span style={{ padding: '4px 12px', borderRadius: 20, fontSize: 12, fontWeight: 600, background: st.bg, color: st.color }}>{st.label}</span>
                    </td>
                    <td style={{ padding: '13px 16px' }}>
                      <button style={{ padding: '6px 14px', borderRadius: 7, border: '1.5px solid var(--border)', background: '#fff', fontSize: 12, color: '#475569', cursor: 'pointer' }}>Ko'rib chiqish</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {/* Footer actions */}
          <div style={{ padding: '16px 20px', borderTop: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <button
              disabled={saving}
              onClick={() => pen && savePenalties(pen)}
              style={{
                padding: '10px 22px', borderRadius: 10, background: 'var(--accent)', color: '#fff',
                fontSize: 13, fontWeight: 600, border: 'none', cursor: 'pointer',
              }}
            >
              {saving ? 'Saqlanmoqda...' : 'Hisobotni Yakunlash va Tasdiqlash'}
            </button>
            <div style={{ display: 'flex', gap: 10 }}>
              <button style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '9px 16px', borderRadius: 9, border: '1.5px solid var(--border)', background: '#fff', fontSize: 13, color: '#475569', cursor: 'pointer' }}>
                Eksport <FileSpreadsheet size={14} style={{ marginLeft: 2 }} /> <Download size={14} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

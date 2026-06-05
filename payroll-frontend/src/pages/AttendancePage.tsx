import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Clock, ToggleLeft } from 'lucide-react';
import { Topbar } from '../components/Topbar';
import { Card } from '../components/Card';
import { Btn } from '../components/Btn';
import { getPenaltyConfig, setPenaltyConfig } from '../lib/api/payroll';
import { fmtUzs } from '../lib/utils';

const TABS = ['Asosiy Sozlamalar', 'Grafiklar (Shifts)', 'Bayramlar va Dam olish kunlari'];

export default function AttendancePage() {
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState(0);
  const [scheduleStart, setScheduleStart] = useState('09:00');
  const [scheduleEnd, setScheduleEnd]     = useState('18:00');
  const [gracePeriod, setGracePeriod]     = useState(15);
  const [autoCorrect, setAutoCorrect]     = useState(true);
  const [reportDeadline, setReportDeadline] = useState(5);
  const [saving, setSaving] = useState(false);

  const penQ = useQuery({ queryKey: ['penalty-config'], queryFn: getPenaltyConfig });
  const pen  = penQ.data;

  async function savePenalties(updated: typeof pen) {
    if (!updated) return;
    setSaving(true);
    try {
      const { id: _id, updated_at: _ua, ...body } = updated;
      await setPenaltyConfig(body);
      qc.invalidateQueries({ queryKey: ['penalty-config'] });
    } finally { setSaving(false); }
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
      <Topbar title="Davomat Sozlamalari" />
      <div style={{ padding: 24 }}>

        {/* Tabs */}
        <div style={{ display: 'flex', borderBottom: '2px solid var(--border)', marginBottom: 24, gap: 4 }}>
          {TABS.map((t, i) => (
            <button key={i} onClick={() => setActiveTab(i)} style={{
              padding: '10px 18px', fontSize: 13, fontWeight: 600,
              borderBottom: activeTab === i ? '2px solid var(--accent)' : '2px solid transparent',
              color: activeTab === i ? 'var(--accent)' : 'var(--text-muted)', marginBottom: -2, background: 'none',
            }}>{t}</button>
          ))}
        </div>

        {activeTab === 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
            {/* Ish vaqti rejimi */}
            <Card style={{ padding: 24 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20 }}>
                <Clock size={16} style={{ color: 'var(--accent)' }} />
                <h3 style={{ fontSize: 14, fontWeight: 700 }}>Ish vaqti rejimi</h3>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
                <div>
                  <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>Check-in (Boshlanishi)</label>
                  <input type="time" value={scheduleStart} onChange={e => setScheduleStart(e.target.value)}
                    style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '9px 12px', fontSize: 14, width: '100%' }} />
                </div>
                <div>
                  <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>Check-out (Tugashi)</label>
                  <input type="time" value={scheduleEnd} onChange={e => setScheduleEnd(e.target.value)}
                    style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '9px 12px', fontSize: 14, width: '100%' }} />
                </div>
              </div>
              <div style={{ background: '#f8fafc', borderRadius: 8, padding: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>Grace Period (Kechikish chegarasi)</div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Jarima hisoblanmaydigan daqiqalar</div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <input type="number" value={gracePeriod} onChange={e => setGracePeriod(Number(e.target.value))}
                      style={{ width: 60, border: '1px solid var(--border)', borderRadius: 6, padding: '6px 8px', fontSize: 13, textAlign: 'center' }} />
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>daq.</span>
                  </div>
                </div>
              </div>
            </Card>

            {/* Korreksiya va Xatolar */}
            <Card style={{ padding: 24 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20 }}>
                <span style={{ fontSize: 14 }}>≡</span>
                <h3 style={{ fontSize: 14, fontWeight: 700 }}>Korreksiya va Xatolar</h3>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>Avtomatik korreksiya</div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Unutilgan check-outni avtomatik yopish</div>
                  </div>
                  <button onClick={() => setAutoCorrect(v => !v)} style={{
                    width: 48, height: 26, borderRadius: 13, background: autoCorrect ? 'var(--accent)' : '#cbd5e0',
                    position: 'relative', transition: 'background .2s',
                  }}>
                    <div style={{ width: 20, height: 20, borderRadius: '50%', background: '#fff', position: 'absolute', top: 3, left: autoCorrect ? 25 : 3, transition: 'left .2s' }} />
                  </button>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>Hisobot muddati</div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Oylik hisobotni topshirish kuni</div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Har oyning</span>
                    <input type="number" value={reportDeadline} onChange={e => setReportDeadline(Number(e.target.value))}
                      style={{ width: 50, border: '1px solid var(--border)', borderRadius: 6, padding: '5px 8px', fontSize: 13, textAlign: 'center' }} />
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>sanasi</span>
                  </div>
                </div>
              </div>
            </Card>

            {/* Jarima stavkalari */}
            {pen && (
              <Card style={{ padding: 24, gridColumn: '1 / -1' }}>
                <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 16 }}>Jarima stavkalari (UZS)</h3>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 10 }}>Davomat</div>
                    {[
                      { field: 'attendance_late_soft_uzs', label: 'Kech (0-5 daq)' },
                      { field: 'attendance_late_uzs',      label: 'Kech (5-10 daq)' },
                      { field: 'attendance_penalty_uzs',   label: 'Jarima (10-30 daq)' },
                      { field: 'attendance_absent_uzs',    label: 'Kelmadi' },
                    ].map(({ field, label }) => (
                      <div key={field} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                        <span style={{ fontSize: 13 }}>{label}</span>
                        <input type="number" value={(pen as any)[field]} style={{ width: 100, border: '1px solid var(--border)', borderRadius: 6, padding: '5px 8px', fontSize: 13, textAlign: 'right' }}
                          onChange={e => savePenalties({ ...pen, [field]: Number(e.target.value) })} />
                      </div>
                    ))}
                  </div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 10 }}>Hisobot</div>
                    {[
                      { field: 'report_late_soft_uzs', label: 'Kech (≤5 daq)' },
                      { field: 'report_late_uzs',      label: 'Kech (≤10 daq)' },
                      { field: 'report_penalty_uzs',   label: 'Jarima (≤30 daq)' },
                      { field: 'report_missed_uzs',    label: 'Topshirmadi' },
                    ].map(({ field, label }) => (
                      <div key={field} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                        <span style={{ fontSize: 13 }}>{label}</span>
                        <input type="number" value={(pen as any)[field]} style={{ width: 100, border: '1px solid var(--border)', borderRadius: 6, padding: '5px 8px', fontSize: 13, textAlign: 'right' }}
                          onChange={e => savePenalties({ ...pen, [field]: Number(e.target.value) })} />
                      </div>
                    ))}
                  </div>
                </div>
              </Card>
            )}

            {/* Status bar */}
            <div style={{ gridColumn: '1 / -1', background: 'var(--accent)', borderRadius: 10, padding: '16px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div style={{ color: '#fff', fontWeight: 600, fontSize: 13 }}>Joriy oy davomat statusi</div>
                <div style={{ color: 'rgba(255,255,255,0.8)', fontSize: 12 }}>Barcha xodimlar uchun ish grafigi biriktirilgan va tasdiqlangan.</div>
              </div>
              <Btn variant="outline" style={{ background: '#fff', color: 'var(--accent)' }}>Hisobotni shakllantirish</Btn>
            </div>
          </div>
        )}

        {activeTab === 1 && (
          <Card style={{ padding: 24 }}>
            <p style={{ color: 'var(--text-muted)' }}>Ish smenalari (shifts) konfiguratsiyasi — tez orada qo'shiladi.</p>
          </Card>
        )}
        {activeTab === 2 && (
          <Card style={{ padding: 24 }}>
            <p style={{ color: 'var(--text-muted)' }}>Bayramlar va dam olish kunlari ro'yxati — tez orada qo'shiladi.</p>
          </Card>
        )}
      </div>
    </div>
  );
}

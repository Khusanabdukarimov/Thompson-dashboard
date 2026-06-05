import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Trash2, CheckCircle } from 'lucide-react';
import { Topbar } from '../components/Topbar';
import { Card } from '../components/Card';
import { Btn } from '../components/Btn';
import { Modal, FormRow, inputStyle } from '../components/Modal';
import { listTariflar, createTarif, updateTarif, deleteTarif } from '../lib/api/payroll';
import type { Tarif, TarifIn } from '../lib/api/payroll';
import { fmtUzs } from '../lib/utils';

const SERVICE_TYPES = [
  { key: 'dizayn', label: 'Dizayn tariflari' },
  { key: 'neyming', label: 'Neyming tariflari' },
];

const EMPTY: TarifIn = {
  service_type: 'dizayn', name: '', loyiha_summasi: 0, variant_klass: '',
  harf_oralighi: '', tekshiruvlar: 0, deadline_mijoz: '', hudud: 'Mahalliy',
  jami_summa: 0, sort_order: 0, is_active: true,
};

const FOOTER_FEATURES = ['Domain check', 'Social Media', 'Negative Meaning', 'Slogan'];

export default function TariflarPage() {
  const qc = useQueryClient();
  const [activeType, setActiveType] = useState('dizayn');
  const [modal, setModal] = useState<'create' | 'edit' | null>(null);
  const [editing, setEditing] = useState<Tarif | null>(null);
  const [form, setForm] = useState<TarifIn>(EMPTY);
  const [saving, setSaving] = useState(false);

  const q = useQuery({
    queryKey: ['tariflar', activeType],
    queryFn: () => listTariflar(activeType),
  });

  const tariflar = q.data?.tariflar ?? [];

  function openCreate() {
    setEditing(null);
    setForm({ ...EMPTY, service_type: activeType });
    setModal('create');
  }
  function openEdit(t: Tarif) {
    setEditing(t);
    setForm({ service_type: t.service_type, name: t.name, loyiha_summasi: t.loyiha_summasi, variant_klass: t.variant_klass, harf_oralighi: t.harf_oralighi, tekshiruvlar: t.tekshiruvlar, deadline_mijoz: t.deadline_mijoz, hudud: t.hudud, jami_summa: t.jami_summa, sort_order: t.sort_order, is_active: t.is_active });
    setModal('edit');
  }
  async function handleSave() {
    setSaving(true);
    try {
      if (modal === 'edit' && editing) await updateTarif(editing.id, form);
      else await createTarif(form);
      qc.invalidateQueries({ queryKey: ['tariflar'] });
      setModal(null);
    } finally { setSaving(false); }
  }
  async function handleDelete(id: number) {
    if (!confirm('O\'chirishni tasdiqlaysizmi?')) return;
    await deleteTarif(id);
    qc.invalidateQueries({ queryKey: ['tariflar'] });
  }

  const set = (f: Partial<TarifIn>) => setForm(prev => ({ ...prev, ...f }));

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
      <Topbar title="Tariflar" />
      <div style={{ padding: 24 }}>

        <div style={{ display: 'flex', borderBottom: '2px solid var(--border)', marginBottom: 24, gap: 4 }}>
          {SERVICE_TYPES.map(st => (
            <button
              key={st.key}
              onClick={() => setActiveType(st.key)}
              style={{
                padding: '10px 20px', fontSize: 13, fontWeight: 600, borderBottom: activeType === st.key ? '2px solid var(--accent)' : '2px solid transparent',
                color: activeType === st.key ? 'var(--accent)' : 'var(--text-muted)', marginBottom: -2, background: 'none',
              }}
            >
              {st.label}
            </button>
          ))}
        </div>

        <Card>
          <div style={{ padding: '0 0 1px' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#f8fafc', borderBottom: '1px solid var(--border)' }}>
                  {['Tarif', 'Loyiha Summasi', 'Variant / Klass', 'Harf oralig\'i', 'Tekshiruvlar', 'Deadline / Mijoz tasdiqlashi', 'Hudud', 'Jami Summa', 'Amallar'].map(h => (
                    <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {q.isLoading ? (
                  <tr><td colSpan={9} style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)' }}>Yuklanmoqda...</td></tr>
                ) : tariflar.length === 0 ? (
                  <tr><td colSpan={9} style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)' }}>
                    Tariflar mavjud emas. Yangi tarif qo'shing.
                  </td></tr>
                ) : tariflar.map(t => (
                  <tr key={t.id} style={{ borderBottom: '1px solid var(--border)' }}
                    onMouseEnter={e => (e.currentTarget.style.background = '#f8fafc')}
                    onMouseLeave={e => (e.currentTarget.style.background = '')}>
                    <td style={{ padding: '12px 14px', fontWeight: 700, fontSize: 14 }}>{t.name}</td>
                    <td style={{ padding: '12px 14px', fontSize: 13 }}>{fmtUzs(t.loyiha_summasi)}</td>
                    <td style={{ padding: '12px 14px', fontSize: 13 }}>
                      {t.variant_klass && (
                        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          {t.variant_klass}
                          {t.tekshiruvlar > 2 && <span style={{ background: 'var(--green)', color: '#fff', fontSize: 10, fontWeight: 700, padding: '1px 5px', borderRadius: 4 }}>+600K</span>}
                          {t.tekshiruvlar > 2 && <span style={{ background: '#6366f1', color: '#fff', fontSize: 10, fontWeight: 700, padding: '1px 5px', borderRadius: 4 }}>EXTRA</span>}
                        </span>
                      )}
                    </td>
                    <td style={{ padding: '12px 14px', fontSize: 13 }}>{t.harf_oralighi || '—'}</td>
                    <td style={{ padding: '12px 14px', fontSize: 13 }}>
                      <div style={{ display: 'flex', gap: 4 }}>
                        {Array.from({ length: t.tekshiruvlar }, (_, i) => (
                          <CheckCircle key={i} size={14} style={{ color: 'var(--green)' }} />
                        ))}
                      </div>
                    </td>
                    <td style={{ padding: '12px 14px', fontSize: 13 }}>{t.deadline_mijoz || '—'}</td>
                    <td style={{ padding: '12px 14px', fontSize: 13 }}>
                      <span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 12, fontWeight: 600, background: t.hudud === 'Xalqaro' ? '#dbeafe' : '#f0fdf4', color: t.hudud === 'Xalqaro' ? '#1d4ed8' : '#15803d' }}>
                        {t.hudud}
                      </span>
                    </td>
                    <td style={{ padding: '12px 14px', fontWeight: 700, color: 'var(--accent)', fontSize: 14 }}>{fmtUzs(t.jami_summa)}</td>
                    <td style={{ padding: '12px 14px' }}>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <Btn small variant="outline" onClick={() => openEdit(t)}><Pencil size={13} /></Btn>
                        <Btn small variant="danger" onClick={() => handleDelete(t.id)}><Trash2 size={13} /></Btn>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Footer */}
            {tariflar.length > 0 && (
              <div style={{ padding: '14px 20px', borderTop: '1px solid var(--border)', display: 'flex', gap: 24, flexWrap: 'wrap' }}>
                {FOOTER_FEATURES.map(f => (
                  <div key={f} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-muted)' }}>
                    <CheckCircle size={14} style={{ color: 'var(--green)' }} />{f}
                  </div>
                ))}
              </div>
            )}

            {activeType === 'neyming' && tariflar.length > 0 && (
              <div style={{ margin: '0 14px 14px', padding: '10px 14px', background: '#f0f9ff', borderRadius: 8, fontSize: 12, color: '#0369a1' }}>
                Ushbu tariflar neyming xizmati uchun amal qiladi. Yakuniy payout loyiha summasi, deadline, mijoz tasdiqlashi va qo'shimcha klasslar soniga qarab hisoblanadi.
              </div>
            )}
          </div>

          <div style={{ padding: '12px 14px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end' }}>
            <Btn onClick={openCreate}><Plus size={14} /> Yangi tarif qo'shish</Btn>
          </div>
        </Card>
      </div>

      <Modal open={!!modal} title={modal === 'edit' ? 'Tarifni tahrirlash' : 'Yangi tarif'} onClose={() => setModal(null)} width={520}>
        <FormRow label="Tarif nomi"><input value={form.name} onChange={e => set({ name: e.target.value })} style={inputStyle} placeholder="Light, Air, Marine..." /></FormRow>
        <FormRow label="Xizmat turi">
          <select value={form.service_type} onChange={e => set({ service_type: e.target.value })} style={inputStyle}>
            <option value="dizayn">Dizayn</option>
            <option value="neyming">Neyming</option>
          </select>
        </FormRow>
        <FormRow label="Loyiha summasi (so'm)"><input type="number" value={form.loyiha_summasi} onChange={e => set({ loyiha_summasi: Number(e.target.value) })} style={inputStyle} /></FormRow>
        <FormRow label="Variant / Klass"><input value={form.variant_klass} onChange={e => set({ variant_klass: e.target.value })} style={inputStyle} placeholder="3+3 / 1 klass" /></FormRow>
        <FormRow label="Harf oralig'i"><input value={form.harf_oralighi} onChange={e => set({ harf_oralighi: e.target.value })} style={inputStyle} placeholder="6-8 harf" /></FormRow>
        <FormRow label="Tekshiruvlar soni"><input type="number" value={form.tekshiruvlar} onChange={e => set({ tekshiruvlar: Number(e.target.value) })} style={inputStyle} /></FormRow>
        <FormRow label="Deadline / Mijoz tasdiqlanishi"><input value={form.deadline_mijoz} onChange={e => set({ deadline_mijoz: e.target.value })} style={inputStyle} placeholder="700k + 800k" /></FormRow>
        <FormRow label="Hudud">
          <select value={form.hudud} onChange={e => set({ hudud: e.target.value })} style={inputStyle}>
            <option value="Mahalliy">Mahalliy</option>
            <option value="Xalqaro">Xalqaro</option>
          </select>
        </FormRow>
        <FormRow label="Jami summa (so'm)"><input type="number" value={form.jami_summa} onChange={e => set({ jami_summa: Number(e.target.value) })} style={inputStyle} /></FormRow>
        <FormRow label="Tartib raqami"><input type="number" value={form.sort_order} onChange={e => set({ sort_order: Number(e.target.value) })} style={inputStyle} /></FormRow>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
          <Btn variant="ghost" onClick={() => setModal(null)}>Bekor qilish</Btn>
          <Btn variant="primary" onClick={handleSave} disabled={saving}>{saving ? 'Saqlanmoqda...' : 'Saqlash'}</Btn>
        </div>
      </Modal>
    </div>
  );
}

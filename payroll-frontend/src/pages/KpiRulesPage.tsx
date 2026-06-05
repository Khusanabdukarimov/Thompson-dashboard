import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Pencil } from 'lucide-react';
import { Topbar } from '../components/Topbar';
import { Card } from '../components/Card';
import { Btn } from '../components/Btn';
import { Modal, FormRow, inputStyle } from '../components/Modal';
import { listKpiRules, createKpiRule, updateKpiRule, deleteKpiRule, listEmployees, upsertEmployeeExtra } from '../lib/api/payroll';
import type { KpiRule, KpiRuleIn, KpiTier } from '../lib/api/payroll';
import { fmtUzs } from '../lib/utils';

const ROLES = ['closer', 'hunter', 'assistant'] as const;

export default function KpiRulesPage() {
  const qc = useQueryClient();
  const kpiQ = useQuery({ queryKey: ['kpi-rules'], queryFn: listKpiRules });
  const empQ = useQuery({ queryKey: ['employees'], queryFn: listEmployees });

  const [activeRole, setActiveRole] = useState<string>('closer');
  const [modal, setModal] = useState<'create' | 'edit' | null>(null);
  const [editing, setEditing] = useState<KpiRule | null>(null);
  const [form, setForm] = useState<KpiRuleIn>({ name: '', role: 'closer', entity: 'deals', period: 'monthly', currency: 'USD', mode: 'single_tier', tiers: [], is_active: true });
  const [saving, setSaving] = useState(false);

  const rules = (kpiQ.data?.rules ?? []).filter(r => r.role === activeRole);
  const employees = (empQ.data?.employees ?? []).filter(e => e.role === activeRole);

  const roleEmployee = employees[0];
  const fixBase = roleEmployee?.fix_base_uzs ?? 0;
  const attBonus = roleEmployee?.attendance_weekly_uzs ?? 0;
  const repBonus = roleEmployee?.report_weekly_uzs ?? 0;

  function openCreate() {
    setEditing(null);
    setForm({ name: '', role: activeRole, entity: 'deals', period: 'monthly', currency: 'USD', mode: 'single_tier', tiers: [{ from: 0, to: 5000, percent: 1 }], is_active: true });
    setModal('create');
  }
  function openEdit(r: KpiRule) {
    setEditing(r);
    setForm({ name: r.name, role: r.role, entity: r.entity, period: r.period, currency: r.currency, mode: r.mode, tiers: r.tiers, is_active: r.is_active });
    setModal('edit');
  }
  async function handleSave() {
    setSaving(true);
    try {
      if (modal === 'edit' && editing) await updateKpiRule(editing.id, form);
      else await createKpiRule(form);
      qc.invalidateQueries({ queryKey: ['kpi-rules'] });
      setModal(null);
    } finally { setSaving(false); }
  }
  async function handleDelete(id: number) {
    if (!confirm('O\'chirish?')) return;
    await deleteKpiRule(id);
    qc.invalidateQueries({ queryKey: ['kpi-rules'] });
  }

  function addTier() {
    const last = form.tiers[form.tiers.length - 1];
    setForm(f => ({ ...f, tiers: [...f.tiers, { from: last?.to ?? 0, to: null, percent: 10 }] }));
  }
  function updateTier(i: number, field: keyof KpiTier, val: string) {
    setForm(f => ({
      ...f,
      tiers: f.tiers.map((t, ti) => ti === i ? { ...t, [field]: field === 'to' && val === '' ? null : Number(val) } : t),
    }));
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
      <Topbar title="KPI Qoidalari" />
      <div style={{ padding: 24 }}>

        {/* Role tabs */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
          {ROLES.map(r => (
            <button key={r} onClick={() => setActiveRole(r)} style={{
              padding: '8px 20px', borderRadius: 8, fontSize: 13, fontWeight: 600,
              background: activeRole === r ? 'var(--accent)' : '#fff',
              color: activeRole === r ? '#fff' : 'var(--text-muted)',
              border: activeRole === r ? 'none' : '1px solid var(--border)',
            }}>
              {r.charAt(0).toUpperCase() + r.slice(1)}
            </button>
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: 20 }}>
          {/* Umumiy sozlamalar */}
          <Card style={{ padding: 20 }}>
            <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 16 }}>Umumiy sozlamalar</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block', marginBottom: 5 }}>Bazaviy fix (UZS)</label>
                <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '9px 12px', fontSize: 13, display: 'flex', justifyContent: 'space-between' }}>
                  <span>{fmtUzs(fixBase)}</span>
                  <span style={{ color: 'var(--text-muted)' }}>UZS</span>
                </div>
              </div>
              <div>
                <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block', marginBottom: 5 }}>Davomat bonusi (UZS)</label>
                <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '9px 12px', fontSize: 13, display: 'flex', justifyContent: 'space-between' }}>
                  <span>{fmtUzs(attBonus)}</span>
                  <span style={{ color: 'var(--text-muted)' }}>UZS</span>
                </div>
              </div>
              <div>
                <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block', marginBottom: 5 }}>Hisobot bonusi (UZS)</label>
                <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '9px 12px', fontSize: 13, display: 'flex', justifyContent: 'space-between' }}>
                  <span>{fmtUzs(repBonus)}</span>
                  <span style={{ color: 'var(--text-muted)' }}>UZS</span>
                </div>
              </div>
            </div>
          </Card>

          {/* KPI diapazonlari */}
          <Card style={{ padding: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <h3 style={{ fontSize: 14, fontWeight: 700 }}>KPI diapazonlari ({activeRole.charAt(0).toUpperCase() + activeRole.slice(1)})</h3>
              <Btn small onClick={openCreate}><Plus size={13} /> Yangi qoida</Btn>
            </div>
            {kpiQ.isLoading ? (
              <p style={{ color: 'var(--text-muted)' }}>Yuklanmoqda...</p>
            ) : rules.length === 0 ? (
              <p style={{ color: 'var(--text-muted)', padding: '20px 0' }}>Qoidalar mavjud emas</p>
            ) : rules.map(rule => (
              <div key={rule.id} style={{ marginBottom: 20 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                  <span style={{ fontWeight: 600, fontSize: 13 }}>{rule.name}</span>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <Btn small variant="outline" onClick={() => openEdit(rule)}><Pencil size={12} /></Btn>
                    <Btn small variant="danger" onClick={() => handleDelete(rule.id)}><Trash2 size={12} /></Btn>
                  </div>
                </div>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: '#f8fafc' }}>
                      {['MIN SUMMA ($)', 'MAX SUMMA ($)', 'FOIZ (%)', 'HOLAT'].map(h => (
                        <th key={h} style={{ padding: '8px 10px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: 'var(--text-muted)' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rule.tiers.map((t, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td style={{ padding: '8px 10px', fontSize: 13 }}>{t.from.toLocaleString()}</td>
                        <td style={{ padding: '8px 10px', fontSize: 13 }}>{t.to === null ? '∞' : t.to.toLocaleString()}</td>
                        <td style={{ padding: '8px 10px', fontSize: 13, fontWeight: 600, color: 'var(--accent)' }}>{t.percent} %</td>
                        <td style={{ padding: '8px 10px' }}>
                          <div style={{ width: 34, height: 20, borderRadius: 10, background: rule.is_active ? 'var(--green)' : '#cbd5e0', position: 'relative' }}>
                            <div style={{ width: 16, height: 16, borderRadius: '50%', background: '#fff', position: 'absolute', top: 2, left: rule.is_active ? 16 : 2, transition: 'left .2s' }} />
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </Card>
        </div>
      </div>

      <Modal open={!!modal} title={modal === 'edit' ? 'Qoidani tahrirlash' : 'Yangi KPI qoida'} onClose={() => setModal(null)} width={540}>
        <FormRow label="Nomi"><input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} style={inputStyle} /></FormRow>
        <FormRow label="Rol">
          <select value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))} style={inputStyle}>
            {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </FormRow>
        <div style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-muted)' }}>KPI Tiers</label>
            <Btn small variant="outline" onClick={addTier}><Plus size={12} /> Qo'shish</Btn>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr style={{ background: '#f8fafc' }}>
              {['Dan ($)', 'Gacha ($)', 'Foiz (%)', ''].map(h => <th key={h} style={{ padding: '6px 8px', textAlign: 'left', fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>{h}</th>)}
            </tr></thead>
            <tbody>
              {form.tiers.map((t, i) => (
                <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '4px 8px' }}><input type="number" value={t.from} onChange={e => updateTier(i, 'from', e.target.value)} style={{ ...inputStyle, padding: '5px 8px' }} /></td>
                  <td style={{ padding: '4px 8px' }}><input type="number" value={t.to ?? ''} placeholder="∞" onChange={e => updateTier(i, 'to', e.target.value)} style={{ ...inputStyle, padding: '5px 8px' }} /></td>
                  <td style={{ padding: '4px 8px' }}><input type="number" value={t.percent} onChange={e => updateTier(i, 'percent', e.target.value)} style={{ ...inputStyle, padding: '5px 8px' }} /></td>
                  <td style={{ padding: '4px 8px' }}>
                    <Btn small variant="danger" onClick={() => setForm(f => ({ ...f, tiers: f.tiers.filter((_, ti) => ti !== i) }))}><Trash2 size={12} /></Btn>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
          <Btn variant="ghost" onClick={() => setModal(null)}>Bekor qilish</Btn>
          <Btn variant="primary" onClick={handleSave} disabled={saving}>{saving ? 'Saqlanmoqda...' : 'Saqlash'}</Btn>
        </div>
      </Modal>
    </div>
  );
}

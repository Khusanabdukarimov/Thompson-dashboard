import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Pencil } from 'lucide-react';
import { Topbar } from '../components/Topbar';
import { Modal, FormRow, inputStyle } from '../components/Modal';
import { Btn } from '../components/Btn';
import { listKpiRules, createKpiRule, updateKpiRule, deleteKpiRule, listEmployees } from '../lib/api/payroll';
import type { KpiRule, KpiRuleIn, KpiTier } from '../lib/api/payroll';
import { fmtUzs } from '../lib/utils';

const ROLES = ['closer', 'hunter'] as const;

function Toggle({ on }: { on: boolean }) {
  return (
    <div style={{
      width: 40, height: 22, borderRadius: 11,
      background: on ? '#16a34a' : '#cbd5e1',
      position: 'relative', cursor: 'pointer', transition: 'background .2s',
    }}>
      <div style={{
        width: 18, height: 18, borderRadius: '50%', background: '#fff',
        position: 'absolute', top: 2, left: on ? 20 : 2, transition: 'left .2s',
        boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
      }} />
    </div>
  );
}

export default function KpiRulesPage() {
  const qc = useQueryClient();
  const kpiQ = useQuery({ queryKey: ['kpi-rules'], queryFn: listKpiRules });
  const empQ = useQuery({ queryKey: ['employees'], queryFn: listEmployees });

  const [activeRole, setActiveRole] = useState<string>('closer');
  const [modal, setModal] = useState<'create' | 'edit' | null>(null);
  const [editing, setEditing] = useState<KpiRule | null>(null);
  const [form, setForm] = useState<KpiRuleIn>({
    name: '', role: 'closer', entity: 'deals', period: 'monthly',
    currency: 'USD', mode: 'single_tier', tiers: [], is_active: true,
  });
  const [saving, setSaving] = useState(false);
  const [calcMode, setCalcMode] = useState<'single' | 'progressive'>('single');

  const rules = (kpiQ.data?.rules ?? []).filter(r => r.role === activeRole);
  const employees = (empQ.data?.employees ?? []).filter(e => e.role === activeRole);
  const rep = employees[0];

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

  // Flatten all tiers from all rules for the table
  const allTiers = rules.flatMap(r => r.tiers.map(t => ({ ...t, rule: r })));

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, background: 'var(--content-bg)' }}>
      <div style={{ padding: '18px 24px', borderBottom: '1px solid var(--border)', background: '#fff', display: 'flex', alignItems: 'center', gap: 16 }}>
        <h1 style={{ fontSize: 18, fontWeight: 700, color: '#0f172a', margin: 0 }}>KPI Qoidalari</h1>
        <span style={{ fontSize: 13, color: '#94a3b8', fontWeight: 400 }}>|</span>
        <span style={{ fontSize: 13, color: '#94a3b8' }}>Qoida versiyasi</span>
      </div>

      <div style={{ padding: 24 }}>
        {/* Role tabs */}
        <div style={{ display: 'flex', gap: 2, marginBottom: 24, background: '#f1f5f9', borderRadius: 10, padding: 4, width: 'fit-content' }}>
          {ROLES.map(r => (
            <button
              key={r}
              onClick={() => setActiveRole(r)}
              style={{
                padding: '8px 24px', borderRadius: 8, fontSize: 13.5, fontWeight: 600, border: 'none', cursor: 'pointer',
                background: activeRole === r ? 'var(--accent)' : 'transparent',
                color: activeRole === r ? '#fff' : '#64748b',
                transition: 'all .15s',
              }}
            >{r.charAt(0).toUpperCase() + r.slice(1)}</button>
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: 20, alignItems: 'start' }}>
          {/* Left cards */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Umumiy sozlamalar */}
            <div style={{ background: '#fff', borderRadius: 14, border: '1px solid var(--border)', padding: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
                <div style={{ width: 32, height: 32, borderRadius: 8, background: '#dbeafe', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15 }}>💰</div>
                <h3 style={{ fontSize: 14, fontWeight: 700, color: '#0f172a', margin: 0 }}>Umumiy sozlamalar</h3>
              </div>
              {[
                { label: 'Bazaviy fix (UZS)', value: fmtUzs(rep?.fix_base_uzs ?? 4_500_000) },
                { label: 'Davomat bonusi (UZS)', value: fmtUzs(rep?.attendance_weekly_uzs ?? 500_000) },
                { label: 'Hisobot bonusi (UZS)', value: fmtUzs(rep?.report_weekly_uzs ?? 300_000) },
              ].map(row => (
                <div key={row.label} style={{ marginBottom: 14 }}>
                  <label style={{ fontSize: 11.5, color: '#94a3b8', display: 'block', marginBottom: 5 }}>{row.label}</label>
                  <div style={{ border: '1px solid var(--border)', borderRadius: 9, padding: '9px 14px', fontSize: 13, fontWeight: 500, display: 'flex', justifyContent: 'space-between', color: '#0f172a' }}>
                    <span>{row.value}</span>
                    <span style={{ color: '#94a3b8', fontWeight: 400 }}>UZS</span>
                  </div>
                </div>
              ))}
            </div>

            {/* Hisoblash usuli */}
            <div style={{ background: '#fff', borderRadius: 14, border: '1px solid var(--border)', padding: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
                <div style={{ width: 32, height: 32, borderRadius: 8, background: '#f0fdf4', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15 }}>📊</div>
                <h3 style={{ fontSize: 14, fontWeight: 700, color: '#0f172a', margin: 0 }}>Hisoblash usuli</h3>
              </div>
              {(['single', 'progressive'] as const).map(m => (
                <div
                  key={m}
                  onClick={() => setCalcMode(m)}
                  style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0', cursor: 'pointer' }}
                >
                  <div style={{
                    width: 18, height: 18, borderRadius: '50%', border: `2px solid ${calcMode === m ? 'var(--accent)' : '#cbd5e1'}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    {calcMode === m && <div style={{ width: 9, height: 9, borderRadius: '50%', background: 'var(--accent)' }} />}
                  </div>
                  <span style={{ fontSize: 13, color: '#0f172a' }}>{m === 'single' ? 'Single-tier' : 'Progressive'}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Right: KPI tiers table */}
          <div style={{ background: '#fff', borderRadius: 14, border: '1px solid var(--border)', overflow: 'hidden' }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 30, height: 30, borderRadius: 7, background: '#dbeafe', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>📈</div>
                <h3 style={{ fontSize: 14, fontWeight: 700, color: '#0f172a', margin: 0 }}>
                  KPI diapazonlari ({activeRole.charAt(0).toUpperCase() + activeRole.slice(1)})
                </h3>
              </div>
              <button
                onClick={openCreate}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px',
                  borderRadius: 8, background: 'none', border: '1.5px solid var(--border)',
                  fontSize: 12.5, fontWeight: 600, color: 'var(--accent)', cursor: 'pointer',
                }}
              >
                <Plus size={13} /> Yangi qator
              </button>
            </div>

            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#f8fafc' }}>
                  {['MIN SUMMA ($)', 'MAX SUMMA ($)', 'FOIZ (%)', 'HOLAT', 'AMAL'].map(h => (
                    <th key={h} style={{ padding: '11px 18px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: '#94a3b8', letterSpacing: '0.06em' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {kpiQ.isLoading ? (
                  <tr><td colSpan={5} style={{ padding: 24, textAlign: 'center', color: '#94a3b8' }}>Yuklanmoqda...</td></tr>
                ) : allTiers.length === 0 ? (
                  <tr><td colSpan={5} style={{ padding: 32, textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>Qoidalar mavjud emas</td></tr>
                ) : allTiers.map((t, i) => (
                  <tr key={i} style={{ borderTop: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '13px 18px', fontSize: 14, fontWeight: 500, color: '#0f172a' }}>{t.from.toLocaleString()}</td>
                    <td style={{ padding: '13px 18px', fontSize: 14, fontWeight: 500, color: '#0f172a' }}>{t.to === null ? '∞' : t.to.toLocaleString()}</td>
                    <td style={{ padding: '13px 18px' }}>
                      <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--accent)' }}>{t.percent}</span>
                      <span style={{ fontSize: 13, color: '#94a3b8', marginLeft: 3 }}>%</span>
                    </td>
                    <td style={{ padding: '13px 18px' }}><Toggle on={t.rule.is_active} /></td>
                    <td style={{ padding: '13px 18px' }}>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button onClick={() => openEdit(t.rule)} style={{ color: '#94a3b8', background: 'none', padding: 4, borderRadius: 4 }}><Pencil size={14} /></button>
                        <button onClick={() => handleDelete(t.rule.id)} style={{ color: '#94a3b8', background: 'none', padding: 4, borderRadius: 4 }}><Trash2 size={14} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Footer */}
            <div style={{ padding: '14px 20px', borderTop: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 12, color: '#94a3b8' }}>Oxirgi tahrir: Bugun, {new Date().toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit' })}</span>
              <div style={{ display: 'flex', gap: 10 }}>
                <button style={{ padding: '8px 18px', borderRadius: 8, border: '1.5px solid var(--border)', background: '#fff', fontSize: 13, color: '#475569', cursor: 'pointer' }}>Bekor qilish</button>
                <button style={{ padding: '8px 18px', borderRadius: 8, border: 'none', background: 'var(--accent)', fontSize: 13, color: '#fff', fontWeight: 600, cursor: 'pointer' }}>Saqlash</button>
              </div>
            </div>
          </div>
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
              {['Dan ($)', 'Gacha ($)', 'Foiz (%)', ''].map(h => <th key={h} style={{ padding: '6px 8px', textAlign: 'left', fontSize: 11, color: '#94a3b8', fontWeight: 600 }}>{h}</th>)}
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

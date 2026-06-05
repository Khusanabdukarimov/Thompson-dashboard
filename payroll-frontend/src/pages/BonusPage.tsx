import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Pencil, Shield, Wallet, Users, BarChart2 } from 'lucide-react';
import { Btn } from '../components/Btn';
import { Modal, FormRow, inputStyle } from '../components/Modal';
import { listBonusRules, createBonusRule, updateBonusRule, deleteBonusRule, listBonusAwards, listEmployees } from '../lib/api/payroll';
import type { BonusRule, BonusRuleIn } from '../lib/api/payroll';
import { fmtUsd, fmtUzs } from '../lib/utils';

const TABS = ['closer', 'hunter', 'dizayner', 'neyming', 'sayohat'] as const;
const TAB_LABEL: Record<string, string> = { closer: 'Closer', hunter: 'Hunter', dizayner: 'Dizayner', neyming: 'Neyming', sayohat: 'Sayohat bonuslari' };
const EMPTY: BonusRuleIn = { name: '', trigger_text: '', period: 'monthly', target_role: 'closer', rule_type: 'manual', value_kind: 'fixed_usd', value: 0, is_active: true };

function Toggle({ on }: { on: boolean }) {
  return (
    <div style={{ width: 40, height: 22, borderRadius: 11, background: on ? '#16a34a' : '#cbd5e1', position: 'relative', cursor: 'pointer', transition: 'background .2s' }}>
      <div style={{ width: 18, height: 18, borderRadius: '50%', background: '#fff', position: 'absolute', top: 2, left: on ? 20 : 2, transition: 'left .2s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)' }} />
    </div>
  );
}

export default function BonusPage() {
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState('closer');
  const [modal, setModal] = useState<'create' | 'edit' | null>(null);
  const [editing, setEditing] = useState<BonusRule | null>(null);
  const [form, setForm] = useState<BonusRuleIn>(EMPTY);
  const [saving, setSaving] = useState(false);

  const now = new Date();
  const periodLabel = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  const rulesQ  = useQuery({ queryKey: ['bonus-rules'], queryFn: listBonusRules });
  const awardsQ = useQuery({ queryKey: ['bonus-awards', periodLabel], queryFn: () => listBonusAwards(periodLabel) });
  const empQ    = useQuery({ queryKey: ['employees'], queryFn: listEmployees });

  const rules    = (rulesQ.data?.rules  ?? []).filter(r => r.target_role === activeTab);
  const allRules = rulesQ.data?.rules ?? [];
  const awards   = awardsQ.data?.awards ?? [];
  const employees = empQ.data?.employees ?? [];
  const activeRulesCount  = allRules.filter(r => r.is_active).length;
  const totalBudget  = awards.reduce((s, a) => s + a.amount_usd, 0);
  const coveredIds = new Set(awards.map(a => a.bitrix_user_id));
  const avgBonus = coveredIds.size ? totalBudget / coveredIds.size : 0;

  function openCreate() { setEditing(null); setForm({ ...EMPTY, target_role: activeTab }); setModal('create'); }
  function openEdit(r: BonusRule) {
    setEditing(r);
    setForm({ name: r.name, trigger_text: r.trigger_text, period: r.period, target_role: r.target_role, rule_type: r.rule_type, value_kind: r.value_kind, value: r.value, is_active: r.is_active });
    setModal('edit');
  }
  async function handleSave() {
    setSaving(true);
    try {
      if (modal === 'edit' && editing) await updateBonusRule(editing.id, form);
      else await createBonusRule(form);
      qc.invalidateQueries({ queryKey: ['bonus-rules'] });
      setModal(null);
    } finally { setSaving(false); }
  }
  async function handleDelete(id: number) {
    if (!confirm('O\'chirish?')) return;
    await deleteBonusRule(id);
    qc.invalidateQueries({ queryKey: ['bonus-rules'] });
  }
  const set = (f: Partial<BonusRuleIn>) => setForm(p => ({ ...p, ...f }));

  const metrics = [
    { label: 'FAOL BONUS QOIDALARI', value: activeRulesCount, sub: `+${allRules.length - activeRulesCount} yangi`, icon: Shield, color: '#3b82f6' },
    { label: 'OYLIK BONUS BUDJETI', value: fmtUzs(totalBudget * 12500), sub: 'Tasdiqlangan', icon: Wallet, color: '#8b5cf6' },
    { label: 'QAMRAB OLINGAN', value: coveredIds.size || employees.length, sub: 'Shtadagi xodimlar', icon: Users, color: '#06b6d4' },
    { label: "O'RTACHA BONUS", value: avgBonus > 0 ? fmtUsd(avgBonus) : '0 UZS', sub: 'Bir kishiga', icon: BarChart2, color: '#10b981' },
  ];

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, background: 'var(--content-bg)' }}>
      {/* Header */}
      <div style={{ padding: '18px 24px', borderBottom: '1px solid var(--border)', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
            <span style={{ fontSize: 11, fontWeight: 700, background: '#f1f5f9', color: '#64748b', padding: '2px 8px', borderRadius: 4, letterSpacing: '0.06em' }}>MASTER PANEL</span>
            <h1 style={{ fontSize: 20, fontWeight: 700, color: '#0f172a', margin: 0 }}>Global Sozlamalar</h1>
          </div>
          <p style={{ fontSize: 12.5, color: '#94a3b8', margin: 0, maxWidth: 480 }}>
            Kompaniya miqyosidagi bonus tizimi parametrlari. Ushbu sozlamalar barcha tegishli departamentlar uchun asosiy qoidalarni belgilaydi.
          </p>
        </div>
        <button
          onClick={openCreate}
          style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '10px 18px', borderRadius: 10, background: 'var(--accent)', color: '#fff', fontSize: 13, fontWeight: 600, border: 'none', cursor: 'pointer' }}
        >
          <Plus size={14} /> Yangi bonus qo'shish
        </button>
      </div>

      <div style={{ padding: 24 }}>
        {/* Metric cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 28 }}>
          {metrics.map(m => {
            const Icon = m.icon;
            return (
              <div key={m.label} style={{ background: '#fff', borderRadius: 14, border: '1px solid var(--border)', padding: '18px 20px' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 12 }}>
                  <span style={{ fontSize: 10.5, fontWeight: 700, color: '#94a3b8', letterSpacing: '0.06em' }}>{m.label}</span>
                  <div style={{ width: 32, height: 32, borderRadius: 8, background: `${m.color}18`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Icon size={15} color={m.color} />
                  </div>
                </div>
                <div style={{ fontSize: 22, fontWeight: 800, color: '#0f172a', marginBottom: 4 }}>{m.value}</div>
                <div style={{ fontSize: 11.5, color: '#94a3b8' }}>{m.sub}</div>
              </div>
            );
          })}
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', borderBottom: '2px solid #e2e8f0', marginBottom: 0, gap: 0 }}>
          {TABS.map(t => (
            <button
              key={t}
              onClick={() => setActiveTab(t)}
              style={{
                padding: '11px 22px', fontSize: 13, fontWeight: 600, border: 'none',
                borderBottom: activeTab === t ? '2.5px solid var(--accent)' : '2.5px solid transparent',
                color: activeTab === t ? 'var(--accent)' : '#64748b',
                background: 'none', cursor: 'pointer', marginBottom: -2, transition: 'color .15s',
              }}
            >{TAB_LABEL[t]}</button>
          ))}
        </div>

        {/* Table */}
        <div style={{ background: '#fff', border: '1px solid var(--border)', borderTop: 'none', borderRadius: '0 0 14px 14px', overflow: 'hidden' }}>
          <div style={{ padding: '14px 20px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#0f172a' }}>
              {TAB_LABEL[activeTab]} bonuslari{activeTab === 'neyming' ? ' (Loyihalar bo\'yicha)' : ''}
            </div>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#f8fafc' }}>
                {['BONUS NOMI', 'BONUS TURI', 'SHART', 'TARIFLAR', 'QIYMAT', 'HOLAT'].map(h => (
                  <th key={h} style={{ padding: '11px 16px', textAlign: 'left', fontSize: 10.5, fontWeight: 700, color: '#94a3b8', letterSpacing: '0.06em' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rulesQ.isLoading ? (
                <tr><td colSpan={6} style={{ padding: 24, textAlign: 'center', color: '#94a3b8' }}>Yuklanmoqda...</td></tr>
              ) : rules.length === 0 ? (
                <tr><td colSpan={6} style={{ padding: 32, textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>Bu kategoriya uchun bonus qoidalar yo'q</td></tr>
              ) : rules.map(r => (
                <tr key={r.id} style={{ borderTop: '1px solid #f1f5f9' }}>
                  <td style={{ padding: '13px 16px', fontWeight: 600, fontSize: 13, color: '#0f172a' }}>{r.name}</td>
                  <td style={{ padding: '13px 16px', fontSize: 13, color: '#475569' }}>{r.value_kind === 'percent' ? 'Tarifli' : 'Summali bonus'}</td>
                  <td style={{ padding: '13px 16px', fontSize: 13, color: '#64748b' }}>{r.trigger_text || r.period}</td>
                  <td style={{ padding: '13px 16px', fontSize: 12, color: '#94a3b8' }}>Barcha tariflar</td>
                  <td style={{ padding: '13px 16px', fontSize: 13, fontWeight: 700, color: 'var(--accent)' }}>
                    {r.value_kind === 'percent' ? `${r.value}%` : fmtUsd(r.value)}
                  </td>
                  <td style={{ padding: '13px 16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <Toggle on={r.is_active} />
                      <button onClick={() => openEdit(r)} style={{ color: '#94a3b8', background: 'none', padding: 3 }}><Pencil size={13} /></button>
                      <button onClick={() => handleDelete(r.id)} style={{ color: '#94a3b8', background: 'none', padding: 3 }}><Trash2 size={13} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Modal open={!!modal} title={modal === 'edit' ? 'Bonus qoidani tahrirlash' : 'Yangi bonus qoida'} onClose={() => setModal(null)}>
        <FormRow label="Nomi"><input value={form.name} onChange={e => set({ name: e.target.value })} style={inputStyle} /></FormRow>
        <FormRow label="Shart / Trigger"><input value={form.trigger_text} onChange={e => set({ trigger_text: e.target.value })} style={inputStyle} placeholder="Muddati bo'yicha..." /></FormRow>
        <FormRow label="Rol">
          <select value={form.target_role} onChange={e => set({ target_role: e.target.value })} style={inputStyle}>
            {TABS.map(t => <option key={t} value={t}>{TAB_LABEL[t]}</option>)}
          </select>
        </FormRow>
        <FormRow label="Davr">
          <select value={form.period} onChange={e => set({ period: e.target.value })} style={inputStyle}>
            <option value="monthly">Oylik</option>
            <option value="weekly">Haftalik</option>
            <option value="quarterly">Kvartallik</option>
          </select>
        </FormRow>
        <FormRow label="Qiymat turi">
          <select value={form.value_kind} onChange={e => set({ value_kind: e.target.value })} style={inputStyle}>
            <option value="fixed_usd">Summali ($)</option>
            <option value="percent">Foizli (%)</option>
          </select>
        </FormRow>
        <FormRow label={`Qiymat (${form.value_kind === 'percent' ? '%' : '$'})`}>
          <input type="number" value={form.value} onChange={e => set({ value: Number(e.target.value) })} style={inputStyle} />
        </FormRow>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
          <Btn variant="ghost" onClick={() => setModal(null)}>Bekor qilish</Btn>
          <Btn variant="primary" onClick={handleSave} disabled={saving}>{saving ? 'Saqlanmoqda...' : 'Saqlash'}</Btn>
        </div>
      </Modal>
    </div>
  );
}

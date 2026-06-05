import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Pencil } from 'lucide-react';
import { Topbar } from '../components/Topbar';
import { Card } from '../components/Card';
import { MetricCard } from '../components/MetricCard';
import { Btn } from '../components/Btn';
import { Modal, FormRow, inputStyle } from '../components/Modal';
import { listBonusRules, createBonusRule, updateBonusRule, deleteBonusRule, listBonusAwards, listEmployees } from '../lib/api/payroll';
import type { BonusRule, BonusRuleIn } from '../lib/api/payroll';
import { fmtUsd } from '../lib/utils';

const TABS = ['closer', 'hunter', 'dizayner', 'neyming', 'sayohat'] as const;
const TAB_LABEL: Record<string, string> = { closer: 'Closer', hunter: 'Hunter', dizayner: 'Dizayner', neyming: 'Neyming', sayohat: 'Sayohat bonuslari' };

const EMPTY: BonusRuleIn = { name: '', trigger_text: '', period: 'monthly', target_role: 'closer', rule_type: 'manual', value_kind: 'fixed_usd', value: 0, is_active: true };

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

  const rules  = (rulesQ.data?.rules  ?? []).filter(r => r.target_role === activeTab);
  const allRules = rulesQ.data?.rules ?? [];
  const awards = awardsQ.data?.awards ?? [];
  const employees = empQ.data?.employees ?? [];

  const activeRules  = allRules.filter(r => r.is_active).length;
  const totalBudget  = awards.reduce((s, a) => s + a.amount_usd, 0);
  const coveredEmpIds = new Set(awards.map(a => a.bitrix_user_id));
  const avgBonus = coveredEmpIds.size ? totalBudget / coveredEmpIds.size : 0;

  function openCreate() {
    setEditing(null);
    setForm({ ...EMPTY, target_role: activeTab });
    setModal('create');
  }
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

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
      <Topbar title="Bonus Qoidalari" />
      <div style={{ padding: 24 }}>

        {/* Metrics */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 24 }}>
          <MetricCard label="Faol bonus qoidalari" value={activeRules} sub={`+${allRules.length - activeRules} yangi`} />
          <MetricCard label="Oylik bonus budjeti" value={fmtUsd(totalBudget)} sub="Tasdiqlangan" color="var(--accent)" />
          <MetricCard label="Qamrab olingan" value={coveredEmpIds.size} sub={`${employees.length} tadagi xodimlar`} />
          <MetricCard label="O'rtacha bonus" value={fmtUsd(avgBonus)} sub="Bir kishiga" color="var(--green)" />
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', borderBottom: '2px solid var(--border)', marginBottom: 20, gap: 4 }}>
          {TABS.map(t => (
            <button key={t} onClick={() => setActiveTab(t)} style={{
              padding: '10px 18px', fontSize: 13, fontWeight: 600,
              borderBottom: activeTab === t ? '2px solid var(--accent)' : '2px solid transparent',
              color: activeTab === t ? 'var(--accent)' : 'var(--text-muted)', marginBottom: -2, background: 'none',
            }}>
              {TAB_LABEL[t]}
            </button>
          ))}
        </div>

        <Card style={{ padding: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <div style={{ fontWeight: 700, fontSize: 15 }}>
              {TAB_LABEL[activeTab]} bonuslari
              {activeTab === 'neyming' && ' (Loyihalar bo\'yicha)'}
            </div>
            <Btn onClick={openCreate}><Plus size={14} /> Yangi bonus qo'shish</Btn>
          </div>

          {rules.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', padding: '20px 0' }}>Bu kategoriya uchun bonus qoidalar yo'q</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#f8fafc', borderBottom: '1px solid var(--border)' }}>
                  {['BONUS NOMI', 'BONUS TURI', 'SHART', 'TARIFLAR', 'QIYMAT', 'HOLAT', 'AMAL'].map(h => (
                    <th key={h} style={{ padding: '10px 12px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: 'var(--text-muted)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rules.map(r => (
                  <tr key={r.id} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '12px', fontWeight: 600, fontSize: 13 }}>{r.name}</td>
                    <td style={{ padding: '12px', fontSize: 13 }}>{r.value_kind === 'percent' ? 'Tarifli' : 'Summali bonus'}</td>
                    <td style={{ padding: '12px', fontSize: 13, color: 'var(--text-muted)' }}>{r.trigger_text || r.period}</td>
                    <td style={{ padding: '12px', fontSize: 12, color: 'var(--text-muted)' }}>Barcha tariflar</td>
                    <td style={{ padding: '12px', fontSize: 13, fontWeight: 700, color: 'var(--accent)' }}>
                      {r.value_kind === 'percent' ? `${r.value}%` : fmtUsd(r.value)}
                    </td>
                    <td style={{ padding: '12px' }}>
                      <div style={{ width: 34, height: 20, borderRadius: 10, background: r.is_active ? 'var(--green)' : '#cbd5e0', position: 'relative', cursor: 'pointer' }}>
                        <div style={{ width: 16, height: 16, borderRadius: '50%', background: '#fff', position: 'absolute', top: 2, left: r.is_active ? 16 : 2, transition: 'left .2s' }} />
                      </div>
                    </td>
                    <td style={{ padding: '12px' }}>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <Btn small variant="outline" onClick={() => openEdit(r)}><Pencil size={12} /></Btn>
                        <Btn small variant="danger" onClick={() => handleDelete(r.id)}><Trash2 size={12} /></Btn>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
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

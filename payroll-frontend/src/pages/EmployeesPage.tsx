import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Pencil, Eye, Search, Plus } from 'lucide-react';
import { Topbar } from '../components/Topbar';
import { Card } from '../components/Card';
import { Badge } from '../components/Badge';
import { Btn } from '../components/Btn';
import { Modal, FormRow, inputStyle } from '../components/Modal';
import { listEmployees, listKpiRules, upsertEmployeeExtra } from '../lib/api/payroll';
import type { Employee, EmployeeExtraIn } from '../lib/api/payroll';
import { fmtUzs } from '../lib/utils';

const STATUS_TONE: Record<string, 'green' | 'amber' | 'red'> = { active: 'green', leave: 'amber', terminated: 'red' };
const STATUS_LABEL: Record<string, string> = { active: 'Faol', leave: 'Ta\'tilda', terminated: 'Bo\'shatildi' };
const ROLE_TONE: Record<string, 'blue' | 'purple' | 'amber'> = { closer: 'blue', hunter: 'purple', assistant: 'amber' };

export default function EmployeesPage() {
  const navigate  = useNavigate();
  const qc        = useQueryClient();
  const empQ      = useQuery({ queryKey: ['employees'], queryFn: listEmployees });
  const kpiQ      = useQuery({ queryKey: ['kpi-rules'], queryFn: listKpiRules });
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [editing, setEditing] = useState<Employee | null>(null);
  const [form, setForm] = useState<EmployeeExtraIn>({});
  const [saving, setSaving] = useState(false);

  const employees = (empQ.data?.employees ?? []).filter(e => {
    const matchSearch = !search || e.name.toLowerCase().includes(search.toLowerCase());
    const matchRole   = !roleFilter   || e.role === roleFilter;
    const matchStatus = !statusFilter || e.status === statusFilter;
    return matchSearch && matchRole && matchStatus;
  });

  function openEdit(e: Employee) {
    setEditing(e);
    setForm({ role: e.role, status: e.status, fix_base_uzs: e.fix_base_uzs, kpi_rule_id: e.kpi_rule_id ?? undefined, schedule_start: e.schedule_start, schedule_end: e.schedule_end, login: e.login || '', dashboard_role: e.dashboard_role });
  }

  async function handleSave() {
    if (!editing) return;
    setSaving(true);
    try {
      await upsertEmployeeExtra(editing.id, form);
      qc.invalidateQueries({ queryKey: ['employees'] });
      setEditing(null);
    } finally { setSaving(false); }
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
      <Topbar title="Xodimlar Ro'yxati" />
      <div style={{ padding: 24, flex: 1 }}>

        {/* Filters */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', flex: '1 1 200px', maxWidth: 300 }}>
            <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input placeholder="Qidiruv..." value={search} onChange={e => setSearch(e.target.value)}
              style={{ ...inputStyle, paddingLeft: 32 }} />
          </div>
          <select value={roleFilter} onChange={e => setRoleFilter(e.target.value)} style={{ ...inputStyle, width: 'auto' }}>
            <option value="">Rol: Barchasi</option>
            <option value="closer">Closer</option>
            <option value="hunter">Hunter</option>
            <option value="assistant">Assistant</option>
          </select>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={{ ...inputStyle, width: 'auto' }}>
            <option value="">Holat: Barchasi</option>
            <option value="active">Faol</option>
            <option value="leave">Ta'tilda</option>
            <option value="terminated">Bo'shatildi</option>
          </select>
          <div style={{ marginLeft: 'auto' }}>
            <Btn variant="primary"><Plus size={14} /> Yangi xodim qo'shish</Btn>
          </div>
        </div>

        <Card>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid var(--border)' }}>
                {['XODIM ISMI', 'ROL', 'FIX BASE', 'HISOBLASH MODELI', 'STATUS', 'AMALLAR'].map(h => (
                  <th key={h} style={{ padding: '12px 16px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.05em' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {empQ.isLoading ? (
                <tr><td colSpan={6} style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)' }}>Yuklanmoqda...</td></tr>
              ) : employees.map(e => (
                <tr key={e.id} style={{ borderBottom: '1px solid var(--border)' }}
                  onMouseEnter={ev => (ev.currentTarget.style.background = '#f8fafc')}
                  onMouseLeave={ev => (ev.currentTarget.style.background = '')}
                >
                  <td style={{ padding: '14px 16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{
                        width: 34, height: 34, borderRadius: '50%', background: 'var(--accent)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        color: '#fff', fontWeight: 700, fontSize: 13, flexShrink: 0,
                      }}>
                        {e.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}
                      </div>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 13 }}>{e.name}</div>
                        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{e.email || '—'}</div>
                      </div>
                    </div>
                  </td>
                  <td style={{ padding: '14px 16px' }}><Badge label={e.role} tone={ROLE_TONE[e.role] || 'gray'} /></td>
                  <td style={{ padding: '14px 16px', fontSize: 13 }}>{fmtUzs(e.fix_base_uzs)}</td>
                  <td style={{ padding: '14px 16px', fontSize: 13, color: 'var(--text-muted)' }}>
                    {e.kpi_rule_id ? (kpiQ.data?.rules.find(r => r.id === e.kpi_rule_id)?.name || 'KPI') : 'Fix salary'}
                  </td>
                  <td style={{ padding: '14px 16px' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                      <span style={{ width: 7, height: 7, borderRadius: '50%', background: e.status === 'active' ? 'var(--green)' : 'var(--red)', display: 'inline-block' }} />
                      <Badge label={STATUS_LABEL[e.status] || e.status} tone={STATUS_TONE[e.status] || 'gray'} />
                    </span>
                  </td>
                  <td style={{ padding: '14px 16px' }}>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <Btn small variant="outline" onClick={() => navigate(`/employees/${e.id}`)}><Eye size={13} />Ko'rish</Btn>
                      <Btn small variant="ghost" onClick={() => openEdit(e)}><Pencil size={13} /></Btn>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)', color: 'var(--text-muted)', fontSize: 13 }}>
            Jami: {employees.length} ta xodim
          </div>
        </Card>
      </div>

      {/* Edit Modal */}
      <Modal open={!!editing} title={`Tahrirlash — ${editing?.name}`} onClose={() => setEditing(null)} width={500}>
        <FormRow label="Rol">
          <select value={form.role || 'closer'} onChange={e => setForm(f => ({ ...f, role: e.target.value }))} style={inputStyle}>
            <option value="closer">Closer</option>
            <option value="hunter">Hunter</option>
            <option value="assistant">Assistant</option>
          </select>
        </FormRow>
        <FormRow label="Holat">
          <select value={form.status || 'active'} onChange={e => setForm(f => ({ ...f, status: e.target.value }))} style={inputStyle}>
            <option value="active">Faol</option>
            <option value="leave">Ta'tilda</option>
            <option value="terminated">Bo'shatildi</option>
          </select>
        </FormRow>
        <FormRow label="Fix Base (so'm)">
          <input type="number" value={form.fix_base_uzs || 0} onChange={e => setForm(f => ({ ...f, fix_base_uzs: Number(e.target.value) }))} style={inputStyle} />
        </FormRow>
        <FormRow label="KPI Qoidasi">
          <select value={form.kpi_rule_id || ''} onChange={e => setForm(f => ({ ...f, kpi_rule_id: e.target.value ? Number(e.target.value) : null }))} style={inputStyle}>
            <option value="">— Yo'q —</option>
            {kpiQ.data?.rules.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </FormRow>
        <FormRow label="Ish boshlanishi">
          <input type="time" value={form.schedule_start || '09:00'} onChange={e => setForm(f => ({ ...f, schedule_start: e.target.value }))} style={inputStyle} />
        </FormRow>
        <FormRow label="Ish tugashi">
          <input type="time" value={form.schedule_end || '18:00'} onChange={e => setForm(f => ({ ...f, schedule_end: e.target.value }))} style={inputStyle} />
        </FormRow>
        <FormRow label="Login">
          <input value={form.login || ''} onChange={e => setForm(f => ({ ...f, login: e.target.value }))} style={inputStyle} />
        </FormRow>
        <FormRow label="Yangi parol (bo'sh qoldirsa o'zgartirilmaydi)">
          <input type="password" placeholder="••••••••" onChange={e => setForm(f => ({ ...f, password: e.target.value }))} style={inputStyle} />
        </FormRow>
        <FormRow label="Dashboard Roli">
          <select value={form.dashboard_role || ''} onChange={e => setForm(f => ({ ...f, dashboard_role: e.target.value }))} style={inputStyle}>
            <option value="">— Kirish yo'q —</option>
            <option value="admin">Admin</option>
            <option value="owner">Owner</option>
            <option value="closer">Closer</option>
            <option value="hunter">Hunter</option>
          </select>
        </FormRow>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
          <Btn variant="ghost" onClick={() => setEditing(null)}>Bekor qilish</Btn>
          <Btn variant="primary" onClick={handleSave} disabled={saving}>{saving ? 'Saqlanmoqda...' : 'Saqlash'}</Btn>
        </div>
      </Modal>
    </div>
  );
}

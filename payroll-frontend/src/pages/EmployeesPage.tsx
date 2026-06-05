import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Pencil, Eye, Search, Plus, ChevronDown } from 'lucide-react';
import { Modal, FormRow, inputStyle } from '../components/Modal';
import { Btn } from '../components/Btn';
import { listEmployees, listKpiRules, upsertEmployeeExtra } from '../lib/api/payroll';
import type { Employee, EmployeeExtraIn } from '../lib/api/payroll';

const now = new Date();
const monthStr = `${now.getFullYear()} yil — ${now.toLocaleString('uz-UZ', { month: 'long' })}`;

const ROLE_STYLE: Record<string, { bg: string; color: string }> = {
  closer:    { bg: '#eff6ff', color: '#2563eb' },
  hunter:    { bg: '#f5f3ff', color: '#7c3aed' },
  assistant: { bg: '#fefce8', color: '#ca8a04' },
  dizayner:  { bg: '#fdf2f8', color: '#db2777' },
  neymer:    { bg: '#f0fdf4', color: '#16a34a' },
};
const STATUS_STYLE: Record<string, { dot: string; label: string }> = {
  active:     { dot: '#16a34a', label: 'Faol' },
  leave:      { dot: '#d97706', label: "Ta'tilda" },
  terminated: { dot: '#dc2626', label: 'Nofaol' },
};

function initials(name: string) {
  return name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
}

function FilterBtn({ label, value, options, onChange }: { label: string; value: string; options: { v: string; l: string }[]; onChange: (v: string) => void }) {
  return (
    <div style={{ position: 'relative' }}>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        style={{
          appearance: 'none', padding: '8px 32px 8px 14px', borderRadius: 9, border: '1.5px solid var(--border)',
          background: '#fff', fontSize: 13, color: '#475569', cursor: 'pointer', fontWeight: 500,
        }}
      >
        <option value="">{label}: Barchasi</option>
        {options.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
      </select>
      <ChevronDown size={13} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', color: '#94a3b8', pointerEvents: 'none' }} />
    </div>
  );
}

export default function EmployeesPage() {
  const navigate = useNavigate();
  const qc       = useQueryClient();
  const empQ     = useQuery({ queryKey: ['employees'], queryFn: listEmployees });
  const kpiQ     = useQuery({ queryKey: ['kpi-rules'], queryFn: listKpiRules });
  const [search, setSearch]       = useState('');
  const [roleFilter, setRoleFilter]     = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [editing, setEditing] = useState<Employee | null>(null);
  const [form, setForm]       = useState<EmployeeExtraIn>({});
  const [saving, setSaving]   = useState(false);

  const employees = (empQ.data?.employees ?? []).filter(e => {
    const ms = !search || e.name.toLowerCase().includes(search.toLowerCase());
    const mr = !roleFilter   || e.role === roleFilter;
    const mst = !statusFilter || e.status === statusFilter;
    return ms && mr && mst;
  });

  function openEdit(e: Employee) {
    setEditing(e);
    setForm({ role: e.role, status: e.status, fix_base_uzs: e.fix_base_uzs, kpi_rule_id: e.kpi_rule_id ?? undefined, schedule_start: e.schedule_start, schedule_end: e.schedule_end, login: e.login || '', dashboard_role: e.dashboard_role });
  }
  async function handleSave() {
    if (!editing) return;
    setSaving(true);
    try { await upsertEmployeeExtra(editing.id, form); qc.invalidateQueries({ queryKey: ['employees'] }); setEditing(null); }
    finally { setSaving(false); }
  }

  const modelLabel = (e: Employee) => {
    if (!e.kpi_rule_id) return 'Fix salary';
    const r = kpiQ.data?.rules.find(r => r.id === e.kpi_rule_id);
    return r ? `Fix + ${r.name}` : 'Fix + KPI';
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, background: 'var(--content-bg)' }}>
      {/* Topbar */}
      <div style={{ padding: '18px 24px', borderBottom: '1px solid var(--border)', background: '#fff', display: 'flex', alignItems: 'center', gap: 16 }}>
        <h1 style={{ fontSize: 18, fontWeight: 700, color: '#0f172a', margin: 0 }}>Xodimlar Ro'yxati</h1>
        <span style={{ fontSize: 14, color: 'var(--accent)', fontWeight: 600, borderBottom: '2px solid var(--accent)', paddingBottom: 2 }}>{monthStr}</span>
        <div style={{ marginLeft: 'auto', position: 'relative' }}>
          <Search size={14} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
          <input
            placeholder="Qidiruv..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ padding: '8px 14px 8px 34px', borderRadius: 9, border: '1.5px solid var(--border)', fontSize: 13, background: '#f8fafc', color: '#0f172a', width: 200 }}
          />
        </div>
      </div>

      <div style={{ padding: 24 }}>
        {/* Filter row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
          <FilterBtn label="Rol" value={roleFilter} onChange={setRoleFilter}
            options={[{ v: 'closer', l: 'Closer' }, { v: 'hunter', l: 'Hunter' }, { v: 'assistant', l: 'Assistant' }]} />
          <FilterBtn label="Bo'lim" value="" onChange={() => {}}
            options={[{ v: 'sotuv', l: 'Sotuv bo\'limi' }]} />
          <FilterBtn label="Holat" value={statusFilter} onChange={setStatusFilter}
            options={[{ v: 'active', l: 'Faol' }, { v: 'leave', l: "Ta'tilda" }, { v: 'terminated', l: 'Nofaol' }]} />
          <button style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', color: 'var(--accent)', fontSize: 13, fontWeight: 500, cursor: 'pointer' }}
            onClick={() => { setRoleFilter(''); setStatusFilter(''); setSearch(''); }}>
            Filtrni tozalash
          </button>
          <div style={{ marginLeft: 'auto' }}>
            <button style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '9px 18px',
              borderRadius: 10, background: 'var(--accent)', color: '#fff', fontSize: 13, fontWeight: 600, border: 'none', cursor: 'pointer',
            }}>
              <Plus size={15} /> Yangi xodim qo'shish
            </button>
          </div>
        </div>

        {/* Table */}
        <div style={{ background: '#fff', borderRadius: 14, border: '1px solid var(--border)', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#f8fafc', borderBottom: '1px solid var(--border)' }}>
                {['XODIM ISMI', 'ROL', 'ISHGA KIRGAN SANA', 'HISOBLASH MODELI', 'STATUS', 'AMALLAR'].map(h => (
                  <th key={h} style={{ padding: '12px 18px', textAlign: 'left', fontSize: 10.5, fontWeight: 700, color: '#94a3b8', letterSpacing: '0.06em' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {empQ.isLoading ? (
                <tr><td colSpan={6} style={{ padding: 32, textAlign: 'center', color: '#94a3b8' }}>Yuklanmoqda...</td></tr>
              ) : employees.length === 0 ? (
                <tr><td colSpan={6} style={{ padding: 32, textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>Xodimlar topilmadi</td></tr>
              ) : employees.map(e => {
                const rs = ROLE_STYLE[e.role] || { bg: '#f1f5f9', color: '#64748b' };
                const ss = STATUS_STYLE[e.status] || { dot: '#94a3b8', label: e.status };
                return (
                  <tr key={e.id} style={{ borderTop: '1px solid #f1f5f9', cursor: 'pointer', transition: 'background .1s' }}
                    onMouseEnter={ev => (ev.currentTarget.style.background = '#f8fafc')}
                    onMouseLeave={ev => (ev.currentTarget.style.background = '')}>
                    <td style={{ padding: '14px 18px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <div style={{
                          width: 38, height: 38, borderRadius: '50%', background: 'var(--accent)',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          color: '#fff', fontWeight: 700, fontSize: 13, flexShrink: 0,
                        }}>{initials(e.name)}</div>
                        <div>
                          <div style={{ fontWeight: 600, fontSize: 13.5, color: '#0f172a' }}>{e.name}</div>
                          <div style={{ fontSize: 12, color: '#94a3b8' }}>{e.email || `${e.role}@agency.uz`}</div>
                        </div>
                      </div>
                    </td>
                    <td style={{ padding: '14px 18px' }}>
                      <span style={{ padding: '4px 10px', borderRadius: 6, fontSize: 12, fontWeight: 600, background: rs.bg, color: rs.color }}>
                        {e.role.charAt(0).toUpperCase() + e.role.slice(1)}
                      </span>
                    </td>
                    <td style={{ padding: '14px 18px', fontSize: 13, color: '#475569' }}>—</td>
                    <td style={{ padding: '14px 18px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                        <span style={{ fontSize: 14 }}>🛡️</span>
                        <span style={{ fontSize: 13, color: '#475569' }}>{modelLabel(e)}</span>
                      </div>
                    </td>
                    <td style={{ padding: '14px 18px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <div style={{ width: 8, height: 8, borderRadius: '50%', background: ss.dot }} />
                        <span style={{ fontSize: 13, fontWeight: 600, color: ss.dot }}>{ss.label}</span>
                      </div>
                    </td>
                    <td style={{ padding: '14px 18px' }}>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button
                          onClick={() => navigate(`/employees/${e.id}`)}
                          style={{ padding: '6px 12px', borderRadius: 7, border: '1.5px solid var(--border)', background: '#fff', fontSize: 12, fontWeight: 500, color: '#475569', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}
                        >
                          <Eye size={13} /> Ko'rib chiqish
                        </button>
                        <button
                          onClick={() => openEdit(e)}
                          style={{ padding: '6px 10px', borderRadius: 7, border: '1.5px solid var(--border)', background: '#fff', fontSize: 12, color: '#94a3b8', cursor: 'pointer' }}
                        ><Pencil size={13} /></button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div style={{ padding: '12px 18px', borderTop: '1px solid #f1f5f9', color: '#94a3b8', fontSize: 12.5 }}>
            Jami: <strong style={{ color: '#475569' }}>{employees.length}</strong> ta xodim
          </div>
        </div>
      </div>

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
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
          <Btn variant="ghost" onClick={() => setEditing(null)}>Bekor qilish</Btn>
          <Btn variant="primary" onClick={handleSave} disabled={saving}>{saving ? 'Saqlanmoqda...' : 'Saqlash'}</Btn>
        </div>
      </Modal>
    </div>
  );
}

import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import * as Dialog from '@radix-ui/react-dialog';
import { Topbar } from '@/components/Topbar';
import { Button } from '@/components/Button';
import { Badge } from '@/components/Badge';
import { Avatar } from '@/components/Avatar';
import { DataTable } from '@/components/DataTable';
// skeleton handled inside DataTable via loading prop
import { listEmployees, listKpiRules, upsertEmployeeExtra } from '@/lib/api/payroll';
import type { Employee, EmployeeExtraIn } from '@/lib/api/payroll';
import { fmtNum } from '@/lib/utils';

const ROLES = [
  { value: 'closer', label: 'Closer', tone: 'blue' as const },
  { value: 'hunter', label: 'Hunter', tone: 'purple' as const },
  { value: 'assistant', label: 'Assistant', tone: 'amber' as const },
];

const STATUSES = [
  { value: 'active',     label: 'Faol',          tone: 'green' as const },
  { value: 'leave',      label: 'Ta\'tilda',     tone: 'amber' as const },
  { value: 'terminated', label: 'Bo\'shatildi',  tone: 'red'   as const },
];

export default function EmployeesPage() {
  const empQ = useQuery({ queryKey: ['payroll/employees'], queryFn: listEmployees });
  const kpiQ = useQuery({ queryKey: ['payroll/kpi-rules'], queryFn: listKpiRules });
  const [editing, setEditing] = useState<Employee | null>(null);
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const list = empQ.data?.employees ?? [];
    const s = search.trim().toLowerCase();
    return s ? list.filter(e => e.name.toLowerCase().includes(s) || (e.email ?? '').toLowerCase().includes(s)) : list;
  }, [empQ.data, search]);

  const columns = useMemo<ColumnDef<Employee, unknown>[]>(() => [
    {
      header: 'Xodim', accessorKey: 'name',
      cell: (c) => {
        const e = c.row.original;
        return (
          <div className="flex items-center gap-2.5">
            <Avatar name={e.name} />
            <div>
              <div className="font-medium">{e.name}</div>
              <div className="text-[10px] text-text3">{e.email ?? '—'}</div>
            </div>
          </div>
        );
      },
    },
    {
      header: 'Rol', accessorKey: 'role',
      cell: (c) => {
        const r = ROLES.find(x => x.value === c.getValue<string>());
        return <Badge tone={r?.tone ?? 'gray'}>{r?.label ?? c.getValue<string>()}</Badge>;
      },
    },
    { header: 'Ish vaqti', accessorFn: (e) => `${e.schedule_start}–${e.schedule_end}`, cell: (c) => <span className="mono text-text2 text-[11px]">{c.getValue<string>()}</span> },
    { header: 'Fix base (oy)', accessorKey: 'fix_base_uzs', cell: (c) => <span className="mono">{fmtNum(c.getValue<number>())}</span> },
    { header: 'Attendance/hafta', accessorKey: 'attendance_weekly_uzs', cell: (c) => <span className="mono">{fmtNum(c.getValue<number>())}</span> },
    { header: 'Report/hafta', accessorKey: 'report_weekly_uzs', cell: (c) => <span className="mono">{fmtNum(c.getValue<number>())}</span> },
    {
      header: 'KPI', accessorKey: 'kpi_rule_id',
      cell: (c) => {
        const id = c.getValue<number | null>();
        if (!id) return <span className="text-text3">—</span>;
        const r = kpiQ.data?.rules.find(x => x.id === id);
        return <span className="text-blue text-[11px]">{r?.name ?? `Rule #${id}`}</span>;
      },
    },
    {
      header: 'Status', accessorKey: 'status',
      cell: (c) => {
        const s = STATUSES.find(x => x.value === c.getValue<string>());
        return <Badge tone={s?.tone ?? 'gray'}>{s?.label ?? c.getValue<string>()}</Badge>;
      },
    },
    {
      header: 'Amal', id: 'action', enableSorting: false,
      cell: (c) => <Button size="sm" onClick={() => setEditing(c.row.original)}>Tahrirlash</Button>,
    },
  ], [kpiQ.data]);

  return (
    <>
      <Topbar
        title="Xodimlar"
        sub={`${empQ.data?.count ?? 0} ta xodim · Bitrix24'dan sinxronlashgan`}
        actions={
          <>
            <input
              className="px-3 py-1.5 rounded border border-border2 bg-bg2 text-[12px] shadow-xs w-44 placeholder:text-text3"
              placeholder="Qidirish..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <Button onClick={() => empQ.refetch()}>Yangilash</Button>
          </>
        }
      />
      <div className="flex-1 overflow-y-auto px-[22px] py-[18px] bg-bg">
        <DataTable<Employee>
          columns={columns}
          data={filtered}
          pageSize={25}
          loading={empQ.isLoading}
          skeletonRows={8}
        />
        {editing && (
          <EditModal
            employee={editing}
            kpiRules={kpiQ.data?.rules ?? []}
            onClose={() => setEditing(null)}
          />
        )}
      </div>
    </>
  );
}

function EditModal({
  employee, kpiRules, onClose,
}: { employee: Employee; kpiRules: { id: number; name: string }[]; onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState<EmployeeExtraIn>({
    role: employee.role,
    status: employee.status,
    fix_base_uzs: employee.fix_base_uzs,
    attendance_weekly_uzs: employee.attendance_weekly_uzs,
    report_weekly_uzs: employee.report_weekly_uzs,
    schedule_start: employee.schedule_start,
    schedule_end: employee.schedule_end,
    kpi_rule_id: employee.kpi_rule_id,
    notes: employee.notes ?? '',
  });
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      await upsertEmployeeExtra(employee.id, form);
      qc.invalidateQueries({ queryKey: ['payroll/employees'] });
      onClose();
    } catch (e) {
      alert(`Xato: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog.Root open onOpenChange={(o) => { if (!o) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40 backdrop-blur-[2px] z-[300]" />
        <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-bg2 border border-border rounded-xl p-6 w-[480px] max-h-[88vh] overflow-y-auto shadow-lg z-[301]">
          <Dialog.Title className="text-[15px] font-semibold mb-4">Xodim tahrirlash — {employee.name}</Dialog.Title>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Rol">
              <select className={fi} value={form.role} onChange={(e) => setForm(f => ({ ...f, role: e.target.value }))}>
                {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </Field>
            <Field label="Status">
              <select className={fi} value={form.status} onChange={(e) => setForm(f => ({ ...f, status: e.target.value }))}>
                {STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </Field>
            <Field label="Fix base (oy, so'm)">
              <input type="number" className={fi} value={form.fix_base_uzs ?? 0} onChange={(e) => setForm(f => ({ ...f, fix_base_uzs: Number(e.target.value) }))} />
            </Field>
            <Field label="Attendance haftalik (so'm)">
              <input type="number" className={fi} value={form.attendance_weekly_uzs ?? 0} onChange={(e) => setForm(f => ({ ...f, attendance_weekly_uzs: Number(e.target.value) }))} />
            </Field>
            <Field label="Report haftalik (so'm)">
              <input type="number" className={fi} value={form.report_weekly_uzs ?? 0} onChange={(e) => setForm(f => ({ ...f, report_weekly_uzs: Number(e.target.value) }))} />
            </Field>
            <Field label="KPI qoida">
              <select className={fi} value={form.kpi_rule_id ?? ''} onChange={(e) => setForm(f => ({ ...f, kpi_rule_id: e.target.value ? Number(e.target.value) : null }))}>
                <option value="">— KPI yo'q —</option>
                {kpiRules.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </Field>
            <Field label="Ish boshlanishi">
              <input type="time" className={fi} value={form.schedule_start ?? '09:00'} onChange={(e) => setForm(f => ({ ...f, schedule_start: e.target.value }))} />
            </Field>
            <Field label="Ish tugashi">
              <input type="time" className={fi} value={form.schedule_end ?? '18:00'} onChange={(e) => setForm(f => ({ ...f, schedule_end: e.target.value }))} />
            </Field>
          </div>

          <Field label="Izoh" className="mt-3">
            <textarea className={fi} rows={2} value={form.notes ?? ''} onChange={(e) => setForm(f => ({ ...f, notes: e.target.value }))} />
          </Field>

          <div className="flex justify-end gap-2 mt-5 pt-4 border-t border-border">
            <Button onClick={onClose}>Bekor</Button>
            <Button variant="primary" disabled={saving} onClick={save}>{saving ? 'Saqlanmoqda…' : 'Saqlash'}</Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

const fi = 'w-full px-2.5 py-2 rounded-[7px] border border-border bg-bg text-text text-[12.5px] focus:outline-none focus:border-blue focus:bg-bg2 focus:shadow-[0_0_0_3px_rgba(34,102,245,0.1)]';

function Field({ label, children, className = '' }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <label className="block text-[10px] text-text3 mb-1 uppercase tracking-wider font-medium">{label}</label>
      {children}
    </div>
  );
}

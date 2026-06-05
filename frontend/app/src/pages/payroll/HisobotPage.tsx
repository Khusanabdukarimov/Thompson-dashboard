import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as Dialog from '@radix-ui/react-dialog';
import type { ColumnDef } from '@tanstack/react-table';
import { Plus } from 'lucide-react';
import { Topbar } from '@/components/Topbar';
import { Button } from '@/components/Button';
import { Badge } from '@/components/Badge';
import { Avatar } from '@/components/Avatar';
import { DataTable } from '@/components/DataTable';
import { MetricRowSkeleton } from '@/components/Skeleton';
import {
  getDisciplineStats, getPenaltyConfig, setPenaltyConfig,
  upsertReportLog, upsertAttendanceLog, listEmployees, autoSyncLogs,
} from '@/lib/api/payroll';
import { useToast } from '@/components/Toast';
import type { DisciplineEmployee, LogBucket, PenaltyConfig } from '@/lib/api/payroll';
import { fmtNum } from '@/lib/utils';
import { MONTH_KEYS, MONTH_LABELS } from '@/lib/api/meta';

const now = new Date();
const DEFAULT_YEAR = now.getFullYear();
const DEFAULT_MONTH = now.getMonth() + 1;

const REPORT_BUCKETS: { id: LogBucket; label: string; tone: 'green' | 'amber' | 'orange' | 'red' | 'gray'; rule?: string }[] = [
  { id: 'on-time',  label: "Vaqtida ≤19:00",            tone: 'green',  rule: 'sof topshirish' },
  { id: 'late-soft', label: 'Kechroq 19:01–19:05',       tone: 'amber' },
  { id: 'late',     label: 'Kech 19:06–19:10',           tone: 'orange' },
  { id: 'penalty',  label: 'Juda kech ⚡ 19:11–19:30',    tone: 'red',    rule: 'jarima' },
  { id: 'missed',   label: 'Topshirmadi',                tone: 'gray' },
];

const ATTENDANCE_BUCKETS: { id: LogBucket; label: string; tone: 'green' | 'amber' | 'orange' | 'red' | 'gray'; rule?: string }[] = [
  { id: 'on-time',   label: 'Vaqtida ≤09:00',           tone: 'green' },
  { id: 'late-soft', label: 'Kechroq 09:01–09:05',      tone: 'amber' },
  { id: 'late',      label: 'Kech 09:06–09:10',         tone: 'orange' },
  { id: 'penalty',   label: 'Juda kech ⚡ 09:11–09:30',  tone: 'red',   rule: 'jarima' },
  { id: 'absent',    label: 'Kelmadi',                  tone: 'gray' },
];

type Mode = 'report' | 'attendance';

export default function HisobotPage() {
  const [year, setYear] = useState(DEFAULT_YEAR);
  const [month, setMonth] = useState(DEFAULT_MONTH);
  const [mode, setMode] = useState<Mode>('report');
  const [logEntry, setLogEntry] = useState<{ employeeId: number; name: string } | null>(null);
  const [editPenalty, setEditPenalty] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const qcRoot = useQueryClient();
  const toast = useToast();

  async function handleSync() {
    setSyncing(true);
    try {
      const r = await autoSyncLogs(year, month, mode);
      qcRoot.invalidateQueries({ queryKey: ['payroll/discipline-stats'] });
      const summary = `${r.created} yaratildi · ${r.updated} yangilandi`;
      if (r.note) {
        toast.info(`${mode === 'report' ? 'Hisobot' : 'Davomat'} sinx`, `${summary}. ${r.note}`);
      } else {
        toast.success(`${mode === 'report' ? 'Hisobot' : 'Davomat'} sinx tugadi`, summary);
      }
    } catch (e) {
      toast.error('Sinx xatosi', (e as Error).message);
    } finally {
      setSyncing(false);
    }
  }

  const statsQ = useQuery({
    queryKey: ['payroll/discipline-stats', year, month],
    queryFn: () => getDisciplineStats(year, month),
  });
  const penaltyQ = useQuery({ queryKey: ['payroll/penalty-config'], queryFn: getPenaltyConfig });

  const buckets = mode === 'report' ? REPORT_BUCKETS : ATTENDANCE_BUCKETS;
  const formula = mode === 'report' ? 'Hisobot formulasi (kunlik 19:00 deadline):' : 'Davomat formulasi (09:00 ish boshlanishi):';

  // Aggregated metrics per mode
  const totals = useMemo(() => {
    const out: Record<LogBucket, number> = { 'on-time': 0, 'late-soft': 0, 'late': 0, 'penalty': 0, 'absent': 0, 'missed': 0 };
    for (const e of statsQ.data?.employees ?? []) {
      const buckets = mode === 'report' ? e.report : e.attendance;
      for (const k of Object.keys(out) as LogBucket[]) {
        out[k] += buckets[k] ?? 0;
      }
    }
    return out;
  }, [statsQ.data, mode]);

  // Score = (on-time + 0.5 * late-soft) / total submissions
  function score(rep: Record<LogBucket, number>) {
    const total = Object.values(rep).reduce((s, v) => s + v, 0);
    if (total === 0) return null;
    const w = (rep['on-time'] ?? 0) * 1 + (rep['late-soft'] ?? 0) * 0.7 + (rep['late'] ?? 0) * 0.4 + (rep['penalty'] ?? 0) * 0.2;
    return (w / total) * 100;
  }

  const columns = useMemo<ColumnDef<DisciplineEmployee, unknown>[]>(() => {
    const cols: ColumnDef<DisciplineEmployee, unknown>[] = [
      {
        header: 'Xodim', accessorKey: 'name',
        cell: (c) => {
          const e = c.row.original;
          return (
            <div className="flex items-center gap-2.5">
              <Avatar name={e.name} />
              <span className="font-medium">{e.name}</span>
            </div>
          );
        },
      },
    ];
    for (const b of buckets) {
      cols.push({
        header: b.label.split(' ')[0],
        id: `b_${b.id}`,
        accessorFn: (r) => (mode === 'report' ? r.report : r.attendance)[b.id] ?? 0,
        cell: (c) => {
          const v = c.getValue<number>();
          if (v === 0) return <span className="text-text3 mono">0</span>;
          return <Badge tone={b.tone}>{v}</Badge>;
        },
      });
    }
    cols.push({
      header: 'Ball',
      id: 'score',
      accessorFn: (r) => score(mode === 'report' ? r.report : r.attendance) ?? 0,
      cell: (c) => {
        const v = c.getValue<number>();
        const buckets = mode === 'report' ? c.row.original.report : c.row.original.attendance;
        const total = Object.values(buckets).reduce((s, x) => s + x, 0);
        if (total === 0) return <span className="text-text3">—</span>;
        const tone = v >= 90 ? 'green' : v >= 75 ? 'amber' : 'red';
        return <Badge tone={tone}>{v.toFixed(0)}%</Badge>;
      },
    });
    cols.push({
      header: 'Amal', id: 'action', enableSorting: false,
      cell: (c) => <Button size="sm" onClick={() => setLogEntry({ employeeId: c.row.original.id, name: c.row.original.name })}><Plus className="w-3 h-3" /> Log</Button>,
    });
    return cols;
  }, [buckets, mode]);

  return (
    <>
      <Topbar
        title="Hisobot intizomi"
        sub={`Kunlik 19:00 deadline · davomat 09:00 · ${MONTH_LABELS[MONTH_KEYS[month - 1]]} ${year}`}
        actions={
          <>
            <select className="px-2.5 py-1.5 rounded border border-border2 bg-bg2 text-[12px] shadow-xs" value={month} onChange={(e) => setMonth(Number(e.target.value))}>
              {MONTH_KEYS.map((m, i) => <option key={m} value={i + 1}>{MONTH_LABELS[m]}</option>)}
            </select>
            <select className="px-2.5 py-1.5 rounded border border-border2 bg-bg2 text-[12px] shadow-xs" value={year} onChange={(e) => setYear(Number(e.target.value))}>
              {[DEFAULT_YEAR, DEFAULT_YEAR - 1].map(y => <option key={y} value={y}>{y}</option>)}
            </select>
            <Button onClick={handleSync} disabled={syncing}>{syncing ? 'Sinxronlanmoqda…' : 'Bitrix\'dan sinx'}</Button>
            <Button onClick={() => setEditPenalty(true)}>Jarima tariflari</Button>
          </>
        }
      />

      <div className="flex-1 overflow-y-auto px-3 sm:px-[22px] py-3 sm:py-[18px] bg-bg">
        {/* Mode tabs */}
        <div className="flex gap-1.5 mb-3">
          <ModeTab active={mode === 'report'}     onClick={() => setMode('report')}     label="Hisobot intizomi" hint={`${(statsQ.data?.employees ?? []).reduce((s, e) => s + Object.values(e.report).reduce((a, b) => a + b, 0), 0)} log`} />
          <ModeTab active={mode === 'attendance'} onClick={() => setMode('attendance')} label="Davomat"          hint={`${(statsQ.data?.employees ?? []).reduce((s, e) => s + Object.values(e.attendance).reduce((a, b) => a + b, 0), 0)} log`} />
        </div>

        {/* Formula box */}
        <div className="bg-bg2 border border-border rounded-md px-3 py-2 mb-4 flex flex-wrap gap-1 items-center shadow">
          <span className="text-[11px] text-text3 mr-2 font-medium">{formula}</span>
          {buckets.map(b => (
            <span key={b.id} className={`inline-flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-full border ${
              b.tone === 'green'  ? 'bg-green-bg  text-green  border-green-bd' :
              b.tone === 'amber'  ? 'bg-amber-bg  text-amber  border-amber-bd' :
              b.tone === 'orange' ? 'bg-orange-bg text-orange border-orange-bd' :
              b.tone === 'red'    ? 'bg-red-bg    text-red    border-red-bd' :
                                    'bg-bg3       text-text2  border-border'
            }`}>
              <span className="w-1.5 h-1.5 rounded-full" style={{
                background: b.tone === 'green' ? 'var(--green)' : b.tone === 'amber' ? 'var(--amber)' : b.tone === 'orange' ? 'var(--orange)' : b.tone === 'red' ? 'var(--red)' : 'var(--text3)',
              }} />
              {b.label}{b.rule ? <span className="text-text3 ml-1">— {b.rule}</span> : null}
            </span>
          ))}
        </div>

        {/* Metrics */}
        {statsQ.isLoading && !statsQ.data ? <MetricRowSkeleton count={5} /> : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5 mb-4">
            {buckets.map(b => (
              <div key={b.id} className="bg-bg2 border border-border rounded-lg px-4 py-3.5 shadow">
                <div className="text-[11px] text-text3 uppercase tracking-wider mb-1.5 font-medium truncate">{b.label.split('—')[0].split('(')[0].trim()}</div>
                <div className={`text-[22px] font-semibold mono ${
                  b.tone === 'green' ? 'text-green' :
                  b.tone === 'amber' ? 'text-amber' :
                  b.tone === 'orange' ? 'text-orange' :
                  b.tone === 'red' ? 'text-red' :
                  'text-text2'
                }`}>{fmtNum(totals[b.id])}</div>
              </div>
            ))}
          </div>
        )}

        {/* Per-employee table */}
        <div className="bg-bg2 border border-border rounded-lg shadow overflow-hidden">
          <div className="px-4 py-3 border-b border-border flex items-center gap-2">
            <span className="text-[13px] font-semibold">{mode === 'report' ? 'Hisobot' : 'Davomat'} statistikasi — {MONTH_LABELS[MONTH_KEYS[month - 1]]} {year}</span>
            <span className="text-[11px] text-text3">· har bir xodim bo'yicha</span>
          </div>
          <DataTable<DisciplineEmployee>
            columns={columns}
            data={statsQ.data?.employees ?? []}
            pageSize={25}
            loading={statsQ.isLoading}
          />
        </div>

        {statsQ.error && (
          <div className="mt-4 p-3 bg-red-bg border border-red-bd text-red rounded-lg text-[12.5px]">
            Xatolik: {(statsQ.error as Error).message}
          </div>
        )}
      </div>

      {logEntry && (
        <LogEntryModal
          mode={mode}
          year={year}
          month={month}
          employee={logEntry}
          onClose={() => setLogEntry(null)}
        />
      )}
      {editPenalty && penaltyQ.data && (
        <PenaltyConfigModal initial={penaltyQ.data} onClose={() => setEditPenalty(false)} />
      )}
    </>
  );
}

function ModeTab({ active, onClick, label, hint }: { active: boolean; onClick: () => void; label: string; hint: string }) {
  return (
    <button
      onClick={onClick}
      className={`px-3.5 py-1.5 rounded-full text-[11.5px] font-medium border transition-colors ${
        active ? 'bg-blue-bg text-blue border-blue-bd font-semibold' : 'bg-bg2 text-text2 border-border hover:bg-bg3'
      }`}
    >{label} <span className="text-text3 ml-1">· {hint}</span></button>
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

// ─── Log entry modal ─────────────────────────────────────────────────
function LogEntryModal({
  mode, year, month, employee, onClose,
}: { mode: Mode; year: number; month: number; employee: { employeeId: number; name: string }; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const today = new Date();
  const defaultDay = today.getFullYear() === year && today.getMonth() + 1 === month
    ? today.toISOString().slice(0, 10)
    : `${year}-${String(month).padStart(2, '0')}-01`;

  const buckets = mode === 'report' ? REPORT_BUCKETS : ATTENDANCE_BUCKETS;
  const [day, setDay] = useState(defaultDay);
  const [bucket, setBucket] = useState<LogBucket>(buckets[0].id);
  const [time, setTime] = useState(mode === 'report' ? '19:00' : '09:00');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      const body = mode === 'report'
        ? { bitrix_user_id: employee.employeeId, day, bucket, submitted_at: time, note: note || null }
        : { bitrix_user_id: employee.employeeId, day, bucket, start_time: time, note: note || null };
      if (mode === 'report') await upsertReportLog(body);
      else await upsertAttendanceLog(body);
      qc.invalidateQueries({ queryKey: ['payroll/discipline-stats'] });
      toast.success('Log saqlandi', `${employee.name} · ${day} · ${bucket}`);
      onClose();
    } catch (e) {
      toast.error('Saqlashda xato', (e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog.Root open onOpenChange={(o) => { if (!o) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40 backdrop-blur-[2px] z-[300]" />
        <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-bg2 border border-border rounded-xl p-6 w-[440px] max-h-[88vh] overflow-y-auto shadow-lg z-[301]">
          <Dialog.Title className="text-[15px] font-semibold mb-1">{mode === 'report' ? 'Hisobot' : 'Davomat'} log</Dialog.Title>
          <div className="text-[12px] text-text3 mb-4">{employee.name}</div>

          <div className="grid grid-cols-2 gap-3 mb-3">
            <Field label="Sana"><input type="date" className={fi} value={day} onChange={(e) => setDay(e.target.value)} /></Field>
            <Field label={mode === 'report' ? 'Topshirilgan vaqt' : 'Kelgan vaqt'}>
              <input type="time" className={fi} value={time} onChange={(e) => setTime(e.target.value)} />
            </Field>
          </div>

          <Field label="Toifa" className="mb-3">
            <select className={fi} value={bucket} onChange={(e) => setBucket(e.target.value as LogBucket)}>
              {buckets.map(b => <option key={b.id} value={b.id}>{b.label}</option>)}
            </select>
          </Field>

          <Field label="Izoh"><textarea className={fi} rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></Field>

          <div className="flex justify-end gap-2 mt-5 pt-4 border-t border-border">
            <Button onClick={onClose}>Bekor</Button>
            <Button variant="primary" disabled={saving} onClick={save}>{saving ? 'Saqlanmoqda…' : 'Saqlash'}</Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// ─── Penalty config modal ────────────────────────────────────────────
function PenaltyConfigModal({ initial, onClose }: { initial: PenaltyConfig; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [form, setForm] = useState({
    attendance_late_soft_uzs: initial.attendance_late_soft_uzs,
    attendance_late_uzs:      initial.attendance_late_uzs,
    attendance_penalty_uzs:   initial.attendance_penalty_uzs,
    attendance_absent_uzs:    initial.attendance_absent_uzs,
    report_late_soft_uzs:     initial.report_late_soft_uzs,
    report_late_uzs:          initial.report_late_uzs,
    report_penalty_uzs:       initial.report_penalty_uzs,
    report_missed_uzs:        initial.report_missed_uzs,
  });
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      await setPenaltyConfig(form);
      qc.invalidateQueries({ queryKey: ['payroll/penalty-config'] });
      toast.success('Tariflar saqlandi');
      onClose();
    } catch (e) {
      toast.error('Saqlashda xato', (e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog.Root open onOpenChange={(o) => { if (!o) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40 backdrop-blur-[2px] z-[300]" />
        <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-bg2 border border-border rounded-xl p-6 w-[520px] max-h-[88vh] overflow-y-auto shadow-lg z-[301]">
          <Dialog.Title className="text-[15px] font-semibold mb-4">Jarima tariflari (so'm/incident)</Dialog.Title>

          <div className="text-[11px] text-text3 mb-2 font-semibold uppercase tracking-wider">Davomat</div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mb-4">
            <Field label="Kechroq"><input type="number" className={fi} value={form.attendance_late_soft_uzs} onChange={(e) => setForm(f => ({ ...f, attendance_late_soft_uzs: Number(e.target.value) }))} /></Field>
            <Field label="Kech"><input type="number" className={fi} value={form.attendance_late_uzs} onChange={(e) => setForm(f => ({ ...f, attendance_late_uzs: Number(e.target.value) }))} /></Field>
            <Field label="Juda kech ⚡"><input type="number" className={fi} value={form.attendance_penalty_uzs} onChange={(e) => setForm(f => ({ ...f, attendance_penalty_uzs: Number(e.target.value) }))} /></Field>
            <Field label="Kelmadi"><input type="number" className={fi} value={form.attendance_absent_uzs} onChange={(e) => setForm(f => ({ ...f, attendance_absent_uzs: Number(e.target.value) }))} /></Field>
          </div>

          <div className="text-[11px] text-text3 mb-2 font-semibold uppercase tracking-wider">Hisobot</div>
          <div className="grid grid-cols-2 gap-3 mb-2">
            <Field label="Kechroq"><input type="number" className={fi} value={form.report_late_soft_uzs} onChange={(e) => setForm(f => ({ ...f, report_late_soft_uzs: Number(e.target.value) }))} /></Field>
            <Field label="Kech"><input type="number" className={fi} value={form.report_late_uzs} onChange={(e) => setForm(f => ({ ...f, report_late_uzs: Number(e.target.value) }))} /></Field>
            <Field label="Juda kech ⚡"><input type="number" className={fi} value={form.report_penalty_uzs} onChange={(e) => setForm(f => ({ ...f, report_penalty_uzs: Number(e.target.value) }))} /></Field>
            <Field label="Topshirmadi"><input type="number" className={fi} value={form.report_missed_uzs} onChange={(e) => setForm(f => ({ ...f, report_missed_uzs: Number(e.target.value) }))} /></Field>
          </div>

          <div className="flex justify-end gap-2 mt-5 pt-4 border-t border-border">
            <Button onClick={onClose}>Bekor</Button>
            <Button variant="primary" disabled={saving} onClick={save}>{saving ? 'Saqlanmoqda…' : 'Saqlash'}</Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// suppress unused import warning
void listEmployees;

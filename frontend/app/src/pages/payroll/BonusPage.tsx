import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as Dialog from '@radix-ui/react-dialog';
import type { ColumnDef } from '@tanstack/react-table';
import { Plus, Trash2, Pencil } from 'lucide-react';
import { Topbar } from '@/components/Topbar';
import { Button } from '@/components/Button';
import { Badge } from '@/components/Badge';
import { Avatar } from '@/components/Avatar';
import { DataTable } from '@/components/DataTable';
import {
  listBonusRules, createBonusRule, updateBonusRule, deleteBonusRule,
  listBonusAwards, createBonusAward, deleteBonusAward,
  listEmployees,
} from '@/lib/api/payroll';
import type { BonusRule, BonusRuleIn, BonusAward, BonusAwardIn } from '@/lib/api/payroll';
import { useToast } from '@/components/Toast';
import { fmtMoney } from '@/lib/utils';
import { MONTH_KEYS, MONTH_LABELS } from '@/lib/api/meta';

const now = new Date();
const DEFAULT_PERIOD = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

export default function BonusPage() {
  const [period, setPeriod] = useState<string>(DEFAULT_PERIOD);

  const rulesQ = useQuery({ queryKey: ['payroll/bonus-rules'], queryFn: listBonusRules });
  const awardsQ = useQuery({ queryKey: ['payroll/bonus-awards', period], queryFn: () => listBonusAwards(period) });
  const empQ = useQuery({ queryKey: ['payroll/employees'], queryFn: listEmployees });

  const [editingRule, setEditingRule] = useState<BonusRule | null>(null);
  const [creatingRule, setCreatingRule] = useState(false);
  const [creatingAward, setCreatingAward] = useState(false);
  const toast = useToast();

  const ruleColumns = useMemo<ColumnDef<BonusRule, unknown>[]>(() => [
    { header: 'Nomi', accessorKey: 'name', cell: (c) => <span className="font-medium">{c.getValue<string>()}</span> },
    { header: 'Trigger', accessorKey: 'trigger_text', cell: (c) => <span className="text-text2 text-[11.5px]">{c.getValue<string>() || '—'}</span> },
    {
      header: 'Qiymat', accessorFn: (r) => r.value_kind === 'percent' ? `${r.value}%` : fmtMoney(r.value),
      cell: (c) => <span className="mono text-green font-semibold">{c.getValue<string>()}</span>,
    },
    { header: 'Davr', accessorKey: 'period', cell: (c) => <Badge tone="gray">{c.getValue<string>()}</Badge> },
    { header: 'Kimga', accessorKey: 'target_role', cell: (c) => <Badge tone="blue">{c.getValue<string>()}</Badge> },
    { header: 'Turi', accessorKey: 'rule_type', cell: (c) => <Badge tone={c.getValue<string>() === 'auto' ? 'green' : 'amber'}>{c.getValue<string>()}</Badge> },
    {
      header: 'Amal', id: 'action', enableSorting: false,
      cell: (c) => (
        <div className="flex gap-1.5">
          <Button size="sm" onClick={() => setEditingRule(c.row.original)}><Pencil className="w-3 h-3" /></Button>
          <Button size="sm" variant="danger" onClick={async () => {
            if (!confirm(`"${c.row.original.name}" qoidasini o'chirish?`)) return;
            try {
              await deleteBonusRule(c.row.original.id);
              rulesQ.refetch();
              toast.success('O\'chirildi', `"${c.row.original.name}"`);
            } catch (e) { toast.error('O\'chirishda xato', (e as Error).message); }
          }}><Trash2 className="w-3 h-3" /></Button>
        </div>
      ),
    },
  ], [rulesQ]);

  const awardColumns = useMemo<ColumnDef<BonusAward, unknown>[]>(() => [
    {
      header: 'Xodim', accessorKey: 'bitrix_user_id',
      cell: (c) => {
        const uid = c.getValue<number>();
        const emp = empQ.data?.employees.find(e => e.id === uid);
        const name = emp?.name ?? `User ${uid}`;
        return (
          <div className="flex items-center gap-2.5">
            <Avatar name={name} />
            <span className="font-medium">{name}</span>
          </div>
        );
      },
    },
    { header: 'Bonus', accessorKey: 'rule_name', cell: (c) => c.getValue<string>() || '—' },
    { header: 'Davr', accessorKey: 'period_label', cell: (c) => <span className="mono text-text2 text-[11px]">{c.getValue<string>()}</span> },
    { header: 'Izoh', accessorKey: 'note', cell: (c) => <span className="text-text2 text-[11.5px]">{c.getValue<string>() ?? '—'}</span> },
    {
      header: 'Summa', accessorKey: 'amount_usd',
      cell: (c) => <span className="mono text-green font-semibold">+{fmtMoney(c.getValue<number>())}</span>,
    },
    {
      header: 'Amal', id: 'action', enableSorting: false,
      cell: (c) => (
        <Button size="sm" variant="danger" onClick={async () => {
          if (!confirm(`O'chirish?`)) return;
          try {
            await deleteBonusAward(c.row.original.id);
            awardsQ.refetch();
            toast.success('Bonus o\'chirildi');
          } catch (e) { toast.error('O\'chirishda xato', (e as Error).message); }
        }}><Trash2 className="w-3 h-3" /></Button>
      ),
    },
  ], [empQ.data, awardsQ]);

  // Period options: last 6 months
  const periodOptions = useMemo(() => {
    const out: { value: string; label: string }[] = [];
    const d = new Date();
    for (let i = 0; i < 6; i++) {
      const y = d.getFullYear();
      const m = d.getMonth() + 1;
      out.push({ value: `${y}-${String(m).padStart(2, '0')}`, label: `${MONTH_LABELS[MONTH_KEYS[m - 1]]} ${y}` });
      d.setMonth(d.getMonth() - 1);
    }
    return out;
  }, []);

  return (
    <>
      <Topbar
        title="Bonuslar"
        sub={`Qoidalar ${rulesQ.data?.count ?? 0} · ${period} davrida ${awardsQ.data?.count ?? 0} ta bonus berilgan`}
        actions={
          <>
            <select
              className="px-2.5 py-1.5 rounded border border-border2 bg-bg2 text-[12px] shadow-xs"
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
            >
              {periodOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <Button onClick={() => setCreatingRule(true)}><Plus className="w-3.5 h-3.5" /> Qoida</Button>
            <Button variant="primary" onClick={() => setCreatingAward(true)}><Plus className="w-3.5 h-3.5" /> Bonus berish</Button>
          </>
        }
      />
      <div className="flex-1 overflow-y-auto px-[22px] py-[18px] bg-bg">
        <SectionHead title="Bonus qoidalari" hint={`${rulesQ.data?.count ?? 0} ta`} />
        <DataTable<BonusRule>
          columns={ruleColumns}
          data={rulesQ.data?.rules ?? []}
          pageSize={10}
          loading={rulesQ.isLoading}
        />

        <div className="mt-4">
          <SectionHead title={`Berilgan bonuslar — ${period}`} hint={`${awardsQ.data?.count ?? 0} ta`} />
          <DataTable<BonusAward>
            columns={awardColumns}
            data={awardsQ.data?.awards ?? []}
            pageSize={10}
            loading={awardsQ.isLoading}
          />
        </div>
      </div>

      {(editingRule || creatingRule) && (
        <RuleModal rule={editingRule} onClose={() => { setEditingRule(null); setCreatingRule(false); }} />
      )}
      {creatingAward && (
        <AwardModal
          period={period}
          rules={rulesQ.data?.rules ?? []}
          employees={empQ.data?.employees ?? []}
          onClose={() => setCreatingAward(false)}
        />
      )}
    </>
  );
}

function SectionHead({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex items-center gap-2 mb-2 mt-1">
      <span className="text-[12.5px] font-semibold text-text">{title}</span>
      {hint && <span className="text-[11px] text-text3">· {hint}</span>}
    </div>
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

function RuleModal({ rule, onClose }: { rule: BonusRule | null; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [form, setForm] = useState<BonusRuleIn>({
    name: rule?.name ?? '',
    trigger_text: rule?.trigger_text ?? '',
    period: rule?.period ?? 'monthly',
    target_role: rule?.target_role ?? 'closer',
    rule_type: rule?.rule_type ?? 'auto',
    value_kind: rule?.value_kind ?? 'percent',
    value: rule?.value ?? 0,
    is_active: rule?.is_active ?? true,
  });
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!form.name.trim()) { toast.error('Qoida nomi kerak'); return; }
    setSaving(true);
    try {
      if (rule) {
        await updateBonusRule(rule.id, form);
        toast.success('Saqlandi', `"${form.name}" yangilandi`);
      } else {
        await createBonusRule(form);
        toast.success('Yaratildi', `"${form.name}" qo'shildi`);
      }
      qc.invalidateQueries({ queryKey: ['payroll/bonus-rules'] });
      onClose();
    } catch (e) { toast.error('Saqlashda xato', (e as Error).message); }
    finally { setSaving(false); }
  }

  return (
    <Dialog.Root open onOpenChange={(o) => { if (!o) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40 backdrop-blur-[2px] z-[300]" />
        <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-bg2 border border-border rounded-xl p-6 w-[480px] max-h-[88vh] overflow-y-auto shadow-lg z-[301]">
          <Dialog.Title className="text-[15px] font-semibold mb-4">{rule ? 'Bonus qoidasini tahrirlash' : 'Yangi bonus qoidasi'}</Dialog.Title>

          <Field label="Nomi" className="mb-3">
            <input className={fi} value={form.name} onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Eng ko'p sotuv" />
          </Field>
          <Field label="Trigger (qachon beriladi)" className="mb-3">
            <input className={fi} value={form.trigger_text} onChange={(e) => setForm(f => ({ ...f, trigger_text: e.target.value }))} placeholder="Oyda #1 savdo" />
          </Field>

          <div className="grid grid-cols-2 gap-3 mb-3">
            <Field label="Qiymat turi">
              <select className={fi} value={form.value_kind} onChange={(e) => setForm(f => ({ ...f, value_kind: e.target.value as 'percent' | 'fixed_usd' }))}>
                <option value="percent">% (savdo)</option>
                <option value="fixed_usd">$ (fix)</option>
              </select>
            </Field>
            <Field label="Qiymat">
              <input className={fi} type="number" step="0.1" value={form.value} onChange={(e) => setForm(f => ({ ...f, value: Number(e.target.value) }))} />
            </Field>
            <Field label="Davr">
              <select className={fi} value={form.period} onChange={(e) => setForm(f => ({ ...f, period: e.target.value }))}>
                <option value="monthly">Oylik</option>
                <option value="weekly">Haftalik</option>
                <option value="quarterly">Kvartallik</option>
              </select>
            </Field>
            <Field label="Kimga">
              <select className={fi} value={form.target_role} onChange={(e) => setForm(f => ({ ...f, target_role: e.target.value }))}>
                <option value="closer">Closer</option>
                <option value="hunter">Hunter</option>
                <option value="assistant">Assistant</option>
              </select>
            </Field>
            <Field label="Turi" className="col-span-2">
              <select className={fi} value={form.rule_type} onChange={(e) => setForm(f => ({ ...f, rule_type: e.target.value as 'auto' | 'manual' }))}>
                <option value="auto">Auto (tizim avtomatik beradi)</option>
                <option value="manual">Manual (qo'lda kiritiladi)</option>
              </select>
            </Field>
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

function AwardModal({
  period, rules, employees, onClose,
}: { period: string; rules: BonusRule[]; employees: { id: number; name: string }[]; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [form, setForm] = useState<BonusAwardIn>({
    bitrix_user_id: employees[0]?.id ?? 0,
    rule_id: rules[0]?.id ?? null,
    rule_name: rules[0]?.name ?? '',
    period_label: period,
    amount_usd: 0,
    note: '',
  });
  const [saving, setSaving] = useState(false);

  function handleRuleChange(ruleId: string) {
    const id = ruleId ? Number(ruleId) : null;
    const r = id ? rules.find(x => x.id === id) : null;
    setForm(f => ({ ...f, rule_id: id, rule_name: r?.name ?? '' }));
  }

  async function save() {
    if (!form.bitrix_user_id) { toast.error('Xodim tanlang'); return; }
    setSaving(true);
    try {
      await createBonusAward(form);
      const empName = employees.find(e => e.id === form.bitrix_user_id)?.name ?? 'xodim';
      toast.success('Bonus berildi', `${empName}: +$${form.amount_usd}`);
      qc.invalidateQueries({ queryKey: ['payroll/bonus-awards'] });
      onClose();
    } catch (e) { toast.error('Saqlashda xato', (e as Error).message); }
    finally { setSaving(false); }
  }

  return (
    <Dialog.Root open onOpenChange={(o) => { if (!o) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40 backdrop-blur-[2px] z-[300]" />
        <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-bg2 border border-border rounded-xl p-6 w-[440px] max-h-[88vh] overflow-y-auto shadow-lg z-[301]">
          <Dialog.Title className="text-[15px] font-semibold mb-4">Bonus berish</Dialog.Title>

          <Field label="Xodim" className="mb-3">
            <select className={fi} value={form.bitrix_user_id} onChange={(e) => setForm(f => ({ ...f, bitrix_user_id: Number(e.target.value) }))}>
              {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </Field>

          <Field label="Qoida" className="mb-3">
            <select className={fi} value={form.rule_id ?? ''} onChange={(e) => handleRuleChange(e.target.value)}>
              <option value="">— qo'lda (qoidasiz) —</option>
              {rules.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </Field>

          <div className="grid grid-cols-2 gap-3 mb-3">
            <Field label="Davr">
              <input className={fi} value={form.period_label} onChange={(e) => setForm(f => ({ ...f, period_label: e.target.value }))} />
            </Field>
            <Field label="Summa ($)">
              <input className={fi} type="number" step="0.01" value={form.amount_usd} onChange={(e) => setForm(f => ({ ...f, amount_usd: Number(e.target.value) }))} />
            </Field>
          </div>

          <Field label="Izoh">
            <textarea className={fi} rows={2} value={form.note ?? ''} onChange={(e) => setForm(f => ({ ...f, note: e.target.value }))} />
          </Field>

          <div className="flex justify-end gap-2 mt-5 pt-4 border-t border-border">
            <Button onClick={onClose}>Bekor</Button>
            <Button variant="primary" disabled={saving} onClick={save}>{saving ? 'Saqlanmoqda…' : 'Berish'}</Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

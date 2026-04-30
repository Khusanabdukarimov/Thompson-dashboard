import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as Dialog from '@radix-ui/react-dialog';
import { Plus, Trash2, Pencil } from 'lucide-react';
import { Topbar } from '@/components/Topbar';
import { Button } from '@/components/Button';
import { Badge } from '@/components/Badge';
import { Skeleton } from '@/components/Skeleton';
import { EmptyState } from '@/components/EmptyState';
import { Award } from 'lucide-react';
import { listKpiRules, createKpiRule, updateKpiRule, deleteKpiRule } from '@/lib/api/payroll';
import type { KpiRule, KpiRuleIn, KpiTier } from '@/lib/api/payroll';
import { useToast } from '@/components/Toast';
import { fmtMoney } from '@/lib/utils';

const ROLE_OPTIONS = [
  { value: 'closer', label: 'Closer' },
  { value: 'hunter', label: 'Hunter' },
  { value: 'assistant', label: 'Assistant' },
];

export default function KpiRulesPage() {
  const q = useQuery({ queryKey: ['payroll/kpi-rules'], queryFn: listKpiRules });
  const [editing, setEditing] = useState<KpiRule | null>(null);
  const [creating, setCreating] = useState(false);

  return (
    <>
      <Topbar
        title="KPI qoidalar"
        sub={`${q.data?.count ?? 0} ta qoida · tier-based commission`}
        actions={<Button variant="primary" onClick={() => setCreating(true)}><Plus className="w-3.5 h-3.5" /> Yangi qoida</Button>}
      />
      <div className="flex-1 overflow-y-auto px-[22px] py-[18px] bg-bg">
        {q.isLoading && !q.data ? (
          <div className="grid grid-cols-2 gap-3">
            {Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="bg-bg2 border border-border rounded-lg shadow p-4">
                <Skeleton className="h-3 w-40 mb-3" />
                <Skeleton className="h-2.5 w-64 mb-4" />
                {Array.from({ length: 4 }).map((_, j) => (
                  <Skeleton key={j} className="h-7 w-full mb-1.5" />
                ))}
              </div>
            ))}
          </div>
        ) : (q.data?.rules ?? []).length === 0 ? (
          <div className="bg-bg2 border border-border rounded-lg shadow">
            <EmptyState
              icon={<Award className="w-5 h-5" />}
              title="Hozircha KPI qoidasi yo'q"
              hint="Sotuv komissiyasini tier'lar bo'yicha sozlang. Misol: $0–5K → 1%, $5K–15K → 5%, $40K+ → 15%"
              action={<Button variant="primary" onClick={() => setCreating(true)}>+ Birinchi qoidani yarating</Button>}
            />
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {q.data!.rules.map(r => (
              <RuleCard key={r.id} rule={r} onEdit={() => setEditing(r)} />
            ))}
          </div>
        )}

        {q.error && (
          <div className="mt-4 p-3 bg-red-bg border border-red-bd text-red rounded-lg text-[12.5px]">
            Xatolik: {(q.error as Error).message}
          </div>
        )}
      </div>

      {(editing || creating) && (
        <RuleModal
          rule={editing}
          onClose={() => { setEditing(null); setCreating(false); }}
        />
      )}
    </>
  );
}

function RuleCard({ rule, onEdit }: { rule: KpiRule; onEdit: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  async function handleDelete() {
    if (!confirm(`"${rule.name}" qoidasini o'chirishni tasdiqlaysizmi?`)) return;
    try {
      await deleteKpiRule(rule.id);
      qc.invalidateQueries({ queryKey: ['payroll/kpi-rules'] });
      toast.success('O\'chirildi', `"${rule.name}" qoidasi o'chirildi`);
    } catch (e) {
      toast.error('O\'chirishda xato', (e as Error).message);
    }
  }

  const max = Math.max(1, ...rule.tiers.map(t => Number(t.percent || 0)));

  return (
    <div className="bg-bg2 border border-border rounded-lg shadow overflow-hidden">
      <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[13px] font-semibold truncate">{rule.name}</div>
          <div className="text-[11px] text-text3 mt-0.5 flex items-center gap-2">
            <Badge tone={rule.role === 'closer' ? 'blue' : rule.role === 'hunter' ? 'purple' : 'amber'}>{rule.role}</Badge>
            <span>· {rule.entity} · {rule.period} · {rule.currency}</span>
          </div>
        </div>
        <div className="flex gap-1.5">
          <Button size="sm" onClick={onEdit}><Pencil className="w-3 h-3" /></Button>
          <Button size="sm" variant="danger" onClick={handleDelete}><Trash2 className="w-3 h-3" /></Button>
        </div>
      </div>
      <div className="p-3 space-y-1">
        {rule.tiers.length === 0 && <div className="text-text3 text-[12px] text-center py-4">Tier yo'q</div>}
        {rule.tiers.map((t, i) => {
          const range = `${fmtMoney(Number(t.from))} – ${t.to == null ? '∞' : fmtMoney(Number(t.to))}`;
          return (
            <div key={i} className="flex items-center gap-3 py-1.5 px-2.5 rounded-md bg-bg3 border border-border">
              <span className="mono text-[12px] font-medium min-w-[120px]">{range}</span>
              <div className="flex-1 h-1.5 bg-bg4 rounded overflow-hidden">
                <div className="h-full rounded bg-gradient-to-r from-blue-2 to-cyan-400" style={{ width: `${(Number(t.percent) / max) * 100}%` }} />
              </div>
              <span className="mono text-[13px] font-bold text-green min-w-[34px] text-right">{Number(t.percent)}%</span>
            </div>
          );
        })}
        <div className="text-[10px] text-text3 mt-2 text-center">
          single_tier: butun summa × mos tier % (misol: $41,200 → 15% → $6,180)
        </div>
      </div>
    </div>
  );
}

function RuleModal({ rule, onClose }: { rule: KpiRule | null; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [form, setForm] = useState<KpiRuleIn>(() => ({
    name: rule?.name ?? '',
    role: rule?.role ?? 'closer',
    entity: rule?.entity ?? 'deals',
    period: rule?.period ?? 'monthly',
    currency: rule?.currency ?? 'USD',
    mode: rule?.mode ?? 'single_tier',
    tiers: rule?.tiers ?? [{ from: 0, to: null, percent: 5 }],
    is_active: rule?.is_active ?? true,
  }));
  const [saving, setSaving] = useState(false);

  function setTier(i: number, patch: Partial<KpiTier>) {
    setForm(f => ({
      ...f,
      tiers: f.tiers.map((t, idx) => idx === i ? { ...t, ...patch } : t),
    }));
  }
  function addTier() {
    setForm(f => {
      const last = f.tiers[f.tiers.length - 1];
      const newFrom = last ? Number(last.to ?? Number(last.from) + 5000) : 0;
      return { ...f, tiers: [...f.tiers, { from: newFrom, to: null, percent: (last?.percent ?? 0) + 1 }] };
    });
  }
  function removeTier(i: number) {
    setForm(f => ({ ...f, tiers: f.tiers.filter((_, idx) => idx !== i) }));
  }

  async function save() {
    if (!form.name.trim()) { toast.error('Qoida nomi kerak'); return; }
    setSaving(true);
    try {
      const cleanTiers = form.tiers.map(t => ({
        from: Number(t.from) || 0,
        to: t.to == null || t.to === undefined || (t.to as unknown) === '' ? null : Number(t.to),
        percent: Number(t.percent) || 0,
      }));
      const body = { ...form, tiers: cleanTiers };
      if (rule) {
        await updateKpiRule(rule.id, body);
        toast.success('Saqlandi', `"${form.name}" yangilandi`);
      } else {
        await createKpiRule(body);
        toast.success('Yaratildi', `"${form.name}" qo'shildi`);
      }
      qc.invalidateQueries({ queryKey: ['payroll/kpi-rules'] });
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
        <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-bg2 border border-border rounded-xl p-6 w-[560px] max-h-[88vh] overflow-y-auto shadow-lg z-[301]">
          <Dialog.Title className="text-[15px] font-semibold mb-4">{rule ? 'Qoida tahrirlash' : 'Yangi KPI qoida'}</Dialog.Title>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Nomi" className="col-span-2">
              <input className={fi} value={form.name} onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Sales KPI — Closer roli" />
            </Field>
            <Field label="Rol">
              <select className={fi} value={form.role} onChange={(e) => setForm(f => ({ ...f, role: e.target.value }))}>
                {ROLE_OPTIONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </Field>
            <Field label="Davr">
              <select className={fi} value={form.period} onChange={(e) => setForm(f => ({ ...f, period: e.target.value }))}>
                <option value="monthly">Oylik</option>
                <option value="weekly">Haftalik</option>
              </select>
            </Field>
            <Field label="Hisob rejimi" className="col-span-2">
              <select className={fi} value={form.mode} onChange={(e) => setForm(f => ({ ...f, mode: e.target.value }))}>
                <option value="single_tier">Single-tier — butun summa × mos tier %</option>
                <option value="multi_tier">Multi-tier — progressive (har tier o'z foizi bilan)</option>
              </select>
              <div className="text-[10px] text-text3 mt-1 leading-tight">
                {form.mode === 'single_tier'
                  ? "Misol: $41,200 → tier $40K+ (15%) → $6,180"
                  : "Misol: $41,200 → ($5K×1%) + ($10K×5%) + ($15K×9%) + ($10K×12%) + ($1.2K×15%) = $3,230"}
              </div>
            </Field>
          </div>

          <div className="mt-4 mb-2 flex items-center justify-between">
            <span className="text-[12px] font-semibold uppercase tracking-wider text-text2">Tierlar</span>
            <Button size="sm" onClick={addTier}><Plus className="w-3 h-3" /> Tier qo'shish</Button>
          </div>

          <div className="space-y-1.5">
            {form.tiers.map((t, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  type="number"
                  className={`${fi} flex-1`}
                  placeholder="From"
                  value={Number(t.from)}
                  onChange={(e) => setTier(i, { from: Number(e.target.value) })}
                />
                <span className="text-text3 text-[11px]">→</span>
                <input
                  type="number"
                  className={`${fi} flex-1`}
                  placeholder="To (∞ uchun bo'sh qoldiring)"
                  value={t.to == null ? '' : Number(t.to)}
                  onChange={(e) => setTier(i, { to: e.target.value === '' ? null : Number(e.target.value) })}
                />
                <input
                  type="number"
                  step="0.5"
                  className={`${fi} w-20`}
                  placeholder="%"
                  value={Number(t.percent)}
                  onChange={(e) => setTier(i, { percent: Number(e.target.value) })}
                />
                <span className="text-text3 text-[11px]">%</span>
                <Button size="sm" variant="danger" onClick={() => removeTier(i)}><Trash2 className="w-3 h-3" /></Button>
              </div>
            ))}
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

const fi = 'px-2.5 py-2 rounded-[7px] border border-border bg-bg text-text text-[12.5px] focus:outline-none focus:border-blue focus:bg-bg2 focus:shadow-[0_0_0_3px_rgba(34,102,245,0.1)]';

function Field({ label, children, className = '' }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <label className="block text-[10px] text-text3 mb-1 uppercase tracking-wider font-medium">{label}</label>
      {children}
    </div>
  );
}

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as Dialog from "@radix-ui/react-dialog";
import { Plus, Trash2, Pencil } from "lucide-react";
import { Topbar } from "@/components/Topbar";
import { Button } from "@/components/Button";

import { Skeleton } from "@/components/Skeleton";
import { EmptyState } from "@/components/EmptyState";
import { Award } from "lucide-react";
import {
  listKpiRules, createKpiRule, updateKpiRule, listEmployees
} from "@/lib/api/payroll";
import type { KpiRule, KpiRuleIn, KpiTier } from "@/lib/api/payroll";
import { useToast } from "@/components/Toast";
import { fmtUzs } from "@/lib/utils";
import { cn } from "@/lib/utils";

const ROLES = [
  { value: "closer",    label: "Closer" },
  { value: "hunter",   label: "Hunter" },
  { value: "assistant",label: "Assistant" },
];

function Toggle({ on }: { on: boolean }) {
  return (
    <div className={cn("w-10 h-[22px] rounded-full relative transition-colors", on ? "bg-green" : "bg-border")}>
      <div className={cn("w-[18px] h-[18px] rounded-full bg-white absolute top-0.5 transition-all shadow", on ? "left-[20px]" : "left-0.5")} />
    </div>
  );
}

export default function KpiRulesPage() {
  const q    = useQuery({ queryKey: ["payroll/kpi-rules"], queryFn: listKpiRules });
  const empQ = useQuery({ queryKey: ["payroll/employees"], queryFn: listEmployees });
  const [activeRole, setActiveRole] = useState("closer");
  const [editing, setEditing]   = useState<KpiRule | null>(null);
  const [creating, setCreating] = useState(false);
  const [calcMode, setCalcMode] = useState<"single" | "progressive">("single");

  const rules = (q.data?.rules ?? []).filter(r => r.role === activeRole);
  const employees = (empQ.data?.employees ?? []).filter(e => e.role === activeRole);
  const rep = employees[0];

  const allTiers = rules.flatMap(r => r.tiers.map(t => ({ ...t, rule: r })));

  return (
    <>
      <Topbar
        title="KPI Qoidalari"
        sub="Qoida versiyasi"
        actions={
          <Button variant="primary" onClick={() => setCreating(true)}>
            <Plus className="w-3.5 h-3.5" /> Yangi qoida
          </Button>
        }
      />
      <div className="flex-1 overflow-y-auto px-[22px] py-[18px] bg-bg">

        {/* Role tabs */}
        <div className="flex gap-1 mb-5 bg-bg3 rounded-xl p-1 w-fit">
          {["closer", "hunter"].map(r => (
            <button
              key={r}
              onClick={() => setActiveRole(r)}
              className={cn(
                "px-6 py-2 rounded-[9px] text-[13px] font-semibold transition-all",
                activeRole === r ? "bg-blue text-white shadow" : "text-text2 hover:bg-bg2",
              )}
            >{r.charAt(0).toUpperCase() + r.slice(1)}</button>
          ))}
        </div>

        <div className="grid grid-cols-[300px_1fr] gap-5 items-start">

          {/* Left cards */}
          <div className="flex flex-col gap-4">
            {/* Umumiy sozlamalar */}
            <div className="bg-bg2 border border-border rounded-xl p-5">
              <div className="flex items-center gap-2.5 mb-4">
                <div className="w-8 h-8 rounded-lg bg-blue-bg flex items-center justify-center text-base">💰</div>
                <span className="text-[14px] font-bold text-text">Umumiy sozlamalar</span>
              </div>
              {[
                { label: "Bazaviy fix (UZS)", value: fmtUzs(rep?.fix_base_uzs ?? 4_500_000) },
                { label: "Davomat bonusi (UZS)", value: fmtUzs(rep?.attendance_weekly_uzs ?? 500_000) },
                { label: "Hisobot bonusi (UZS)", value: fmtUzs(rep?.report_weekly_uzs ?? 300_000) },
              ].map(row => (
                <div key={row.label} className="mb-3.5">
                  <label className="text-[11px] text-text3 block mb-1.5">{row.label}</label>
                  <div className="border border-border rounded-[9px] px-3 py-2 text-[13px] font-medium text-text flex justify-between">
                    <span>{row.value}</span>
                    <span className="text-text3 font-normal">UZS</span>
                  </div>
                </div>
              ))}
            </div>

            {/* Hisoblash usuli */}
            <div className="bg-bg2 border border-border rounded-xl p-5">
              <div className="flex items-center gap-2.5 mb-4">
                <div className="w-8 h-8 rounded-lg bg-green-bg flex items-center justify-center text-base">📊</div>
                <span className="text-[14px] font-bold text-text">Hisoblash usuli</span>
              </div>
              {(["single", "progressive"] as const).map(m => (
                <div key={m} onClick={() => setCalcMode(m)} className="flex items-center gap-3 py-2 cursor-pointer">
                  <div className={cn(
                    "w-[18px] h-[18px] rounded-full border-2 flex items-center justify-center",
                    calcMode === m ? "border-blue" : "border-border",
                  )}>
                    {calcMode === m && <div className="w-2.5 h-2.5 rounded-full bg-blue" />}
                  </div>
                  <span className="text-[13px] text-text">{m === "single" ? "Single-tier" : "Progressive"}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Right: KPI diapazonlari table */}
          <div className="bg-bg2 border border-border rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-border flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-lg bg-blue-bg flex items-center justify-center text-sm">📈</div>
                <span className="text-[14px] font-bold text-text">
                  KPI diapazonlari ({activeRole.charAt(0).toUpperCase() + activeRole.slice(1)})
                </span>
              </div>
              <button
                onClick={() => setCreating(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-[12.5px] font-semibold text-blue hover:bg-blue-bg transition-colors"
              >
                <Plus className="w-3.5 h-3.5" /> Yangi qator
              </button>
            </div>

            <table className="w-full text-[13px]">
              <thead>
                <tr className="bg-bg3 border-b border-border">
                  {["MIN SUMMA ($)", "MAX SUMMA ($)", "FOIZ (%)", "HOLAT", "AMAL"].map(h => (
                    <th key={h} className="px-5 py-3 text-left text-[10.5px] font-semibold text-text3 tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {q.isLoading ? (
                  Array.from({ length: 4 }).map((_, i) => (
                    <tr key={i} className="border-b border-border">
                      {Array.from({ length: 5 }).map((__, j) => (
                        <td key={j} className="px-5 py-3"><Skeleton className="h-4 w-20" /></td>
                      ))}
                    </tr>
                  ))
                ) : allTiers.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-5 py-12">
                      <EmptyState icon={<Award className="w-5 h-5" />} title="Qoidalar mavjud emas" hint="Yangi KPI qoida qo'shing" />
                    </td>
                  </tr>
                ) : allTiers.map((t, i) => (
                  <tr key={i} className="border-b border-border hover:bg-bg3 transition-colors">
                    <td className="px-5 py-3.5 text-[14px] font-medium text-text">{Number(t.from).toLocaleString()}</td>
                    <td className="px-5 py-3.5 text-[14px] font-medium text-text">{t.to == null ? "∞" : Number(t.to).toLocaleString()}</td>
                    <td className="px-5 py-3.5">
                      <span className="text-[15px] font-bold text-blue">{Number(t.percent)}</span>
                      <span className="text-text3 ml-1 text-[13px]">%</span>
                    </td>
                    <td className="px-5 py-3.5"><Toggle on={t.rule.is_active} /></td>
                    <td className="px-5 py-3.5">
                      <div className="flex gap-2">
                        <button onClick={() => setEditing(t.rule)} className="text-text3 hover:text-text p-1 rounded hover:bg-bg transition-colors"><Pencil className="w-3.5 h-3.5" /></button>
                        <button className="text-text3 hover:text-red p-1 rounded hover:bg-red-bg transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="px-5 py-3.5 border-t border-border flex items-center justify-between">
              <span className="text-[12px] text-text3">Oxirgi tahrir: Bugun, {new Date().toLocaleTimeString("uz-UZ", { hour: "2-digit", minute: "2-digit" })}</span>
              <div className="flex gap-2.5">
                <Button size="sm">Bekor qilish</Button>
                <Button size="sm" variant="primary">Saqlash</Button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {(editing || creating) && (
        <RuleModal rule={editing} onClose={() => { setEditing(null); setCreating(false); }} />
      )}
    </>
  );
}

function RuleModal({ rule, onClose }: { rule: KpiRule | null; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [form, setForm] = useState<KpiRuleIn>(() => ({
    name: rule?.name ?? "", role: rule?.role ?? "closer", entity: rule?.entity ?? "deals",
    period: rule?.period ?? "monthly", currency: rule?.currency ?? "USD",
    mode: rule?.mode ?? "single_tier",
    tiers: rule?.tiers ?? [{ from: 0, to: null, percent: 5 }],
    is_active: rule?.is_active ?? true,
  }));
  const [saving, setSaving] = useState(false);

  function setTier(i: number, patch: Partial<KpiTier>) {
    setForm(f => ({ ...f, tiers: f.tiers.map((t, idx) => idx === i ? { ...t, ...patch } : t) }));
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
    if (!form.name.trim()) { toast.error("Qoida nomi kerak"); return; }
    setSaving(true);
    try {
      const cleanTiers = form.tiers.map(t => ({
        from: Number(t.from) || 0,
        to: t.to == null || (t.to as unknown) === "" ? null : Number(t.to),
        percent: Number(t.percent) || 0,
      }));
      if (rule) { await updateKpiRule(rule.id, { ...form, tiers: cleanTiers }); toast.success("Yangilandi"); }
      else { await createKpiRule({ ...form, tiers: cleanTiers }); toast.success("Yaratildi"); }
      qc.invalidateQueries({ queryKey: ["payroll/kpi-rules"] });
      onClose();
    } catch (e) { toast.error("Xato", (e as Error).message); }
    finally { setSaving(false); }
  }

  return (
    <Dialog.Root open onOpenChange={o => { if (!o) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40 backdrop-blur-[2px] z-[300]" />
        <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-bg2 border border-border rounded-xl p-6 w-[560px] max-h-[88vh] overflow-y-auto shadow-lg z-[301]">
          <Dialog.Title className="text-[15px] font-semibold mb-4">{rule ? "Qoida tahrirlash" : "Yangi KPI qoida"}</Dialog.Title>
          <div className="grid grid-cols-2 gap-3 mb-4">
            <div className="col-span-2">
              <label className="text-[10px] text-text3 uppercase tracking-wider font-medium block mb-1">Nomi</label>
              <input className={fi} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Sales KPI — Closer" />
            </div>
            <div>
              <label className="text-[10px] text-text3 uppercase tracking-wider font-medium block mb-1">Rol</label>
              <select className={fi} value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}>
                {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] text-text3 uppercase tracking-wider font-medium block mb-1">Davr</label>
              <select className={fi} value={form.period} onChange={e => setForm(f => ({ ...f, period: e.target.value }))}>
                <option value="monthly">Oylik</option>
                <option value="weekly">Haftalik</option>
              </select>
            </div>
          </div>

          <div className="flex items-center justify-between mb-2">
            <span className="text-[12px] font-semibold uppercase tracking-wider text-text2">Tierlar</span>
            <Button size="sm" onClick={addTier}><Plus className="w-3 h-3" /> Qo'shish</Button>
          </div>
          <div className="space-y-1.5">
            {form.tiers.map((t, i) => (
              <div key={i} className="flex items-center gap-2">
                <input type="number" className={`${fi} flex-1`} placeholder="Dan ($)" value={Number(t.from)} onChange={e => setTier(i, { from: Number(e.target.value) })} />
                <span className="text-text3 text-[11px]">→</span>
                <input type="number" className={`${fi} flex-1`} placeholder="∞" value={t.to == null ? "" : Number(t.to)} onChange={e => setTier(i, { to: e.target.value === "" ? null : Number(e.target.value) })} />
                <input type="number" step="0.5" className={`${fi} w-20`} placeholder="%" value={Number(t.percent)} onChange={e => setTier(i, { percent: Number(e.target.value) })} />
                <span className="text-text3 text-[11px]">%</span>
                <Button size="sm" variant="danger" onClick={() => removeTier(i)}><Trash2 className="w-3 h-3" /></Button>
              </div>
            ))}
          </div>

          <div className="flex justify-end gap-2 mt-5 pt-4 border-t border-border">
            <Button onClick={onClose}>Bekor</Button>
            <Button variant="primary" disabled={saving} onClick={save}>{saving ? "Saqlanmoqda…" : "Saqlash"}</Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

const fi = "w-full px-2.5 py-2 rounded-[7px] border border-border bg-bg text-text text-[12.5px] focus:outline-none focus:border-blue";

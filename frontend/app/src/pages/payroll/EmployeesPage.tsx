import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as Dialog from "@radix-ui/react-dialog";
import { Pencil, Eye, Plus, Search, ChevronDown, ArrowLeft, TrendingUp, Shield } from "lucide-react";
import { Topbar } from "@/components/Topbar";
import { Button } from "@/components/Button";
import { Skeleton } from "@/components/Skeleton";
import {
  listEmployees, listKpiRules, upsertEmployeeExtra,
  calculatePayroll, getSalesTrend,
  uploadEmployeeAvatar, deleteEmployeeAvatar,
} from "@/lib/api/payroll";
import type { Employee, EmployeeExtraIn } from "@/lib/api/payroll";
import { useToast } from "@/components/Toast";
import { cn } from "@/lib/utils";
import { fmtNum } from "@/lib/utils";
import { MONTH_KEYS, MONTH_LABELS } from "@/lib/api/meta";

const ROLES = [
  { value: "closer",        label: "Closer",         bg: "bg-blue-bg",         text: "text-blue" },
  { value: "hunter",        label: "Hunter",         bg: "bg-[#f5f3ff]",       text: "text-[#7c3aed]" },
  { value: "hunter+closer", label: "Hunter + Closer",bg: "bg-[#fdf2f8]",       text: "text-[#db2777]" },
  { value: "assistant",     label: "Assistant",      bg: "bg-amber-bg",        text: "text-amber" },
  { value: "dizayner",      label: "Dizayner",       bg: "bg-green-bg",        text: "text-green" },
  { value: "neymer",        label: "Neymer",         bg: "bg-green-bg/50",     text: "text-green" },
];
const STATUSES = [
  { value: "active",     label: "Faol",    dot: "bg-green" },
  { value: "leave",      label: "Ta'tilda", dot: "bg-amber" },
  { value: "terminated", label: "Nofaol",  dot: "bg-red" },
];
const DASHBOARD_ROLES = [
  { value: "", label: "— Kirish yo'q —" },
  { value: "admin", label: "Admin" },
  { value: "owner", label: "Owner" },
  { value: "closer", label: "Closer" },
  { value: "marketolog", label: "Marketolog" },
  { value: "hunter", label: "Hunter" },
];

const TARGET_NAMES = [
  'davlatyor',
  'shaxzod', 'yormatov',
  'shaxod',  'turonov',
  'samandar', 'samadov',
  'temurmalik', 'xoshimjonov',
  'bekzod', 'ergashev',
  'muxriddin', 'atoullayev',
];

function isTargetEmployee(name: string): boolean {
  const lower = name.toLowerCase();
  return TARGET_NAMES.some(t => lower.includes(t));
}

function initials(name: string) {
  return name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
}

function AvatarImg({ name, url, size = 36, className = "" }: { name: string; url?: string | null; size?: number; className?: string }) {
  if (url) {
    return (
      <img
        src={url}
        alt={name}
        width={size}
        height={size}
        className={cn("rounded-full object-cover shrink-0", className)}
        style={{ width: size, height: size }}
        onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
      />
    );
  }
  return (
    <div
      className={cn("rounded-full bg-blue flex items-center justify-center text-white font-bold shrink-0", className)}
      style={{ width: size, height: size, fontSize: size * 0.33 }}
    >
      {initials(name)}
    </div>
  );
}

const now = new Date();
const CUR_MONTH = now.getMonth() + 1;
const CUR_YEAR = now.getFullYear();

export default function EmployeesPage() {
  const empQ = useQuery({ queryKey: ["payroll/employees"], queryFn: listEmployees });
  const kpiQ = useQuery({ queryKey: ["payroll/kpi-rules"], queryFn: listKpiRules });
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [editing, setEditing] = useState<Employee | null>(null);
  const [viewing, setViewing] = useState<Employee | null>(null);
  const [creating, setCreating] = useState(false);

  const employees = (empQ.data?.employees ?? []).filter(e => {
    if (!isTargetEmployee(e.name)) return false;
    const ms = !search || e.name.toLowerCase().includes(search.toLowerCase());
    const mr = !roleFilter || e.role === roleFilter;
    const mst = !statusFilter || e.status === statusFilter;
    return ms && mr && mst;
  });

  const modelLabel = (e: Employee) => {
    if (!e.kpi_rule_id) return "Fix salary";
    const r = kpiQ.data?.rules.find(r => r.id === e.kpi_rule_id);
    return r ? `Fix + ${r.name}` : "Fix + KPI";
  };

  return (
    <>
      <Topbar
        title="Xodimlar Ro'yxati"
        sub={`${empQ.data?.count ?? 0} ta xodim`}
        actions={
          <Button variant="primary" onClick={() => setCreating(true)}>
            <Plus className="w-3.5 h-3.5" /> Yangi xodim qo'shish
          </Button>
        }
      />
      <div className="flex-1 overflow-y-auto px-[22px] py-[18px] bg-bg">

        {/* Filter row */}
        <div className="flex items-center gap-3 mb-5 flex-wrap">
          {[
            { label: "Rol", value: roleFilter, onChange: setRoleFilter, options: ROLES.map(r => ({ v: r.value, l: r.label })) },
            { label: "Holat", value: statusFilter, onChange: setStatusFilter, options: STATUSES.map(s => ({ v: s.value, l: s.label })) },
          ].map(f => (
            <div key={f.label} className="relative">
              <select
                value={f.value}
                onChange={e => f.onChange(e.target.value)}
                className="appearance-none pl-3 pr-8 py-2 rounded-[9px] border border-border bg-bg2 text-[13px] text-text font-medium focus:outline-none focus:border-blue cursor-pointer"
              >
                <option value="">{f.label}: Barchasi</option>
                {f.options.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
              </select>
              <ChevronDown className="w-3.5 h-3.5 text-text3 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>
          ))}
          {(roleFilter || statusFilter || search) && (
            <button onClick={() => { setRoleFilter(""); setStatusFilter(""); setSearch(""); }}
              className="text-blue text-[13px] font-medium hover:underline">
              Filtrni tozalash
            </button>
          )}
          <div className="ml-auto relative">
            <Search className="w-3.5 h-3.5 text-text3 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              placeholder="Qidiruv..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-9 pr-3 py-2 rounded-[9px] border border-border bg-bg2 text-[13px] text-text w-48 focus:outline-none focus:border-blue"
            />
          </div>
        </div>

        {/* Table */}
        <div className="bg-bg2 border border-border rounded-xl overflow-hidden">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="bg-bg3 border-b border-border">
                {["XODIM ISMI", "ROL", "ISHGA KIRGAN SANA", "HISOBLASH MODELI", "STATUS", "AMALLAR"].map(h => (
                  <th key={h} className="px-5 py-3 text-left text-[10.5px] font-semibold text-text3 tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {empQ.isLoading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i} className="border-b border-border">
                    <td className="px-5 py-4"><div className="flex items-center gap-3"><Skeleton className="w-9 h-9 rounded-full" /><div><Skeleton className="h-3.5 w-32 mb-1.5" /><Skeleton className="h-2.5 w-24" /></div></div></td>
                    {[1,2,3,4,5].map(j => <td key={j} className="px-5 py-4"><Skeleton className="h-3.5 w-20" /></td>)}
                  </tr>
                ))
              ) : employees.length === 0 ? (
                <tr><td colSpan={6} className="px-5 py-14 text-center text-text3 text-[12.5px]">Xodimlar topilmadi</td></tr>
              ) : employees.map(e => {
                const rs = ROLES.find(r => r.value === e.role);
                const ss = STATUSES.find(s => s.value === e.status);
                const model = modelLabel(e);
                return (
                  <tr key={e.id} className="border-b border-border hover:bg-bg3 transition-colors">
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-3">
                        <AvatarImg name={e.name} url={e.avatar_url} size={36} />
                        <div>
                          <div className="font-semibold text-text">{e.name}</div>
                          <div className="text-[11.5px] text-text3">{e.email ?? `${e.role}@agency.uz`}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-4">
                      <span className={cn("px-2.5 py-1 rounded-md text-[12px] font-semibold", rs?.bg ?? "bg-bg3", rs?.text ?? "text-text2")}>
                        {rs?.label ?? e.role}
                      </span>
                    </td>
                    <td className="px-5 py-4 text-text2">—</td>
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-2">
                        <span className="text-[14px]">{e.kpi_rule_id ? "📈" : "🛡️"}</span>
                        <span className="text-text2">{model}</span>
                      </div>
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-2">
                        <div className={cn("w-2 h-2 rounded-full", ss?.dot ?? "bg-text3")} />
                        <span className={cn("font-semibold text-[12.5px]", e.status === "active" ? "text-green" : e.status === "leave" ? "text-amber" : "text-red")}>
                          {ss?.label ?? e.status}
                        </span>
                      </div>
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex gap-2">
                        <button
                          onClick={() => setViewing(e)}
                          className="px-3 py-1.5 rounded-lg border border-border text-[12px] font-medium text-text2 hover:bg-bg3 transition-colors flex items-center gap-1.5"
                        >
                          <Eye className="w-3 h-3" /> Ko'rib chiqish
                        </button>
                        <button onClick={() => setEditing(e)} className="p-1.5 rounded-lg border border-border text-text3 hover:bg-bg3 hover:text-text transition-colors">
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="px-5 py-3 border-t border-border text-[12px] text-text3">
            Jami: <strong className="text-text">{employees.length}</strong> ta xodim
          </div>
        </div>
      </div>

      {editing && (
        <EditModal employee={editing} kpiRules={kpiQ.data?.rules ?? []} onClose={() => setEditing(null)} />
      )}
      {viewing && (
        <ProfileModal employee={viewing} onClose={() => setViewing(null)} onEdit={() => { setEditing(viewing); setViewing(null); }} />
      )}
      {creating && (
        <CreateModal kpiRules={kpiQ.data?.rules ?? []} onClose={() => setCreating(false)} />
      )}
    </>
  );
}

// ── Profile Modal ──────────────────────────────────────────────────────────────
function ProfileModal({ employee, onClose, onEdit }: { employee: Employee; onClose: () => void; onEdit: () => void }) {
  const monthLabel = MONTH_LABELS[MONTH_KEYS[CUR_MONTH - 1]];
  const rs = ROLES.find(r => r.value === employee.role);
  const ss = STATUSES.find(s => s.value === employee.status);

  const calcQ = useQuery({
    queryKey: ["payroll/calculate", employee.id, CUR_YEAR, CUR_MONTH],
    queryFn: () => calculatePayroll(employee.id, CUR_YEAR, CUR_MONTH),
  });
  const trendQ = useQuery({
    queryKey: ["payroll/sales-trend"],
    queryFn: () => getSalesTrend(6),
  });

  const calc = calcQ.data;
  const trend = trendQ.data?.months ?? [];
  const maxTrend = Math.max(...trend.map(m => m.won_revenue), 1);

  const taxable = employee.fix_base_uzs + employee.attendance_weekly_uzs * 4;
  const taxAmount = Math.round(taxable * 0.12);
  const estimated = calc ? calc.total_uzs : taxable - taxAmount;

  return (
    <Dialog.Root open onOpenChange={o => { if (!o) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 backdrop-blur-[3px] z-[300]" />
        <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-bg border border-border rounded-2xl w-[860px] max-h-[90vh] overflow-y-auto shadow-2xl z-[301]">

          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-border">
            <div className="flex items-center gap-3">
              <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-bg3 text-text3 hover:text-text transition-colors">
                <ArrowLeft className="w-4 h-4" />
              </button>
              <div>
                <span className="text-[12px] text-text3">Payroll System / </span>
                <span className="text-[12px] font-semibold text-blue">Xodim Profili</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="px-3 py-1 rounded-lg bg-blue-bg text-blue text-[12px] font-semibold">📅 {monthLabel} {CUR_YEAR}</span>
              <button onClick={onEdit} className="p-1.5 rounded-lg border border-border text-text3 hover:bg-bg3 transition-colors">
                <Pencil className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          <div className="p-6 grid grid-cols-[260px_1fr] gap-5">

            {/* Left: Employee card */}
            <div className="space-y-4">
              {/* Profile card */}
              <div className="bg-bg2 border border-border rounded-xl p-5">
                <div className="flex flex-col items-center text-center mb-4">
                  <div className="relative mb-3">
                    <AvatarImg name={employee.name} url={employee.avatar_url} size={64} />
                  </div>
                  <div className="text-[16px] font-bold text-text">{employee.name}</div>
                  <div className="text-[12px] text-text3 mt-0.5">{employee.work_position ?? rs?.label ?? employee.role}</div>
                  <div className="mt-2">
                    <span className={cn("px-2.5 py-1 rounded-md text-[11.5px] font-semibold", rs?.bg ?? "bg-bg3", rs?.text ?? "text-text2")}>
                      {rs?.label ?? employee.role}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 mt-2">
                    <div className={cn("w-2 h-2 rounded-full", ss?.dot ?? "bg-text3")} />
                    <span className={cn("text-[12px] font-semibold", employee.status === "active" ? "text-green" : employee.status === "leave" ? "text-amber" : "text-red")}>
                      {ss?.label ?? employee.status}
                    </span>
                  </div>
                </div>
                <div className="border-t border-border pt-3.5">
                  <div className="text-[10px] text-text3 uppercase tracking-wider font-medium mb-1">Taxminiy oylik ({monthLabel})</div>
                  {calcQ.isLoading
                    ? <Skeleton className="h-8 w-full" />
                    : <>
                        <div className="text-[22px] font-bold text-blue">{fmtNum(estimated)} <span className="text-[13px] font-semibold text-text3">UZS</span></div>
                        <div className="text-[11.5px] text-green mt-1 flex items-center gap-1">
                          <TrendingUp className="w-3 h-3" /> Hisoblangan
                        </div>
                      </>
                  }
                </div>
              </div>

              {/* Stats */}
              <div className="bg-bg2 border border-border rounded-xl p-4 space-y-3">
                {[
                  { label: "Asosiy maosh", val: `${fmtNum(employee.fix_base_uzs)} UZS` },
                  { label: "Davomat bonusi", val: `${fmtNum(employee.attendance_weekly_uzs * 4)} UZS` },
                  { label: "Hisobot bonusi", val: `${fmtNum(employee.report_weekly_uzs * 4)} UZS` },
                  { label: "Soliqlr (12%)", val: `−${fmtNum(taxAmount)} UZS`, red: true },
                ].map(r => (
                  <div key={r.label} className="flex justify-between items-center text-[12.5px]">
                    <span className="text-text3">{r.label}</span>
                    <span className={cn("font-semibold", r.red ? "text-red" : "text-text")}>{r.val}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Right */}
            <div className="space-y-4">
              {/* Hisoblash Modeli */}
              <div className="bg-bg2 border border-border rounded-xl p-5">
                <div className="flex items-center gap-2.5 mb-4">
                  <div className="w-8 h-8 rounded-lg bg-blue-bg flex items-center justify-center">
                    <Shield className="w-4 h-4 text-blue" />
                  </div>
                  <span className="text-[14px] font-bold text-text">Hisoblash Modeli</span>
                </div>

                {/* Fix row */}
                <div className="flex items-center justify-between py-3 border-b border-border">
                  <span className="text-[13px] text-text">Asosiy Fix (Maosh)</span>
                  <span className="text-[14px] font-bold text-text">{fmtNum(employee.fix_base_uzs)} <span className="text-text3 text-[11px] font-normal">uzs</span></span>
                </div>

                {/* KPI section */}
                <div className="py-3 border-b border-border">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <TrendingUp className="w-4 h-4 text-blue" />
                      <span className="text-[13px] font-semibold text-text">KPI Ko'rsatkichlari</span>
                    </div>
                    <span className={cn("text-[13px] font-bold", calc?.kpi.payout_usd ? "text-green" : "text-text3")}>
                      {calc ? `+${fmtNum(calc.kpi.payout_usd * 12800)} UZS` : calcQ.isLoading ? "…" : "—"}
                    </span>
                  </div>

                  {calcQ.isLoading ? (
                    <div className="space-y-2"><Skeleton className="h-8 w-full" /><Skeleton className="h-8 w-full" /></div>
                  ) : calc ? (
                    <div className="space-y-3">
                      {[
                        {
                          label: `Shartnomalar soni (${calc.deal_count}/30)`,
                          pct: Math.min(100, Math.round((calc.deal_count / 30) * 100)),
                          color: "bg-green",
                        },
                        {
                          label: `Sotuv hajmi ($${Math.round(calc.revenue_usd / 1000)}K / $1.5M)`,
                          pct: Math.min(100, Math.round((calc.revenue_usd / 1_500_000) * 100)),
                          color: "bg-blue",
                        },
                      ].map(bar => (
                        <div key={bar.label}>
                          <div className="flex justify-between text-[11.5px] text-text3 mb-1.5">
                            <span>{bar.label}</span>
                            <span>{bar.pct}%</span>
                          </div>
                          <div className="h-2 bg-bg3 rounded-full overflow-hidden">
                            <div className={cn("h-full rounded-full transition-all", bar.color)} style={{ width: `${bar.pct}%` }} />
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-[12px] text-text3 py-1">KPI qoidasi yo'q yoki ma'lumot yuklanmadi</div>
                  )}
                </div>

                {/* Bonus & Ushlanma */}
                <div className="flex gap-4 pt-3">
                  <div className="flex-1 bg-amber-bg rounded-lg p-3">
                    <div className="text-[10px] text-amber font-bold tracking-wider mb-1">BONUS</div>
                    <div className="text-[15px] font-bold text-amber">
                      {calc ? `+${fmtNum(calc.bonuses_total_usd * 12800)} UZS` : "+0 UZS"}
                    </div>
                  </div>
                  <div className="flex-1 bg-red-bg rounded-lg p-3">
                    <div className="text-[10px] text-red font-bold tracking-wider mb-1">USHLANMA</div>
                    <div className="text-[15px] font-bold text-red">−0 UZS</div>
                  </div>
                </div>
              </div>

              {/* 6 Oylik Dinamika */}
              <div className="bg-bg2 border border-border rounded-xl p-5">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-lg bg-green-bg flex items-center justify-center">
                      <TrendingUp className="w-4 h-4 text-green" />
                    </div>
                    <span className="text-[14px] font-bold text-text">6 Oylik Dinamika</span>
                  </div>
                  <span className="text-[11px] text-text3 bg-bg3 px-2 py-1 rounded">BIRLIK: UZS (min)</span>
                </div>
                {trendQ.isLoading ? (
                  <Skeleton className="h-28 w-full" />
                ) : trend.length === 0 ? (
                  <div className="text-center text-text3 text-[12px] py-8">Ma'lumot yo'q</div>
                ) : (
                  <div className="flex items-end gap-2 h-28">
                    {trend.map((m, i) => {
                      const pct = maxTrend > 0 ? (m.won_revenue / maxTrend) * 100 : 0;
                      const isLast = i === trend.length - 1;
                      const label = new Date(m.year, m.month - 1).toLocaleString('uz-UZ', { month: 'short' });
                      return (
                        <div key={`${m.year}-${m.month}`} className="flex-1 flex flex-col items-center gap-1.5">
                          {isLast && <span className="text-[10px] font-bold text-blue">{Math.round(m.won_revenue / 1000)}K</span>}
                          <div className="w-full flex items-end" style={{ height: '80px' }}>
                            <div
                              className={cn("w-full rounded-t-md transition-all", isLast ? "bg-blue" : "bg-bg3")}
                              style={{ height: `${Math.max(8, pct)}%` }}
                            />
                          </div>
                          <span className="text-[9px] font-medium text-text3 uppercase">{label.slice(0, 3)}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="px-6 py-4 border-t border-border flex items-center justify-between bg-bg3 rounded-b-2xl">
            <span className="text-[11.5px] text-text3">ID: #{employee.id}</span>
            <div className="flex gap-2">
              <Button onClick={onClose}>Yopish</Button>
              <Button variant="primary" onClick={onEdit}><Pencil className="w-3 h-3" /> Tahrirlash</Button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// ── Create Modal ───────────────────────────────────────────────────────────────
function CreateModal({ kpiRules, onClose }: { kpiRules: { id: number; name: string }[]; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [bitrixId, setBitrixId] = useState("");
  const [form, setForm] = useState<EmployeeExtraIn>({
    role: "closer", status: "active",
    fix_base_uzs: 4_500_000, attendance_weekly_uzs: 500_000, report_weekly_uzs: 300_000,
    schedule_start: "09:00", schedule_end: "18:00",
    kpi_rule_id: null, notes: "", login: "", dashboard_role: "", password: "",
  });
  const [saving, setSaving] = useState(false);

  async function save() {
    const id = Number(bitrixId);
    if (!id || isNaN(id)) { toast.error("Bitrix24 ID kerak"); return; }
    setSaving(true);
    try {
      await upsertEmployeeExtra(id, form);
      qc.invalidateQueries({ queryKey: ["payroll/employees"] });
      toast.success("Xodim qo'shildi", `Bitrix24 ID: ${id}`);
      onClose();
    } catch (e) { toast.error("Xato", (e as Error).message); }
    finally { setSaving(false); }
  }

  return (
    <Dialog.Root open onOpenChange={o => { if (!o) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40 backdrop-blur-[2px] z-[300]" />
        <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-bg2 border border-border rounded-xl p-6 w-[480px] max-h-[90vh] overflow-y-auto shadow-lg z-[301]">
          <Dialog.Title className="text-[15px] font-semibold mb-1">Yangi xodim qo'shish</Dialog.Title>
          <p className="text-[12px] text-text3 mb-5">Xodim Bitrix24 tizimida mavjud bo'lishi kerak. Bitrix24 ID kiriting.</p>

          <Field label="Bitrix24 Foydalanuvchi ID *">
            <input
              type="number"
              className={fi}
              value={bitrixId}
              onChange={e => setBitrixId(e.target.value)}
              placeholder="Masalan: 42"
            />
          </Field>

          <div className="grid grid-cols-2 gap-3 mt-3">
            <Field label="Rol">
              <select className={fi} value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}>
                {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </Field>
            <Field label="Status">
              <select className={fi} value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
                {STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </Field>
            <Field label="Fix base (so'm)">
              <input type="number" className={fi} value={form.fix_base_uzs ?? 0} onChange={e => setForm(f => ({ ...f, fix_base_uzs: Number(e.target.value) }))} />
            </Field>
            <Field label="Davomat haftalik (so'm)">
              <input type="number" className={fi} value={form.attendance_weekly_uzs ?? 0} onChange={e => setForm(f => ({ ...f, attendance_weekly_uzs: Number(e.target.value) }))} />
            </Field>
            <Field label="KPI qoida">
              <select className={fi} value={form.kpi_rule_id ?? ""} onChange={e => setForm(f => ({ ...f, kpi_rule_id: e.target.value ? Number(e.target.value) : null }))}>
                <option value="">— KPI yo'q —</option>
                {kpiRules.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </Field>
            <Field label="Dashboard roli">
              <select className={fi} value={form.dashboard_role ?? ""} onChange={e => setForm(f => ({ ...f, dashboard_role: e.target.value }))}>
                {DASHBOARD_ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </Field>
            <Field label="Login">
              <input className={fi} value={form.login ?? ""} onChange={e => setForm(f => ({ ...f, login: e.target.value }))} placeholder="username" />
            </Field>
            <Field label="Parol">
              <input type="password" className={fi} value={form.password ?? ""} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} />
            </Field>
          </div>

          <div className="flex justify-end gap-2 mt-5 pt-4 border-t border-border">
            <Button onClick={onClose}>Bekor</Button>
            <Button variant="primary" disabled={saving} onClick={save}>
              {saving ? "Qo'shilmoqda…" : <><Plus className="w-3.5 h-3.5" /> Qo'shish</>}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// ── Edit Modal ─────────────────────────────────────────────────────────────────
function EditModal({ employee, kpiRules, onClose }: { employee: Employee; kpiRules: { id: number; name: string }[]; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(employee.avatar_url);

  async function handleAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setAvatarUploading(true);
    try {
      const res = await uploadEmployeeAvatar(employee.id, file);
      setAvatarPreview(res.avatar_url);
      qc.invalidateQueries({ queryKey: ["payroll/employees"] });
      toast.success("Rasm yuklandi");
    } catch (err) { toast.error("Rasm yuklanmadi", (err as Error).message); }
    finally { setAvatarUploading(false); }
  }

  async function handleAvatarDelete() {
    try {
      await deleteEmployeeAvatar(employee.id);
      setAvatarPreview(null);
      qc.invalidateQueries({ queryKey: ["payroll/employees"] });
      toast.success("Rasm o'chirildi");
    } catch (err) { toast.error("Xato", (err as Error).message); }
  }

  const [form, setForm] = useState<EmployeeExtraIn>({
    role: employee.role, status: employee.status, fix_base_uzs: employee.fix_base_uzs,
    attendance_weekly_uzs: employee.attendance_weekly_uzs, report_weekly_uzs: employee.report_weekly_uzs,
    schedule_start: employee.schedule_start, schedule_end: employee.schedule_end,
    kpi_rule_id: employee.kpi_rule_id, notes: employee.notes ?? "", login: employee.login ?? "",
    dashboard_role: employee.dashboard_role ?? "", password: "",
  });
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      const res = await upsertEmployeeExtra(employee.id, form);
      await qc.invalidateQueries({ queryKey: ["payroll/employees"] });
      toast.success("Saqlandi", `${res.role} — ${employee.name}`);
      onClose();
    } catch (e) {
      const msg = (e as Error).message || "Noma'lum xato";
      toast.error("Saqlashda xato", msg);
      console.error("Save failed:", e);
    } finally { setSaving(false); }
  }

  return (
    <Dialog.Root open onOpenChange={o => { if (!o) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40 backdrop-blur-[2px] z-[300]" />
        <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-bg2 border border-border rounded-xl p-6 w-[480px] max-h-[88vh] overflow-y-auto shadow-lg z-[301]">
          <Dialog.Title className="text-[15px] font-semibold mb-4">
            Xodim tahrirlash — {employee.name}
          </Dialog.Title>

          {/* Avatar upload */}
          <div className="flex items-center gap-4 mb-5 p-3 bg-bg3 rounded-xl">
            <AvatarImg name={employee.name} url={avatarPreview} size={52} />
            <div className="flex-1">
              <div className="text-[12px] font-semibold text-text mb-1">Profil rasmi</div>
              <div className="flex gap-2">
                <label className={cn("px-3 py-1.5 rounded-lg border border-border bg-bg text-[12px] font-medium text-text2 cursor-pointer hover:bg-bg3 transition-colors", avatarUploading && "opacity-50 pointer-events-none")}>
                  {avatarUploading ? "Yuklanmoqda…" : "📷 Rasm yuklash"}
                  <input type="file" accept="image/*" className="hidden" onChange={handleAvatarChange} disabled={avatarUploading} />
                </label>
                {avatarPreview && (
                  <button onClick={handleAvatarDelete} className="px-3 py-1.5 rounded-lg border border-border bg-bg text-[12px] font-medium text-red hover:bg-red-bg transition-colors">
                    O'chirish
                  </button>
                )}
              </div>
              <div className="text-[10.5px] text-text3 mt-1">JPG, PNG, WebP · max 5 MB</div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Rol">
              <select className={fi} value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}>
                {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </Field>
            <Field label="Status">
              <select className={fi} value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
                {STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </Field>
            <Field label="Fix base (so'm)">
              <input type="number" className={fi} value={form.fix_base_uzs ?? 0} onChange={e => setForm(f => ({ ...f, fix_base_uzs: Number(e.target.value) }))} />
            </Field>
            <Field label="Davomat haftalik (so'm)">
              <input type="number" className={fi} value={form.attendance_weekly_uzs ?? 0} onChange={e => setForm(f => ({ ...f, attendance_weekly_uzs: Number(e.target.value) }))} />
            </Field>
            <Field label="Hisobot haftalik (so'm)">
              <input type="number" className={fi} value={form.report_weekly_uzs ?? 0} onChange={e => setForm(f => ({ ...f, report_weekly_uzs: Number(e.target.value) }))} />
            </Field>
            <Field label="KPI qoida">
              <select className={fi} value={form.kpi_rule_id ?? ""} onChange={e => setForm(f => ({ ...f, kpi_rule_id: e.target.value ? Number(e.target.value) : null }))}>
                <option value="">— KPI yo'q —</option>
                {kpiRules.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </Field>
            <Field label="Ish boshlanishi">
              <input type="time" className={fi} value={form.schedule_start ?? "09:00"} onChange={e => setForm(f => ({ ...f, schedule_start: e.target.value }))} />
            </Field>
            <Field label="Ish tugashi">
              <input type="time" className={fi} value={form.schedule_end ?? "18:00"} onChange={e => setForm(f => ({ ...f, schedule_end: e.target.value }))} />
            </Field>
          </div>
          <Field label="Izoh" className="mt-3">
            <textarea className={fi} rows={2} value={form.notes ?? ""} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
          </Field>
          <div className="mt-4 pt-4 border-t border-border">
            <div className="text-[10px] text-text3 uppercase tracking-wider font-medium mb-2">Dashboard kirish</div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Login">
                <input className={fi} value={form.login ?? ""} onChange={e => setForm(f => ({ ...f, login: e.target.value }))} placeholder="username" />
              </Field>
              <Field label="Yangi parol">
                <input type="password" className={fi} value={form.password ?? ""} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} placeholder="O'zgartirish uchun" />
              </Field>
              <Field label="Dashboard roli" className="col-span-2">
                <select className={fi} value={form.dashboard_role ?? ""} onChange={e => setForm(f => ({ ...f, dashboard_role: e.target.value }))}>
                  {DASHBOARD_ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
              </Field>
            </div>
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

function Field({ label, children, className = "" }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <label className="block text-[10px] text-text3 mb-1 uppercase tracking-wider font-medium">{label}</label>
      {children}
    </div>
  );
}

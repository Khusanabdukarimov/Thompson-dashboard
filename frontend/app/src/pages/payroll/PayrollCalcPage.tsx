import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Topbar } from "@/components/Topbar";
import { Button } from "@/components/Button";
import { Badge } from "@/components/Badge";
import { Skeleton } from "@/components/Skeleton";
import {
  listEmployees, calculatePayroll, createApproval, listApprovals,
} from "@/lib/api/payroll";
import { fmtNum, fmtMoney } from "@/lib/utils";
import { MONTH_KEYS, MONTH_LABELS } from "@/lib/api/meta";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { useToast } from "@/components/Toast";

const now = new Date();
const DEFAULT_MONTH = now.getMonth() + 1;
const DEFAULT_YEAR = now.getFullYear();

const TARGET_NAMES = [
  'davlatyor',
  'shaxzod', 'yormatov',
  'shaxod',  'turonov',
  'samandar', 'samadov',
  'temurmalik', 'xoshimjonov',
  'bekzod', 'ergashev',
  'muxriddin', 'atoullayev',
];
function isTarget(name: string) {
  const lower = name.toLowerCase();
  return TARGET_NAMES.some(t => lower.includes(t));
}

export default function PayrollCalcPage() {
  const [year, setYear] = useState<number>(DEFAULT_YEAR);
  const [month, setMonth] = useState<number>(DEFAULT_MONTH);
  const [activePreset, setActivePreset] = useLocalStorage<string | null>(
    "payroll-calc.preset",
    null,
  );
  const [approving, setApproving] = useState(false);
  const toast = useToast();
  const qc = useQueryClient();

  const empQ = useQuery({
    queryKey: ["payroll/employees"],
    queryFn: listEmployees,
  });
  const employees = (empQ.data?.employees ?? []).filter(e => isTarget(e.name));

  // Resolve active employee from preset
  const activeEmpId = useMemo(() => {
    const id = activePreset ? Number(activePreset) : null;
    if (id && employees.some((e) => e.id === id)) return id;
    return employees[0]?.id ?? null;
  }, [activePreset, employees]);
  const activeEmp = employees.find((e) => e.id === activeEmpId) ?? null;

  const calcQ = useQuery({
    queryKey: ["payroll/calculate", activeEmpId, year, month],
    queryFn: () => calculatePayroll(activeEmpId as number, year, month),
    enabled: !!activeEmpId,
  });

  const calc = calcQ.data;

  const approvalsQ = useQuery({
    queryKey: ["payroll/approvals", year, month],
    queryFn: () => listApprovals(year, month),
  });
  const currentApproval = approvalsQ.data?.approvals.find(
    a => a.bitrix_user_id === activeEmpId
  ) ?? null;

  async function handleApprove() {
    if (!activeEmp || !calc) return;
    setApproving(true);
    try {
      await createApproval({
        bitrix_user_id: activeEmp.id,
        year, month,
        employee_name: activeEmp.name,
        fix_base_uzs: activeEmp.fix_base_uzs,
        attendance_bonus_uzs: activeEmp.attendance_weekly_uzs * 4,
        kpi_payout_usd: calc.kpi.payout_usd,
        bonus_total_usd: calc.bonuses_total_usd,
        penalty_uzs: calc.penalties_uzs,
        total_uzs: calc.total_uzs,
        total_usd: calc.total_usd,
        note: null,
        approved_by: null,
      });
      qc.invalidateQueries({ queryKey: ["payroll/approvals"] });
      toast.success("Tasdiqlandi", `${activeEmp.name} uchun oylik tasdiqlandi`);
    } catch (e) { toast.error("Xato", (e as Error).message); }
    finally { setApproving(false); }
  }

  const [listTab, setListTab] = useState<"all" | "pending" | "paid">("all");
  const filteredEmp = useMemo(() => {
    if (listTab === "pending") return employees.filter(e => e.status === "active");
    if (listTab === "paid") return employees.filter(e => e.status !== "active");
    return employees;
  }, [employees, listTab]);

  return (
    <>
      <Topbar
        title="Payroll Hisoblash"
        sub={`${MONTH_LABELS[MONTH_KEYS[month - 1]]} ${year}`}
        actions={
          <div className="flex items-center gap-2">
            <select className="px-2.5 py-1.5 rounded border border-border2 bg-bg2 text-[12px] text-text shadow-xs" value={month} onChange={e => setMonth(Number(e.target.value))}>
              {MONTH_KEYS.map((m, i) => <option key={m} value={i + 1}>{MONTH_LABELS[m]}</option>)}
            </select>
            <select className="px-2.5 py-1.5 rounded border border-border2 bg-bg2 text-[12px] text-text shadow-xs" value={year} onChange={e => setYear(Number(e.target.value))}>
              {[DEFAULT_YEAR, DEFAULT_YEAR - 1, DEFAULT_YEAR - 2].map(y => <option key={y} value={y}>{y}</option>)}
            </select>
            <Button variant="primary" onClick={() => calcQ.refetch()}>{calcQ.isFetching ? "…" : "Hisoblash"}</Button>
          </div>
        }
      />
      <div className="flex-1 overflow-y-auto px-[22px] py-[18px] bg-bg">
        <div className="grid grid-cols-[340px_1fr] gap-5 items-start">

          {/* Left: employee list */}
          <div className="bg-bg2 border border-border rounded-xl overflow-hidden">
            <div className="px-4 py-3.5 border-b border-border">
              <div className="text-[14px] font-bold text-text mb-1">Oylik hisob-kitoblar</div>
              <div className="text-[12px] text-text3">{MONTH_LABELS[MONTH_KEYS[month - 1]]} uchun payroll tahlili</div>
            </div>

            {/* Tab filter */}
            <div className="flex gap-2 px-3 py-2.5 border-b border-border">
              {([
                { key: "all",     label: `Barchasi (${employees.length})` },
                { key: "pending", label: `Kutilmoqda (${employees.filter(e => e.status === "active").length})` },
                { key: "paid",    label: `To'langan (${employees.filter(e => e.status !== "active").length})` },
              ] as const).map(t => (
                <button key={t.key} onClick={() => setListTab(t.key)}
                  className={`px-3 py-1.5 rounded-lg text-[11.5px] font-medium transition-all ${
                    listTab === t.key ? "bg-blue text-white" : "bg-bg3 text-text2 hover:bg-bg"
                  }`}
                >{t.label}</button>
              ))}
            </div>

            {/* Employee rows */}
            <div className="overflow-y-auto" style={{ maxHeight: "calc(100vh - 280px)" }}>
              {empQ.isLoading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="px-4 py-3 border-b border-border">
                    <Skeleton className="h-4 w-36 mb-1.5" /><Skeleton className="h-3 w-24" />
                  </div>
                ))
              ) : filteredEmp.map(e => {
                const active = activeEmpId === e.id;
                return (
                  <button
                    key={e.id}
                    onClick={() => setActivePreset(String(e.id))}
                    className={`w-full text-left px-4 py-3.5 border-b border-border transition-colors ${
                      active ? "bg-blue" : "hover:bg-bg3"
                    }`}
                  >
                    <div className="flex items-center gap-3 mb-2">
                      <div className={`w-9 h-9 rounded-full flex items-center justify-center text-[12px] font-bold text-white shrink-0 ${active ? "bg-white/20" : "bg-blue"}`}>
                        {e.name.split(" ").map((w: string) => w[0]).join("").slice(0, 2).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className={`font-semibold text-[13px] truncate ${active ? "text-white" : "text-text"}`}>{e.name}</div>
                        <div className={`text-[11px] ${active ? "text-white/70" : "text-text3"}`}>{e.work_position || e.role}</div>
                      </div>
                      <span className={`text-[11px] font-semibold px-2.5 py-1 rounded-full ${
                        active ? "bg-white/20 text-white" :
                        e.status === "active" ? "bg-amber-bg text-amber" : "bg-green-bg text-green"
                      }`}>
                        {e.status === "active" ? "Hisoblangan" : "To'langan"}
                      </span>
                    </div>
                    <div className={`flex justify-between pl-12 text-[11px] ${active ? "text-white/60" : "text-text3"}`}>
                      <span>Jami oylik:</span>
                      <span className={`text-[13px] font-bold ${active ? "text-white" : "text-text"}`}>
                        {fmtNum(e.fix_base_uzs)} so'm
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Right: detail panel */}
          <div className="bg-bg2 border border-border rounded-xl overflow-hidden">
        {empQ.isLoading && !empQ.data && (
          <div className="p-6 space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="h-9 w-9 rounded-lg" />
                <div className="flex-1"><Skeleton className="h-3 w-40 mb-1.5" /><Skeleton className="h-2.5 w-28" /></div>
                <Skeleton className="h-4 w-24" />
              </div>
            ))}
          </div>
        )}

        {!empQ.isLoading && !activeEmp && (
          <div className="text-center text-text3 py-16 text-[12.5px]">
            Xodim tanlang
          </div>
        )}

        {activeEmp && (
          <>
            {/* Detail header */}
            <div className="px-5 py-3.5 border-b border-border flex items-center gap-3">
              <span className="text-[13.5px] font-bold text-text">{activeEmp.name} — {MONTH_LABELS[MONTH_KEYS[month - 1]]} {year} hisobi</span>
              <Badge tone={calc ? "amber" : "gray"}>
                {calcQ.isFetching ? "Hisoblanmoqda…" : calc ? "Hisoblangan" : "Hisoblanmagan"}
              </Badge>
              <span className="ml-auto text-[12px] text-text3">ID: #{activeEmp.id}</span>
            </div>

            {/* Calc rows */}
            <div className="px-5 py-1">
              {[
                { icon: "💼", bg: "bg-blue-bg", title: "Base Fix (Oklad)", sub: `Shartnoma bo'yicha asosiy stavka · ${activeEmp.schedule_start}–${activeEmp.schedule_end}`, value: `${fmtNum(activeEmp.fix_base_uzs)} so'm`, color: "text-text" },
                { icon: "✅", bg: "bg-green-bg", title: "Attendance Bonus", sub: `Kechikishlarsiz to'liq davomat uchun`, value: `${fmtNum(activeEmp.attendance_weekly_uzs * 4)} so'm`, color: "text-green" },
                { icon: "📈", bg: "bg-blue-bg", title: "Sales KPI (Bonusi)", sub: calc ? `${calc.deal_count} ta deal · $${Math.round(calc.revenue_usd).toLocaleString()} tushumdan ${calc.kpi.percent || 0}% stavka` : "— qoidasiz —", value: calc ? fmtMoney(calc.kpi.payout_usd) : "$0", color: "text-blue" },
                { icon: "⭐", bg: "bg-amber-bg", title: "Extra Bonuses", sub: calc && calc.bonuses.length > 0 ? `${calc.bonuses.length} ta bonus` : "—", value: calc ? fmtMoney(calc.bonuses_total_usd) : "$0", color: "text-amber" },
              ].map((row, i) => (
                <div key={i} className="flex items-center py-4 border-b border-border last:border-0 gap-4">
                  <div className={`w-9 h-9 rounded-[9px] ${row.bg} flex items-center justify-center text-[17px] shrink-0`}>{row.icon}</div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-semibold text-text">{row.title}</div>
                    <div className="text-[11.5px] text-text3 mt-0.5 truncate">{row.sub}</div>
                  </div>
                  <div className={`text-[14px] font-bold ${row.color}`}>{row.value}</div>
                </div>
              ))}
            </div>

            {/* Tax line */}
            <div className="px-5 py-2.5 flex justify-between items-center border-t border-border">
              <span className="text-[13px] text-text3">Soliqlar va ushlanmalar (12%)</span>
              <span className="text-[13px] text-text3">−{fmtNum(Math.round((activeEmp.fix_base_uzs + activeEmp.attendance_weekly_uzs * 4) * 0.12))} so'm</span>
            </div>

            {/* Total block */}
            <div className="mx-5 mb-5 rounded-xl px-5 py-4 flex justify-between items-center" style={{ background: '#0d1b2a' }}>
              <div>
                <div className="text-white font-bold text-[13px] tracking-wider uppercase">Jami to'lanishi kerak</div>
                <div className="text-[#64748b] text-[11.5px] mt-1 italic">Hisoblangan barcha bonuslar bilan birga</div>
              </div>
              <div className="text-right">
                <div className="text-white font-bold text-[20px]">{fmtNum(calc?.total_uzs ?? activeEmp.fix_base_uzs)} so'm</div>
                {calc && calc.total_usd > 0 && <div className="text-[#64748b] text-[12px] mt-0.5">+ {fmtMoney(calc.total_usd)}</div>}
              </div>
            </div>

            {/* Action buttons */}
            <div className="px-5 pb-5 flex gap-3">
              <button
                onClick={() => calcQ.refetch()}
                className="flex-1 py-2.5 rounded-[10px] border border-border bg-bg text-text text-[13px] font-semibold flex items-center justify-center gap-2 hover:bg-bg3 transition-colors"
              >
                🔄 Qayta hisoblash
              </button>
              <button
                onClick={handleApprove}
                disabled={approving || !calc}
                className="flex-1 py-2.5 rounded-[10px] bg-blue text-white text-[13px] font-semibold flex items-center justify-center gap-2 hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {approving ? "Saqlanmoqda…" : currentApproval ? "✓ Tasdiqlangan" : "✓ Tasdiqlab yuborish"}
              </button>
            </div>
            {currentApproval && (
              <div className="px-5 pb-4 text-[11.5px] text-green flex items-center gap-2">
                <span>✓</span>
                <span>
                  {MONTH_LABELS[MONTH_KEYS[month - 1]]} {year} — tasdiqlangan
                  {currentApproval.status === "paid" ? " · To'langan" : ""}
                </span>
              </div>
            )}
          </>
        )}

        {(empQ.error || calcQ.error) && (
          <div className="mt-4 p-3 bg-red-bg border border-red-bd text-red rounded-lg text-[12.5px]">
            Xatolik: {((empQ.error ?? calcQ.error) as Error).message}
          </div>
        )}
          </div>
        </div>
      </div>
    </>
  );
}

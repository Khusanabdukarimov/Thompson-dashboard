import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Topbar } from '@/components/Topbar';
import { Button } from '@/components/Button';
import { Badge } from '@/components/Badge';
import { MetricCard } from '@/components/MetricCard';
import { FilterBar } from '@/components/FilterBar';
import type { FilterField, FilterPreset, FilterValues } from '@/components/FilterBar';
import { MetricRowSkeleton, Skeleton } from '@/components/Skeleton';
import { listEmployees, calculatePayroll, getMonthlyTarget } from '@/lib/api/payroll';
import { fmtNum, fmtMoney, fmtPct } from '@/lib/utils';
import { MONTH_KEYS, MONTH_LABELS } from '@/lib/api/meta';
import { useLocalStorage } from '@/hooks/useLocalStorage';

const now = new Date();
const DEFAULT_MONTH = now.getMonth() + 1;
const DEFAULT_YEAR = now.getFullYear();

export default function PayrollCalcPage() {
  const [year, setYear] = useState<number>(DEFAULT_YEAR);
  const [month, setMonth] = useState<number>(DEFAULT_MONTH);
  const [activePreset, setActivePreset] = useLocalStorage<string | null>('payroll-calc.preset', null);
  const [search, setSearch] = useState('');
  const [values, setValues] = useLocalStorage<FilterValues>('payroll-calc.filter', {});

  const empQ = useQuery({ queryKey: ['payroll/employees'], queryFn: listEmployees });
  const targetQ = useQuery({
    queryKey: ['payroll/target', year, month],
    queryFn: () => getMonthlyTarget(year, month),
  });

  const employees = empQ.data?.employees ?? [];

  // Employee presets — one per employee, plus search by name in popover.
  const employeePresets: FilterPreset[] = useMemo(
    () => employees.map(e => ({ id: String(e.id), label: e.name, pinned: true })),
    [employees],
  );

  const roleOptions = useMemo(() => {
    const set = new Set<string>();
    employees.forEach(e => { if (e.role) set.add(e.role); });
    return [...set].sort();
  }, [employees]);

  const filterFields: FilterField[] = useMemo(() => [
    { key: 'role', label: 'Lavozim', type: 'select', options: roleOptions.map(v => ({ value: v, label: v })) },
  ], [roleOptions]);

  // Resolve active employee from preset (preset id is the employee id as string).
  const activeEmpId = useMemo(() => {
    const id = activePreset ? Number(activePreset) : null;
    if (id && employees.some(e => e.id === id)) return id;
    return employees[0]?.id ?? null;
  }, [activePreset, employees]);
  const activeEmp = employees.find(e => e.id === activeEmpId) ?? null;

  // Filtered presets shown in popover sidebar (search + role filter narrow the list).
  const filteredPresets = useMemo(() => {
    const s = search.trim().toLowerCase();
    const role = values.role || '';
    return employeePresets.filter(p => {
      const emp = employees.find(e => String(e.id) === p.id);
      if (!emp) return false;
      if (role && emp.role !== role) return false;
      if (s && !emp.name.toLowerCase().includes(s)) return false;
      return true;
    });
  }, [employeePresets, employees, search, values.role]);

  const calcQ = useQuery({
    queryKey: ['payroll/calculate', activeEmpId, year, month],
    queryFn: () => calculatePayroll(activeEmpId as number, year, month),
    enabled: !!activeEmpId,
  });

  const calc = calcQ.data;

  const target = targetQ.data?.target_usd ?? 0;
  const targetProgress = useMemo(() => {
    if (!target || !calc) return 0;
    return (calc.revenue_usd / target) * 100;
  }, [target, calc]);

  return (
    <>
      <Topbar
        title="Oylik hisob"
        sub={`Payroll breakdown — ${MONTH_LABELS[MONTH_KEYS[month - 1]]} ${year}`}
      />
      <div className="flex-1 overflow-y-auto px-[22px] py-[18px] bg-bg">
        <div className="bg-bg2 border border-border rounded-lg shadow p-3 mb-4 flex items-center gap-3 flex-wrap">
          <FilterBar
            presets={filteredPresets}
            activePreset={activeEmpId ? String(activeEmpId) : null}
            onPresetChange={setActivePreset}
            searchValue={search}
            onSearchChange={setSearch}
            fields={filterFields}
            values={values}
            onChange={(k, v) => setValues((s) => ({ ...s, [k]: v }))}
            onClear={() => { setSearch(''); setValues({}); setActivePreset(null); }}
            onApply={() => { /* client-side */ }}
            activeChipLabel={activeEmp?.name}
            onActiveChipClear={() => setActivePreset(null)}
            storageKey="payroll.calc"
            onApplySavedFilter={(v) => setValues(v as typeof values)}
          />
          <div className="flex items-center gap-2 ml-auto">
            <select
              className="px-2.5 py-1.5 rounded border border-border2 bg-bg2 text-[12px] text-text shadow-xs"
              value={month}
              onChange={(e) => setMonth(Number(e.target.value))}
            >
              {MONTH_KEYS.map((m, i) => <option key={m} value={i + 1}>{MONTH_LABELS[m]}</option>)}
            </select>
            <select
              className="px-2.5 py-1.5 rounded border border-border2 bg-bg2 text-[12px] text-text shadow-xs"
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
            >
              {[DEFAULT_YEAR, DEFAULT_YEAR - 1, DEFAULT_YEAR - 2].map(y => <option key={y} value={y}>{y}</option>)}
            </select>
            <Button variant="primary" onClick={() => calcQ.refetch()}>{calcQ.isFetching ? '…' : 'Hisoblash'}</Button>
          </div>
        </div>
        {empQ.isLoading && !empQ.data && (
          <>
            <MetricRowSkeleton count={4} />
            <div className="bg-bg2 border border-border rounded-lg shadow p-6 space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center justify-between gap-3">
                  <Skeleton className="h-3 flex-1" style={{ maxWidth: 200 }} />
                  <Skeleton className="h-1 w-32" />
                  <Skeleton className="h-3 w-32" />
                </div>
              ))}
            </div>
          </>
        )}

        {!empQ.isLoading && !activeEmp && (
          <div className="text-center text-text3 py-16 text-[12.5px]">Xodim tanlang</div>
        )}

        {activeEmp && (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 mb-4">
              <MetricCard label="Fix base (oy)" value={fmtNum(activeEmp.fix_base_uzs)} tone="blue" hint="so'm" />
              <MetricCard label="KPI payout" value={calc ? fmtMoney(calc.kpi.payout_usd) : '—'} tone="green" hint={calc?.kpi.percent ? `${calc.kpi.percent}% × ${fmtMoney(calc.revenue_usd)}` : '—'} />
              <MetricCard label="Bonuslar" value={calc ? fmtMoney(calc.bonuses_total_usd) : '—'} tone="amber" hint={`${calc?.bonuses.length ?? 0} ta bonus`} />
              <MetricCard label="Jarimalar (so'm)" value={calc ? fmtNum(calc.penalties_uzs) : '—'} tone="red" hint={calc?.penalty_breakdown.length ? `${calc.penalty_breakdown.length} ta tur` : '0 ta'} />
            </div>

            <div className="bg-bg2 border border-border rounded-lg shadow overflow-hidden mb-4">
              <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                <span className="text-[13px] font-semibold">{activeEmp.name} — {MONTH_LABELS[MONTH_KEYS[month - 1]]} {year} breakdown</span>
                <Badge tone={calc ? 'amber' : 'gray'}>{calcQ.isFetching ? 'Hisoblanmoqda…' : calc ? 'Hisoblangan' : 'Hisoblanmagan'}</Badge>
              </div>

              <div className="p-4">
                <BRow
                  label={`Fix base (${activeEmp.role})`}
                  hint={`${activeEmp.schedule_start}–${activeEmp.schedule_end} · ${activeEmp.attendance_weekly_uzs > 0 ? `Att ${fmtNum(activeEmp.attendance_weekly_uzs)}/hafta` : ''}`}
                  value={`${fmtNum(activeEmp.fix_base_uzs)} so'm`}
                  bar={activeEmp.fix_base_uzs > 0 ? 100 : 0}
                  color="var(--blue)"
                />
                <BRow
                  label="Bitrix savdo (deal won)"
                  hint={calc ? `${calc.deal_count} ta deal · ${target ? fmtPct(targetProgress, 1) + ' maqsad' : 'maqsad belgilanmagan'}` : '—'}
                  value={calc ? fmtMoney(calc.revenue_usd) : '—'}
                  bar={target ? Math.min(100, targetProgress) : 0}
                  color="var(--green)"
                />
                <BRow
                  label={`KPI payout ${calc?.kpi.matched_tier ? `(tier ${fmtMoney(Number(calc.kpi.matched_tier.from))}+ → ${calc.kpi.matched_tier.percent}%)` : ''}`}
                  hint={calc?.kpi.rule_name ?? '— qoidasiz —'}
                  value={calc ? fmtMoney(calc.kpi.payout_usd) : '—'}
                  bar={calc?.revenue_usd ? 70 : 0}
                  color="var(--green)"
                />
                <BRow
                  label="Bonuslar"
                  hint={`${calc?.bonuses.length ?? 0} ta`}
                  value={calc ? fmtMoney(calc.bonuses_total_usd) : '—'}
                  bar={calc && calc.bonuses_total_usd > 0 ? 50 : 0}
                  color="var(--amber)"
                />
                <BRow
                  label="Jarimalar"
                  hint={calc && calc.penalty_breakdown.length > 0
                    ? calc.penalty_breakdown.map(b => `${b.kind} ${b.bucket} × ${b.count}`).join(', ')
                    : 'kechikish + boshqalar'}
                  value={calc && calc.penalties_uzs > 0 ? `−${fmtNum(calc.penalties_uzs)} so'm` : '—'}
                  bar={0}
                  color="var(--red)"
                />

                {calc && (
                  <div className="mt-3 pt-3 flex justify-between items-center bg-green-bg rounded-md border border-green-bd px-4 py-3">
                    <span className="text-[14px] font-bold text-green">Jami oylik to'lov</span>
                    <span className="mono text-[16px] font-bold text-green">
                      ≈ {fmtNum(calc.total_uzs)} so'm + {fmtMoney(calc.total_usd)}
                    </span>
                  </div>
                )}

                <div className="text-[10px] text-text3 mt-2 text-center">
                  * Dollar summalar joriy kurs bo'yicha alohida to'lanadi yoki konvertatsiya qilinadi
                </div>
              </div>
            </div>

            {calc && calc.bonuses.length > 0 && (
              <div className="bg-bg2 border border-border rounded-lg shadow overflow-hidden">
                <div className="px-4 py-3 border-b border-border">
                  <span className="text-[13px] font-semibold">Berilgan bonuslar — {calc.period_label}</span>
                </div>
                <table className="w-full">
                  <thead>
                    <tr className="bg-bg3 text-text3 text-[11px] uppercase tracking-wider">
                      <th className="text-left px-4 py-2.5">Bonus</th>
                      <th className="text-left px-4 py-2.5">Izoh</th>
                      <th className="text-right px-4 py-2.5">Summa</th>
                    </tr>
                  </thead>
                  <tbody>
                    {calc.bonuses.map(b => (
                      <tr key={b.id} className="border-b border-border last:border-0">
                        <td className="px-4 py-2.5 text-[12.5px] font-medium">{b.rule_name || '—'}</td>
                        <td className="px-4 py-2.5 text-[12px] text-text2">{b.note ?? '—'}</td>
                        <td className="px-4 py-2.5 text-right mono text-green font-semibold">+{fmtMoney(b.amount_usd)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
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
    </>
  );
}

function BRow({
  label, hint, value, bar, color,
}: { label: string; hint?: string; value: string; bar: number; color: string }) {
  return (
    <div className="flex items-center justify-between py-2.5 border-b border-border last:border-b-0 gap-3">
      <div className="flex-1 min-w-0">
        <div className="text-[12.5px] text-text">{label}</div>
        {hint && <div className="text-[11px] text-text3 mt-0.5">{hint}</div>}
      </div>
      <div className="w-32">
        <div className="h-1 bg-bg4 rounded overflow-hidden">
          <div className="h-full rounded transition-all" style={{ width: `${bar}%`, background: color }} />
        </div>
      </div>
      <div className="mono text-[13px] font-semibold w-44 text-right">{value}</div>
    </div>
  );
}

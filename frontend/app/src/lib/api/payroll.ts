import { apiGet } from './client';

// ── Employees ─────────────────────────────────────────────────────
export type Employee = {
  id: number;
  name: string;
  email: string | null;
  work_position: string | null;
  bitrix_active: boolean;
  role: string;
  status: string;
  fix_base_uzs: number;
  attendance_weekly_uzs: number;
  report_weekly_uzs: number;
  schedule_start: string;
  schedule_end: string;
  kpi_rule_id: number | null;
  notes: string | null;
  has_extras: boolean;
};

export function listEmployees() {
  return apiGet<{ count: number; employees: Employee[] }>('/api/payroll/employees');
}

export type EmployeeExtraIn = Partial<Pick<Employee,
  'role' | 'status' | 'fix_base_uzs' | 'attendance_weekly_uzs' | 'report_weekly_uzs' |
  'schedule_start' | 'schedule_end' | 'kpi_rule_id' | 'notes'
>>;

export async function upsertEmployeeExtra(uid: number, body: EmployeeExtraIn): Promise<Employee> {
  const res = await fetch(`/api/payroll/employees/${uid}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

// ── KPI rules ─────────────────────────────────────────────────────
export type KpiTier = { from: number; to: number | null; percent: number };
export type KpiRule = {
  id: number;
  name: string;
  role: string;
  entity: string;
  period: string;
  currency: string;
  mode: string;
  tiers: KpiTier[];
  is_active: boolean;
  created_at: string;
};
export function listKpiRules() {
  return apiGet<{ count: number; rules: KpiRule[] }>('/api/payroll/kpi-rules');
}

// ── Bonus rules + awards ──────────────────────────────────────────
export type BonusRule = {
  id: number; name: string; trigger_text: string; period: string;
  target_role: string; rule_type: string; value_kind: string; value: number;
  is_active: boolean; created_at: string;
};
export type BonusAward = {
  id: number; bitrix_user_id: number; rule_id: number | null; rule_name: string;
  period_label: string; amount_usd: number; note: string | null; awarded_at: string;
};
export function listBonusRules() { return apiGet<{ count: number; rules: BonusRule[] }>('/api/payroll/bonus-rules'); }
export function listBonusAwards(period_label?: string) { return apiGet<{ count: number; awards: BonusAward[] }>('/api/payroll/bonus-awards', period_label ? { period_label } : undefined); }

// ── Monthly target ────────────────────────────────────────────────
export type MonthlyTarget = { year: number; month: number; target_usd: number; weekly_breakdown: number[] };
export function getMonthlyTarget(year: number, month: number) {
  return apiGet<MonthlyTarget>('/api/payroll/target', { year, month });
}

// ── Calculation ───────────────────────────────────────────────────
export type PayrollCalc = {
  bitrix_user_id: number;
  year: number; month: number; period_label: string;
  revenue_usd: number;
  deal_count: number;
  fix_base_uzs: number;
  kpi: { payout_usd: number; rule_id: number | null; rule_name: string | null; matched_tier: KpiTier | null; percent: number };
  bonuses: BonusAward[];
  bonuses_total_usd: number;
  penalties_usd: number;
  total_uzs: number;
  total_usd: number;
};
export function calculatePayroll(uid: number, year: number, month: number) {
  return apiGet<PayrollCalc>('/api/payroll/calculate', { bitrix_user_id: uid, year, month });
}

// ── Realtime attendance (existing /api/users/timeman endpoint) ────
export type TimemanStatus = 'OPENED' | 'PAUSED' | 'CLOSED' | null | { STATUS?: string };
export type TimemanUser = {
  id: number | string; name: string; email: string;
  active: boolean; work_position: string;
  timeman: TimemanStatus | null;
};
export function listTimeman() {
  return apiGet<{ count: number; users: TimemanUser[] }>('/api/users/timeman');
}

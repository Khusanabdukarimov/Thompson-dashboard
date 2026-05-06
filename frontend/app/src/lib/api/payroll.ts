import { apiGet, authedFetch } from "./client";

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
  login: string | null;
  dashboard_role: string;
};

export function listEmployees() {
  return apiGet<{ count: number; employees: Employee[] }>(
    "/api/payroll/employees",
  );
}

export type EmployeeExtraIn = Partial<
  Pick<
    Employee,
    | "role"
    | "status"
    | "fix_base_uzs"
    | "attendance_weekly_uzs"
    | "report_weekly_uzs"
    | "schedule_start"
    | "schedule_end"
    | "kpi_rule_id"
    | "notes"
    | "login"
    | "dashboard_role"
  >
> & { password?: string };

export async function upsertEmployeeExtra(
  uid: number,
  body: EmployeeExtraIn,
): Promise<Employee> {
  const res = await authedFetch(`/api/payroll/employees/${uid}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
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
  return apiGet<{ count: number; rules: KpiRule[] }>("/api/payroll/kpi-rules");
}

export type KpiRuleIn = {
  name: string;
  role: string;
  entity?: string;
  period?: string;
  currency?: string;
  mode?: string;
  tiers: KpiTier[];
  is_active?: boolean;
};
export async function createKpiRule(body: KpiRuleIn): Promise<KpiRule> {
  const res = await authedFetch("/api/payroll/kpi-rules", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}
export async function updateKpiRule(
  id: number,
  body: KpiRuleIn,
): Promise<KpiRule> {
  const res = await authedFetch(`/api/payroll/kpi-rules/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}
export async function deleteKpiRule(id: number): Promise<void> {
  const res = await authedFetch(`/api/payroll/kpi-rules/${id}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
}

export type BonusRuleIn = Omit<BonusRule, "id" | "created_at">;
export async function createBonusRule(body: BonusRuleIn): Promise<BonusRule> {
  const res = await authedFetch("/api/payroll/bonus-rules", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}
export async function updateBonusRule(
  id: number,
  body: BonusRuleIn,
): Promise<BonusRule> {
  const res = await authedFetch(`/api/payroll/bonus-rules/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}
export async function deleteBonusRule(id: number): Promise<void> {
  const res = await authedFetch(`/api/payroll/bonus-rules/${id}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
}

export type BonusAwardIn = Omit<BonusAward, "id" | "awarded_at">;
export async function createBonusAward(
  body: BonusAwardIn,
): Promise<BonusAward> {
  const res = await authedFetch("/api/payroll/bonus-awards", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}
export async function deleteBonusAward(id: number): Promise<void> {
  const res = await authedFetch(`/api/payroll/bonus-awards/${id}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
}

// ── Bonus rules + awards ──────────────────────────────────────────
export type BonusRule = {
  id: number;
  name: string;
  trigger_text: string;
  period: string;
  target_role: string;
  rule_type: string;
  value_kind: string;
  value: number;
  is_active: boolean;
  created_at: string;
};
export type BonusAward = {
  id: number;
  bitrix_user_id: number;
  rule_id: number | null;
  rule_name: string;
  period_label: string;
  amount_usd: number;
  note: string | null;
  awarded_at: string;
};
export function listBonusRules() {
  return apiGet<{ count: number; rules: BonusRule[] }>(
    "/api/payroll/bonus-rules",
  );
}
export function listBonusAwards(period_label?: string) {
  return apiGet<{ count: number; awards: BonusAward[] }>(
    "/api/payroll/bonus-awards",
    period_label ? { period_label } : undefined,
  );
}

// ── Monthly target ────────────────────────────────────────────────
export type MonthlyTarget = {
  year: number;
  month: number;
  target_usd: number;
  weekly_breakdown: number[];
};
export function getMonthlyTarget(year: number, month: number) {
  return apiGet<MonthlyTarget>("/api/payroll/target", { year, month });
}

// ── Calculation ───────────────────────────────────────────────────
export type PayrollCalc = {
  bitrix_user_id: number;
  year: number;
  month: number;
  period_label: string;
  revenue_usd: number;
  deal_count: number;
  fix_base_uzs: number;
  kpi: {
    payout_usd: number;
    rule_id: number | null;
    rule_name: string | null;
    matched_tier: KpiTier | null;
    percent: number;
  };
  bonuses: BonusAward[];
  bonuses_total_usd: number;
  penalties_uzs: number;
  penalty_breakdown: {
    kind: string;
    bucket: string;
    count: number;
    rate_uzs: number;
    subtotal_uzs: number;
  }[];
  total_uzs: number;
  total_usd: number;
};
export function calculatePayroll(uid: number, year: number, month: number) {
  return apiGet<PayrollCalc>("/api/payroll/calculate", {
    bitrix_user_id: uid,
    year,
    month,
  });
}

// ── Sales trend (last N months) ───────────────────────────────────
export type SalesTrendMonth = {
  year: number;
  month: number;
  won_revenue: number;
  won_count: number;
};
export function getSalesTrend(months_back = 6) {
  return apiGet<{ months: SalesTrendMonth[] }>("/api/payroll/sales-trend", {
    months_back,
  });
}

// ── Weekly sales actuals (per week of month) ──────────────────────
export type WeeklyActual = {
  week: number;
  start_day: number;
  end_day: number;
  won_revenue: number;
  won_count: number;
  any_revenue: number;
};
export function getWeeklyActuals(year: number, month: number) {
  return apiGet<{ year: number; month: number; weeks: WeeklyActual[] }>(
    "/api/payroll/weekly-actuals",
    { year, month },
  );
}

// ── Attendance + Report logs ──────────────────────────────────────
export type LogBucket =
  | "on-time"
  | "late-soft"
  | "late"
  | "penalty"
  | "absent"
  | "missed";
export type AttendanceLog = {
  id: number;
  bitrix_user_id: number;
  day: string;
  start_time: string | null;
  end_time: string | null;
  bucket: LogBucket;
  note: string | null;
};
export type ReportLog = {
  id: number;
  bitrix_user_id: number;
  day: string;
  submitted_at: string | null;
  bucket: LogBucket;
  note: string | null;
  created_at: string;
};

export function listAttendanceLogs(year: number, month: number) {
  return apiGet<{ count: number; logs: AttendanceLog[] }>(
    "/api/payroll/attendance-log",
    { year, month },
  );
}
export function listReportLogs(year: number, month: number) {
  return apiGet<{ count: number; logs: ReportLog[] }>(
    "/api/payroll/report-log",
    { year, month },
  );
}
export type LogEntryIn = {
  bitrix_user_id: number;
  day: string;
  bucket: LogBucket;
  start_time?: string | null;
  end_time?: string | null;
  submitted_at?: string | null;
  note?: string | null;
};
async function _put<T>(path: string, body: unknown): Promise<T> {
  const res = await authedFetch(path, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}
export const upsertAttendanceLog = (b: LogEntryIn) =>
  _put<AttendanceLog>("/api/payroll/attendance-log", b);
export const upsertReportLog = (b: LogEntryIn) =>
  _put<ReportLog>("/api/payroll/report-log", b);

export type AutoSyncResult = {
  mode: string;
  created: number;
  updated: number;
  skipped_users: number;
  note?: string;
};
export async function autoSyncLogs(
  year: number,
  month: number,
  mode: "report" | "attendance",
): Promise<AutoSyncResult> {
  const url = new URL("/api/payroll/auto-sync", window.location.origin);
  url.searchParams.set("year", String(year));
  url.searchParams.set("month", String(month));
  url.searchParams.set("mode", mode);
  const res = await authedFetch(url.pathname + url.search, { method: "POST" });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

// ── Discipline stats ──────────────────────────────────────────────
export type DisciplineBuckets = Record<LogBucket, number>;
export type DisciplineEmployee = {
  id: number;
  name: string;
  attendance: DisciplineBuckets;
  report: DisciplineBuckets;
};
export function getDisciplineStats(year: number, month: number) {
  return apiGet<{
    year: number;
    month: number;
    employees: DisciplineEmployee[];
  }>("/api/payroll/discipline-stats", { year, month });
}

// ── Penalty config ────────────────────────────────────────────────
export type PenaltyConfig = {
  id: number;
  attendance_late_soft_uzs: number;
  attendance_late_uzs: number;
  attendance_penalty_uzs: number;
  attendance_absent_uzs: number;
  report_late_soft_uzs: number;
  report_late_uzs: number;
  report_penalty_uzs: number;
  report_missed_uzs: number;
  updated_at: string;
};
export function getPenaltyConfig() {
  return apiGet<PenaltyConfig>("/api/payroll/penalty-config");
}
export const setPenaltyConfig = (b: Omit<PenaltyConfig, "id" | "updated_at">) =>
  _put<PenaltyConfig>("/api/payroll/penalty-config", b);

// ── Realtime attendance (existing /api/users/timeman endpoint) ────
export type TimemanStatus =
  | "OPENED"
  | "PAUSED"
  | "CLOSED"
  | null
  | { STATUS?: string };
export type TimemanUser = {
  id: number | string;
  name: string;
  email: string;
  active: boolean;
  work_position: string;
  timeman: TimemanStatus | null;
};
export function listTimeman() {
  return apiGet<{ count: number; users: TimemanUser[] }>("/api/users/timeman");
}

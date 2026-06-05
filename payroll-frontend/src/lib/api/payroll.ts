import { api } from './client';

// ── Auth ──────────────────────────────────────────────────────────
export async function login(username: string, password: string) {
  const { data } = await api.post('/api/auth/login', { username, password });
  return data as { access_token: string; token_type: string; role: string };
}

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

export async function listEmployees() {
  const { data } = await api.get<{ count: number; employees: Employee[] }>('/api/payroll/employees');
  return data;
}

export type EmployeeExtraIn = Partial<Omit<Employee, 'id' | 'name' | 'email' | 'work_position' | 'bitrix_active' | 'has_extras'>> & { password?: string };

export async function upsertEmployeeExtra(uid: number, body: EmployeeExtraIn) {
  const { data } = await api.put<Employee>(`/api/payroll/employees/${uid}`, body);
  return data;
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
export type KpiRuleIn = Omit<KpiRule, 'id' | 'created_at'>;

export async function listKpiRules() {
  const { data } = await api.get<{ count: number; rules: KpiRule[] }>('/api/payroll/kpi-rules');
  return data;
}
export async function createKpiRule(body: KpiRuleIn) {
  const { data } = await api.post<KpiRule>('/api/payroll/kpi-rules', body);
  return data;
}
export async function updateKpiRule(id: number, body: KpiRuleIn) {
  const { data } = await api.put<KpiRule>(`/api/payroll/kpi-rules/${id}`, body);
  return data;
}
export async function deleteKpiRule(id: number) {
  await api.delete(`/api/payroll/kpi-rules/${id}`);
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
export type BonusRuleIn = Omit<BonusRule, 'id' | 'created_at'>;
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
export type BonusAwardIn = Omit<BonusAward, 'id' | 'awarded_at'>;

export async function listBonusRules() {
  const { data } = await api.get<{ count: number; rules: BonusRule[] }>('/api/payroll/bonus-rules');
  return data;
}
export async function createBonusRule(body: BonusRuleIn) {
  const { data } = await api.post<BonusRule>('/api/payroll/bonus-rules', body);
  return data;
}
export async function updateBonusRule(id: number, body: BonusRuleIn) {
  const { data } = await api.put<BonusRule>(`/api/payroll/bonus-rules/${id}`, body);
  return data;
}
export async function deleteBonusRule(id: number) {
  await api.delete(`/api/payroll/bonus-rules/${id}`);
}
export async function listBonusAwards(period_label?: string) {
  const { data } = await api.get<{ count: number; awards: BonusAward[] }>('/api/payroll/bonus-awards', { params: period_label ? { period_label } : undefined });
  return data;
}
export async function createBonusAward(body: BonusAwardIn) {
  const { data } = await api.post<BonusAward>('/api/payroll/bonus-awards', body);
  return data;
}
export async function deleteBonusAward(id: number) {
  await api.delete(`/api/payroll/bonus-awards/${id}`);
}

// ── Monthly target ────────────────────────────────────────────────
export type MonthlyTarget = { year: number; month: number; target_usd: number; weekly_breakdown: number[] };
export async function getMonthlyTarget(year: number, month: number) {
  const { data } = await api.get<MonthlyTarget>('/api/payroll/target', { params: { year, month } });
  return data;
}

// ── Payroll calc ─────────────────────────────────────────────────
export type PayrollCalc = {
  bitrix_user_id: number;
  year: number;
  month: number;
  period_label: string;
  revenue_usd: number;
  deal_count: number;
  fix_base_uzs: number;
  kpi: { payout_usd: number; rule_id: number | null; rule_name: string | null; matched_tier: KpiTier | null; percent: number };
  bonuses: BonusAward[];
  bonuses_total_usd: number;
  penalties_uzs: number;
  penalty_breakdown: { kind: string; bucket: string; count: number; rate_uzs: number; subtotal_uzs: number }[];
  total_uzs: number;
  total_usd: number;
};
export async function calculatePayroll(uid: number, year: number, month: number) {
  const { data } = await api.get<PayrollCalc>('/api/payroll/calculate', { params: { bitrix_user_id: uid, year, month } });
  return data;
}

// ── Sales trend ───────────────────────────────────────────────────
export type SalesTrendMonth = { year: number; month: number; won_revenue: number; won_count: number };
export async function getSalesTrend(months_back = 6) {
  const { data } = await api.get<{ months: SalesTrendMonth[] }>('/api/payroll/sales-trend', { params: { months_back } });
  return data;
}

// ── Discipline stats ──────────────────────────────────────────────
export type LogBucket = 'on-time' | 'late-soft' | 'late' | 'penalty' | 'absent' | 'missed';
export type DisciplineBuckets = Record<LogBucket, number>;
export type DisciplineEmployee = { id: number; name: string; attendance: DisciplineBuckets; report: DisciplineBuckets };
export async function getDisciplineStats(year: number, month: number) {
  const { data } = await api.get<{ year: number; month: number; employees: DisciplineEmployee[] }>('/api/payroll/discipline-stats', { params: { year, month } });
  return data;
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
export async function getPenaltyConfig() {
  const { data } = await api.get<PenaltyConfig>('/api/payroll/penalty-config');
  return data;
}
export async function setPenaltyConfig(body: Omit<PenaltyConfig, 'id' | 'updated_at'>) {
  const { data } = await api.put<PenaltyConfig>('/api/payroll/penalty-config', body);
  return data;
}

// ── Tariflar ──────────────────────────────────────────────────────
export type Tarif = {
  id: number;
  service_type: string;
  name: string;
  loyiha_summasi: number;
  variant_klass: string;
  harf_oralighi: string;
  tekshiruvlar: number;
  deadline_mijoz: string;
  hudud: string;
  jami_summa: number;
  sort_order: number;
  is_active: boolean;
  created_at: string;
};
export type TarifIn = Omit<Tarif, 'id' | 'created_at'>;

export async function listTariflar(service_type?: string) {
  const { data } = await api.get<{ count: number; tariflar: Tarif[] }>('/api/payroll/tariflar', { params: service_type ? { service_type } : undefined });
  return data;
}
export async function createTarif(body: TarifIn) {
  const { data } = await api.post<Tarif>('/api/payroll/tariflar', body);
  return data;
}
export async function updateTarif(id: number, body: TarifIn) {
  const { data } = await api.put<Tarif>(`/api/payroll/tariflar/${id}`, body);
  return data;
}
export async function deleteTarif(id: number) {
  await api.delete(`/api/payroll/tariflar/${id}`);
}

// ── Timeman (live attendance) ─────────────────────────────────────
export type TimemanUser = {
  id: number | string;
  name: string;
  email: string;
  active: boolean;
  work_position: string;
  timeman: 'OPENED' | 'PAUSED' | 'CLOSED' | null;
};
export async function listTimeman() {
  const { data } = await api.get<{ count: number; users: TimemanUser[] }>('/api/users/timeman');
  return data;
}

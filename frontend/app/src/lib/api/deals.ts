import { apiGet, API_URL_CRM } from './client';

export type DealsFilter = {
  start_date?: string;
  end_date?: string;
  assigned_by?: number;
  stage_id?: string;
  source_id?: string;
};

export type StatsDealsByUser = {
  id: string;
  name: string;
  total: number;
  won_revenue: number;
  by_stage: Record<string, number>;
};

export type StatsDealsResponse = {
  total: number;
  won_count: number;
  lost_count: number;
  total_won_revenue: number;
  conversion_rate: number;
  by_stage: Record<string, number>;
  by_user: StatsDealsByUser[];
  all_stages: string[];
  stage_names: Record<string, string>;
  users: { id: string; name: string }[];
};

export type DealsBySource = {
  id: string;
  label: string;
  ishlaydi: number;
  provodka: number;
  success: number;
  revenue: number;
  total: number;
  conversion: number;
};

export type DealsBySourceResponse = {
  sources: DealsBySource[];
  source_names: Record<string, string>;
};

export function getDealsStats(filter: DealsFilter) {
  return apiGet<StatsDealsResponse>('/api/stats/deals', filter);
}

export function getDealsBySource(filter: DealsFilter) {
  return apiGet<DealsBySourceResponse>('/api/stats/deals/by-source', filter);
}

// ── New endpoints (bitrix-sync) ──────────────────────────────────

export type DealKpiStats = {
  total: number;
  won: number;
  lost: number;
  in_progress: number;
  jami_sotuv: number;
  ortacha_chek: number;
  konversiya: number;
};

export type DealRow = {
  id: number;
  responsible: string;
  mijoz: string;
  summa: number;
  manba: string;
  sana: string;
  stage_name: string;
  is_won: boolean;
  is_final: boolean;
};

export type DealsListResponse = {
  total: number;
  page: number;
  limit: number;
  items: DealRow[];
};

export type DealsListFilter = {
  from?: string;
  to?: string;
  search?: string;
  status?: 'won' | 'lost' | 'active' | '';
  page?: number;
  limit?: number;
};

export function getDealKpiStats(filter: { from?: string; to?: string }) {
  return apiGet<DealKpiStats>('/api/dashboard/deals-stats', filter, API_URL_CRM);
}

export function getDealsList(filter: DealsListFilter) {
  return apiGet<DealsListResponse>('/api/dashboard/deals-list', filter as Record<string, string | number | undefined>, API_URL_CRM);
}

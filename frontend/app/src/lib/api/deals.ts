import { apiGet } from './client';

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

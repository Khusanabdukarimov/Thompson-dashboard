import { api } from './client';

export const MONTHS_EN = ['january','february','march','april','may','june','july','august','september','october','november','december'];

export function monthEn(month: number) { return MONTHS_EN[month - 1]; }
export function currentYear() { return new Date().getFullYear(); }

export type KunlikData = {
  leads: number[]; qual_leads: number[]; meetings: number[];
  deals: number[]; deals_sum: number[]; sales_count: number[];
  sales_sum: number[]; cancelled: number[];
};
export type KunlikResponse = {
  month: string; year: number;
  data: { target: KunlikData; instagram?: KunlikData };
};
export type KunlikMetaResponse = {
  plans: Record<string, Record<string, number>>;
  overrides: Record<string, Record<string, Record<number, number>>>;
};
export type MetaInsightsData = {
  spend: number; leads: number; clicks: number; impressions: number;
  cpl: number; ctr: number;
  by_platform: { platform: string; spend: number; leads: number; clicks: number }[];
  by_day: { date: string; spend: number; leads: number; clicks: number }[];
};
export type CampaignRow = {
  ad_name: string; campaign_name: string; platform: string;
  spend: number; leads: number; clicks: number; impressions: number; cpl: number; ctr: number;
};
export type DealsStats = {
  total: number; won_count: number; lost_count: number;
  total_won_revenue: number; conversion_rate: number;
  by_stage: Record<string, number>;
  by_user: { id: string; name: string; total: number; won_revenue: number; by_stage: Record<string, number> }[];
  all_stages: string[]; stage_names: Record<string, string>;
  users: { id: string; name: string }[];
};
export type DealsBySource = {
  sources: { id: string; label: string; ishlaydi: number; provodka: number; success: number; revenue: number; total: number; conversion: number }[];
  source_names: Record<string, string>;
};
export type Lead = {
  id: number; title: string; name: string; last_name: string;
  opportunity: number; currency: string;
  is_won: boolean; is_failed: boolean;
  date_create: string; date_modify: string;
  stage_name: string; stage_bitrix_id: string;
  responsible_name: string; primary_phone: string | null;
};
export type LeadsResponse = { count: number; leads: Lead[]; offset: number; limit: number };
export type LeadSource = { source_id: string; label: string; total: number; qualified: number; cancelled: number; conversion: number };

export async function getKunlik(month: number, year: number, targetolog = 'all') {
  const { data } = await api.get<KunlikResponse>('/api/marketing/kunlik', { params: { month: monthEn(month), year, targetolog } });
  return data;
}
export async function getKunlikMeta(month: number, year: number) {
  const { data } = await api.get<KunlikMetaResponse>('/api/marketing/kunlik-meta', { params: { month: monthEn(month), year } });
  return data;
}
export async function setKunlikPlan(body: { section: string; metric_key: string; month: string; year: number; value: number }) {
  await api.put('/api/marketing/kunlik-plan', body);
}
export async function setKunlikOverride(body: { section: string; metric_key: string; month: string; year: number; day: number; value: number }) {
  await api.put('/api/marketing/kunlik-override', body);
}
export async function getMetaInsights(month: number, year: number) {
  const { data } = await api.get<{ month: string; year: number; data: MetaInsightsData }>('/api/meta/insights', { params: { month: monthEn(month), year } });
  return data;
}
export async function getMetaCampaigns(month: number, year: number) {
  const { data } = await api.get<{ month: string; year: number; rows: CampaignRow[] }>('/api/meta/campaigns', { params: { month: monthEn(month), year } });
  return data;
}
export async function getDealsStats(params: { start_date?: string; end_date?: string; assigned_by?: number; source_id?: string } = {}) {
  const { data } = await api.get<DealsStats>('/api/stats/deals', { params });
  return data;
}
export async function getDealsBySource(params: { start_date?: string; end_date?: string } = {}) {
  const { data } = await api.get<DealsBySource>('/api/stats/deals/by-source', { params });
  return data;
}
export async function getLeads(params: { range?: string; responsible_id?: number; stage_id?: string; search?: string; page?: number; limit?: number } = {}) {
  const { data } = await api.get<LeadsResponse>('/api/leads', { params });
  return data;
}
export async function getLeadSources(month: number, year: number) {
  const { data } = await api.get<{ sources: LeadSource[] }>('/api/marketing/lead-sources', { params: { month: monthEn(month), year } });
  return data;
}

import { apiGet } from './client';

export type LeadFilter = {
  start_date?: string;
  end_date?: string;
  assigned_by?: number;
  status_id?: string;
  source_id?: string;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_content?: string;
  utm_term?: string;
};

export type StatsLeadsByUser = {
  id: string;
  name: string;
  total: number;
  revenue: number;
  by_status: Record<string, number>;
};

export type StatsLeadsResponse = {
  total: number;
  total_revenue: number;
  converted: number;
  jarayon_total: number;
  conversion_rate: number;
  by_status: Record<string, number>;
  by_user: StatsLeadsByUser[];
  all_statuses: string[];
  status_names: Record<string, string>;
  users: { id: string; name: string }[];
  sources: { id: string; label: string }[];
  utm_sources: string[];
  utm_mediums: string[];
  utm_campaigns: string[];
  utm_contents: string[];
  utm_terms: string[];
};

export type LeadQualityResponse = {
  sifatsiz: { label: string; val: number }[];
  bekor: { label: string; val: number }[];
  sandiq: { label: string; val: number }[];
  utm: { label: string; val: number }[];
};

export function getLeadsStats(filter: LeadFilter) {
  return apiGet<StatsLeadsResponse>('/api/stats/leads', filter);
}

export function getLeadQuality(filter: LeadFilter) {
  return apiGet<LeadQualityResponse>('/api/stats/lead-quality', filter);
}

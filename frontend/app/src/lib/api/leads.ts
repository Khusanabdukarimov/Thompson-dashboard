import { apiGet, authedFetch } from './client';

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

// ── Lead list (raw + enriched) ───────────────────────────────────
export type LeadRow = {
  ID: string;
  TITLE: string | null;
  NAME: string | null;
  LAST_NAME: string | null;
  ASSIGNED_BY_ID: string | null;
  OPPORTUNITY: string | null;
  STATUS_ID: string | null;
  SOURCE_ID: string | null;
  DATE_CREATE: string | null;
  DATE_MODIFY: string | null;
  PHONE: string | null;
  EMAIL: string | null;
  COMMENTS: string | null;
  _status_name?: string;
  _source_name?: string;
  _assigned_name?: string;
};

export type LeadsListFilter = {
  start_date?: string;
  end_date?: string;
  assigned_by?: number;
  status_id?: string;
  source_id?: string;
  search?: string;
  limit?: number;
  offset?: number;
  enrich?: boolean;
};

export function listLeadsRich(filter: LeadsListFilter) {
  return apiGet<{ count: number; leads: LeadRow[]; offset: number; limit: number | null }>(
    '/api/leads',
    { ...filter, enrich: filter.enrich ? 'true' : undefined } as Record<string, string | number | undefined>,
  );
}

// ── Create lead ──────────────────────────────────────────────────
export type LeadCreateIn = {
  client: string;
  date?: string;
  employee_id?: number;
  source?: string;
  amount?: number;
  status?: string;
  deal_id?: string;
  notes?: string;
};

export async function createLead(body: LeadCreateIn): Promise<{ result: number }> {
  const res = await authedFetch('/api/leads', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

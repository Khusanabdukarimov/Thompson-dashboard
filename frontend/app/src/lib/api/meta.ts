import { apiGet, authedFetch, API_URL_CRM } from './client';

export type MetaInsightsRow = {
  budget: number[];
  leads: number[];
  clicks: number[];
  impressions: number[];
};

export type MetaInsightsResponse = {
  month: string;
  year: number;
  data: {
    target: MetaInsightsRow;
    instagram: MetaInsightsRow;
  };
};

export type BitrixDailyRow = {
  sales_sum: number[];
  sales_count: number[];
  qual_leads: number[];
  deals: number[];
};

export type BitrixDailyResponse = {
  month: string;
  year: number;
  data: {
    target: BitrixDailyRow;
    instagram: BitrixDailyRow;
  };
};

export type KunlikRow = {
  leads: number[];
  qual_leads: number[];
  meetings: number[];
  deals: number[];
  deals_sum: number[];
  sales_count: number[];
  sales_sum: number[];
  cancelled: number[];
};

export type KunlikResponse = {
  month: string;
  year: number;
  data: {
    target: KunlikRow;
    instagram: KunlikRow;
  };
};

export type DashboardDailyResponse = {
  date: string;
  facebook: { date?: string; spend?: number | string; leads_count?: number; error?: string };
  bitrix: {
    visits_count: number;
    leads_count: number;
    closed_deals: { sum: number; count: number };
  };
};

export const MONTH_KEYS = [
  'yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun',
  'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr',
] as const;
export type MonthKey = typeof MONTH_KEYS[number];

export const MONTH_LABELS: Record<MonthKey, string> = {
  yanvar: 'Yanvar', fevral: 'Fevral', mart: 'Mart', aprel: 'Aprel',
  may: 'May', iyun: 'Iyun', iyul: 'Iyul', avgust: 'Avgust',
  sentabr: 'Sentabr', oktabr: 'Oktabr', noyabr: 'Noyabr', dekabr: 'Dekabr',
};

export function getMetaInsights(month: MonthKey, year: number, ad_account_id?: string) {
  // Served by Node.js (port 3001) with PostgreSQL 1-hour cache.
  // ad_account_id is ignored here (account configured server-side via env).
  void ad_account_id;
  return apiGet<MetaInsightsResponse>('/api/campaigns/insights', { month, year });
}

export function getBitrixDaily(month: MonthKey, year: number) {
  return apiGet<BitrixDailyResponse>('/api/marketing/bitrix-daily', { month, year });
}

export function getKunlikHisobot(month: MonthKey, year: number) {
  return apiGet<KunlikResponse>('/api/marketing/kunlik', { month, year });
}

export type KunlikMeta = {
  month: string; year: number;
  plans:     { target: Partial<Record<string, number>>; instagram: Partial<Record<string, number>> };
  overrides: { target: Partial<Record<string, Record<number, number>>>; instagram: Partial<Record<string, Record<number, number>>> };
};

export function getKunlikMeta(month: MonthKey, year: number) {
  return apiGet<KunlikMeta>('/api/marketing/kunlik-meta', { month, year });
}

export function saveKunlikPlan(section: string, metric_key: string, month: MonthKey, year: number, value: number) {
  return authedFetch('/api/marketing/kunlik-plan', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ section, metric_key, month, year, value }),
  });
}

export function saveKunlikOverride(section: string, metric_key: string, month: MonthKey, year: number, day: number, value: number | null) {
  return authedFetch('/api/marketing/kunlik-override', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ section, metric_key, month, year, day, value }),
  });
}

export type CampaignAdRow = {
  campaign_name: string;
  adset_name: string;
  ad_name: string;
  objective: string;
  platform: 'facebook' | 'instagram';
  spend: number;
  impressions: number;
  reach: number;
  frequency: number;
  clicks: number;
  unique_clicks: number;
  link_clicks: number;
  leads: number;
  landing_page_views: number;
  cpm: number;
  cpc: number;
  cpl: number;
  ctr: number;
  hook_rate: number;
  visit_rate: number;
  lid_rate: number;
};

export type CampaignsResponse = {
  month: string;
  year: number;
  rows: CampaignAdRow[];
};

export function getMetaCampaigns(month: MonthKey, year: number) {
  // Served by Node.js (port 3001) with PostgreSQL 1-hour cache.
  return apiGet<CampaignsResponse>('/api/campaigns/rows', { month, year });
}

export function getDashboardDaily(date: string) {
  return apiGet<DashboardDailyResponse>('/api/dashboard/daily', { date_str: date }, API_URL_CRM);
}

export type LeadgenForm = {
  form_id: string;
  form_name: string;
  status: string;
  leads_count: number | null;
  created_time: string;
  adset_id: string;
  adset_name: string;
};

export type CampaignForms = {
  campaign_id: string;
  campaign_name: string;
  objective: string;
  forms: LeadgenForm[];
};

export type CampaignFormsResponse = {
  count: number;
  campaigns: CampaignForms[];
};

export function getCampaignForms(month?: string, year?: number) {
  const params: Record<string, string | number | undefined> = {};
  if (month) params.month = month;
  if (year)  params.year  = year;
  return apiGet<CampaignFormsResponse>('/api/campaigns/forms', params);
}

export interface FormLead {
  id: string;
  name: string;
  phone: string;
  email: string;
  created_at: string;
  utm_source: string;
  utm_medium: string;
  utm_campaign: string;
  utm_content: string;
  utm_term: string;
  field_data: Record<string, string>;
}

export type PageForm = {
  form_id:      string;
  form_name:    string;
  status:       string;
  leads_count:  number;
  created_time: string;
  page_name:    string;
};

export function getPageForms() {
  return apiGet<{ forms: PageForm[] }>('/api/meta/page-forms');
}

export function getFormLeads(formId: string, campaignId?: string, from?: string, to?: string) {
  return apiGet<{ count: number; leads: FormLead[] }>('/api/campaigns/leads', {
    form_id: formId,
    ...(campaignId ? { campaign_id: campaignId } : {}),
    ...(from ? { from } : {}),
    ...(to   ? { to }   : {}),
  });
}

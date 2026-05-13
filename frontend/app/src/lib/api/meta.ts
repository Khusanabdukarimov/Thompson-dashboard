import { apiGet, API_URL_CRM } from './client';

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
  return apiGet<MetaInsightsResponse>('/api/meta/insights', { month, year, ad_account_id });
}

export function getBitrixDaily(month: MonthKey, year: number) {
  return apiGet<BitrixDailyResponse>('/api/marketing/bitrix-daily', { month, year });
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
  return apiGet<CampaignsResponse>('/api/meta/campaigns', { month, year });
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

export function getCampaignForms(ad_account_id?: string) {
  return apiGet<CampaignFormsResponse>('/api/meta/campaign-forms', ad_account_id ? { ad_account_id } : {});
}

import { apiGet } from './client';

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

export function getDashboardDaily(date: string) {
  return apiGet<DashboardDailyResponse>('/api/dashboard/daily', { date_str: date });
}

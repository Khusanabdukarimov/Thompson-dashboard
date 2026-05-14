import { apiGet, authedFetch, API_URL_CRM } from "./client";

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

export type DashboardStatsResponse = {
  header: {
    total_leads: number;
    in_process: number;
    failed: number;
    converted: number;
    conversion_pct: number;
    total_opportunity: number;
    avg_opportunity: number;
    frozen_leads: number;
    avg_age_days: number;
    sifatli_lid_count: number;
    konsultatsiya_belgilandi_count: number;
    konsultatsiya_otkazildi_count: number;
    muvaffaqiyatsiz_count: number;
    sifatsiz_bekor_count: number;
  };
  funnel: {
    bitrix_id: string;
    name_uz: string;
    sort_order: number;
    lead_count: number;
    total_opportunity: number;
  }[];
};

export type ResponsiblesStatsResponse = {
  responsibles: {
    responsible_id: number;
    full_name: string;
    total: number;
    qongiroqlar: number;
    yangi_lid: number;
    propushenniy: number;
    javob_bermadi: number;
    qayta_aloqa: number;
    oylab_koradi: number;
    konsultatsiya: number;
    otkazilmadi: number;
    konsultatsiya_otkazildi: number;
    sandiq: number;
    sifatsiz: number;
    bekor_boldi: number;
    total_opportunity: number;
  }[];
};

export type DashFilter = {
  start_date?: string;
  end_date?: string;
  responsible_id?: number;
  stage?: string;
  source?: string;
};

export type FilterOptions = {
  responsibles: { id: number; full_name: string }[];
  stages: { bitrix_id: string; name: string }[];
  sources: { id: string; name: string }[];
};

export function getDashboardStats(filter: DashFilter) {
  return apiGet<DashboardStatsResponse>("/api/stats", {
    start_date: filter.start_date,
    end_date: filter.end_date,
    responsible_id: filter.responsible_id,
    stage: filter.stage,
    source: filter.source,
  }, API_URL_CRM);
}

export function getResponsiblesStats(filter: DashFilter) {
  return apiGet<ResponsiblesStatsResponse>("/api/responsibles", {
    start_date: filter.start_date,
    end_date: filter.end_date,
    responsible_id: filter.responsible_id,
    stage: filter.stage,
    source: filter.source,
  }, API_URL_CRM);
}

export type ConversionStatsResponse = {
  conversion: {
    responsible_id: number;
    full_name: string;
    total: number;
    jarayonda: number;
    sifatsiz_lid: number;
    tashrif_buyurdi: number;
  }[];
};

export function getConversionStats(filter: DashFilter) {
  return apiGet<ConversionStatsResponse>("/api/conversion", {
    start_date: filter.start_date,
    end_date: filter.end_date,
    responsible_id: filter.responsible_id,
    stage: filter.stage,
    source: filter.source,
  }, API_URL_CRM);
}

export function getFilterOptions() {
  return apiGet<FilterOptions>("/api/filter-options", {}, API_URL_CRM);
}

export type TasksSummaryResponse = {
  tasks: {
    responsible_id: number;
    full_name: string;
    total: number;
    in_progress: number;
    completed: number;
    overdue: number;
  }[];
};

export function getTasksSummary(filter: Pick<DashFilter, "start_date" | "end_date">) {
  return apiGet<TasksSummaryResponse>("/api/dashboard/tasks-summary", {
    from: filter.start_date,
    to: filter.end_date,
  }, API_URL_CRM);
}

export type ReasonsResponse = {
  items: { reason: string; total: number }[];
};

export function getCancelReasons(filter: Pick<DashFilter, "start_date" | "end_date" | "responsible_id">) {
  return apiGet<ReasonsResponse>("/api/dashboard/cancel-reasons", {
    from: filter.start_date,
    to: filter.end_date,
    responsible_id: filter.responsible_id,
  }, API_URL_CRM);
}

export function getJunkReasons(filter: Pick<DashFilter, "start_date" | "end_date" | "responsible_id">) {
  return apiGet<ReasonsResponse>("/api/dashboard/junk-reasons", {
    from: filter.start_date,
    to: filter.end_date,
    responsible_id: filter.responsible_id,
  }, API_URL_CRM);
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
  return apiGet<{
    count: number;
    leads: LeadRow[];
    offset: number;
    limit: number | null;
  }>("/api/leads", {
    ...filter,
    enrich: filter.enrich ? "true" : undefined,
  } as Record<string, string | number | undefined>, API_URL_CRM);
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

export async function createLead(
  body: LeadCreateIn,
): Promise<{ result: number }> {
  const res = await authedFetch("/api/leads", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }, API_URL_CRM);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

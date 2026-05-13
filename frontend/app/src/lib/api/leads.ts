import { apiGet, authedFetch } from "./client";

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
    yangi_lid: number;
    javob_bermadi: number;
    qayta_aloqa: number;
    oylab_koradi: number;
    konsultatsiya: number;
    otkazilmadi: number;
    sandiq: number;
    sifatsiz: number;
    bekor_boldi: number;
    total_opportunity: number;
  }[];
};

export function getDashboardStats(filter: Pick<LeadFilter, "start_date" | "end_date">) {
  // Map our start_date/end_date to the 'range' parameter the backend expects.
  // The backend expects 'range' as a number of days or 'all'.
  let range = "all";
  if (filter.start_date) {
    const start = new Date(filter.start_date);
    const now = new Date();
    const diffTime = Math.abs(now.getTime() - start.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    range = String(diffDays);
  }
  return apiGet<DashboardStatsResponse>("/api/stats", { range });
}

export function getResponsiblesStats(filter: Pick<LeadFilter, "start_date" | "end_date">) {
  let range = "all";
  if (filter.start_date) {
    const start = new Date(filter.start_date);
    const now = new Date();
    const diffTime = Math.abs(now.getTime() - start.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    range = String(diffDays);
  }
  return apiGet<ResponsiblesStatsResponse>("/api/responsibles", { range });
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
  } as Record<string, string | number | undefined>);
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
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

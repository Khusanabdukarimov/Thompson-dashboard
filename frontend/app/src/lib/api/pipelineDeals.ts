import { apiGet, API_URL_CRM } from './client';

/** Bitrix deal pipelines (воронки) on the Sdelkalar page. */
export type PipelineKey = 'uc' | 'yangi';

/** Bucket key the backend uses for deals with no source / no reason. */
export const NONE_KEY = '__none__';

/** Bucket key for sources Bitrix no longer lists (deleted codes), shown as "O'chirilgan manba". */
export const DELETED_SOURCE_KEY = '__deleted__';

export type StageKind = 'process' | 'won' | 'lost';

export type PipelineStage = {
  id: string;        // Bitrix STATUS_ID, e.g. "NEW", "C25:WON"
  name: string;
  sort: number;
  kind: StageKind;
  color: string | null;
};

/** Filters shared by every pipeline endpoint. Lists are comma-separated. */
export type PipelineFilter = {
  pipeline: PipelineKey;
  /** Viloyat (region ids: toshkent, navoiy, …); "!" prefix = Istisno, like every list filter. */
  region?: string;
  from?: string;
  to?: string;
  mode?: string;
  responsible_id?: string;
  source?: string;
  stage?: string;
  /** Источник 1 / Причина / Филиал enum option ids, comma-separated ("Manba 1" / "Sabab" / "Filial" filters). */
  source1?: string;
  prichina?: string;
  filial?: string;
};

type Rollup = { total: number; in_process: number; won: number; lost: number };
type ByStage = Record<string, number>;

export type PipelineKpi = Rollup & { by_stage: ByStage; stages: PipelineStage[] };

export type PipelineManagerRow = Rollup & {
  responsible_id: number | null;
  full_name: string;
  work_position: string | null;
  by_stage: ByStage;
};

export type PipelineSourceRow = Rollup & {
  source_id: string;
  source_name: string;
  by_stage: ByStage;
};

export type ReasonScope = 'lost' | 'all';

export type PipelineReasons =
  | { available: false; items: [] }
  | {
      available: true;
      field: string;
      field_label: string;
      scope: ReasonScope;
      /** Stages the "lost" scope covers (Учебный центр: every lost stage; YANGI: Bekor bo'ldi). */
      scope_stages?: { id: string; name: string }[];
      items: { reason_id: string; reason: string; total: number }[];
    };

export type PipelineDeal = {
  id: number;
  title: string | null;
  phone: string | null;
  responsible_id: number | null;
  responsible: string | null;
  stage: string;
  stage_name: string;
  stage_kind: StageKind;
  source_id: string;
  source_name: string;
  reason: string | null;
  report_stage: string | null;
  opportunity: number;
  currency_id: string | null;
  date_create: string | null;
  date_modify: string | null;
};

/** Drill-down filters: the shared ones plus what a table cell narrows to. */
export type PipelineDealsFilter = PipelineFilter & {
  kind?: StageKind;
  reason?: string;
  reason_scope?: ReasonScope;
};

const q = (f: object) => f as Record<string, string | number | undefined>;

export function getPipelineKpi(f: PipelineFilter) {
  return apiGet<PipelineKpi>('/api/dashboard/pipeline/kpi', q(f), API_URL_CRM);
}

export function getPipelineManagers(f: PipelineFilter) {
  return apiGet<{ stages: PipelineStage[]; managers: PipelineManagerRow[] }>('/api/dashboard/pipeline/managers', q(f), API_URL_CRM);
}

export function getPipelineSources(f: PipelineFilter) {
  return apiGet<{ stages: PipelineStage[]; sources: PipelineSourceRow[] }>('/api/dashboard/pipeline/sources', q(f), API_URL_CRM);
}

export function getPipelineReasons(f: PipelineFilter & { scope: ReasonScope }) {
  return apiGet<PipelineReasons>('/api/dashboard/pipeline/reasons', q(f), API_URL_CRM);
}

export type PipelineFilterOptions = {
  source1s: { id: string; name: string }[];
  reasons: { id: string; name: string }[];
  filials: { id: string; name: string }[];
  regions?: { id: string; name: string }[];
};

/** Options for the "Manba 1", "Sabab" and "Filial" pickers (the whole Bitrix enum, alphabetical). */
export function getPipelineFilterOptions(f: Pick<PipelineFilter, 'pipeline'>) {
  return apiGet<PipelineFilterOptions>('/api/dashboard/pipeline/filter-options', q(f), API_URL_CRM);
}

/** Deals per responsible id in the pipeline + date window: counts in the Bo'lim / Mas'ul picker. */
export function getPipelineResponsibleCounts(f: Pick<PipelineFilter, 'pipeline' | 'from' | 'to'>) {
  return apiGet<{ counts: Record<string, number> }>('/api/dashboard/pipeline/responsible-counts', q(f), API_URL_CRM);
}

export function getPipelineDeals(f: PipelineDealsFilter & { limit?: number; offset?: number }) {
  return apiGet<{ total: number; limit: number; offset: number; items: PipelineDeal[] }>(
    '/api/dashboard/pipeline/deals', q(f), API_URL_CRM);
}

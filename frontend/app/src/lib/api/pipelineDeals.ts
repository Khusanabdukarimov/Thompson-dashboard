import { apiGet, API_URL_CRM } from './client';

/** Bitrix deal pipelines (воронки) on the Sdelkalar page. */
export type PipelineKey = 'uc' | 'yangi';

/** Bucket key the backend uses for deals with no source / no reason. */
export const NONE_KEY = '__none__';

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
  from?: string;
  to?: string;
  mode?: string;
  responsible_id?: string;
  source?: string;
  stage?: string;
  /** JSON array of Стадия (для отчетов) values — free text, so not comma-separated. */
  report_stage?: string;
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

export type ReportStageOptions =
  | { available: false; items: [] }
  | { available: true; field_label: string; items: { value: string; label: string; total: number }[] };

/** Стадия (для отчетов) values in the pipeline/date/mode window — options for its filter. */
export function getPipelineReportStages(f: Pick<PipelineFilter, 'pipeline' | 'from' | 'to' | 'mode'>) {
  return apiGet<ReportStageOptions>('/api/dashboard/pipeline/report-stages', q(f), API_URL_CRM);
}

export function getPipelineDeals(f: PipelineDealsFilter & { limit?: number; offset?: number }) {
  return apiGet<{ total: number; limit: number; offset: number; items: PipelineDeal[] }>(
    '/api/dashboard/pipeline/deals', q(f), API_URL_CRM);
}

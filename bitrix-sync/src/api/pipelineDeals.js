/**
 * Pipeline-scoped deal analytics for the Sdelkalar page.
 * Mounted at /api/dashboard/pipeline.
 *
 * Every endpoint takes ?pipeline=uc|yangi plus the shared filters
 *   from, to (YYYY-MM-DD, Tashkent date of d.date_create), mode,
 *   responsible_id, source, stage (comma-separated lists),
 *   report_stage (JSON array of Стадия (для отчетов) values — free text, so not CSV)
 * and counts deals by their CURRENT stage, so a table row always adds up to the
 * Bitrix kanban for the same created-date window.
 *
 * Aggregates come back keyed by stage id together with the pipeline's stage
 * list, so the frontend never hard-codes stage ids except the few KPI cards
 * that name a specific stage.
 */
const { Router } = require('express');
const pool = require('../db/pool');
const { getPipeline, getStages, getEnumLabels, categoryCond } = require('../services/pipelines');

const router = Router();

// Deals without a source / reason are grouped under this key so they can be
// drilled into like any other bucket.
const NONE = '__none__';
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));

/**
 * ?report_stage=["Визит назначен","__none__"] → string[], or null when malformed.
 * Values are bound as a parameter, so length is not capped: any option /report-stages
 * offers must be accepted back verbatim.
 */
function parseJsonList(v) {
  try {
    const a = JSON.parse(String(v));
    return Array.isArray(a) && a.length > 0 && a.length <= 1000 && a.every((x) => typeof x === 'string') ? a : null;
  } catch { return null; }
}

/** Resolves ?pipeline= or answers 400. */
function pipelineOr400(req, res) {
  const pipe = getPipeline(req.query.pipeline);
  if (!pipe) res.status(400).json({ error: "pipeline must be 'uc' or 'yangi'" });
  return pipe;
}

/**
 * WHERE clause + params for deals `d` joined to stages `s`, limited to one
 * pipeline and the request's filters. `extra` adds endpoint-specific
 * conditions through the same placeholder counter.
 */
function buildScope(q, pipe, extra = () => []) {
  const params = [];
  const p = (v) => { params.push(v); return `$${params.length}`; };
  const dateCol = q.mode === 'amocrm' ? 'COALESCE(d.uf_amo_date, d.date_create)' : 'd.date_create';
  const where = [`s.entity = 'deal'`, categoryCond(pipe.categoryId)];
  if (isDate(q.from)) where.push(`(${dateCol} AT TIME ZONE 'Asia/Tashkent')::date >= ${p(q.from)}::date`);
  if (isDate(q.to))   where.push(`(${dateCol} AT TIME ZONE 'Asia/Tashkent')::date <= ${p(q.to)}::date`);
  if (q.mode === 'amocrm')   where.push(`d.source_id = 'UC_1WUFJB'`);
  if (q.mode === 'bitrix24') where.push(`(d.source_id IS NULL OR d.source_id <> 'UC_1WUFJB')`);
  if (q.responsible_id) where.push(`d.responsible_id::text = ANY(string_to_array(${p(String(q.responsible_id))}, ','))`);
  if (q.source)         where.push(`COALESCE(NULLIF(d.source_id, ''), '${NONE}') = ANY(string_to_array(${p(String(q.source))}, ','))`);
  if (q.stage)          where.push(`s.bitrix_id = ANY(string_to_array(${p(String(q.stage))}, ','))`);
  if (pipe.reportStage && q.report_stage) {
    const reportStages = parseJsonList(q.report_stage);
    // A filter that cannot be read matches nothing rather than silently matching everything.
    where.push(reportStages
      ? `COALESCE(NULLIF(d.uf_report_stage, ''), '${NONE}') = ANY(${p(reportStages)}::text[])`
      : 'FALSE');
  }
  where.push(...extra(p));
  return { where: where.join('\n         AND '), params };
}

/**
 * Stage list for the response: the pipeline's live stages, plus any stage a
 * counted deal sits in that Bitrix no longer lists (deleted stage), so every
 * deal is visible somewhere and the totals add up.
 */
function withOrphans(stages, seenIds) {
  const known = new Set(stages.map(s => s.id));
  const orphans = [...seenIds].filter(id => !known.has(id))
    .map((id, i) => ({ id, name: id, sort: 10_000 + i, color: null, kind: 'process' }));
  return orphans.length ? [...stages, ...orphans] : stages;
}

/** total / in_process / won / lost from a { stageId: count } map. */
function rollup(byStage, stages) {
  const kindOf = Object.fromEntries(stages.map(s => [s.id, s.kind]));
  const out = { total: 0, in_process: 0, won: 0, lost: 0 };
  for (const [id, n] of Object.entries(byStage)) {
    out.total += n;
    const k = kindOf[id] || 'process';
    if (k === 'won') out.won += n;
    else if (k === 'lost') out.lost += n;
    else out.in_process += n;
  }
  return out;
}

const fail = (res, tag) => (err) => {
  console.error(`[pipeline/${tag}]`, err.message);
  res.status(500).json({ error: err.message });
};

/** GET /meta — pipeline label and its stages (id, name, sort, kind, color). */
router.get('/meta', async (req, res) => {
  const pipe = pipelineOr400(req, res); if (!pipe) return;
  try {
    const stages = await getStages(pipe.categoryId);
    res.json({ key: pipe.key, label: pipe.label, category_id: pipe.categoryId, has_reason: !!pipe.reasonField, stages });
  } catch (err) { fail(res, 'meta')(err); }
});

/** GET /kpi — deal counts for the KPI cards: per stage and rolled up. */
router.get('/kpi', async (req, res) => {
  const pipe = pipelineOr400(req, res); if (!pipe) return;
  try {
    const { where, params } = buildScope(req.query, pipe);
    const [liveStages, { rows }] = await Promise.all([
      getStages(pipe.categoryId),
      pool.query(
        `SELECT s.bitrix_id AS stage, COUNT(*)::int AS n
         FROM deals d
         JOIN stages s ON s.id = d.stage_id
         WHERE ${where}
         GROUP BY s.bitrix_id`,
        params
      ),
    ]);
    const byStage = Object.fromEntries(rows.map(r => [r.stage, r.n]));
    const stages = withOrphans(liveStages, Object.keys(byStage));
    res.json({ ...rollup(byStage, stages), by_stage: byStage, stages });
  } catch (err) { fail(res, 'kpi')(err); }
});

/**
 * GET /managers — one row per responsible with counts in every stage.
 * Feeds both the stage matrix and "Sdelka va Konversiya".
 */
router.get('/managers', async (req, res) => {
  const pipe = pipelineOr400(req, res); if (!pipe) return;
  try {
    const { where, params } = buildScope(req.query, pipe);
    const [liveStages, { rows }] = await Promise.all([
      getStages(pipe.categoryId),
      pool.query(
        `SELECT d.responsible_id,
                TRIM(COALESCE(r.name, '') || ' ' || COALESCE(r.last_name, '')) AS full_name,
                r.work_position,
                s.bitrix_id AS stage,
                COUNT(*)::int AS n
         FROM deals d
         JOIN stages s ON s.id = d.stage_id
         LEFT JOIN responsibles r ON r.id = d.responsible_id
         WHERE ${where}
         GROUP BY d.responsible_id, r.name, r.last_name, r.work_position, s.bitrix_id`,
        params
      ),
    ]);
    const stages = withOrphans(liveStages, new Set(rows.map(r => r.stage)));
    const byResp = new Map();
    for (const r of rows) {
      const key = r.responsible_id ?? 0;
      if (!byResp.has(key)) {
        byResp.set(key, {
          responsible_id: r.responsible_id,
          full_name: r.full_name || "Mas'ulsiz",
          work_position: r.work_position || null,
          by_stage: {},
        });
      }
      byResp.get(key).by_stage[r.stage] = r.n;
    }
    const managers = [...byResp.values()]
      .map(m => ({ ...m, ...rollup(m.by_stage, stages) }))
      .sort((a, b) => b.total - a.total);
    res.json({ stages, managers });
  } catch (err) { fail(res, 'managers')(err); }
});

/** GET /sources — one row per Источник (SOURCE_ID) with its Bitrix name. */
router.get('/sources', async (req, res) => {
  const pipe = pipelineOr400(req, res); if (!pipe) return;
  try {
    const { where, params } = buildScope(req.query, pipe);
    const [liveStages, { rows }] = await Promise.all([
      getStages(pipe.categoryId),
      pool.query(
        `SELECT COALESCE(NULLIF(d.source_id, ''), '${NONE}') AS source_id,
                MAX(ls.name) AS source_name,
                s.bitrix_id AS stage,
                COUNT(*)::int AS n
         FROM deals d
         JOIN stages s ON s.id = d.stage_id
         LEFT JOIN lead_sources ls ON ls.source_id = d.source_id
         WHERE ${where}
         GROUP BY 1, s.bitrix_id`,
        params
      ),
    ]);
    const stages = withOrphans(liveStages, new Set(rows.map(r => r.stage)));
    const bySrc = new Map();
    for (const r of rows) {
      if (!bySrc.has(r.source_id)) {
        bySrc.set(r.source_id, {
          source_id: r.source_id,
          // lead_sources mirrors crm.status SOURCE; an id missing there is shown raw
          // so it can still be traced back to Bitrix.
          source_name: r.source_id === NONE ? 'Manbasiz' : (r.source_name || r.source_id),
          by_stage: {},
        });
      }
      bySrc.get(r.source_id).by_stage[r.stage] = r.n;
    }
    const sources = [...bySrc.values()]
      .map(s => ({ ...s, ...rollup(s.by_stage, stages) }))
      .sort((a, b) => b.total - a.total);
    res.json({ stages, sources });
  } catch (err) { fail(res, 'sources')(err); }
});

/**
 * GET /reasons?scope=lost|all — deals grouped by the pipeline's reason field.
 * Причина is filled on most deals at intake, not only on lost ones, so the
 * default scope is the failure stages ("Bekor bo'lish sabablari"); scope=all
 * shows the field across every stage.
 * Pipelines without a reason field answer { available: false }.
 */
router.get('/reasons', async (req, res) => {
  const pipe = pipelineOr400(req, res); if (!pipe) return;
  if (!pipe.reasonField) return res.json({ available: false, items: [] });
  const scope = req.query.scope === 'all' ? 'all' : 'lost';
  try {
    const [stages, labels] = await Promise.all([getStages(pipe.categoryId), getEnumLabels(pipe.reasonField)]);
    const lostIds = stages.filter(s => s.kind === 'lost').map(s => s.id);
    const { where, params } = buildScope(req.query, pipe, (p) =>
      scope === 'lost' ? [`s.bitrix_id = ANY(${p(lostIds)}::text[])`] : []);
    const { rows } = await pool.query(
      `SELECT COALESCE(NULLIF(d.uf_prichina, ''), '${NONE}') AS reason_id, COUNT(*)::int AS total
       FROM deals d
       JOIN stages s ON s.id = d.stage_id
       WHERE ${where}
       GROUP BY 1
       ORDER BY total DESC`,
      params
    );
    res.json({
      available: true,
      field: pipe.reasonField,
      field_label: 'Причина',
      scope,
      items: rows.map(r => ({
        reason_id: r.reason_id,
        reason: r.reason_id === NONE ? "Ko'rsatilmagan" : (labels[r.reason_id] || `#${r.reason_id}`),
        total: r.total,
      })),
    });
  } catch (err) { fail(res, 'reasons')(err); }
});

/**
 * GET /report-stages — options for the Стадия (для отчетов) filter: every value
 * in the pipeline/date/mode window with its deal count. The other filters are
 * deliberately not applied, so picking a value never hides the others.
 */
router.get('/report-stages', async (req, res) => {
  const pipe = pipelineOr400(req, res); if (!pipe) return;
  if (!pipe.reportStage) return res.json({ available: false, items: [] });
  try {
    const { from, to, mode } = req.query;
    const { where, params } = buildScope({ from, to, mode }, pipe);
    const { rows } = await pool.query(
      `SELECT COALESCE(NULLIF(d.uf_report_stage, ''), '${NONE}') AS value, COUNT(*)::int AS total
       FROM deals d
       JOIN stages s ON s.id = d.stage_id
       WHERE ${where}
       GROUP BY 1
       ORDER BY total DESC`,
      params
    );
    res.json({
      available: true,
      field_label: 'Стадия (для отчетов)',
      items: rows.map((r) => ({ value: r.value, label: r.value === NONE ? "Ko'rsatilmagan" : r.value, total: r.total })),
    });
  } catch (err) { fail(res, 'report-stages')(err); }
});

/**
 * GET /deals — the drill-down list behind every table cell.
 * Extra filters: kind=process|won|lost, reason (enum ids or __none__),
 * reason_scope=lost|all (mirrors /reasons), limit (<=500), offset.
 */
router.get('/deals', async (req, res) => {
  const pipe = pipelineOr400(req, res); if (!pipe) return;
  const limit = Math.min(500, Math.max(1, parseInt(req.query.limit, 10) || 100));
  const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
  try {
    const [liveStages, labels] = await Promise.all([
      getStages(pipe.categoryId),
      pipe.reasonField ? getEnumLabels(pipe.reasonField) : {},
    ]);
    const { kind, reason, reason_scope } = req.query;
    const { where, params } = buildScope(req.query, pipe, (p) => {
      const extra = [];
      if (['process', 'won', 'lost'].includes(kind)) {
        const idsOf = (k) => liveStages.filter(s => s.kind === k).map(s => s.id);
        // "process" is everything not won/lost — the same rule rollup() applies, so
        // deals in stages Bitrix no longer lists drill down where they were counted.
        extra.push(kind === 'process'
          ? `NOT (s.bitrix_id = ANY(${p([...idsOf('won'), ...idsOf('lost')])}::text[]))`
          : `s.bitrix_id = ANY(${p(idsOf(kind))}::text[])`);
      }
      if (reason && pipe.reasonField) {
        extra.push(`COALESCE(NULLIF(d.uf_prichina, ''), '${NONE}') = ANY(string_to_array(${p(String(reason))}, ','))`);
        if (reason_scope !== 'all') {
          extra.push(`s.bitrix_id = ANY(${p(liveStages.filter(s => s.kind === 'lost').map(s => s.id))}::text[])`);
        }
      }
      return extra;
    });
    const n = params.length;
    const [{ rows }, { rows: [{ total }] }] = await Promise.all([
      pool.query(
        `SELECT d.id, d.title, d.date_create, d.date_modify, d.opportunity, d.currency_id,
                s.bitrix_id AS stage,
                COALESCE(NULLIF(d.source_id, ''), '${NONE}') AS source_id, ls.name AS source_name,
                d.responsible_id,
                TRIM(COALESCE(r.name, '') || ' ' || COALESCE(r.last_name, '')) AS responsible,
                d.uf_prichina,
                d.uf_report_stage,
                ph.phone
         FROM deals d
         JOIN stages s ON s.id = d.stage_id
         LEFT JOIN responsibles r ON r.id = d.responsible_id
         LEFT JOIN lead_sources ls ON ls.source_id = d.source_id
         LEFT JOIN LATERAL (SELECT phone FROM deal_phones WHERE deal_id = d.id LIMIT 1) ph ON true
         WHERE ${where}
         ORDER BY d.date_create DESC, d.id DESC
         LIMIT $${n + 1} OFFSET $${n + 2}`,
        [...params, limit, offset]
      ),
      pool.query(
        `SELECT COUNT(*)::int AS total
         FROM deals d
         JOIN stages s ON s.id = d.stage_id
         WHERE ${where}`,
        params
      ),
    ]);
    const stageById = Object.fromEntries(liveStages.map(s => [s.id, s]));
    res.json({
      total, limit, offset,
      items: rows.map(r => ({
        id: r.id,
        title: r.title,
        phone: r.phone || null,
        responsible_id: r.responsible_id,
        responsible: r.responsible || null,
        stage: r.stage,
        stage_name: stageById[r.stage]?.name || r.stage,
        stage_kind: stageById[r.stage]?.kind || 'process',
        source_id: r.source_id,
        source_name: r.source_id === NONE ? 'Manbasiz' : (r.source_name || r.source_id),
        reason: pipe.reasonField && r.uf_prichina ? (labels[r.uf_prichina] || `#${r.uf_prichina}`) : null,
        report_stage: pipe.reportStage ? (r.uf_report_stage || null) : null,
        opportunity: Number(r.opportunity) || 0,
        currency_id: r.currency_id,
        date_create: r.date_create,
        date_modify: r.date_modify,
      })),
    });
  } catch (err) { fail(res, 'deals')(err); }
});

module.exports = router;

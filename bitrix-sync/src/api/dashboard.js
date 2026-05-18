const { Router } = require('express');
const pool = require('../db/pool');

const router = Router();

// ── Mode-aware SQL helpers ─────────────────────────────────────────

function leadModeClause(mode) {
  return mode === 'amocrm'
    ? `AND l.source_id ILIKE '%amocrm%'`
    : `AND (l.source_id IS NULL OR l.source_id NOT ILIKE '%amocrm%')`;
}

function leadDateCond(mode, p1, p2) {
  const f = mode === 'amocrm'
    ? `(l.raw_data->>'Дата создания (amoCRM)')::date`
    : `l.date_create::date`;
  return `($${p1}::date IS NULL OR ${f} >= $${p1}::date)\n           AND ($${p2}::date IS NULL OR ${f} <= $${p2}::date)`;
}

// Manba always uses UF_CRM_1778260858916 (applies to both modes)
function leadSrcCond(pi) {
  return `($${pi}::text IS NULL OR l.raw_data->>'UF_CRM_1778260858916' = $${pi}::text)`;
}

const SOURCE_NAMES = {
  'UC_O9BLGT': 'Facebook',
  'UC_3O8GTF': 'Instagram',
  'UC_H1PMDS': 'Telegram forma',
  'REPEAT_SALE': 'Website forma',
  'CALL': "Qo'ng'iroq",
  'Звонок': "Qo'ng'iroq",
  'ADVERTISING': 'Reklama',
  'UC_8BLFVY': "Ko'chadan",
  'UC_3F6D2K': 'Vakansiya',
  'UC_1WUFJB': 'amoCRM',
};

/**
 * GET /api/dashboard/stats
 * Simple counts + last sync state.
 */
router.get('/stats', async (req, res) => {
  const { mode } = req.query;
  const leadsWhere = mode === 'amocrm'
    ? `WHERE source_id ILIKE '%amocrm%'`
    : `WHERE (source_id IS NULL OR source_id NOT ILIKE '%amocrm%')`;
  try {
    const [leadsRes, dealsRes, syncRes] = await Promise.all([
      pool.query(`SELECT COUNT(*) AS total FROM leads ${leadsWhere}`),
      pool.query('SELECT COUNT(*) AS total FROM deals'),
      pool.query('SELECT entity, last_sync, total_rows FROM sync_state ORDER BY entity'),
    ]);
    res.json({
      leads: parseInt(leadsRes.rows[0].total),
      deals: parseInt(dealsRes.rows[0].total),
      sync: syncRes.rows,
    });
  } catch (err) {
    console.error('[dashboard/stats]', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/dashboard/responsibles
 * Lead counts per responsible, broken down by stage.
 * Params: from, to, responsible_id, stage, source
 */
router.get('/responsibles', async (req, res) => {
  const { from, to, responsible_id, stage, source, mode } = req.query;
  const params = [
    from || null,
    to || null,
    responsible_id ? parseInt(responsible_id) : null,
    stage || null,
    source || null,
  ];

  try {
    const { rows } = await pool.query(
      `WITH fl AS (
         SELECT l.id, l.responsible_id, l.opportunity, s.bitrix_id AS stage_bid
         FROM leads l
         JOIN stages s ON s.id = l.stage_id
         WHERE ${leadDateCond(mode, 1, 2)}
           AND ($3::int  IS NULL OR l.responsible_id = $3::int)
           AND ($4::text IS NULL OR s.bitrix_id = $4::text)
           AND ${leadSrcCond(5)}
           ${leadModeClause(mode)}
       )
       SELECT
         r.id,
         TRIM(COALESCE(r.name,'') || ' ' || COALESCE(r.last_name,'')) AS full_name,
         COUNT(fl.id)                                                              AS total,
         COALESCE(SUM(fl.opportunity), 0)                                         AS revenue,
         COUNT(fl.id) FILTER (WHERE fl.stage_bid = 'NEW')                         AS yangi_lid,
         COUNT(fl.id) FILTER (WHERE fl.stage_bid IN ('UC_1KPATX','NO_ANSWER'))    AS javob_bermadi,
         COUNT(fl.id) FILTER (WHERE fl.stage_bid IN ('UC_Q2U9EL','CALLBACK'))     AS qayta_aloqa,
         COUNT(fl.id) FILTER (WHERE fl.stage_bid IN ('UC_KXC3ZW','THINKING'))     AS oylab_koradi,
         COUNT(fl.id) FILTER (WHERE fl.stage_bid IN ('UC_L28G68','CONSULTATION')) AS konsultatsiya,
         COUNT(fl.id) FILTER (WHERE fl.stage_bid IN ('UC_5G8244','NOT_TRANSFERRED')) AS otkazilmadi,
         COUNT(fl.id) FILTER (WHERE fl.stage_bid IN ('JUNK','ARCHIVE'))           AS sandiq,
         COUNT(fl.id) FILTER (WHERE fl.stage_bid = 'UC_F8K4GI')                  AS sifatsiz,
         COUNT(fl.id) FILTER (WHERE fl.stage_bid IN ('UC_NAZK5J','RECYCLED'))     AS bekor_boldi
       FROM responsibles r
       LEFT JOIN fl ON fl.responsible_id = r.id
       WHERE r.active = TRUE
       GROUP BY r.id, r.name, r.last_name
       ORDER BY total DESC`,
      params
    );
    res.json(rows);
  } catch (err) {
    console.error('[dashboard/responsibles]', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/dashboard/funnel
 * Lead count per stage.
 * Params: from, to, responsible_id, source
 */
router.get('/funnel', async (req, res) => {
  const { from, to, responsible_id, source, mode } = req.query;
  const params = [
    from || null,
    to || null,
    responsible_id ? parseInt(responsible_id) : null,
    source || null,
  ];

  try {
    const { rows } = await pool.query(
      `SELECT
         s.id,
         s.name,
         s.bitrix_id,
         s.sort_order,
         s.is_final,
         s.is_won,
         COUNT(l.id) AS total
       FROM stages s
       LEFT JOIN leads l ON l.stage_id = s.id
         AND ${leadDateCond(mode, 1, 2)}
         AND ($3::int  IS NULL OR l.responsible_id = $3::int)
         AND ${leadSrcCond(4)}
         ${leadModeClause(mode)}
       WHERE s.entity = 'lead'
       GROUP BY s.id, s.name, s.bitrix_id, s.sort_order, s.is_final, s.is_won
       ORDER BY s.sort_order`,
      params
    );
    res.json(rows);
  } catch (err) {
    console.error('[dashboard/funnel]', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/dashboard/leads
 * Paginated lead list.
 * Params: page, limit, responsible_id, stage_id, date_from, date_to, source_id, utm_source, utm_campaign
 */
router.get('/leads', async (req, res) => {
  const {
    page = 1, limit = 50, mode,
    responsible_id, stage_id, date_from, date_to,
    source_id, utm_source, utm_campaign,
  } = req.query;

  const isAmo = mode === 'amocrm';
  const conditions = [isAmo
    ? `l.source_id ILIKE '%amocrm%'`
    : `(l.source_id IS NULL OR l.source_id NOT ILIKE '%amocrm%')`];
  const params = [];

  if (responsible_id) { params.push(parseInt(responsible_id)); conditions.push(`l.responsible_id = $${params.length}`); }
  if (stage_id)       { params.push(parseInt(stage_id));       conditions.push(`l.stage_id = $${params.length}`); }
  if (date_from) {
    params.push(date_from);
    const f = isAmo ? `(l.raw_data->>'Дата создания (amoCRM)')::date` : `l.date_create`;
    conditions.push(`${f} >= $${params.length}`);
  }
  if (date_to) {
    params.push(date_to);
    const f = isAmo ? `(l.raw_data->>'Дата создания (amoCRM)')::date` : `l.date_create`;
    conditions.push(`${f} <= $${params.length}`);
  }
  if (source_id) {
    params.push(source_id);
    conditions.push(`l.raw_data->>'UF_CRM_1778260858916' = $${params.length}`);
  }
  if (utm_source)     { params.push(utm_source);               conditions.push(`l.utm_source = $${params.length}`); }
  if (utm_campaign)   { params.push(utm_campaign);             conditions.push(`l.utm_campaign = $${params.length}`); }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const offset = (parseInt(page) - 1) * parseInt(limit);
  params.push(parseInt(limit));  const limitIdx = params.length;
  params.push(offset);           const offsetIdx = params.length;

  try {
    const [dataRes, countRes] = await Promise.all([
      pool.query(
        `SELECT l.id,
           TRIM(COALESCE(r.name,'') || ' ' || COALESCE(r.last_name,'')) AS responsible,
           s.name AS stage, l.opportunity, l.source_id, l.utm_source, l.utm_campaign,
           l.uf_segment, l.uf_filial, l.date_create, l.date_modify
         FROM leads l
         LEFT JOIN responsibles r ON r.id = l.responsible_id
         LEFT JOIN stages s ON s.id = l.stage_id
         ${where}
         ORDER BY l.date_create DESC
         LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
        params
      ),
      pool.query(
        `SELECT COUNT(*) AS total FROM leads l ${where}`,
        params.slice(0, params.length - 2)
      ),
    ]);
    res.json({
      total: parseInt(countRes.rows[0].total),
      page: parseInt(page),
      limit: parseInt(limit),
      data: dataRes.rows,
    });
  } catch (err) {
    console.error('[dashboard/leads]', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/dashboard/responsibles-list
 * All active responsibles for filter dropdown.
 */
router.get('/responsibles-list', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, TRIM(COALESCE(name,'') || ' ' || COALESCE(last_name,'')) AS full_name
       FROM responsibles WHERE active = TRUE ORDER BY name`
    );
    res.json(rows);
  } catch (err) {
    console.error('[dashboard/responsibles-list]', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/dashboard/stages-list
 * All lead stages for filter dropdown.
 */
router.get('/stages-list', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT bitrix_id, name FROM stages
       WHERE entity = 'lead' AND sort_order > 0
       ORDER BY sort_order`
    );
    res.json(rows);
  } catch (err) {
    console.error('[dashboard/stages-list]', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/dashboard/sources-list
 * Distinct source_id values for filter dropdown.
 */
router.get('/sources-list', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT DISTINCT raw_data->>'UF_CRM_1778260858916' AS source
       FROM leads
       WHERE raw_data->>'UF_CRM_1778260858916' IS NOT NULL
         AND raw_data->>'UF_CRM_1778260858916' != ''
       ORDER BY source`
    );
    res.json(rows.map(r => r.source));
  } catch (err) {
    console.error('[dashboard/sources-list]', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/dashboard/tasks-summary
 * Tasks grouped by executor (responsible).
 * Params: from, to
 */
router.get('/tasks-summary', async (req, res) => {
  const { from, to, mode } = req.query;
  const params = [from || null, to || null];

  const leadFilter = mode === 'amocrm'
    ? `AND t.lead_id IS NOT NULL AND t.lead_id IN (SELECT id FROM leads WHERE source_id ILIKE '%amocrm%')`
    : `AND (t.lead_id IS NULL OR t.lead_id NOT IN (SELECT id FROM leads WHERE source_id ILIKE '%amocrm%'))`;

  try {
    const { rows } = await pool.query(
      `SELECT
         r.id AS responsible_id,
         TRIM(COALESCE(r.name,'') || ' ' || COALESCE(r.last_name,'')) AS full_name,
         COUNT(t.id)                                                                              AS total,
         COUNT(t.id) FILTER (WHERE t.status IN ('pending','in_progress','review'))               AS in_progress,
         COUNT(t.id) FILTER (WHERE t.status = 'completed')                                       AS completed,
         COUNT(t.id) FILTER (WHERE t.deadline < NOW() AND t.status != 'completed')               AS overdue
       FROM responsibles r
       LEFT JOIN tasks t ON t.executor_id = r.id
         AND ($1::date IS NULL OR t.date_created >= $1::date)
         AND ($2::date IS NULL OR t.date_created <= $2::date)
         ${leadFilter}
       WHERE r.active = TRUE
       GROUP BY r.id, r.name, r.last_name
       HAVING COUNT(t.id) > 0
       ORDER BY total DESC`,
      params
    );
    res.json({ tasks: rows });
  } catch (err) {
    console.error('[dashboard/tasks-summary]', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/dashboard/cancel-reasons
 * Cancellation reason breakdown for UC_NAZK5J (Bekor bo'ldi) stage.
 * Params: from, to, responsible_id
 */
router.get('/cancel-reasons', async (req, res) => {
  const { from, to, responsible_id, mode } = req.query;
  const params = [
    from || null,
    to || null,
    responsible_id ? parseInt(responsible_id) : null,
  ];
  try {
    const { rows } = await pool.query(
      `SELECT
         COALESCE(l.uf_cancel_reason, 'Noma''lum') AS reason,
         COUNT(*)::int AS total
       FROM leads l
       JOIN stages s ON s.id = l.stage_id AND s.bitrix_id = 'UC_NAZK5J'
       WHERE ${leadDateCond(mode, 1, 2)}
         AND ($3::int  IS NULL OR l.responsible_id = $3::int)
         ${leadModeClause(mode)}
       GROUP BY l.uf_cancel_reason
       ORDER BY total DESC`,
      params
    );
    res.json({ items: rows });
  } catch (err) {
    console.error('[dashboard/cancel-reasons]', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/dashboard/junk-reasons
 * Disqualification reason breakdown for UC_F8K4GI (Sifatsiz) stage.
 * Params: from, to, responsible_id
 */
router.get('/junk-reasons', async (req, res) => {
  const { from, to, responsible_id, mode } = req.query;
  const params = [
    from || null,
    to || null,
    responsible_id ? parseInt(responsible_id) : null,
  ];
  try {
    const { rows } = await pool.query(
      `SELECT
         COALESCE(l.uf_junk_reason, 'Noma''lum') AS reason,
         COUNT(*)::int AS total
       FROM leads l
       JOIN stages s ON s.id = l.stage_id AND s.bitrix_id = 'UC_F8K4GI'
       WHERE ${leadDateCond(mode, 1, 2)}
         AND ($3::int  IS NULL OR l.responsible_id = $3::int)
         ${leadModeClause(mode)}
       GROUP BY l.uf_junk_reason
       ORDER BY total DESC`,
      params
    );
    res.json({ items: rows });
  } catch (err) {
    console.error('[dashboard/junk-reasons]', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/dashboard/deal-cancel-reasons
 * Cancellation reason breakdown for lost/cancelled deals.
 * Params: from, to, responsible_id
 */
router.get('/deal-cancel-reasons', async (req, res) => {
  const { from, to, responsible_id } = req.query;
  const params = [
    from || null,
    to || null,
    responsible_id ? parseInt(responsible_id) : null,
  ];
  try {
    const { rows } = await pool.query(
      `SELECT
         COALESCE(d.uf_cancel_reason, 'Noma''lum') AS reason,
         COUNT(*)::int AS total
       FROM deals d
       JOIN stages s ON s.id = d.stage_id AND s.is_final = true AND s.is_won = false
       WHERE ($1::date IS NULL OR d.date_create::date >= $1::date)
         AND ($2::date IS NULL OR d.date_create::date <= $2::date)
         AND ($3::int  IS NULL OR d.responsible_id = $3::int)
         AND (d.source_id IS NULL OR d.source_id NOT ILIKE '%amocrm%')
       GROUP BY d.uf_cancel_reason
       ORDER BY total DESC`,
      params
    );
    res.json({ items: rows });
  } catch (err) {
    console.error('[dashboard/deal-cancel-reasons]', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/dashboard/deal-filter-options
 * Responsibles, deal stages, and sources for Sdelkalar filter panel.
 */
router.get('/deal-filter-options', async (_req, res) => {
  try {
    const [respRes, stageRes, srcRes] = await Promise.all([
      pool.query(`SELECT id, TRIM(COALESCE(name,'') || ' ' || COALESCE(last_name,'')) AS full_name
                  FROM responsibles WHERE active = true ORDER BY name`),
      pool.query(`SELECT DISTINCT s.id, s.name FROM stages s
                  INNER JOIN deals d ON d.stage_id = s.id
                  ORDER BY s.name`),
      pool.query(`SELECT DISTINCT source_id FROM deals
                  WHERE source_id IS NOT NULL AND source_id != ''
                    AND source_id NOT ILIKE '%amocrm%'
                  ORDER BY source_id LIMIT 30`),
    ]);
    res.json({
      responsibles: respRes.rows,
      stages: stageRes.rows,
      sources: srcRes.rows.map(r => ({
        id: r.source_id,
        name: SOURCE_NAMES[r.source_id] || r.source_id,
      })),
    });
  } catch (err) {
    console.error('[dashboard/deal-filter-options]', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/dashboard/deals-stats?from=&to=&responsible_id=&stage_id=&source=
 * KPI summary cards for Sdelkalar page (amoCRM excluded).
 */
router.get('/deals-stats', async (req, res) => {
  const { from, to, responsible_id, stage_id, source } = req.query;

  const extra = [];
  const params = [from || null, to || null];
  let pi = 3;
  if (responsible_id) { extra.push(`AND d.responsible_id = $${pi++}`); params.push(parseInt(responsible_id)); }
  if (stage_id)       { extra.push(`AND d.stage_id = $${pi++}`);       params.push(parseInt(stage_id)); }
  if (source === '__none__') { extra.push(`AND (d.source_id IS NULL OR d.source_id = '')`); }
  else if (source)   { extra.push(`AND d.source_id = $${pi++}`);       params.push(source); }

  try {
    const { rows } = await pool.query(
      `SELECT
         COUNT(d.id)::int AS total,
         COUNT(d.id) FILTER (WHERE s.is_final = false AND s.is_won = false)::int AS yangi,
         COUNT(d.id) FILTER (WHERE s.is_won = true)::int                         AS sotuv_boldi,
         COUNT(d.id) FILTER (WHERE s.is_final = true AND s.is_won = false)::int  AS bekor,
         COALESCE(SUM(d.opportunity) FILTER (WHERE s.is_won = true), 0)::numeric AS jami_sotuv,
         COALESCE(ROUND(AVG(d.opportunity) FILTER (WHERE s.is_won = true), 0), 0)::numeric AS ortacha_chek,
         ROUND(COUNT(d.id) FILTER (WHERE s.is_won = true)::numeric / NULLIF(COUNT(d.id), 0) * 100, 1) AS konversiya
       FROM deals d
       JOIN stages s ON s.id = d.stage_id
       WHERE ($1::date IS NULL OR d.date_create::date >= $1::date)
         AND ($2::date IS NULL OR d.date_create::date <= $2::date)
         ${extra.join(' ')}`,
      params
    );
    res.json(rows[0]);
  } catch (err) {
    console.error('[dashboard/deals-stats]', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/dashboard/deals-list?from=&to=&page=1&limit=20&search=&status=&responsible_id=&stage_id=&source=
 * Paginated individual deals for Sdelkalar page (amoCRM excluded).
 */
router.get('/deals-list', async (req, res) => {
  const { from, to, search, status, responsible_id, stage_id, source } = req.query;
  const page  = Math.max(1, parseInt(req.query.page)  || 1);
  const limit = Math.min(100, parseInt(req.query.limit) || 20);
  const offset = (page - 1) * limit;

  const buildWhere = (extra = []) => {
    const parts = [
      `($1::date IS NULL OR d.date_create::date >= $1::date)`,
      `($2::date IS NULL OR d.date_create::date <= $2::date)`,
    ];
    const statusPart =
      status === 'won'    ? 'AND s.is_won = true' :
      status === 'lost'   ? 'AND s.is_final = true AND s.is_won = false' :
      status === 'active' ? 'AND s.is_final = false' : '';
    if (statusPart) parts.push(statusPart.slice(4));
    return parts.concat(extra).map((p, i) => (i === 0 ? `WHERE ${p}` : `  AND ${p}`)).join('\n');
  };

  const baseParams = [from || null, to || null];
  let pi = 3;
  const extra = [];
  if (responsible_id) { extra.push(`d.responsible_id = $${pi++}`); baseParams.push(parseInt(responsible_id)); }
  if (stage_id)       { extra.push(`d.stage_id = $${pi++}`);       baseParams.push(parseInt(stage_id)); }
  if (source === '__none__') { extra.push(`(d.source_id IS NULL OR d.source_id = '')`); }
  else if (source)   { extra.push(`d.source_id = $${pi++}`);       baseParams.push(source); }
  if (search)         { extra.push(`(TRIM(COALESCE(r.name,'') || ' ' || COALESCE(r.last_name,'')) ILIKE '%' || $${pi} || '%' OR d.source_id ILIKE '%' || $${pi} || '%' OR ph.phone ILIKE '%' || $${pi} || '%')`); baseParams.push(search); pi++; }

  try {
    const listParams = [...baseParams, limit, offset];
    const { rows } = await pool.query(
      `SELECT
         d.id,
         TRIM(COALESCE(r.name,'') || ' ' || COALESCE(r.last_name,'')) AS responsible,
         COALESCE(ph.phone, '—')    AS mijoz,
         d.opportunity::numeric     AS summa,
         COALESCE(d.source_id, '—') AS manba,
         d.date_create              AS sana,
         s.name                     AS stage_name,
         s.is_won,
         s.is_final
       FROM deals d
       JOIN stages s ON s.id = d.stage_id
       LEFT JOIN responsibles r ON r.id = d.responsible_id
       LEFT JOIN LATERAL (SELECT phone FROM deal_phones WHERE deal_id = d.id LIMIT 1) ph ON true
       ${buildWhere(extra)}
       ORDER BY d.date_create DESC
       LIMIT $${pi} OFFSET $${pi + 1}`,
      listParams
    );

    const { rows: countRows } = await pool.query(
      `SELECT COUNT(*)::int AS total
       FROM deals d
       JOIN stages s ON s.id = d.stage_id
       LEFT JOIN responsibles r ON r.id = d.responsible_id
       LEFT JOIN LATERAL (SELECT phone FROM deal_phones WHERE deal_id = d.id LIMIT 1) ph ON true
       ${buildWhere(extra)}`,
      baseParams
    );

    const items = rows.map(r => ({
      ...r,
      manba: SOURCE_NAMES[r.manba] || r.manba || '—',
    }));
    res.json({ total: countRows[0].total, page, limit, items });
  } catch (err) {
    console.error('[dashboard/deals-list]', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/dashboard/deals-conversion?from=&to=
 * Per-responsible deal counts + jami_sotuv + konversiya donut.
 */
router.get('/deals-conversion', async (req, res) => {
  const { from, to } = req.query;
  try {
    const { rows } = await pool.query(
      `WITH fd AS (
         SELECT d.id, d.responsible_id, d.opportunity, s.is_won, s.is_final
         FROM deals d
         JOIN stages s ON s.id = d.stage_id
         WHERE ($1::date IS NULL OR d.date_create::date >= $1::date)
           AND ($2::date IS NULL OR d.date_create::date <= $2::date)
       )
       SELECT
         r.id AS responsible_id,
         TRIM(COALESCE(r.name,'') || ' ' || COALESCE(r.last_name,'')) AS full_name,
         COUNT(fd.id)::int AS total,
         COUNT(fd.id) FILTER (WHERE NOT fd.is_won AND NOT fd.is_final)::int AS jarayonda,
         COUNT(fd.id) FILTER (WHERE fd.is_won)::int AS sotuv_boldi,
         COUNT(fd.id) FILTER (WHERE fd.is_final AND NOT fd.is_won)::int AS bekor_boldi,
         COALESCE(SUM(fd.opportunity) FILTER (WHERE fd.is_won), 0)::numeric AS jami_sotuv
       FROM responsibles r
       JOIN fd ON fd.responsible_id = r.id
       GROUP BY r.id, r.name, r.last_name
       HAVING COUNT(fd.id) > 0
       ORDER BY total DESC`,
      [from || null, to || null]
    );
    res.json(rows);
  } catch (err) {
    console.error('[dashboard/deals-conversion]', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/dashboard/deals-responsibles?from=&to=
 * Per-responsible deal counts broken down by actual deal stages.
 */
router.get('/deals-responsibles', async (req, res) => {
  const { from, to } = req.query;
  try {
    const { rows } = await pool.query(
      `WITH fd AS (
         SELECT d.id, d.responsible_id, s.bitrix_id AS stage_bid
         FROM deals d
         JOIN stages s ON s.id = d.stage_id
         WHERE ($1::date IS NULL OR d.date_create::date >= $1::date)
           AND ($2::date IS NULL OR d.date_create::date <= $2::date)
       )
       SELECT
         r.id AS responsible_id,
         TRIM(COALESCE(r.name,'') || ' ' || COALESCE(r.last_name,'')) AS full_name,
         COUNT(fd.id)::int AS total,
         COUNT(fd.id) FILTER (WHERE fd.stage_bid = 'C1:PRESENTATION')::int AS taqdimot,
         COUNT(fd.id) FILTER (WHERE fd.stage_bid = 'C1:CONSULTATION_DONE')::int AS konsultatsiya,
         COUNT(fd.id) FILTER (WHERE fd.stage_bid = 'C1:AGREEMENT')::int AS kelishuv,
         COUNT(fd.id) FILTER (WHERE fd.stage_bid = 'C1:WON')::int AS sotuv_boldi,
         COUNT(fd.id) FILTER (WHERE fd.stage_bid = 'C1:LOSE')::int AS bekor_boldi
       FROM responsibles r
       JOIN fd ON fd.responsible_id = r.id
       GROUP BY r.id, r.name, r.last_name
       HAVING COUNT(fd.id) > 0
       ORDER BY total DESC`,
      [from || null, to || null]
    );
    res.json(rows);
  } catch (err) {
    console.error('[dashboard/deals-responsibles]', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/dashboard/amocrm-sources
 * Distinct amoCRM sub-source values from raw_data for the Manba filter dropdown.
 */
router.get('/amocrm-sources', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT DISTINCT raw_data->>'UF_CRM_1778260858916' AS source
       FROM leads
       WHERE source_id ILIKE '%amocrm%'
         AND raw_data->>'UF_CRM_1778260858916' IS NOT NULL
         AND raw_data->>'UF_CRM_1778260858916' != ''
       ORDER BY source`
    );
    res.json(rows.map(r => r.source));
  } catch (err) {
    console.error('[dashboard/amocrm-sources]', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

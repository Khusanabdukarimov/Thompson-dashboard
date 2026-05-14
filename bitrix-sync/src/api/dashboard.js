const { Router } = require('express');
const pool = require('../db/pool');

const router = Router();

/**
 * GET /api/dashboard/stats
 * Simple counts + last sync state.
 */
router.get('/stats', async (req, res) => {
  try {
    const [leadsRes, dealsRes, syncRes] = await Promise.all([
      pool.query('SELECT COUNT(*) AS total FROM leads'),
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
  const { from, to, responsible_id, stage, source } = req.query;
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
         WHERE ($1::date IS NULL OR l.date_create >= $1::date)
           AND ($2::date IS NULL OR l.date_create <= $2::date)
           AND ($3::int  IS NULL OR l.responsible_id = $3::int)
           AND ($4::text IS NULL OR s.bitrix_id = $4::text)
           AND ($5::text IS NULL OR l.source_id = $5::text)
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
  const { from, to, responsible_id, source } = req.query;
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
         AND ($1::date IS NULL OR l.date_create >= $1::date)
         AND ($2::date IS NULL OR l.date_create <= $2::date)
         AND ($3::int  IS NULL OR l.responsible_id = $3::int)
         AND ($4::text IS NULL OR l.source_id = $4::text)
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
    page = 1, limit = 50,
    responsible_id, stage_id, date_from, date_to,
    source_id, utm_source, utm_campaign,
  } = req.query;

  const conditions = [];
  const params = [];

  if (responsible_id) { params.push(parseInt(responsible_id)); conditions.push(`l.responsible_id = $${params.length}`); }
  if (stage_id)       { params.push(parseInt(stage_id));       conditions.push(`l.stage_id = $${params.length}`); }
  if (date_from)      { params.push(date_from);                conditions.push(`l.date_create >= $${params.length}`); }
  if (date_to)        { params.push(date_to);                  conditions.push(`l.date_create <= $${params.length}`); }
  if (source_id)      { params.push(source_id);                conditions.push(`l.source_id = $${params.length}`); }
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
      `SELECT DISTINCT source_id FROM leads
       WHERE source_id IS NOT NULL AND source_id != ''
       ORDER BY source_id LIMIT 60`
    );
    res.json(rows.map(r => r.source_id));
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
  const { from, to } = req.query;
  const params = [from || null, to || null];

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

module.exports = router;

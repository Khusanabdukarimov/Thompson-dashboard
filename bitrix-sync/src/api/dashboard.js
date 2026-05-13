const { Router } = require('express');
const pool = require('../db/pool');

const router = Router();

/**
 * GET /api/dashboard/stats
 * Total leads, deals, conversion rate, and last sync time.
 */
router.get('/stats', async (req, res) => {
  try {
    const [leadsRes, dealsRes, syncRes] = await Promise.all([
      pool.query('SELECT COUNT(*) AS total FROM leads'),
      pool.query('SELECT COUNT(*) AS total FROM deals'),
      pool.query("SELECT entity, last_sync, total_rows FROM sync_state ORDER BY entity"),
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
 * Lead/deal counts per responsible user.
 * Query params: entity=lead|deal, date_from, date_to
 */
router.get('/responsibles', async (req, res) => {
  const { entity = 'lead', date_from, date_to } = req.query;
  const table = entity === 'deal' ? 'deals' : 'leads';
  const dateCol = entity === 'deal' ? 'date_create' : 'date_create';

  const conditions = ['r.id IS NOT NULL'];
  const params = [];

  if (date_from) {
    params.push(date_from);
    conditions.push(`e.${dateCol} >= $${params.length}`);
  }
  if (date_to) {
    params.push(date_to);
    conditions.push(`e.${dateCol} <= $${params.length}`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  try {
    const { rows } = await pool.query(
      `SELECT
         r.id,
         TRIM(COALESCE(r.name, '') || ' ' || COALESCE(r.last_name, '')) AS full_name,
         COUNT(e.id) AS total,
         SUM(e.opportunity) AS revenue
       FROM responsibles r
       LEFT JOIN ${table} e ON e.responsible_id = r.id
       ${where}
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
 * Lead count per stage (for funnel chart).
 * Query params: date_from, date_to
 */
router.get('/funnel', async (req, res) => {
  const { date_from, date_to } = req.query;
  const conditions = ["s.entity = 'lead'"];
  const params = [];

  if (date_from) {
    params.push(date_from);
    conditions.push(`l.date_create >= $${params.length}`);
  }
  if (date_to) {
    params.push(date_to);
    conditions.push(`l.date_create <= $${params.length}`);
  }

  const where = `WHERE ${conditions.join(' AND ')}`;

  try {
    const { rows } = await pool.query(
      `SELECT
         s.id,
         s.name,
         s.sort_order,
         s.is_final,
         s.is_won,
         COUNT(l.id) AS total
       FROM stages s
       LEFT JOIN leads l ON l.stage_id = s.id
       ${where}
       GROUP BY s.id, s.name, s.sort_order, s.is_final, s.is_won
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
 * Paginated lead list with filters.
 * Query params: page, limit, responsible_id, stage_id, date_from, date_to,
 *               source_id, utm_source, utm_campaign, search
 */
router.get('/leads', async (req, res) => {
  const {
    page = 1,
    limit = 50,
    responsible_id,
    stage_id,
    date_from,
    date_to,
    source_id,
    utm_source,
    utm_campaign,
  } = req.query;

  const conditions = [];
  const params = [];

  if (responsible_id) {
    params.push(parseInt(responsible_id));
    conditions.push(`l.responsible_id = $${params.length}`);
  }
  if (stage_id) {
    params.push(parseInt(stage_id));
    conditions.push(`l.stage_id = $${params.length}`);
  }
  if (date_from) {
    params.push(date_from);
    conditions.push(`l.date_create >= $${params.length}`);
  }
  if (date_to) {
    params.push(date_to);
    conditions.push(`l.date_create <= $${params.length}`);
  }
  if (source_id) {
    params.push(source_id);
    conditions.push(`l.source_id = $${params.length}`);
  }
  if (utm_source) {
    params.push(utm_source);
    conditions.push(`l.utm_source = $${params.length}`);
  }
  if (utm_campaign) {
    params.push(utm_campaign);
    conditions.push(`l.utm_campaign = $${params.length}`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const offset = (parseInt(page) - 1) * parseInt(limit);

  // Count params index for LIMIT/OFFSET
  params.push(parseInt(limit));
  const limitIdx = params.length;
  params.push(offset);
  const offsetIdx = params.length;

  try {
    const [dataRes, countRes] = await Promise.all([
      pool.query(
        `SELECT
           l.id,
           TRIM(COALESCE(r.name,'') || ' ' || COALESCE(r.last_name,'')) AS responsible,
           s.name AS stage,
           l.opportunity,
           l.source_id,
           l.utm_source,
           l.utm_campaign,
           l.uf_segment,
           l.uf_filial,
           l.date_create,
           l.date_modify
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

module.exports = router;

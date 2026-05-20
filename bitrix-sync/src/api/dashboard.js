const { Router } = require('express');
const pool = require('../db/pool');
const fs = require('fs');
const path = require('path');

const router = Router();

// ── Mode-aware SQL helpers ─────────────────────────────────────────

function leadModeClause(mode) {
  return mode === 'amocrm' ? `AND l.source_id = 'UC_1WUFJB'` : ``;
}

function leadDateCond(_mode, p1, p2) {
  return `($${p1}::date IS NULL OR l.date_create::date >= $${p1}::date)\n           AND ($${p2}::date IS NULL OR l.date_create::date <= $${p2}::date)`;
}

function leadSrcCond(mode, pi) {
  const col = mode === 'amocrm' ? 'l.uf_filial' : 'l.source_id';
  return `($${pi}::text IS NULL OR ${col} = $${pi}::text)`;
}

function dealModeClause(mode) {
  return mode === 'amocrm' ? `AND d.source_id = 'UC_1WUFJB'` : ``;
}

function dealSrcCond(mode, pi) {
  if (mode === 'amocrm') {
    return `($${pi}::text IS NULL OR EXISTS (
      SELECT 1 FROM lead_phones lp
      JOIN leads l ON l.id = lp.lead_id
      WHERE lp.phone = ph.phone AND l.uf_filial = $${pi}::text
    ))`;
  } else {
    return `($${pi}::text IS NULL OR d.source_id = $${pi}::text)`;
  }
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
  'UC_89FPH6': 'Tavsiya',
};

/**
 * GET /api/dashboard/stats
 * Simple counts + last sync state.
 */
router.get('/stats', async (req, res) => {
  const { mode } = req.query;
  const leadsWhere = mode === 'amocrm' ? `WHERE source_id = 'UC_1WUFJB'` : `WHERE (source_id IS NULL OR source_id != 'UC_1WUFJB')`;
  const dealsWhere = mode === 'amocrm' ? `WHERE source_id = 'UC_1WUFJB'` : `WHERE (source_id IS NULL OR source_id != 'UC_1WUFJB')`;
  try {
    const [leadsRes, dealsRes, syncRes] = await Promise.all([
      pool.query(`SELECT COUNT(*) AS total FROM leads ${leadsWhere}`),
      pool.query(`SELECT COUNT(*) AS total FROM deals ${dealsWhere}`),
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
           AND ${leadSrcCond(mode, 5)}
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
         AND ${leadSrcCond(mode, 4)}
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
  const conditions = isAmo ? [`l.source_id = 'UC_1WUFJB'`] : [];
  const params = [];

  if (responsible_id) { params.push(parseInt(responsible_id)); conditions.push(`l.responsible_id = $${params.length}`); }
  if (stage_id)       { params.push(parseInt(stage_id));       conditions.push(`l.stage_id = $${params.length}`); }
  if (date_from) { params.push(date_from); conditions.push(`l.date_create::date >= $${params.length}::date`); }
  if (date_to)   { params.push(date_to);   conditions.push(`l.date_create::date <= $${params.length}::date`); }
  if (source_id) {
    params.push(source_id);
    const srcCol = isAmo ? 'l.uf_filial' : 'l.source_id';
    conditions.push(`${srcCol} = $${params.length}`);
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
 * Distinct source_id values for filter dropdown (excluding amoCRM).
 */
router.get('/sources-list', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT DISTINCT source_id AS source
       FROM leads
       WHERE source_id IS NOT NULL AND source_id != '' AND source_id != 'UC_1WUFJB'
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
    ? `AND t.lead_id IS NOT NULL AND t.lead_id IN (SELECT id FROM leads WHERE source_id = 'UC_1WUFJB')`
    : ``;

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
router.get('/deal-filter-options', async (req, res) => {
  const { mode } = req.query;
  try {
    const [respRes, stageRes, srcRes] = await Promise.all([
      pool.query(`SELECT id, TRIM(COALESCE(name,'') || ' ' || COALESCE(last_name,'')) AS full_name
                  FROM responsibles WHERE active = true ORDER BY name`),
      pool.query(`SELECT DISTINCT s.id, s.name FROM stages s
                  INNER JOIN deals d ON d.stage_id = s.id
                  ${mode === 'amocrm' ? "WHERE d.source_id = 'UC_1WUFJB'" : ""}
                  ORDER BY s.name`),
      mode === 'amocrm'
        ? Promise.resolve({ rows: [] })
        : pool.query(`SELECT DISTINCT source_id FROM deals
                    WHERE source_id IS NOT NULL AND source_id != ''
                    ORDER BY source_id LIMIT 30`),
    ]);

    let sources = [];
    if (mode === 'amocrm') {
      sources = [
        { id: 'Instagram', name: 'Instagram' },
        { id: 'Target', name: 'Target' },
        { id: 'Veb sayt', name: 'Veb sayt' },
        { id: 'Networking', name: 'Networking' },
        { id: 'Sovuq qo\'ng\'iroq', name: 'Sovuq qo\'ng\'iroq' },
        { id: 'Qidiruv', name: 'Qidiruv' },
        { id: 'Boshqalar', name: 'Boshqalar' }
      ];
    } else {
      sources = srcRes.rows.map(r => ({
        id: r.source_id,
        name: SOURCE_NAMES[r.source_id] || r.source_id,
      }));
    }

    res.json({
      responsibles: respRes.rows,
      stages: stageRes.rows,
      sources,
    });
  } catch (err) {
    console.error('[dashboard/deal-filter-options]', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get('/deals-stats', async (req, res) => {
  const { from, to, responsible_id, stage_id, source, mode } = req.query;

  const extra = [];
  const params = [from || null, to || null];
  let pi = 3;
  if (responsible_id) { extra.push(`AND d.responsible_id = $${pi++}`); params.push(parseInt(responsible_id)); }
  if (stage_id)       { extra.push(`AND d.stage_id = $${pi++}`);       params.push(parseInt(stage_id)); }
  
  if (source === '__none__') {
    if (mode === 'amocrm') {
      extra.push(`AND NOT EXISTS (
        SELECT 1 FROM lead_phones lp
        JOIN leads l ON l.id = lp.lead_id
        WHERE lp.phone = ph.phone AND l.uf_filial IS NOT NULL AND l.uf_filial != ''
      )`);
    } else {
      extra.push(`AND (d.source_id IS NULL OR d.source_id = '')`);
    }
  } else if (source) {
    extra.push(`AND ${dealSrcCond(mode, pi++)}`);
    params.push(source);
  }

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
       LEFT JOIN LATERAL (SELECT phone FROM deal_phones WHERE deal_id = d.id LIMIT 1) ph ON true
       WHERE ($1::date IS NULL OR d.date_create::date >= $1::date)
         AND ($2::date IS NULL OR d.date_create::date <= $2::date)
         ${dealModeClause(mode)}
         ${extra.join(' ')}`,
      params
    );
    res.json(rows[0]);
  } catch (err) {
    console.error('[dashboard/deals-stats]', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get('/deals-list', async (req, res) => {
  const { from, to, search, status, responsible_id, stage_id, source, mode } = req.query;
  const page  = Math.max(1, parseInt(req.query.page)  || 1);
  const limit = Math.min(100, parseInt(req.query.limit) || 20);
  const offset = (page - 1) * limit;

  const buildWhere = (extra = []) => {
    const parts = [
      `($1::date IS NULL OR d.date_create::date >= $1::date)`,
      `($2::date IS NULL OR d.date_create::date <= $2::date)`,
      dealModeClause(mode).slice(4)
    ];
    const statusPart =
      status === 'won'    ? 'AND s.is_won = true' :
      status === 'lost'   ? 'AND s.is_final = true AND s.is_won = false' :
      status === 'active' ? 'AND s.is_final = false' : '';
    if (statusPart) parts.push(statusPart.slice(4));
    return parts.concat(extra).filter(Boolean).map((p, i) => (i === 0 ? `WHERE ${p}` : `  AND ${p}`)).join('\n');
  };

  const baseParams = [from || null, to || null];
  let pi = 3;
  const extra = [];
  if (responsible_id) { extra.push(`d.responsible_id = $${pi++}`); baseParams.push(parseInt(responsible_id)); }
  if (stage_id)       { extra.push(`d.stage_id = $${pi++}`);       baseParams.push(parseInt(stage_id)); }
  
  if (source === '__none__') {
    if (mode === 'amocrm') {
      extra.push(`NOT EXISTS (
        SELECT 1 FROM lead_phones lp
        JOIN leads l ON l.id = lp.lead_id
        WHERE lp.phone = ph.phone AND l.uf_filial IS NOT NULL AND l.uf_filial != ''
      )`);
    } else {
      extra.push(`(d.source_id IS NULL OR d.source_id = '')`);
    }
  } else if (source) {
    extra.push(dealSrcCond(mode, pi++));
    baseParams.push(source);
  }

  if (search) {
    extra.push(`(TRIM(COALESCE(r.name,'') || ' ' || COALESCE(r.last_name,'')) ILIKE '%' || $${pi} || '%' OR d.source_id ILIKE '%' || $${pi} || '%' OR ph.phone ILIKE '%' || $${pi} || '%')`);
    baseParams.push(search);
    pi++;
  }

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

    const items = [];
    for (const row of rows) {
      let resolvedManba = row.manba;
      if (mode === 'amocrm' && row.mijoz && row.mijoz !== '—') {
        const { rows: filialRes } = await pool.query(`
          SELECT l.uf_filial FROM lead_phones lp
          JOIN leads l ON l.id = lp.lead_id
          WHERE lp.phone = $1 AND l.uf_filial IS NOT NULL AND l.uf_filial != ''
          LIMIT 1
        `, [row.mijoz]);
        resolvedManba = filialRes.length ? filialRes[0].uf_filial : 'Boshqalar';
      }
      items.push({
        ...row,
        manba: SOURCE_NAMES[resolvedManba] || resolvedManba || '—',
      });
    }

    res.json({ total: countRows[0].total, page, limit, items });
  } catch (err) {
    console.error('[dashboard/deals-list]', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get('/deals-conversion', async (req, res) => {
  const { from, to, mode } = req.query;
  try {
    const { rows } = await pool.query(
      `WITH fd AS (
         SELECT d.id, d.responsible_id, d.opportunity, s.is_won, s.is_final
         FROM deals d
         JOIN stages s ON s.id = d.stage_id
         WHERE ($1::date IS NULL OR d.date_create::date >= $1::date)
           AND ($2::date IS NULL OR d.date_create::date <= $2::date)
           ${dealModeClause(mode)}
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
  const { from, to, mode } = req.query;
  try {
    const { rows } = await pool.query(
      `WITH fd AS (
         SELECT d.id, d.responsible_id, s.bitrix_id AS stage_bid, s.is_won, s.is_final
         FROM deals d
         JOIN stages s ON s.id = d.stage_id
         WHERE ($1::date IS NULL OR d.date_create::date >= $1::date)
           AND ($2::date IS NULL OR d.date_create::date <= $2::date)
           ${dealModeClause(mode)}
       )
       SELECT
         r.id AS responsible_id,
         TRIM(COALESCE(r.name,'') || ' ' || COALESCE(r.last_name,'')) AS full_name,
         COUNT(fd.id)::int AS total,
         COUNT(fd.id) FILTER (WHERE fd.stage_bid IN ('NEW','C1:NEW','C1:CONSULTATION_DONE'))::int              AS konsultatsiya,
         COUNT(fd.id) FILTER (WHERE fd.stage_bid IN ('C1:IN_PROCESS'))::int                                    AS jarayonda,
         COUNT(fd.id) FILTER (WHERE fd.stage_bid IN ('C1:PREPARATION'))::int                                   AS taklif,
         COUNT(fd.id) FILTER (WHERE fd.stage_bid IN ('EXECUTING','C1:EXECUTING','C1:PRESENTATION'))::int       AS taqdimot,
         COUNT(fd.id) FILTER (WHERE fd.stage_bid IN ('C1:CLIENT_APPROVED'))::int                               AS manzur,
         COUNT(fd.id) FILTER (WHERE fd.stage_bid IN ('C1:CONTRACT_SENT'))::int                                 AS shartnoma,
         COUNT(fd.id) FILTER (WHERE fd.stage_bid IN ('UC_W35V62','C1:AGREEMENT'))::int                         AS kelishuv,
         COUNT(fd.id) FILTER (WHERE fd.stage_bid IN ('C1:FINAL_INVOICE','C1:PARTIAL_PAYMENT'))::int            AS tolov,
         COUNT(fd.id) FILTER (WHERE fd.stage_bid IN ('C1:WORK_STARTED'))::int                                  AS ish_boshlandi,
         COUNT(fd.id) FILTER (WHERE fd.is_won)::int                                                             AS sotuv_boldi,
         COUNT(fd.id) FILTER (WHERE fd.is_final AND NOT fd.is_won)::int                                        AS bekor_boldi
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
 * Distinct amoCRM sub-source values (uf_filial = UF_CRM_1778260858916).
 */
router.get('/amocrm-sources', async (_req, res) => {
  // Try DB first; on failure, fall back to a local JSON file so UI can work without Postgres.
  try {
    const { rows } = await pool.query(
      `SELECT DISTINCT uf_filial AS source
       FROM leads
       WHERE source_id = 'UC_1WUFJB'
         AND uf_filial IS NOT NULL AND uf_filial != '' AND uf_filial != 'false'
       ORDER BY source`
    );
    return res.json(rows.map(r => r.source));
  } catch (err) {
    console.error('[dashboard/amocrm-sources] DB query failed:', err.message || err);
    // Fallback: look for bitrix-sync/amocrm_sources.json in cwd
    try {
      const file = path.resolve(process.cwd(), 'amocrm_sources.json');
      if (fs.existsSync(file)) {
        const txt = fs.readFileSync(file, 'utf8');
        const arr = JSON.parse(txt);
        if (Array.isArray(arr)) return res.json(arr);
      }
    } catch (fe) {
      console.error('[dashboard/amocrm-sources] fallback read failed:', fe.message || fe);
    }
    res.status(500).json({ error: 'Failed to load amoCRM sources (DB error and no fallback file)' });
  }
});

// ══════════════════════════════════════════════════════════════════
// Lead dashboard endpoints — single source of truth (replaces Python)
// ══════════════════════════════════════════════════════════════════

/**
 * GET /api/dashboard/lead-stats
 * Header KPIs + funnel per stage.  Replaces Python /api/stats.
 * Params: from, to, responsible_id, stage, source, mode
 */
router.get('/lead-stats', async (req, res) => {
  const { from, to, responsible_id, stage, source, mode } = req.query;

  const statsParams  = [from || null, to || null, responsible_id ? parseInt(responsible_id) : null, stage || null, source || null];
  const funnelParams = [from || null, to || null, responsible_id ? parseInt(responsible_id) : null, source || null];

  const statsWhere = `${leadDateCond(mode, 1, 2)}
      AND ($3::int  IS NULL OR l.responsible_id = $3::int)
      AND ($4::text IS NULL OR s.bitrix_id       = $4::text)
      AND ${leadSrcCond(mode, 5)}
      ${leadModeClause(mode)}`;

  const funnelJoin = `${leadDateCond(mode, 1, 2)}
      AND ($3::int  IS NULL OR l.responsible_id = $3::int)
      AND ${leadSrcCond(mode, 4)}
      ${leadModeClause(mode)}`;

  try {
    const [statsRes, funnelRes] = await Promise.all([
      pool.query(
        `SELECT
           COUNT(*)::int                                                                       AS total_leads,
           COUNT(*) FILTER (WHERE NOT s.is_final)::int                                        AS in_process,
           COUNT(*) FILTER (WHERE s.is_final AND NOT s.is_won)::int                           AS failed,
           COUNT(*) FILTER (WHERE s.is_final AND s.is_won)::int                               AS converted,
           ROUND(COUNT(*) FILTER (WHERE s.is_final AND s.is_won)::numeric
                 / NULLIF(COUNT(*), 0) * 100, 2)                                              AS conversion_pct,
           COALESCE(SUM(l.opportunity), 0)::numeric                                           AS total_opportunity,
           COALESCE(ROUND(AVG(l.opportunity), 0), 0)::numeric                                 AS avg_opportunity,
           COUNT(*) FILTER (WHERE NOT s.is_final AND l.date_modify < NOW() - INTERVAL '7 days')::int AS frozen_leads,
           ROUND(AVG(EXTRACT(EPOCH FROM (NOW() - l.date_create)) / 86400.0)
             FILTER (WHERE NOT s.is_final), 1)                                                AS avg_age_days,
           COUNT(l.id) FILTER (WHERE s.bitrix_id IN ('UC_F8K4GI','JUNK'))::int                AS sifatsiz_bekor_count,
           (COUNT(*) - COUNT(l.id) FILTER (WHERE s.bitrix_id IN ('UC_F8K4GI','JUNK')))::int   AS sifatli_lid_count,
           COUNT(l.id) FILTER (WHERE s.bitrix_id IN ('UC_L28G68','CONSULTATION'))::int        AS konsultatsiya_belgilandi_count,
           COUNT(l.id) FILTER (WHERE s.bitrix_id = 'CONVERTED')::int                         AS konsultatsiya_otkazildi_count,
           COUNT(l.id) FILTER (WHERE s.bitrix_id IN ('UC_F8K4GI','JUNK'))::int                AS muvaffaqiyatsiz_count
         FROM leads l
         JOIN stages s ON s.id = l.stage_id
         WHERE ${statsWhere}`,
        statsParams
      ),
      pool.query(
        `SELECT
           s.bitrix_id,
           s.name AS name_uz,
           s.sort_order,
           COUNT(l.id)::int                          AS lead_count,
           COALESCE(SUM(l.opportunity), 0)::numeric  AS total_opportunity
         FROM stages s
         LEFT JOIN leads l ON l.stage_id = s.id AND ${funnelJoin}
         WHERE s.entity = 'lead' AND s.sort_order > 0
         GROUP BY s.id, s.bitrix_id, s.name, s.sort_order
         ORDER BY s.sort_order`,
        funnelParams
      ),
    ]);
    res.json({ header: statsRes.rows[0] || {}, funnel: funnelRes.rows });
  } catch (err) {
    console.error('[dashboard/lead-stats]', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/dashboard/lead-responsibles
 * Per-responsible lead breakdown with all stage columns.  Replaces Python /api/responsibles.
 */
router.get('/lead-responsibles', async (req, res) => {
  const { from, to, responsible_id, stage, source, mode } = req.query;
  const params = [from || null, to || null, responsible_id ? parseInt(responsible_id) : null, stage || null, source || null];

  try {
    const { rows } = await pool.query(
      `WITH fl AS (
         SELECT l.id, l.responsible_id, l.opportunity, s.bitrix_id AS stage_bid
         FROM leads l
         JOIN stages s ON s.id = l.stage_id
         WHERE ${leadDateCond(mode, 1, 2)}
           AND ($3::int  IS NULL OR l.responsible_id = $3::int)
           AND ($4::text IS NULL OR s.bitrix_id       = $4::text)
           AND ${leadSrcCond(mode, 5)}
           ${leadModeClause(mode)}
       )
       SELECT
         r.id                                                                                  AS responsible_id,
         TRIM(COALESCE(r.name,'') || ' ' || COALESCE(r.last_name,''))                         AS full_name,
         COUNT(fl.id)::int                                                                     AS total,
         COUNT(fl.id) FILTER (WHERE fl.stage_bid = 'NEW')::int                                AS qongiroqlar,
         COUNT(fl.id) FILTER (WHERE fl.stage_bid = 'IN_PROCESS')::int                         AS yangi_lid,
         COUNT(fl.id) FILTER (WHERE fl.stage_bid = 'PROCESSED')::int                          AS propushenniy,
         COUNT(fl.id) FILTER (WHERE fl.stage_bid IN ('UC_1KPATX','NO_ANSWER'))::int            AS javob_bermadi,
         COUNT(fl.id) FILTER (WHERE fl.stage_bid IN ('UC_Q2U9EL','CALLBACK'))::int             AS qayta_aloqa,
         COUNT(fl.id) FILTER (WHERE fl.stage_bid IN ('UC_KXC3ZW','THINKING'))::int             AS oylab_koradi,
         COUNT(fl.id) FILTER (WHERE fl.stage_bid IN ('UC_L28G68','CONSULTATION'))::int         AS konsultatsiya,
         COUNT(fl.id) FILTER (WHERE fl.stage_bid IN ('UC_5G8244','NOT_TRANSFERRED'))::int      AS otkazilmadi,
         COUNT(fl.id) FILTER (WHERE fl.stage_bid = 'CONVERTED')::int                          AS konsultatsiya_otkazildi,
         COUNT(fl.id) FILTER (WHERE fl.stage_bid IN ('JUNK','ARCHIVE'))::int                   AS sandiq,
         COUNT(fl.id) FILTER (WHERE fl.stage_bid = 'UC_F8K4GI')::int                          AS sifatsiz,
         COUNT(fl.id) FILTER (WHERE fl.stage_bid IN ('UC_NAZK5J','RECYCLED'))::int             AS bekor_boldi,
         COALESCE(SUM(fl.opportunity), 0)::numeric                                            AS total_opportunity
       FROM responsibles r
       LEFT JOIN fl ON fl.responsible_id = r.id
       WHERE r.active = TRUE
       GROUP BY r.id, r.name, r.last_name
       ORDER BY total DESC`,
      params
    );
    res.json({ responsibles: rows });
  } catch (err) {
    console.error('[dashboard/lead-responsibles]', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/dashboard/lead-conversion
 * Per-responsible conversion funnel.  Replaces Python /api/conversion.
 */
router.get('/lead-conversion', async (req, res) => {
  const { from, to, responsible_id, stage, source, mode } = req.query;
  const params = [from || null, to || null, responsible_id ? parseInt(responsible_id) : null, stage || null, source || null];

  try {
    const { rows } = await pool.query(
      `WITH fl AS (
         SELECT l.id, l.responsible_id, s.bitrix_id AS stage_bid
         FROM leads l
         JOIN stages s ON s.id = l.stage_id
         WHERE ${leadDateCond(mode, 1, 2)}
           AND ($3::int  IS NULL OR l.responsible_id = $3::int)
           AND ($4::text IS NULL OR s.bitrix_id       = $4::text)
           AND ${leadSrcCond(mode, 5)}
           ${leadModeClause(mode)}
       )
       SELECT
         r.id                                                                                  AS responsible_id,
         TRIM(COALESCE(r.name,'') || ' ' || COALESCE(r.last_name,''))                         AS full_name,
         COUNT(fl.id)::int                                                                     AS total,
         COUNT(fl.id) FILTER (WHERE fl.stage_bid IN (
           'NEW','IN_PROCESS','PROCESSED',
           'UC_1KPATX','UC_Q2U9EL','UC_KXC3ZW','UC_L28G68','UC_5G8244'
         ))::int                                                                               AS jarayonda,
         COUNT(fl.id) FILTER (WHERE fl.stage_bid IN ('UC_F8K4GI','JUNK'))::int                AS sifatsiz_lid,
         COUNT(fl.id) FILTER (WHERE fl.stage_bid = 'CONVERTED')::int                         AS tashrif_buyurdi
       FROM responsibles r
       LEFT JOIN fl ON fl.responsible_id = r.id
       WHERE r.active = TRUE
       GROUP BY r.id, r.name, r.last_name
       ORDER BY total DESC`,
      params
    );
    res.json({ conversion: rows });
  } catch (err) {
    console.error('[dashboard/lead-conversion]', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/dashboard/lead-filter-options
 * Responsibles, lead stages, and sources.  Replaces Python /api/filter-options.
 */
router.get('/lead-filter-options', async (_req, res) => {
  try {
    const [respRes, stageRes, srcRes, formRes] = await Promise.all([
      pool.query(
        `SELECT id, TRIM(COALESCE(name,'') || ' ' || COALESCE(last_name,'')) AS full_name
         FROM responsibles WHERE active = TRUE ORDER BY name`
      ),
      pool.query(
        `SELECT bitrix_id, name FROM stages
         WHERE entity = 'lead' AND sort_order > 0
         ORDER BY sort_order`
      ),
      pool.query(
        `SELECT DISTINCT source_id FROM leads
         WHERE source_id IS NOT NULL AND source_id != '' AND source_id != 'UC_1WUFJB'
         ORDER BY source_id LIMIT 60`
      ),
      pool.query(
        `SELECT form_id AS id, form_name AS name, lead_count
         FROM crm_forms
         WHERE active = TRUE
         ORDER BY lead_count DESC NULLS LAST, name`
      ).catch(() => ({ rows: [] })),
    ]);
    res.json({
      responsibles: respRes.rows,
      stages: stageRes.rows,
      sources: srcRes.rows.map(r => ({ id: r.source_id, name: SOURCE_NAMES[r.source_id] || r.source_id })),
      forms: formRes.rows.map(r => ({ id: r.id, name: r.name, count: r.lead_count })),
    });
  } catch (err) {
    console.error('[dashboard/lead-filter-options]', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/dashboard/taqsimot
 * Returns all active responsibles with their taqsimot_pct values.
 */
router.get('/taqsimot', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT r.id, TRIM(COALESCE(r.name,'') || ' ' || COALESCE(r.last_name,'')) AS full_name,
              r.email, r.work_position, r.taqsimot_pct
       FROM responsibles r
       WHERE r.active = TRUE
       ORDER BY r.name`
    );
    res.json({ responsibles: rows });
  } catch (err) {
    console.error('[dashboard/taqsimot GET]', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * PUT /api/dashboard/taqsimot/:id
 * Body: { "taqsimot_pct": 22.5 }
 * Updates responsibles.taqsimot_pct and returns new total across all active distributors.
 */
router.put('/taqsimot/:id', async (req, res) => {
  const id  = parseInt(req.params.id, 10);
  const pct = parseFloat(req.body?.taqsimot_pct);
  if (isNaN(id) || isNaN(pct) || pct < 0 || pct > 100) {
    return res.status(400).json({ error: 'Invalid id or taqsimot_pct (0–100)' });
  }
  try {
    await pool.query(
      `UPDATE responsibles SET taqsimot_pct = $1 WHERE id = $2`,
      [pct, id]
    );
    const { rows } = await pool.query(
      `SELECT SUM(taqsimot_pct)::numeric AS total
       FROM responsibles WHERE taqsimot_pct > 0 AND active = TRUE`
    );
    const total = parseFloat(rows[0].total || 0);
    res.json({
      ok: true,
      id,
      taqsimot_pct: pct,
      total_pct: total,
      warning: total !== 100 ? `Jami: ${total}% (100% bo'lishi kerak)` : null,
    });
  } catch (err) {
    console.error('[dashboard/taqsimot PUT]', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/dashboard/taqsimot-stats
 * Today's distribution accuracy per responsible.
 */
router.get('/taqsimot-stats', async (_req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        r.id,
        TRIM(COALESCE(r.name,'') || ' ' || COALESCE(r.last_name,'')) AS full_name,
        r.taqsimot_pct::float                                         AS target_pct,
        COUNT(l.id)::int                                              AS today_count,
        ROUND(
          COUNT(l.id)::numeric /
          NULLIF(SUM(COUNT(l.id)) OVER(), 0) * 100, 1
        )::float                                                      AS actual_pct,
        ROUND(
          r.taqsimot_pct -
          (COUNT(l.id)::numeric / NULLIF(SUM(COUNT(l.id)) OVER(), 0) * 100), 1
        )::float                                                      AS deficit_pct
      FROM responsibles r
      LEFT JOIN leads l ON l.responsible_id = r.id
        AND l.date_create >= date_trunc('day', NOW() AT TIME ZONE 'Asia/Tashkent')
        AND (l.source_id IS NULL OR l.source_id != 'UC_1WUFJB')
      WHERE r.taqsimot_pct > 0 AND r.active = TRUE
      GROUP BY r.id, r.name, r.last_name, r.taqsimot_pct
      ORDER BY r.taqsimot_pct DESC
    `);
    res.json({ stats: rows, date: new Date().toISOString() });
  } catch (err) {
    console.error('[dashboard/taqsimot-stats]', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get('/utm-campaign-stats', async (req, res) => {
  const { from, to, mode, utm_source } = req.query;
  if (!utm_source) return res.status(400).json({ error: 'utm_source required' });
  try {
    const { rows } = await pool.query(
      `SELECT
         COALESCE(NULLIF(l.utm_campaign, ''), 'Nomalum') AS utm_campaign,
         COUNT(*)::int                                                              AS umumiy_lidlar,
         COUNT(*) FILTER (WHERE s.bitrix_id IN (
           'CALLS','NEW','MISSED','NO_ANSWER','CALLBACK',
           'THINKING','NOT_TRANSFERRED'
         ))::int                                                                    AS jarayonda,
         (COUNT(*) - COUNT(*) FILTER (WHERE s.bitrix_id IN ('JUNK','RECYCLED')))::int AS sifatli_lid,
         COUNT(*) FILTER (WHERE s.bitrix_id = 'CONSULTATION')::int                AS konsultatsiya_belgilandi,
         COUNT(*) FILTER (WHERE s.bitrix_id = 'CONSULTATION_DONE')::int           AS konsultatsiya_otkazildi,
         COUNT(*) FILTER (WHERE s.bitrix_id = 'JUNK')::int                        AS sifatsiz,
         COUNT(*) FILTER (WHERE s.bitrix_id = 'RECYCLED')::int                    AS bekor_boldi,
         COUNT(DISTINCT l.responsible_id)::int                                     AS responsible_count
       FROM leads l
       LEFT JOIN stages s ON s.id = l.stage_id
       WHERE ($1::date IS NULL OR l.date_create::date >= $1::date)
         AND ($2::date IS NULL OR l.date_create::date <= $2::date)
         AND ($3::text IS NULL OR TRIM(l.utm_source) = $3)
         ${leadModeClause(mode)}
       GROUP BY COALESCE(NULLIF(l.utm_campaign, ''), 'Nomalum')
       ORDER BY umumiy_lidlar DESC`,
      [from || null, to || null, utm_source || null],
    );
    res.json(rows);
  } catch (err) {
    console.error('[dashboard/utm-campaign-stats]', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get('/utm-responsible-stats', async (req, res) => {
  const { from, to, mode, utm_source, utm_campaign } = req.query;
  try {
    const { rows } = await pool.query(
      `SELECT
         COALESCE(TRIM(COALESCE(r.name,'') || ' ' || COALESCE(r.last_name,'')), 'Nomalum') AS full_name,
         l.responsible_id,
         COUNT(*)::int                                                              AS umumiy_lidlar,
         COUNT(*) FILTER (WHERE s.bitrix_id IN (
           'CALLS','NEW','MISSED','NO_ANSWER','CALLBACK',
           'THINKING','NOT_TRANSFERRED'
         ))::int                                                                    AS jarayonda,
         (COUNT(*) - COUNT(*) FILTER (WHERE s.bitrix_id IN ('JUNK','RECYCLED')))::int AS sifatli_lid,
         COUNT(*) FILTER (WHERE s.bitrix_id = 'CONSULTATION')::int                AS konsultatsiya_belgilandi,
         COUNT(*) FILTER (WHERE s.bitrix_id = 'CONSULTATION_DONE')::int           AS konsultatsiya_otkazildi,
         COUNT(*) FILTER (WHERE s.bitrix_id = 'JUNK')::int                        AS sifatsiz,
         COUNT(*) FILTER (WHERE s.bitrix_id = 'RECYCLED')::int                    AS bekor_boldi
       FROM leads l
       LEFT JOIN stages s ON s.id = l.stage_id
       LEFT JOIN responsibles r ON r.id = l.responsible_id
       WHERE ($1::date IS NULL OR l.date_create::date >= $1::date)
         AND ($2::date IS NULL OR l.date_create::date <= $2::date)
         AND ($3::text IS NULL OR TRIM(l.utm_source) = $3)
         AND (
           $4::text IS NULL
           OR ($4 = 'Nomalum' AND (l.utm_campaign IS NULL OR l.utm_campaign = ''))
           OR ($4 != 'Nomalum' AND l.utm_campaign = $4)
         )
         ${leadModeClause(mode)}
       GROUP BY l.responsible_id, r.name, r.last_name
       ORDER BY umumiy_lidlar DESC`,
      [from || null, to || null, utm_source || null, utm_campaign || null],
    );
    res.json(rows);
  } catch (err) {
    console.error('[dashboard/utm-responsible-stats]', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get('/utm-stats', async (req, res) => {
  const { from, to, mode, form_id } = req.query;
  try {
    const { rows } = await pool.query(
      `SELECT
         TRIM(l.utm_source) AS utm_source,
         COUNT(*)::int                                                              AS umumiy_lidlar,
         COUNT(*) FILTER (WHERE s.bitrix_id IN (
           'CALLS','NEW','MISSED','NO_ANSWER','CALLBACK',
           'THINKING','NOT_TRANSFERRED'
         ))::int                                                                    AS jarayonda,
         (COUNT(*) - COUNT(*) FILTER (WHERE s.bitrix_id IN ('JUNK','RECYCLED')))::int AS sifatli_lid,
         COUNT(*) FILTER (WHERE s.bitrix_id = 'CONSULTATION')::int                AS konsultatsiya_belgilandi,
         COUNT(*) FILTER (WHERE s.bitrix_id = 'CONSULTATION_DONE')::int           AS konsultatsiya_otkazildi,
         COUNT(*) FILTER (WHERE s.bitrix_id = 'JUNK')::int                        AS sifatsiz,
         COUNT(*) FILTER (WHERE s.bitrix_id = 'RECYCLED')::int                    AS bekor_boldi,
         COUNT(DISTINCT NULLIF(l.utm_campaign, ''))::int                           AS campaign_count
       FROM leads l
       LEFT JOIN stages s ON s.id = l.stage_id
       WHERE l.utm_source IS NOT NULL AND TRIM(l.utm_source) != ''
         AND ($1::date IS NULL OR l.date_create::date >= $1::date)
         AND ($2::date IS NULL OR l.date_create::date <= $2::date)
         AND ($3::text IS NULL
              OR NOT EXISTS (SELECT 1 FROM crm_forms WHERE form_id = $3 AND fb_form_id IS NOT NULL)
              OR EXISTS (
                SELECT 1 FROM crm_forms cf2
                WHERE cf2.form_id = $3 AND cf2.fb_form_id IS NOT NULL
                  AND EXISTS (
                    SELECT 1 FROM lead_phones lp
                    JOIN facebook_leads fl ON fl.phone = lp.phone
                    WHERE lp.lead_id = l.id AND fl.form_id = cf2.fb_form_id
                  )
              ))
         ${leadModeClause(mode)}
       GROUP BY TRIM(l.utm_source)
       ORDER BY umumiy_lidlar DESC`,
      [from || null, to || null, form_id || null],
    );
    res.json(rows);
  } catch (err) {
    console.error('[dashboard/utm-stats]', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/dashboard/source-stats
 * Leads grouped by source with funnel breakdown.
 * Params: from, to, responsible_id, mode
 */
router.get('/source-stats', async (req, res) => {
  const { from, to, responsible_id, mode } = req.query;
  try {
    const { rows } = await pool.query(
      `SELECT
         COALESCE(l.source_id, 'Nomalum') AS source_id,
         COUNT(*)::int                                                              AS umumiy_lidlar,
         COUNT(*) FILTER (WHERE s.bitrix_id IN (
           'CALLS','NEW','MISSED','NO_ANSWER','CALLBACK',
           'THINKING','NOT_TRANSFERRED'
         ))::int                                                                    AS jarayonda,
         (COUNT(*) - COUNT(*) FILTER (WHERE s.bitrix_id IN ('JUNK','RECYCLED')))::int AS sifatli_lid,
         COUNT(*) FILTER (WHERE s.bitrix_id = 'CONSULTATION')::int                AS konsultatsiya_belgilandi,
         COUNT(*) FILTER (WHERE s.bitrix_id = 'CONSULTATION_DONE')::int           AS konsultatsiya_otkazildi,
         COUNT(*) FILTER (WHERE s.bitrix_id = 'JUNK')::int                        AS sifatsiz,
         COUNT(*) FILTER (WHERE s.bitrix_id = 'RECYCLED')::int                    AS bekor_boldi
       FROM leads l
       LEFT JOIN stages s ON s.id = l.stage_id
       WHERE ($1::date IS NULL OR l.date_create::date >= $1::date)
         AND ($2::date IS NULL OR l.date_create::date <= $2::date)
         AND ($3::int  IS NULL OR l.responsible_id = $3::int)
         ${leadModeClause(mode)}
       GROUP BY COALESCE(l.source_id, 'Nomalum')
       ORDER BY umumiy_lidlar DESC`,
      [from || null, to || null, responsible_id ? parseInt(responsible_id) : null]
    );
    res.json(rows.map(r => ({
      ...r,
      source_name: SOURCE_NAMES[r.source_id] || r.source_id,
    })));
  } catch (err) {
    console.error('[dashboard/source-stats]', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/dashboard/sync-crm-forms
 * Fetches CRM forms from Bitrix24 and upserts into crm_forms table.
 */
router.post('/sync-crm-forms', async (_req, res) => {
  const BITRIX_URL = process.env.BITRIX_WEBHOOK_URL;
  if (!BITRIX_URL) return res.status(500).json({ error: 'BITRIX_WEBHOOK_URL not set' });
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS crm_forms (
        form_id     TEXT PRIMARY KEY,
        form_name   TEXT,
        active      BOOLEAN DEFAULT TRUE,
        lead_count  INT,
        fb_form_id  TEXT,
        synced_at   TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await pool.query(`
      ALTER TABLE crm_forms ADD COLUMN IF NOT EXISTS fb_form_id TEXT
    `);
    const resp = await fetch(`${BITRIX_URL}crm.webform.list`);
    const json = await resp.json();
    const forms = json.result || [];
    for (const f of forms) {
      await pool.query(
        `INSERT INTO crm_forms (form_id, form_name, active, synced_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (form_id) DO UPDATE SET
           form_name = EXCLUDED.form_name,
           active    = EXCLUDED.active,
           synced_at = NOW()`,
        [String(f.ID), f.NAME, f.ACTIVE === 'Y']
      );
    }
    // Try to link Bitrix24 form to Facebook form_id by matching form name → campaign_name/adset_name
    await pool.query(`
      UPDATE crm_forms cf SET fb_form_id = sub.form_id
      FROM (
        SELECT form_id,
               MAX(COALESCE(NULLIF(campaign_name,''), adset_name)) AS display_name,
               COUNT(*)::int AS cnt
        FROM facebook_leads WHERE form_id IS NOT NULL
        GROUP BY form_id
      ) sub
      WHERE sub.display_name ILIKE '%' || cf.form_name || '%'
         OR cf.form_name ILIKE '%' || sub.display_name || '%'
    `);
    // Update lead_count from linked facebook_leads
    await pool.query(`
      UPDATE crm_forms cf SET lead_count = sub.cnt
      FROM (
        SELECT form_id, COUNT(*)::int AS cnt FROM facebook_leads
        WHERE form_id IS NOT NULL GROUP BY form_id
      ) sub
      WHERE cf.fb_form_id = sub.form_id
    `);
    res.json({ ok: true, synced: forms.length });
  } catch (err) {
    console.error('[dashboard/sync-crm-forms]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Call sync helpers (Bitrix24 crm.activity.list) ────────────────
async function ensureCallsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS calls (
      id             TEXT PRIMARY KEY,
      responsible_id INT,
      call_start     TIMESTAMPTZ,
      call_end       TIMESTAMPTZ,
      duration       INT,
      direction      INT,
      completed      BOOLEAN,
      synced_at      TIMESTAMPTZ DEFAULT NOW()
    )
  `);
}

async function syncCallsFromBitrix(from, to) {
  await ensureCallsTable();
  const { fetchAll } = require('../services/bitrix');
  const filter = { TYPE_ID: 2 };
  if (from) filter['>=START_TIME'] = from;
  if (to)   filter['<=START_TIME'] = to;

  const records = await fetchAll('crm.activity.list', filter, [
    'ID','RESPONSIBLE_ID','START_TIME','END_TIME','COMPLETED','DIRECTION',
  ]);

  let upserted = 0;
  for (const r of records) {
    const startMs  = r.START_TIME ? new Date(r.START_TIME).getTime() : null;
    const endMs    = r.END_TIME   ? new Date(r.END_TIME).getTime()   : null;
    const duration = (startMs && endMs && endMs > startMs)
      ? Math.round((endMs - startMs) / 1000) : 0;
    await pool.query(
      `INSERT INTO calls (id, responsible_id, call_start, call_end, duration, direction, completed, synced_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
       ON CONFLICT (id) DO UPDATE SET
         responsible_id = EXCLUDED.responsible_id,
         call_start     = EXCLUDED.call_start,
         call_end       = EXCLUDED.call_end,
         duration       = EXCLUDED.duration,
         direction      = EXCLUDED.direction,
         completed      = EXCLUDED.completed,
         synced_at      = NOW()`,
      [
        String(r.ID),
        r.RESPONSIBLE_ID ? parseInt(r.RESPONSIBLE_ID) : null,
        r.START_TIME || null,
        r.END_TIME   || null,
        duration,
        r.DIRECTION  ? parseInt(r.DIRECTION) : null,
        r.COMPLETED === 'Y',
      ]
    );
    upserted++;
  }
  return upserted;
}

// Auto-sync every 5 minutes: last 2 days rolling window
function startCallsAutoSync() {
  const run = async () => {
    try {
      const to   = new Date().toISOString().slice(0, 10);
      const from = new Date(Date.now() - 2 * 86400 * 1000).toISOString().slice(0, 10);
      const n = await syncCallsFromBitrix(from, to);
      console.log(`[calls-autosync] synced ${n} calls`);
    } catch (err) {
      console.error('[calls-autosync] error:', err.message);
    }
  };
  run(); // run immediately on startup
  setInterval(run, 5 * 60 * 1000); // then every 5 minutes
}

module.exports.startCallsAutoSync = startCallsAutoSync;

/**
 * POST /api/dashboard/sync-calls
 * Manual sync with optional date range.
 */
router.post('/sync-calls', async (req, res) => {
  const { from, to } = req.body || req.query;
  try {
    const upserted = await syncCallsFromBitrix(from, to);
    res.json({ ok: true, synced: upserted });
  } catch (err) {
    console.error('[dashboard/sync-calls]', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/dashboard/call-stats
 * Per-responsible call stats. Success = duration >= 10s.
 */
router.get('/call-stats', async (req, res) => {
  const { from, to, responsible_id } = req.query;
  try {
    const { rows } = await pool.query(
      `SELECT
         c.responsible_id,
         COALESCE(TRIM(COALESCE(r.name,'') || ' ' || COALESCE(r.last_name,'')), 'Noma''lum') AS full_name,
         COUNT(*)::int                                                      AS total_calls,
         COALESCE(SUM(c.duration), 0)::int                                 AS total_duration,
         COALESCE(ROUND(AVG(c.duration) FILTER (WHERE c.duration >= 10)), 0)::int AS avg_duration,
         COUNT(*) FILTER (WHERE c.duration >= 10)::int                     AS success_calls,
         COUNT(*) FILTER (WHERE c.duration < 10)::int                      AS failed_calls
       FROM calls c
       LEFT JOIN responsibles r ON r.id = c.responsible_id
       WHERE ($1::date IS NULL OR c.call_start::date >= $1::date)
         AND ($2::date IS NULL OR c.call_start::date <= $2::date)
         AND ($3::int  IS NULL OR c.responsible_id   = $3::int)
       GROUP BY c.responsible_id, r.name, r.last_name
       ORDER BY total_duration DESC`,
      [from || null, to || null, responsible_id ? parseInt(responsible_id) : null]
    );
    res.json(rows);
  } catch (err) {
    if (err.code === '42P01') return res.json([]);
    console.error('[dashboard/call-stats]', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
module.exports.startCallsAutoSync = startCallsAutoSync;

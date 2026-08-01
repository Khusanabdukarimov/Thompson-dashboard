const { Router } = require('express');
const pool = require('../db/pool');
const fs = require('fs');
const path = require('path');

const router = Router();

// ── Mode-aware SQL helpers ─────────────────────────────────────────

function leadModeClause(mode) {
  if (mode === 'amocrm')   return `AND l.source_id = 'UC_1WUFJB'`;
  if (mode === 'bitrix24') return `AND (l.source_id IS NULL OR l.source_id != 'UC_1WUFJB')`;
  return '';
}

function leadDateCond(mode, p1, p2) {
  const col = mode === 'amocrm' ? 'COALESCE(l.uf_amo_date, l.date_create)' : 'l.date_create';
  return `($${p1}::date IS NULL OR (${col} AT TIME ZONE 'Asia/Tashkent')::date >= $${p1}::date)\n           AND ($${p2}::date IS NULL OR (${col} AT TIME ZONE 'Asia/Tashkent')::date <= $${p2}::date)`;
}

function leadSrcCond(mode, pi) {
  const col = mode === 'amocrm' ? 'l.uf_filial' : 'l.source_id';
  return `($${pi}::text IS NULL OR ${col}::text = ANY(string_to_array($${pi}, ',')))`;
}

// ── Lead metric definitions ────────────────────────────────────────
// Everything below keys off Bitrix STATUS_ID, never the display name: names are
// edited in Bitrix from time to time, ids are not. Names are quoted only so a
// reader can tell which status an id refers to. Source of truth is
// crm.status.list (ENTITY_ID=STATUS), mirrored into `stages` by leadStatusSync.
//
//   1          Думает (1-30)        UC_N0PI5R  Визит назначен
//   UC_SWPARQ  Не пришёл            UC_L8G2B9  Закрыт
//   CONVERTED  Успешный лид         JUNK       Горячие звонки (NO)
const STAGE_SIFATLI  = "'1','UC_N0PI5R','UC_SWPARQ','UC_L8G2B9','CONVERTED'";
const STAGE_SIFATSIZ = "'JUNK'";      // Горячие звонки (NO) — stage only, never the "sifatsiz sababi" field
const STAGE_BEKOR    = "'UC_L8G2B9'"; // Закрыт — stage only, never the "bekor sababi" field

// "Jarayonda" = Bitrix status semantics 'P' (in progress), i.e. neither won nor
// failed. Mirrors DataLens count_if(статус-тип id = "P").
const IN_PROGRESS = `s.semantics = 'P'`;

// Bitrix writes '' or the string 'false' for an unset field, so IS NOT NULL alone
// is not enough to decide "this date was stamped".
const ufSet = (col) => `(${col} IS NOT NULL AND ${col} <> '' AND ${col} <> 'false')`;

// Tashrif belgilandi  → UF_CRM_1770693781846 "Tashrif belgilandiga tushgan sana"
// Tashrif o'tkazildi  → UF_CRM_1770695429433 "Tashrif buyurdiga tushgan sana"
// Similar names, different meanings: scheduled vs actually attended.
const TASHRIF_BELGILANDI = ufSet('l.uf_tashrif_sanasi');
const TASHRIF_OTKAZILDI  = ufSet('l.uf_tashrif_buyurdi');

// ── The dashboard's lead scope ─────────────────────────────────────
// Every lead figure on the Lidlar page is scoped to these two conditions, and
// nothing else. They are always on — "Tozalash" clears the visible filters but
// never widens the scope — so the page is always answering the same question as
// this Bitrix filter:
//
//     Proekt: O'quv markaz, Maktab      Proekt2: anything except HR
//
// Proekt is an allow-list, not a deny-list. It used to be
// `NOT IN (Bog'cha, IH)`, which silently let through every lead with no Proekt
// value at all — the single biggest reason the cards disagreed with Bitrix.
const PROEKT_FIELD = 'UF_CRM_1781879563298';
const PROEKT_ALLOWED = "'3571','3573','5113'"; // O'quv markaz, Maktab, Kids
                                               // excluded: 3575 Bog'cha, 3577 IH

// Proekt2 (UF_CRM_1782148374198): internal HR / Студент / Жалоба tagging.
// Only HR (5159) is dropped — Студент (5161) and Жалоба (5163) are real leads.
const PROEKT2_FIELD = 'UF_CRM_1782148374198';
const PROEKT2_HIDDEN = "'5159'"; // HR

/** The always-on scope, for any query that has a lead id to constrain. */
const leadScopeCond = (col) =>
  `${col} IN (SELECT lead_id FROM lead_uf_values
               WHERE field_code = '${PROEKT_FIELD}' AND value IN (${PROEKT_ALLOWED}))
   AND ${col} NOT IN (SELECT lead_id FROM lead_uf_values
                       WHERE field_code = '${PROEKT2_FIELD}' AND value IN (${PROEKT2_HIDDEN}))`;

// Reason fields, resolved against lead_uf_enums (kept current by ufSync) rather
// than a hardcoded id→label map. The maps inherited from the Mountain codebase
// carried that portal's enum ids, so nothing matched here and leads.uf_*_reason
// ended up 0% filled — every reason rendered as "Noma'lum" despite 11,002
// values sitting in lead_uf_values.
const REASON_BEKOR    = 'UF_CRM_1770976355232'; // Bekor bo'ldi sababini belgilang (LC)
const REASON_SIFATSIZ = 'UF_CRM_1770282341169'; // Sifatsizlik sababini belgilang (LC)

/** Reason label for a lead, joined off the enum dictionary. */
const reasonJoin = (field) => `
  LEFT JOIN lead_uf_values rv ON rv.lead_id = l.id
        AND rv.field_code = '${field}' AND rv.value <> ''
  LEFT JOIN lead_uf_enums  re ON re.field_code = rv.field_code
        AND re.enum_id = rv.value`;

// Optional enum filters, each an AND over lead_uf_values. Enum ids are numeric,
// so they are validated as digits and inlined — parameterising four
// variable-length lists across every endpoint would renumber all the existing
// positional placeholders.
const UF_FILTERS = [
  ['course',  'UF_CRM_1618299519454'], // Курсы
  ['source1', 'UF_CRM_1635794595'],    // Источник 1
  ['filial',  'UF_CRM_1618299635672'], // Филиал
  ['reason',  'UF_CRM_1618300665524'], // Причина
  ['hudud',   'UF_CRM_1701529319467'], // Вилоят
];

const SOURCE1_FIELD = 'UF_CRM_1635794595';
const HUDUD_FIELD   = 'UF_CRM_1701529319467';
const PRICHINA_FIELD = 'UF_CRM_1618300665524'; // Причина — the "Sabab" filter's own field

/**
 * Lead breakdown by a Bitrix enum UF field (same funnel columns as
 * /source-stats), grouped by that field's own enum value. Backs both
 * /source1-stats ("Manba 1 bo'yicha") and /hudud-stats ("Hudud bo'yicha") —
 * they differ only in which field they group by.
 */
function ufBreakdownHandler(fieldCode, { excludeUnknown = false } = {}) {
  return async (req, res) => {
    const { from, to, responsible_id, proekt, mode } = req.query;
    try {
      const { rows } = await pool.query(
        `SELECT
           COALESCE(e.value, 'Noma''lum')                                       AS name,
           MAX(e.enum_id)                                                       AS enum_id,
           COUNT(*)::int                                                        AS umumiy_lidlar,
           COUNT(*) FILTER (WHERE ${IN_PROGRESS})::int                          AS jarayonda,
           COUNT(*) FILTER (WHERE s.bitrix_id IN (${STAGE_SIFATLI}))::int       AS sifatli_lid,
           COUNT(*) FILTER (WHERE ${TASHRIF_BELGILANDI})::int                   AS konsultatsiya_belgilandi,
           COUNT(*) FILTER (WHERE ${TASHRIF_OTKAZILDI})::int                    AS konsultatsiya_otkazildi,
           COUNT(*) FILTER (WHERE s.bitrix_id = 'JUNK')::int                    AS sifatsiz,
           COUNT(*) FILTER (WHERE s.bitrix_id = 'UC_L8G2B9')::int               AS bekor_boldi
         FROM leads l
         LEFT JOIN stages s ON s.id = l.stage_id
         ${excludeUnknown ? 'JOIN' : 'LEFT JOIN'} lead_uf_values v ON v.lead_id = l.id AND v.field_code = '${fieldCode}' AND v.value <> ''
         ${excludeUnknown ? 'JOIN' : 'LEFT JOIN'} lead_uf_enums  e ON e.field_code = v.field_code AND e.enum_id = v.value
         WHERE ${leadDateCond(mode, 1, 2)}
           AND ($3::text IS NULL OR l.responsible_id::text = ANY(string_to_array($3, ',')))
           AND ${leadProektCond(4, req.query)}
           ${leadModeClause(mode)}
         GROUP BY COALESCE(e.value, 'Noma''lum')
         ORDER BY umumiy_lidlar DESC`,
        [from || null, to || null, responsible_id || null, proekt || null]
      );
      res.json(rows);
    } catch (err) {
      console.error(`[dashboard/uf-breakdown ${fieldCode}]`, err.message);
      res.status(500).json({ error: err.message });
    }
  };
}

/** SQL for whichever of the four enum filters the request actually set. */
function ufFilterCond(q, col = 'l.id') {
  let sql = '';
  for (const [key, field] of UF_FILTERS) {
    const ids = String(q?.[key] ?? '').split(',').map(v => v.trim()).filter(v => /^\d+$/.test(v));
    if (!ids.length) continue;
    sql += `\n    AND ${col} IN (SELECT lead_id FROM lead_uf_values
             WHERE field_code = '${field}' AND value IN (${ids.map(i => `'${i}'`).join(',')}))`;
  }
  return sql;
}

/** Scope plus the user's optional Proekt picker (a subset of the allow-list). */
function leadProektCond(pi, q) {
  return `($${pi}::text IS NULL OR l.id IN (
      SELECT lead_id FROM lead_uf_values
      WHERE field_code = '${PROEKT_FIELD}' AND value = ANY(string_to_array($${pi}, ','))
    ))
    AND ${leadScopeCond('l.id')}${ufFilterCond(q)}`;
}

function dealModeClause(mode) {
  if (mode === 'amocrm')   return `AND d.source_id = 'UC_1WUFJB'`;
  if (mode === 'bitrix24') return `AND (d.source_id IS NULL OR d.source_id != 'UC_1WUFJB')`;
  return '';
}

function dealDateCond(mode, p1, p2) {
  const col = mode === 'amocrm' ? 'COALESCE(d.uf_amo_date, d.date_create)' : 'd.date_create';
  return `($${p1}::date IS NULL OR (${col} AT TIME ZONE 'Asia/Tashkent')::date >= $${p1}::date)\n           AND ($${p2}::date IS NULL OR (${col} AT TIME ZONE 'Asia/Tashkent')::date <= $${p2}::date)`;
}

function dealSrcCond(mode, pi) {
  if (mode === 'amocrm') {
    return `EXISTS (
      SELECT 1 FROM lead_phones lp
      JOIN leads l ON l.id = lp.lead_id
      WHERE lp.phone = ph.phone AND l.uf_filial = ANY(string_to_array($${pi}, ','))
    )`;
  } else {
    return `d.source_id = ANY(string_to_array($${pi}, ','))`;
  }
}

const SOURCE_NAMES = {
  'UC_O9BLGT': 'Facebook',
  'UC_3O8GTF': 'Instagram',
  'UC_89FPH6': 'Target',
  'UC_H1PMDS': 'Telegram forma',
  'REPEAT_SALE': 'Website forma',
  'CALL': "Qo'ng'iroq",
  'CALLBACK': "Qayta qo'ng'iroq",
  'Звонок': "Qo'ng'iroq",
  'ADVERTISING': 'Reklama',
  'UC_8BLFVY': "Ko'chadan",
  'UC_3F6D2K': 'Vakansiya',
  'UC_1WUFJB': 'amoCRM',
  'UC_P8729J': 'Tavsiya orqali (NPS)',
  'UC_BU2WXB': 'Networking',
  'UC_Y6RAXP': 'Qayta sotuv (LTV)',
  'UC_BOJPCA': 'Sovuq qo\'ng\'iroq',
  'UC_0QF8D1': 'Veb sayt',
  'UC_CKSPAM': 'Organik tashrif',
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
           AND ${leadScopeCond('l.id')}
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
         COUNT(fl.id) FILTER (WHERE fl.stage_bid = 'JUNK')                        AS sifatsiz,
         COUNT(fl.id) FILTER (WHERE fl.stage_bid = 'UC_L8G2B9')                   AS bekor_boldi
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
         AND ${leadScopeCond('l.id')}
         ${leadModeClause(mode)}
       WHERE s.entity = 'lead' AND s.semantics IS NOT NULL
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
       WHERE entity = 'lead' AND sort_order > 0 AND semantics IS NOT NULL
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
/**
 * GET /api/dashboard/responsible-tasks
 * The tasks behind one row of Vazifalar kesimida, so an operator's count can be
 * opened down to the actual records. Params: responsible_id, from, to, proekt,
 * mode, limit.
 */
router.get('/responsible-tasks', async (req, res) => {
  const { responsible_id, from, to, proekt, mode } = req.query;
  if (!responsible_id) return res.status(400).json({ error: 'responsible_id required' });
  const limit = Math.min(500, parseInt(req.query.limit, 10) || 200);

  const leadFilter = (mode === 'amocrm'
    ? `AND t.lead_id IS NOT NULL AND t.lead_id IN (SELECT id FROM leads WHERE source_id = 'UC_1WUFJB')`
    : ``) + `
         AND ($4::text IS NULL OR t.lead_id IN (
           SELECT lead_id FROM lead_uf_values
           WHERE field_code = '${PROEKT_FIELD}' AND value = ANY(string_to_array($4, ','))
         ))
         AND (t.lead_id IS NULL OR ${leadScopeCond('t.lead_id')})`;

  try {
    const { rows } = await pool.query(
      `SELECT t.id, t.title, t.status, t.deadline, t.date_created, t.date_closed,
              t.lead_id, l.title AS lead_title, s.bitrix_id AS lead_stage_bid
       FROM tasks t
       LEFT JOIN leads l  ON l.id = t.lead_id
       LEFT JOIN stages s ON s.id = l.stage_id
       WHERE t.executor_id = $3::int
         AND ($1::date IS NULL OR t.date_created >= $1::date)
         AND ($2::date IS NULL OR t.date_created < $2::date + INTERVAL '1 day')
         ${leadFilter}
       ORDER BY t.date_created DESC
       LIMIT ${limit}`,
      [from || null, to || null, parseInt(responsible_id, 10), proekt || null]
    );
    res.json({ items: rows });
  } catch (err) {
    console.error('[dashboard/responsible-tasks]', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get('/tasks-summary', async (req, res) => {
  const { from, to, proekt, mode } = req.query;
  const params = [from || null, to || null, proekt || null];

  const leadFilter = (mode === 'amocrm'
    ? `AND t.lead_id IS NOT NULL AND t.lead_id IN (SELECT id FROM leads WHERE source_id = 'UC_1WUFJB')`
    : ``) + `
         AND ($3::text IS NULL OR t.lead_id IN (
           SELECT lead_id FROM lead_uf_values
           WHERE field_code = '${PROEKT_FIELD}' AND value = ANY(string_to_array($3, ','))
         ))
         AND (t.lead_id IS NULL OR ${leadScopeCond('t.lead_id')})`;

  try {
    const { rows } = await pool.query(
      `SELECT
         r.id AS responsible_id,
         TRIM(COALESCE(r.name,'') || ' ' || COALESCE(r.last_name,'')) AS full_name,
         COUNT(t.id)                                                                              AS total,
         COUNT(t.id) FILTER (WHERE t.status IN ('pending','in_progress','review','deferred'))    AS in_progress,
         COUNT(t.id) FILTER (WHERE t.status = 'completed')                                       AS completed,
         COUNT(t.id) FILTER (WHERE t.deadline < NOW() AND t.status != 'completed')               AS overdue,
         COUNT(t.id) FILTER (WHERE t.status = 'completed' AND t.deadline IS NOT NULL AND t.date_closed > t.deadline) AS completed_late
       FROM responsibles r
       LEFT JOIN tasks t ON t.executor_id = r.id
         AND ($1::date IS NULL OR t.date_created >= $1::date)
         AND ($2::date IS NULL OR t.date_created < $2::date + INTERVAL '1 day')
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
  const { from, to, responsible_id, proekt, mode } = req.query;
  const params = [from || null, to || null, responsible_id || null, proekt || null];
  try {
    const { rows } = await pool.query(
      `SELECT
         COALESCE(re.value, 'Noma''lum') AS reason,
         COUNT(*)::int AS total
       FROM leads l
       JOIN stages s ON s.id = l.stage_id AND s.bitrix_id = 'UC_L8G2B9'
       ${reasonJoin(REASON_BEKOR)}
       WHERE ${leadDateCond(mode, 1, 2)}
         AND ($3::text IS NULL OR l.responsible_id::text = ANY(string_to_array($3, ',')))
         AND ${leadProektCond(4, req.query)}
         ${leadModeClause(mode)}
       GROUP BY re.value
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
/**
 * GET /api/dashboard/reason-leads
 * The leads behind one bar of the Bekor / Sifatsiz panels, so a reason can be
 * expanded down to the actual records. Params: kind=cancel|junk, reason,
 * from, to, responsible_id, proekt, mode, limit, offset.
 *
 * `reason` is the human label, matched against the enum dictionary — the same
 * value the panel renders. "Noma'lum" means the field was never filled.
 */
router.get('/reason-leads', async (req, res) => {
  const { kind, reason, from, to, responsible_id, proekt, mode } = req.query;
  const isJunk = kind === 'junk';
  const stage  = isJunk ? 'JUNK' : 'UC_L8G2B9';
  const field  = isJunk ? REASON_SIFATSIZ : REASON_BEKOR;
  // Barchasi asks for a whole reason at once; 5000 is well above the
  // largest bucket and still bounds a malformed request.
  const limit  = Math.min(5000, parseInt(req.query.limit, 10) || 8);
  const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
  const unknown = !reason || reason === "Noma'lum";

  try {
    const { rows } = await pool.query(
      `SELECT l.id, l.title, l.name, l.last_name, l.date_create
       FROM leads l
       JOIN stages s ON s.id = l.stage_id AND s.bitrix_id = '${stage}'
       ${reasonJoin(field)}
       WHERE ${leadDateCond(mode, 1, 2)}
         AND ($3::text IS NULL OR l.responsible_id::text = ANY(string_to_array($3, ',')))
         AND ${leadProektCond(4, req.query)}
         AND (${unknown ? 're.value IS NULL' : 're.value = $5::text'})
         ${leadModeClause(mode)}
       ORDER BY l.date_create DESC
       LIMIT ${limit} OFFSET ${offset}`,
      [from || null, to || null, responsible_id || null, proekt || null, ...(unknown ? [] : [reason])]
    );
    res.json({ items: rows });
  } catch (err) {
    console.error('[dashboard/reason-leads]', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get('/junk-reasons', async (req, res) => {
  const { from, to, responsible_id, proekt, mode } = req.query;
  const params = [from || null, to || null, responsible_id || null, proekt || null];
  try {
    const { rows } = await pool.query(
      `SELECT
         COALESCE(re.value, 'Noma''lum') AS reason,
         COUNT(*)::int AS total
       FROM leads l
       JOIN stages s ON s.id = l.stage_id AND s.bitrix_id = 'JUNK'
       ${reasonJoin(REASON_SIFATSIZ)}
       WHERE ${leadDateCond(mode, 1, 2)}
         AND ($3::text IS NULL OR l.responsible_id::text = ANY(string_to_array($3, ',')))
         AND ${leadProektCond(4, req.query)}
         ${leadModeClause(mode)}
       GROUP BY re.value
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
        name: r.source_name || SOURCE_NAMES[r.source_id] || r.source_id,
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
  if (responsible_id) { extra.push(`AND d.responsible_id::text = ANY(string_to_array($${pi++}, ','))`); params.push(responsible_id); }
  if (stage_id)       { extra.push(`AND d.stage_id::text = ANY(string_to_array($${pi++}, ','))`);       params.push(stage_id); }
  if (source) {
    extra.push(`AND ${dealSrcCond(mode, pi++)}`);
    params.push(source);
  }

  // Build payment-date subquery extra conditions (same param indices, inner alias d2)
  // Skip amocrm source condition (uses ph.phone lateral join not available inside subquery)
  const extraPay = [];
  let pi2 = 3;
  if (responsible_id) { extraPay.push(`AND d2.responsible_id::text = ANY(string_to_array($${pi2++}, ','))`); }
  if (stage_id)       { extraPay.push(`AND d2.stage_id::text = ANY(string_to_array($${pi2++}, ','))`); }
  if (source && mode !== 'amocrm') { extraPay.push(`AND d2.source_id = ANY(string_to_array($${pi2++}, ','))`); }

  const tolanganSubq = `(
    SELECT COALESCE(SUM(sub.amount), 0)
    FROM (
      SELECT p.amount_usd AS amount
      FROM deal_payments p
      JOIN deals d2 ON d2.id = p.deal_id
      JOIN stages s2 ON s2.id = d2.stage_id
      WHERE NOT (s2.is_final = true AND s2.is_won = false)
        AND p.paid_at BETWEEN $1::date AND $2::date
        ${extraPay.join(' ')}
      UNION ALL
      SELECT d2.uf_paid_sum AS amount
      FROM deals d2
      JOIN stages s2 ON s2.id = d2.stage_id
      WHERE d2.uf_paid_sum IS NOT NULL AND d2.uf_paid_sum > 0
        AND NOT (s2.is_final = true AND s2.is_won = false)
        AND COALESCE(d2.uf_bp_sale_date, d2.uf_payment_date, d2.date_create)::date BETWEEN $1::date AND $2::date
        AND d2.id NOT IN (SELECT DISTINCT deal_id FROM deal_payments)
        ${extraPay.join(' ')}
    ) sub
  )::numeric`;

  try {
    const { rows } = await pool.query(
      `SELECT
         COUNT(d.id)::int AS total,
         COUNT(d.id) FILTER (WHERE s.is_final = false AND s.is_won = false)::int AS yangi,
         COUNT(d.id) FILTER (WHERE s.is_won = true)::int AS sotuv_boldi,
         COUNT(d.id) FILTER (WHERE s.is_final = true AND s.is_won = false)::int  AS bekor,
         COALESCE(SUM(d.opportunity) FILTER (WHERE s.is_won = true AND d.currency_id = 'USD'), 0)::numeric AS jami_sotuv,
         ${tolanganSubq} AS tolangan,
         COALESCE(ROUND(AVG(d.opportunity) FILTER (WHERE s.is_won = true AND d.currency_id = 'USD'), 0), 0)::numeric AS ortacha_chek,
         ROUND(COUNT(d.id) FILTER (WHERE s.is_won = true)::numeric / NULLIF(COUNT(d.id), 0) * 100, 1) AS konversiya
       FROM deals d
       LEFT JOIN stages s ON s.id = d.stage_id
       LEFT JOIN LATERAL (SELECT phone FROM deal_phones WHERE deal_id = d.id LIMIT 1) ph ON true
       WHERE ${dealDateCond(mode, 1, 2)}
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
    const dateCond = dealDateCond(mode, 1, 2);
    const parts = [
      dateCond.split('\n')[0].trim(),
      dateCond.split('\n')[1].trim().replace(/^AND\s+/i, ''),
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
  if (responsible_id) { extra.push(`d.responsible_id::text = ANY(string_to_array($${pi++}, ','))`); baseParams.push(responsible_id); }
  if (stage_id)       { extra.push(`d.stage_id::text = ANY(string_to_array($${pi++}, ','))`);       baseParams.push(stage_id); }
  if (source) {
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
       LEFT JOIN stages s ON s.id = d.stage_id
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
       LEFT JOIN stages s ON s.id = d.stage_id
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
         SELECT d.id, d.responsible_id, d.opportunity, d.currency_id, s.is_won, s.is_final, s.bitrix_id AS stage_bid
         FROM deals d
         JOIN stages s ON s.id = d.stage_id
         WHERE ${dealDateCond(mode, 1, 2)}
           ${dealModeClause(mode)}
       )
       SELECT
         r.id AS responsible_id,
         TRIM(COALESCE(r.name,'') || ' ' || COALESCE(r.last_name,'')) AS full_name,
         r.work_position,
         COUNT(fd.id)::int AS total,
         COUNT(fd.id) FILTER (WHERE NOT fd.is_won = true AND NOT fd.is_final)::int AS jarayonda,
         COUNT(fd.id) FILTER (WHERE fd.is_won = true)::int AS sotuv_boldi,
         COUNT(fd.id) FILTER (WHERE fd.is_final AND NOT fd.is_won)::int AS bekor_boldi,
         COALESCE(SUM(fd.opportunity) FILTER (WHERE fd.is_won = true AND fd.currency_id = 'USD'), 0)::numeric AS jami_sotuv
       FROM responsibles r
       JOIN fd ON fd.responsible_id = r.id
       GROUP BY r.id, r.name, r.last_name, r.work_position
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
         WHERE ${dealDateCond(mode, 1, 2)}
           ${dealModeClause(mode)}
       )
       SELECT
         r.id AS responsible_id,
         TRIM(COALESCE(r.name,'') || ' ' || COALESCE(r.last_name,'')) AS full_name,
         r.work_position,
         COUNT(fd.id)::int AS total,
         COUNT(fd.id) FILTER (WHERE fd.stage_bid IN ('NEW','C1:NEW','C1:CONSULTATION_DONE'))::int              AS konsultatsiya,
         COUNT(fd.id) FILTER (WHERE fd.stage_bid IN ('UC_W35V62','C1:AGREEMENT'))::int                         AS kelishuv,
         COUNT(fd.id) FILTER (WHERE fd.stage_bid IN ('UC_EHGFKW','UC_3BDUY6'))::int                           AS ish_boshlandi,
         COUNT(fd.id) FILTER (WHERE fd.is_won = true)::int AS sotuv_boldi,
         COUNT(fd.id) FILTER (WHERE fd.is_final AND NOT fd.is_won)::int                                        AS bekor_boldi
       FROM responsibles r
       JOIN fd ON fd.responsible_id = r.id
       GROUP BY r.id, r.name, r.last_name, r.work_position
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
/**
 * GET /api/dashboard/lead-daily
 * Bucketed series behind the KPI card waves.
 *
 * The bucket adapts to the selected range so the wave always holds roughly
 * 8-20 points: a week reads day by day, a quarter by week, a year by month.
 * A fixed daily bucket would render a year as 365 spikes and a week as 7.
 * Same scope and same metric definitions as /lead-stats, so a wave can never
 * tell a different story from the number above it.
 */
router.get('/lead-daily', async (req, res) => {
  const { from, to, responsible_id, stage, source, proekt, mode } = req.query;
  // Bucket follows the range so the wave always holds roughly 8-24 points.
  // One day reads hour by hour; a year reads by month.
  let bucket = 'month';
  let effFrom = from || null;
  if (from && to) {
    const span = (new Date(to) - new Date(from)) / 86400000;
    bucket = span < 1 ? 'hour' : span <= 10 ? 'day' : span <= 90 ? 'week' : 'month';
  } else {
    // "Butun davr" spans years in which the early ones are nearly empty, so the
    // wave flattened to a line with a single spike at the right. Start at the
    // current year instead — the shape is the point of the card.
    effFrom = `${new Date().getFullYear()}-01-01`;
  }

  const params = [effFrom, to || null, responsible_id || null, stage || null, source || null, proekt || null];
  const dateCol = mode === 'amocrm' ? 'COALESCE(l.uf_amo_date, l.date_create)' : 'l.date_create';

  try {
    const { rows } = await pool.query(
      `SELECT date_trunc('${bucket}', (${dateCol} AT TIME ZONE 'Asia/Tashkent')) AS b,
         COUNT(*)::int                                                   AS total,
         COUNT(*) FILTER (WHERE ${IN_PROGRESS})::int                     AS jarayonda,
         COUNT(*) FILTER (WHERE s.bitrix_id IN (${STAGE_SIFATLI}))::int  AS sifatli,
         COUNT(*) FILTER (WHERE s.bitrix_id IN (${STAGE_SIFATSIZ}))::int AS sifatsiz,
         COUNT(*) FILTER (WHERE s.bitrix_id IN (${STAGE_BEKOR}))::int    AS bekor,
         COUNT(*) FILTER (WHERE ${TASHRIF_BELGILANDI})::int              AS belgilandi,
         COUNT(*) FILTER (WHERE ${TASHRIF_OTKAZILDI})::int               AS otkazildi
       FROM leads l
       JOIN stages s ON s.id = l.stage_id
       WHERE ${leadDateCond(mode, 1, 2)}
         AND ($3::text IS NULL OR l.responsible_id::text = ANY(string_to_array($3, ',')))
         AND ($4::text IS NULL OR s.bitrix_id = ANY(string_to_array($4, ',')))
         AND ${leadSrcCond(mode, 5)}
         AND ${leadProektCond(6, req.query)}
         ${leadModeClause(mode)}
       GROUP BY b ORDER BY b`,
      params
    );

    const fmt = (d) => {
      const dt = new Date(d);
      if (bucket === 'hour')  return `${String(dt.getHours()).padStart(2, '0')}:00`;
      if (bucket === 'month') return dt.toLocaleDateString('ru-RU', { month: 'short', year: '2-digit' });
      return dt.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
    };

    res.json({
      bucket,
      labels:     rows.map(r => fmt(r.b)),
      total:      rows.map(r => r.total),
      jarayonda:  rows.map(r => r.jarayonda),
      sifatli:    rows.map(r => r.sifatli),
      sifatsiz:   rows.map(r => r.sifatsiz),
      bekor:      rows.map(r => r.bekor),
      belgilandi: rows.map(r => r.belgilandi),
      otkazildi:  rows.map(r => r.otkazildi),
      convPct:    rows.map(r => (r.total > 0 ? Math.round((r.otkazildi / r.total) * 1000) / 10 : 0)),
    });
  } catch (err) {
    console.error('[dashboard/lead-daily]', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get('/lead-stats', async (req, res) => {
  const { from, to, responsible_id, stage, source, proekt, mode } = req.query;

  const statsParams  = [from || null, to || null, responsible_id || null, stage || null, source || null, proekt || null];
  const funnelParams = [from || null, to || null, responsible_id || null, source || null, proekt || null];

  const statsWhere = `${leadDateCond(mode, 1, 2)}
      AND ($3::text IS NULL OR l.responsible_id::text = ANY(string_to_array($3, ',')))
      AND ($4::text IS NULL OR s.bitrix_id = ANY(string_to_array($4, ',')))
      AND ${leadSrcCond(mode, 5)}
      AND ${leadProektCond(6, req.query)}
      ${leadModeClause(mode)}`;

  const funnelJoin = `${leadDateCond(mode, 1, 2)}
      AND ($3::text IS NULL OR l.responsible_id::text = ANY(string_to_array($3, ',')))
      AND ${leadSrcCond(mode, 4)}
      AND ${leadProektCond(5, req.query)}
      ${leadModeClause(mode)}`;

  try {
    const [statsRes, funnelRes] = await Promise.all([
      pool.query(
        `SELECT
           COUNT(*)::int                                                                       AS total_leads,
           COUNT(*) FILTER (WHERE ${IN_PROGRESS})::int                                        AS in_process,
           COUNT(*) FILTER (WHERE s.semantics = 'F')::int                                     AS failed,
           COUNT(*) FILTER (WHERE ${TASHRIF_OTKAZILDI})::int                                  AS converted,
           ROUND(COUNT(*) FILTER (WHERE ${TASHRIF_OTKAZILDI})::numeric
                 / NULLIF(COUNT(*), 0) * 100, 2)                                              AS conversion_pct,
           COALESCE(SUM(l.opportunity), 0)::numeric                                           AS total_opportunity,
           COALESCE(ROUND(AVG(l.opportunity), 0), 0)::numeric                                 AS avg_opportunity,
           COUNT(*) FILTER (WHERE ${IN_PROGRESS} AND l.date_modify < NOW() - INTERVAL '7 days')::int AS frozen_leads,
           ROUND(AVG(EXTRACT(EPOCH FROM (NOW() - l.date_create)) / 86400.0)
             FILTER (WHERE ${IN_PROGRESS}), 1)                                                AS avg_age_days,
           COUNT(l.id) FILTER (WHERE s.bitrix_id IN (${STAGE_SIFATSIZ}))::int                 AS sifatsiz_bekor_count,
           COUNT(l.id) FILTER (WHERE s.bitrix_id IN (${STAGE_BEKOR}))::int                    AS bekor_boldi_count,
           COUNT(l.id) FILTER (WHERE s.bitrix_id IN (${STAGE_SIFATLI}))::int                  AS sifatli_lid_count,
           COUNT(l.id) FILTER (WHERE ${TASHRIF_BELGILANDI})::int                              AS konsultatsiya_belgilandi_count,
           COUNT(l.id) FILTER (WHERE ${TASHRIF_OTKAZILDI})::int                               AS konsultatsiya_otkazildi_count,
           COUNT(l.id) FILTER (WHERE s.bitrix_id IN (${STAGE_SIFATSIZ}))::int                 AS muvaffaqiyatsiz_count
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
         WHERE s.entity = 'lead' AND s.sort_order > 0 AND s.semantics IS NOT NULL
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
  const { from, to, responsible_id, stage, source, proekt, mode } = req.query;
  const params = [from || null, to || null, responsible_id || null, stage || null, source || null, proekt || null];

  try {
    const { rows } = await pool.query(
      `WITH fl AS (
         SELECT l.id, l.responsible_id, l.opportunity, s.bitrix_id AS stage_bid
         FROM leads l
         JOIN stages s ON s.id = l.stage_id
         WHERE ${leadDateCond(mode, 1, 2)}
           AND ($3::text IS NULL OR l.responsible_id::text = ANY(string_to_array($3, ',')))
           AND ($4::text IS NULL OR s.bitrix_id = ANY(string_to_array($4, ',')))
           AND ${leadSrcCond(mode, 5)}
           AND ${leadProektCond(6, req.query)}
           ${leadModeClause(mode)}
       ),
       per_stage AS (
         SELECT responsible_id, stage_bid, COUNT(*)::int AS n
         FROM fl GROUP BY responsible_id, stage_bid
       ),
       totals AS (
         SELECT responsible_id, COUNT(*)::int AS total,
                COALESCE(SUM(opportunity), 0)::numeric AS total_opportunity
         FROM fl GROUP BY responsible_id
       )
       SELECT
         r.id                                                          AS responsible_id,
         TRIM(COALESCE(r.name,'') || ' ' || COALESCE(r.last_name,''))  AS full_name,
         t.total,
         -- Counts keyed by Bitrix STATUS_ID rather than a fixed column list, so
         -- the table always shows exactly the statuses the portal currently has.
         -- The old hardcoded list had drifted: four retired statuses that could
         -- only render empty columns, and no room for any status added later.
         COALESCE((
           SELECT jsonb_object_agg(p.stage_bid, p.n)
           FROM per_stage p WHERE p.responsible_id = r.id
         ), '{}'::jsonb)                                               AS by_stage,
         t.total_opportunity
       FROM responsibles r
       JOIN totals t ON t.responsible_id = r.id   -- inner join drops 0-lead staff
       -- no r.active filter: a lead still counts when its owner was
       -- deactivated, and the KPI cards count it, so JAMI must too.
       ORDER BY t.total DESC`,
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
  const { from, to, responsible_id, stage, source, proekt, mode } = req.query;
  const params = [from || null, to || null, responsible_id || null, stage || null, source || null, proekt || null];

  try {
    const { rows } = await pool.query(
      `WITH fl AS (
         SELECT l.id, l.responsible_id, s.bitrix_id AS stage_bid, s.semantics,
                ${TASHRIF_BELGILANDI} AS t_belgilandi,
                ${TASHRIF_OTKAZILDI}  AS t_otkazildi
         FROM leads l
         JOIN stages s ON s.id = l.stage_id
         WHERE ${leadDateCond(mode, 1, 2)}
           AND ($3::text IS NULL OR l.responsible_id::text = ANY(string_to_array($3, ',')))
           AND ($4::text IS NULL OR s.bitrix_id = ANY(string_to_array($4, ',')))
           AND ${leadSrcCond(mode, 5)}
           AND ${leadProektCond(6, req.query)}
           ${leadModeClause(mode)}
       )
       SELECT
         r.id                                                                                  AS responsible_id,
         TRIM(COALESCE(r.name,'') || ' ' || COALESCE(r.last_name,''))                         AS full_name,
         COUNT(fl.id)::int                                                                     AS total,
         COUNT(fl.id) FILTER (WHERE fl.semantics = 'P')::int                                   AS jarayonda,
         COUNT(fl.id) FILTER (WHERE fl.stage_bid IN (${STAGE_SIFATLI}))::int                   AS sifatli_lid,
         COUNT(fl.id) FILTER (WHERE fl.stage_bid IN (${STAGE_SIFATSIZ}))::int                  AS sifatsiz_lid,
         COUNT(fl.id) FILTER (WHERE fl.stage_bid IN (${STAGE_BEKOR}))::int                     AS bekor_boldi,
         COUNT(fl.id) FILTER (WHERE fl.t_belgilandi)::int                                      AS tashrif_belgilandi,
         COUNT(fl.id) FILTER (WHERE fl.t_otkazildi)::int                                       AS tashrif_buyurdi
       FROM responsibles r
       JOIN fl ON fl.responsible_id = r.id   -- inner join drops 0-lead staff
       -- no r.active filter: a lead still counts when its owner was
       -- deactivated, and the KPI cards count it, so JAMI must too.
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
router.get('/lead-filter-options', async (req, res) => {
  const { mode } = req.query;
  const srcExclude = mode === 'bitrix24'
    ? `AND source_id != 'UC_1WUFJB'`
    : mode === 'amocrm'
      ? `AND source_id = 'UC_1WUFJB'`
      : '';
  try {
    const [respRes, stageRes, srcRes, formRes, proektRes, ufRes] = await Promise.all([
      pool.query(
        `SELECT id, TRIM(COALESCE(name,'') || ' ' || COALESCE(last_name,'')) AS full_name
         FROM responsibles WHERE active = TRUE ORDER BY name`
      ),
      pool.query(
        // semantics IS NOT NULL excludes retired statuses that predate
        // leadStatusSync (e.g. IN_PROCESS/PROCESSED) — they're still in this
        // table because nothing ever deletes a stage row, but no live lead
        // can be in one, so they'd only ever render an empty column.
        `SELECT bitrix_id, name FROM stages
         WHERE entity = 'lead' AND sort_order > 0 AND semantics IS NOT NULL
         ORDER BY sort_order`
      ),
      pool.query(
        `SELECT DISTINCT l.source_id, ls.name
         FROM leads l LEFT JOIN lead_sources ls ON ls.source_id = l.source_id
         WHERE l.source_id IS NOT NULL AND l.source_id != '' ${srcExclude}
         ORDER BY l.source_id LIMIT 60`
      ),
      pool.query(
        `SELECT form_id AS id, form_name AS name, lead_count
         FROM crm_forms
         WHERE active = TRUE
         ORDER BY lead_count DESC NULLS LAST, name`
      ).catch(() => ({ rows: [] })),
      pool.query(
        `SELECT e.enum_id AS id, e.value AS name
         FROM lead_uf_enums e
         WHERE e.field_code = '${PROEKT_FIELD}'
           AND e.enum_id IN (${PROEKT_ALLOWED})
         ORDER BY e.value`
      ).catch(() => ({ rows: [] })),
      // The four extra enum pickers (Kurslar / Manba 1 / Filial / Sabab).
      pool.query(
        `SELECT field_code, enum_id AS id, value AS name
         FROM lead_uf_enums
         WHERE field_code = ANY($1::text[])
         ORDER BY field_code, value`,
        [UF_FILTERS.map(([, f]) => f)]
      ).catch(() => ({ rows: [] })),
    ]);
    const byField = (code) => ufRes.rows.filter(r => r.field_code === code).map(r => ({ id: r.id, name: r.name }));
    res.json({
      responsibles: respRes.rows,
      stages: stageRes.rows,
      sources: srcRes.rows.map(r => ({ id: r.source_id, name: r.name || SOURCE_NAMES[r.source_id] || r.source_id })),
      forms: formRes.rows.map(r => ({ id: r.id, name: r.name, count: r.lead_count })),
      proekts: proektRes.rows,
      courses:  byField('UF_CRM_1618299519454'),
      source1s: byField(SOURCE1_FIELD),
      filials:  byField('UF_CRM_1618299635672'),
      reasons:  byField('UF_CRM_1618300665524'),
      hududs:   byField(HUDUD_FIELD),
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
  const { from, to, mode, utm_source, utm_medium } = req.query;
  if (!utm_source) return res.status(400).json({ error: 'utm_source required' });
  try {
    const { rows } = await pool.query(
      `SELECT
         COALESCE(NULLIF(l.utm_campaign, ''), 'Nomalum') AS utm_campaign,
         COUNT(*)::int                                                              AS umumiy_lidlar,
         COUNT(*) FILTER (WHERE ${IN_PROGRESS})::int AS jarayonda,
         COUNT(*) FILTER (WHERE s.bitrix_id IN (${STAGE_SIFATLI}))::int AS sifatli_lid,
         COUNT(*) FILTER (WHERE ${TASHRIF_BELGILANDI})::int AS konsultatsiya_belgilandi,
         COUNT(*) FILTER (WHERE ${TASHRIF_OTKAZILDI})::int AS konsultatsiya_otkazildi,
         COUNT(*) FILTER (WHERE s.bitrix_id = 'JUNK')::int                          AS sifatsiz,
         COUNT(*) FILTER (WHERE s.bitrix_id = 'UC_L8G2B9')::int               AS bekor_boldi,
         COUNT(DISTINCT l.responsible_id)::int                                     AS responsible_count
       FROM leads l
       LEFT JOIN stages s ON s.id = l.stage_id
       WHERE ($1::date IS NULL OR l.date_create::date >= $1::date)
         AND ($2::date IS NULL OR l.date_create::date <= $2::date)
         AND ($3::text IS NULL OR TRIM(l.utm_source) = $3)
         AND ($4::text IS NULL OR COALESCE(NULLIF(TRIM(l.utm_medium),''),'Nomalum') = $4)
         AND ${leadScopeCond('l.id')}
         ${leadModeClause(mode)}
       GROUP BY COALESCE(NULLIF(l.utm_campaign, ''), 'Nomalum')
       ORDER BY umumiy_lidlar DESC`,
      [from || null, to || null, utm_source || null, utm_medium || null],
    );
    res.json(rows);
  } catch (err) {
    console.error('[dashboard/utm-campaign-stats]', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get('/utm-medium-stats', async (req, res) => {
  const { from, to, mode, utm_source } = req.query;
  if (!utm_source) return res.status(400).json({ error: 'utm_source required' });
  try {
    const { rows } = await pool.query(
      `SELECT
         COALESCE(NULLIF(TRIM(l.utm_medium), ''), 'Nomalum') AS utm_medium,
         COUNT(*)::int AS umumiy_lidlar,
         COUNT(*) FILTER (WHERE ${IN_PROGRESS})::int AS jarayonda,
         COUNT(*) FILTER (WHERE s.bitrix_id IN (${STAGE_SIFATLI}))::int AS sifatli_lid,
         COUNT(*) FILTER (WHERE ${TASHRIF_BELGILANDI})::int AS konsultatsiya_belgilandi,
         COUNT(*) FILTER (WHERE ${TASHRIF_OTKAZILDI})::int AS konsultatsiya_otkazildi,
         COUNT(*) FILTER (WHERE s.bitrix_id = 'JUNK')::int                          AS sifatsiz,
         COUNT(*) FILTER (WHERE s.bitrix_id = 'UC_L8G2B9')::int               AS bekor_boldi,
         COUNT(DISTINCT NULLIF(l.utm_campaign, ''))::int AS campaign_count
       FROM leads l
       LEFT JOIN stages s ON s.id = l.stage_id
       WHERE ($1::date IS NULL OR l.date_create::date >= $1::date)
         AND ($2::date IS NULL OR l.date_create::date <= $2::date)
         AND TRIM(l.utm_source) = $3
         AND ${leadScopeCond('l.id')}
         ${leadModeClause(mode)}
       GROUP BY COALESCE(NULLIF(TRIM(l.utm_medium), ''), 'Nomalum')
       ORDER BY umumiy_lidlar DESC`,
      [from || null, to || null, utm_source],
    );
    res.json(rows);
  } catch (err) {
    console.error('[dashboard/utm-medium-stats]', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get('/utm-content-stats', async (req, res) => {
  const { from, to, mode, utm_source, utm_medium, utm_campaign } = req.query;
  if (!utm_source) return res.status(400).json({ error: 'utm_source required' });
  try {
    const { rows } = await pool.query(
      `SELECT
         COALESCE(NULLIF(TRIM(l.utm_content), ''), 'Nomalum') AS utm_content,
         COUNT(*)::int AS umumiy_lidlar,
         COUNT(*) FILTER (WHERE ${IN_PROGRESS})::int AS jarayonda,
         COUNT(*) FILTER (WHERE s.bitrix_id IN (${STAGE_SIFATLI}))::int AS sifatli_lid,
         COUNT(*) FILTER (WHERE ${TASHRIF_BELGILANDI})::int AS konsultatsiya_belgilandi,
         COUNT(*) FILTER (WHERE ${TASHRIF_OTKAZILDI})::int AS konsultatsiya_otkazildi,
         COUNT(*) FILTER (WHERE s.bitrix_id = 'JUNK')::int                          AS sifatsiz,
         COUNT(*) FILTER (WHERE s.bitrix_id = 'UC_L8G2B9')::int               AS bekor_boldi,
         COUNT(DISTINCT l.responsible_id)::int AS responsible_count
       FROM leads l
       LEFT JOIN stages s ON s.id = l.stage_id
       WHERE ($1::date IS NULL OR l.date_create::date >= $1::date)
         AND ($2::date IS NULL OR l.date_create::date <= $2::date)
         AND ($3::text IS NULL OR TRIM(l.utm_source) = $3)
         AND ($4::text IS NULL OR COALESCE(NULLIF(TRIM(l.utm_medium),''),'Nomalum') = $4)
         AND (
           $5::text IS NULL
           OR ($5 = 'Nomalum' AND (l.utm_campaign IS NULL OR l.utm_campaign = ''))
           OR ($5 != 'Nomalum' AND l.utm_campaign = $5)
         )
         AND ${leadScopeCond('l.id')}
         ${leadModeClause(mode)}
       GROUP BY COALESCE(NULLIF(TRIM(l.utm_content), ''), 'Nomalum')
       ORDER BY umumiy_lidlar DESC`,
      [from || null, to || null, utm_source || null, utm_medium || null, utm_campaign || null],
    );
    res.json(rows);
  } catch (err) {
    console.error('[dashboard/utm-content-stats]', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get('/utm-term-stats', async (req, res) => {
  const { from, to, mode, utm_source, utm_medium, utm_campaign, utm_content } = req.query;
  if (!utm_source) return res.status(400).json({ error: 'utm_source required' });
  try {
    const { rows } = await pool.query(
      `SELECT
         COALESCE(NULLIF(TRIM(l.utm_term), ''), 'Nomalum') AS utm_term,
         COUNT(*)::int AS umumiy_lidlar,
         COUNT(*) FILTER (WHERE ${IN_PROGRESS})::int AS jarayonda,
         COUNT(*) FILTER (WHERE s.bitrix_id IN (${STAGE_SIFATLI}))::int AS sifatli_lid,
         COUNT(*) FILTER (WHERE ${TASHRIF_BELGILANDI})::int AS konsultatsiya_belgilandi,
         COUNT(*) FILTER (WHERE ${TASHRIF_OTKAZILDI})::int AS konsultatsiya_otkazildi,
         COUNT(*) FILTER (WHERE s.bitrix_id = 'JUNK')::int                          AS sifatsiz,
         COUNT(*) FILTER (WHERE s.bitrix_id = 'UC_L8G2B9')::int               AS bekor_boldi,
         COUNT(DISTINCT l.responsible_id)::int AS responsible_count
       FROM leads l
       LEFT JOIN stages s ON s.id = l.stage_id
       WHERE ($1::date IS NULL OR l.date_create::date >= $1::date)
         AND ($2::date IS NULL OR l.date_create::date <= $2::date)
         AND ($3::text IS NULL OR TRIM(l.utm_source) = $3)
         AND ($4::text IS NULL OR COALESCE(NULLIF(TRIM(l.utm_medium),''),'Nomalum') = $4)
         AND (
           $5::text IS NULL
           OR ($5 = 'Nomalum' AND (l.utm_campaign IS NULL OR l.utm_campaign = ''))
           OR ($5 != 'Nomalum' AND l.utm_campaign = $5)
         )
         AND (
           $6::text IS NULL
           OR ($6 = 'Nomalum' AND (l.utm_content IS NULL OR l.utm_content = ''))
           OR ($6 != 'Nomalum' AND l.utm_content = $6)
         )
         AND ${leadScopeCond('l.id')}
         ${leadModeClause(mode)}
       GROUP BY COALESCE(NULLIF(TRIM(l.utm_term), ''), 'Nomalum')
       ORDER BY umumiy_lidlar DESC`,
      [from || null, to || null, utm_source || null, utm_medium || null, utm_campaign || null, utm_content || null],
    );
    res.json(rows);
  } catch (err) {
    console.error('[dashboard/utm-term-stats]', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get('/utm-responsible-stats', async (req, res) => {
  const { from, to, mode, utm_source, utm_campaign, utm_medium, utm_content, utm_term } = req.query;
  try {
    const { rows } = await pool.query(
      `SELECT
         COALESCE(TRIM(COALESCE(r.name,'') || ' ' || COALESCE(r.last_name,'')), 'Nomalum') AS full_name,
         l.responsible_id,
         COUNT(*)::int                                                              AS umumiy_lidlar,
         COUNT(*) FILTER (WHERE ${IN_PROGRESS})::int AS jarayonda,
         COUNT(*) FILTER (WHERE s.bitrix_id IN (${STAGE_SIFATLI}))::int AS sifatli_lid,
         COUNT(*) FILTER (WHERE ${TASHRIF_BELGILANDI})::int AS konsultatsiya_belgilandi,
         COUNT(*) FILTER (WHERE ${TASHRIF_OTKAZILDI})::int AS konsultatsiya_otkazildi,
         COUNT(*) FILTER (WHERE s.bitrix_id = 'JUNK')::int                          AS sifatsiz,
         COUNT(*) FILTER (WHERE s.bitrix_id = 'UC_L8G2B9')::int               AS bekor_boldi
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
         AND ($5::text IS NULL OR COALESCE(NULLIF(TRIM(l.utm_medium),''),'Nomalum') = $5)
         AND (
           $6::text IS NULL
           OR ($6 = 'Nomalum' AND (l.utm_content IS NULL OR l.utm_content = ''))
           OR ($6 != 'Nomalum' AND l.utm_content = $6)
         )
         AND (
           $7::text IS NULL
           OR ($7 = 'Nomalum' AND (l.utm_term IS NULL OR l.utm_term = ''))
           OR ($7 != 'Nomalum' AND l.utm_term = $7)
         )
         AND ${leadScopeCond('l.id')}
         ${leadModeClause(mode)}
       GROUP BY l.responsible_id, r.name, r.last_name
       ORDER BY umumiy_lidlar DESC`,
      [from || null, to || null, utm_source || null, utm_campaign || null, utm_medium || null, utm_content || null, utm_term || null],
    );
    res.json(rows);
  } catch (err) {
    console.error('[dashboard/utm-responsible-stats]', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get('/utm-stats', async (req, res) => {
  const { from, to, mode, form_id, proekt } = req.query;
  try {
    const { rows } = await pool.query(
      `SELECT
         TRIM(l.utm_source) AS utm_source,
         COUNT(*)::int                                                              AS umumiy_lidlar,
         COUNT(*) FILTER (WHERE ${IN_PROGRESS})::int AS jarayonda,
         COUNT(*) FILTER (WHERE s.bitrix_id IN (${STAGE_SIFATLI}))::int AS sifatli_lid,
         COUNT(*) FILTER (WHERE ${TASHRIF_BELGILANDI})::int AS konsultatsiya_belgilandi,
         COUNT(*) FILTER (WHERE ${TASHRIF_OTKAZILDI})::int AS konsultatsiya_otkazildi,
         COUNT(*) FILTER (WHERE s.bitrix_id = 'JUNK')::int                          AS sifatsiz,
         COUNT(*) FILTER (WHERE s.bitrix_id = 'UC_L8G2B9')::int               AS bekor_boldi,
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
         AND ${leadProektCond(4, req.query)}
         ${leadModeClause(mode)}
       GROUP BY TRIM(l.utm_source)
       ORDER BY umumiy_lidlar DESC`,
      [from || null, to || null, form_id || null, proekt || null],
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
/**
 * GET /api/dashboard/source-leads
 * The leads behind one row of Manba bo'yicha. `source_id` is the raw Bitrix
 * SOURCE_ID; 'Nomalum' means the field was never set.
 * Params: source_id, from, to, responsible_id, proekt, mode, limit, offset.
 */
router.get('/source-leads', async (req, res) => {
  const { source_id, from, to, responsible_id, proekt, mode } = req.query;
  const limit  = Math.min(5000, parseInt(req.query.limit, 10) || 10);
  const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
  const unknown = !source_id || source_id === 'Nomalum';

  try {
    const { rows } = await pool.query(
      `SELECT l.id, l.title, l.name, l.last_name, l.date_create,
              s.bitrix_id AS stage_bid,
              NULLIF(NULLIF(l.uf_tashrif_sanasi, ''), 'false') AS tashrif_sanasi
       FROM leads l
       JOIN stages s ON s.id = l.stage_id
       WHERE ${leadDateCond(mode, 1, 2)}
         AND ($3::text IS NULL OR l.responsible_id::text = ANY(string_to_array($3, ',')))
         AND ${leadProektCond(4, req.query)}
         AND (${unknown ? 'l.source_id IS NULL' : 'l.source_id = $5::text'})
         ${leadModeClause(mode)}
       ORDER BY l.date_create DESC
       LIMIT ${limit} OFFSET ${offset}`,
      [from || null, to || null, responsible_id || null, proekt || null, ...(unknown ? [] : [source_id])]
    );
    res.json({ items: rows });
  } catch (err) {
    console.error('[dashboard/source-leads]', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get('/source-stats', async (req, res) => {
  const { from, to, responsible_id, proekt, mode } = req.query;
  try {
    const { rows } = await pool.query(
      `SELECT
         COALESCE(l.source_id, 'Nomalum') AS source_id,
         COALESCE(MAX(ls.name), COALESCE(l.source_id, 'Nomalum')) AS source_name,
         COUNT(*)::int AS umumiy_lidlar,
         COUNT(*) FILTER (WHERE ${IN_PROGRESS})::int AS jarayonda,
         COUNT(*) FILTER (WHERE s.bitrix_id IN (${STAGE_SIFATLI}))::int AS sifatli_lid,
         COUNT(*) FILTER (WHERE ${TASHRIF_BELGILANDI})::int AS konsultatsiya_belgilandi,
         COUNT(*) FILTER (WHERE ${TASHRIF_OTKAZILDI})::int AS konsultatsiya_otkazildi,
         COUNT(*) FILTER (WHERE s.bitrix_id = 'JUNK')::int                          AS sifatsiz,
         COUNT(*) FILTER (WHERE s.bitrix_id = 'UC_L8G2B9')::int               AS bekor_boldi
       FROM leads l
       LEFT JOIN stages s ON s.id = l.stage_id
       LEFT JOIN lead_sources ls ON ls.source_id = l.source_id
       -- Was l.date_create::date, i.e. UTC day boundaries, while every other
       -- endpoint converts to Asia/Tashkent first. The two disagreed on which
       -- leads fall in the period, which is why Sifatli lid in this table never
       -- matched the KPI card above it.
       WHERE ${leadDateCond(mode, 1, 2)}
         AND ($3::text IS NULL OR l.responsible_id::text = ANY(string_to_array($3, ',')))
         AND ${leadProektCond(4, req.query)}
         ${leadModeClause(mode)}
       GROUP BY COALESCE(l.source_id, 'Nomalum')
       ORDER BY umumiy_lidlar DESC`,
      [from || null, to || null, responsible_id || null, proekt || null]
    );
    res.json(rows.map(r => ({
      ...r,
      source_name: r.source_name || SOURCE_NAMES[r.source_id] || r.source_id,
    })));
  } catch (err) {
    console.error('[dashboard/source-stats]', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/dashboard/source1-stats — leads grouped by "Источник 1" (Manba 1).
 * GET /api/dashboard/hudud-stats    — leads grouped by "Вилоят" (Hudud).
 * Same funnel columns as /source-stats. Params: from, to, responsible_id, proekt, mode.
 */
router.get('/source1-stats', ufBreakdownHandler(SOURCE1_FIELD));
router.get('/hudud-stats',   ufBreakdownHandler(HUDUD_FIELD, { excludeUnknown: true }));

/**
 * Drill-down leads for one row of /source1-stats or /hudud-stats — same shape
 * as /source-leads. `enum_id` identifies the row; "Nomalum" means no value set.
 */
function ufBreakdownLeadsHandler(fieldCode) {
  return async (req, res) => {
    const { enum_id, from, to, responsible_id, proekt, mode } = req.query;
    const limit  = Math.min(5000, parseInt(req.query.limit, 10) || 10);
    const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
    const unknown = !enum_id || enum_id === 'Nomalum';

    try {
      const { rows } = await pool.query(
        `SELECT l.id, l.title, l.name, l.last_name, l.date_create,
                s.bitrix_id AS stage_bid,
                NULLIF(NULLIF(l.uf_tashrif_sanasi, ''), 'false') AS tashrif_sanasi
         FROM leads l
         JOIN stages s ON s.id = l.stage_id
         WHERE ${leadDateCond(mode, 1, 2)}
           AND ($3::text IS NULL OR l.responsible_id::text = ANY(string_to_array($3, ',')))
           AND ${leadProektCond(4, req.query)}
           AND (${unknown
             ? `l.id NOT IN (SELECT lead_id FROM lead_uf_values WHERE field_code = '${fieldCode}' AND value <> '')`
             : `l.id IN (SELECT lead_id FROM lead_uf_values WHERE field_code = '${fieldCode}' AND value = $5::text)`})
           ${leadModeClause(mode)}
         ORDER BY l.date_create DESC
         LIMIT ${limit} OFFSET ${offset}`,
        [from || null, to || null, responsible_id || null, proekt || null, ...(unknown ? [] : [enum_id])]
      );
      res.json({ items: rows });
    } catch (err) {
      console.error(`[dashboard/uf-breakdown-leads ${fieldCode}]`, err.message);
      res.status(500).json({ error: err.message });
    }
  };
}
router.get('/source1-leads', ufBreakdownLeadsHandler(SOURCE1_FIELD));
router.get('/hudud-leads',   ufBreakdownLeadsHandler(HUDUD_FIELD));

/**
 * GET /api/dashboard/reason-stats / /reason-leads — leads grouped by
 * "Причина" (Sabab), placed under Bekor bo'lish/Sifatsiz sabablari on the
 * page. Same shape as source1/hudud.
 */
router.get('/prichina-stats', ufBreakdownHandler(PRICHINA_FIELD));
router.get('/prichina-leads', ufBreakdownLeadsHandler(PRICHINA_FIELD));

/**
 * GET /api/dashboard/form-stats
 * Leads grouped by web_form_id (direct DB field), joined with crm_forms for name.
 * Params: from, to, responsible_id, mode
 */
router.get('/form-stats', async (req, res) => {
  const { from, to, responsible_id, mode } = req.query;
  try {
    const { rows } = await pool.query(
      `SELECT
         l.web_form_id,
         COALESCE(cf.form_name, 'Noma''lum') AS form_name,
         COUNT(*)::int AS umumiy_lidlar,
         COUNT(*) FILTER (WHERE ${IN_PROGRESS})::int AS jarayonda,
         COUNT(*) FILTER (WHERE s.bitrix_id IN (${STAGE_SIFATLI}))::int AS sifatli_lid,
         COUNT(*) FILTER (WHERE ${TASHRIF_BELGILANDI})::int AS konsultatsiya_belgilandi,
         COUNT(*) FILTER (WHERE ${TASHRIF_OTKAZILDI})::int AS konsultatsiya_otkazildi,
         COUNT(*) FILTER (WHERE s.bitrix_id = 'JUNK')::int                          AS sifatsiz,
         COUNT(*) FILTER (WHERE s.bitrix_id = 'UC_L8G2B9')::int               AS bekor_boldi
       FROM leads l
       LEFT JOIN stages s ON s.id = l.stage_id
       LEFT JOIN crm_forms cf ON cf.form_id = l.web_form_id::text
       WHERE l.web_form_id IS NOT NULL AND TRIM(l.web_form_id::text) != ''
         AND ($1::date IS NULL OR l.date_create::date >= $1::date)
         AND ($2::date IS NULL OR l.date_create::date <= $2::date)
         AND ($3::text IS NULL OR l.responsible_id::text = ANY(string_to_array($3, ',')))
         AND ${leadScopeCond('l.id')}
         ${leadModeClause(mode)}
       GROUP BY l.web_form_id, cf.form_name
       ORDER BY umumiy_lidlar DESC`,
      [from || null, to || null, responsible_id || null]
    );
    res.json(rows);
  } catch (err) {
    console.error('[dashboard/form-stats]', err.message);
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

router.get('/responsible-leads', async (req, res) => {
  const { responsible_id, from, to, proekt, mode } = req.query;
  if (!responsible_id) return res.status(400).json({ error: 'responsible_id required' });

  const params = [parseInt(responsible_id), from || null, to || null, proekt || null];

  try {
    const { rows } = await pool.query(
      `SELECT
         l.id,
         COALESCE(NULLIF(TRIM(COALESCE(l.title,'')), ''),
                  NULLIF(TRIM(COALESCE(l.name,'') || ' ' || COALESCE(l.last_name,'')), ''),
                  'Nomalum') AS title,
         s.bitrix_id AS stage_bid,
         l.date_create::date AS date_create,
         l.opportunity,
         NULLIF(NULLIF(l.uf_tashrif_sanasi, ''), 'false') AS tashrif_sanasi,
         (s.bitrix_id IN ('NEW','IN_PROCESS','PROCESSED','UC_1KPATX','NO_ANSWER',
           'UC_Q2U9EL','CALLBACK','UC_KXC3ZW','THINKING','UC_L28G68','CONSULTATION',
           'UC_5G8244','NOT_TRANSFERRED'))::int                                     AS ne_obrabotinniy,
         (s.bitrix_id = 'NEW')::int                                                AS yangi_lid,
         (s.bitrix_id = 'PROCESSED')::int                                          AS propushenniy,
         (s.bitrix_id IN ('UC_1KPATX','NO_ANSWER'))::int                           AS javob_bermadi,
         (s.bitrix_id IN ('UC_Q2U9EL','CALLBACK'))::int                            AS qayta_aloqa,
         (s.bitrix_id IN ('UC_KXC3ZW','THINKING'))::int                            AS oylab_koradi,
         (s.bitrix_id IN ('UC_L28G68','CONSULTATION'))::int                        AS tashrif_belgilandi,
         (s.bitrix_id IN ('UC_5G8244','NOT_TRANSFERRED'))::int                     AS kelmadi,
         (s.bitrix_id IN ('JUNK','ARCHIVE'))::int                                  AS sandiq,
         (s.bitrix_id = 'JUNK')::int                                               AS sifatsiz,
         (s.bitrix_id = 'UC_L8G2B9')::int                                          AS bekor_boldi,
         (s.bitrix_id IN ('CONVERTED_CONSULT','CONVERTED'))::int                   AS tashrif_buyurdi
       FROM leads l
       JOIN stages s ON s.id = l.stage_id
       WHERE l.responsible_id = $1
         AND ($2::date IS NULL OR l.date_create::date >= $2::date)
         AND ($3::date IS NULL OR l.date_create::date <= $3::date)
         AND ${leadProektCond(4, req.query)}
         ${mode === 'amocrm' ? `AND l.source_id = 'UC_1WUFJB'` : ``}
       ORDER BY l.date_create DESC
       LIMIT 1000`,
      params
    );
    res.json(rows);
  } catch (err) {
    console.error('[dashboard/responsible-leads]', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/dashboard/deals-source-stats?from=&to=&mode=
 * Deal counts grouped by source — umumiy, jarayonda, bekor bo'ldi, sotuv bo'ldi.
 */
router.get('/deals-source-stats', async (req, res) => {
  const { from, to, mode } = req.query;
  try {
    const { rows } = await pool.query(
      `SELECT
         COALESCE(d.source_id, '') AS source_id,
         COUNT(d.id)::int                                                              AS umumiy,
         COUNT(d.id) FILTER (WHERE NOT s.is_won AND NOT s.is_final)::int              AS jarayonda,
         COUNT(d.id) FILTER (WHERE s.is_final AND NOT s.is_won)::int                  AS bekor_boldi,
         COUNT(d.id) FILTER (WHERE s.is_won = true)::int AS sotuv_boldi
       FROM deals d
       JOIN stages s ON s.id = d.stage_id
       WHERE ${dealDateCond(mode, 1, 2)}
         ${dealModeClause(mode)}
       GROUP BY d.source_id
       ORDER BY umumiy DESC`,
      [from || null, to || null]
    );
    const result = rows.map(r => ({
      ...r,
      source_name: r.source_name || SOURCE_NAMES[r.source_id] || r.source_id || 'Manbasiz',
    }));
    res.json(result);
  } catch (err) {
    console.error('[dashboard/deals-source-stats]', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

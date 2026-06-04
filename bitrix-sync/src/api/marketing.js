const { Router } = require('express');
const pool = require('../db/pool');

const router = Router();

// Source classification expression (reusable SQL fragment)
// Returns 'target' | 'instagram' | NULL
const SRC_CASE = `
  CASE
    WHEN LOWER(utm_source) IN ('facebook','fb','meta','facebook_ads','fb_ads','target','target_ads')
         OR source_id = 'UC_O9BLGT' THEN 'target'
    WHEN LOWER(utm_source) IN ('instagram','ig')
         OR source_id = 'UC_3O8GTF' THEN 'instagram'
    ELSE NULL
  END
`;

const MONTH_NUMS = {
  yanvar:1, fevral:2, mart:3, aprel:4, may:5, iyun:6,
  iyul:7, avgust:8, sentabr:9, oktabr:10, noyabr:11, dekabr:12,
};

// Qualified lead stage bitrix_ids
const QUAL_BITRIX_IDS = `'IN_PROCESS','PROCESSED','UC_1KPATX','UC_Q2U9EL','UC_KXC3ZW','UC_L28G68','CONVERTED','CONVERTED_CONSULT','CONSULTATION'`;

// Meeting stage bitrix_ids (Konsultatsiya belgilandi)
const MEETING_BITRIX_IDS = `'UC_L28G68','CONSULTATION'`;

function makeEmpty(days) {
  return Array(days).fill(0);
}

// GET /api/marketing/kunlik?month=iyun&year=2026
router.get('/kunlik', async (req, res) => {
  const monthKey = (req.query.month || '').toLowerCase();
  const year     = parseInt(req.query.year) || new Date().getFullYear();
  const monthNum = MONTH_NUMS[monthKey];
  if (!monthNum) return res.status(400).json({ error: `Unknown month: ${monthKey}` });

  const daysInMonth = new Date(year, monthNum, 0).getDate();
  const since = `${year}-${String(monthNum).padStart(2,'0')}-01 00:00:00`;
  const until = `${year}-${String(monthNum).padStart(2,'0')}-${String(daysInMonth).padStart(2,'0')} 23:59:59`;

  const SRCS = ['target', 'instagram'];
  const METRICS = ['leads','qual_leads','meetings','deals','deals_sum','sales_count','sales_sum','cancelled'];

  const result = {};
  for (const src of SRCS) {
    result[src] = {};
    for (const m of METRICS) result[src][m] = makeEmpty(daysInMonth);
  }

  try {
    // ── 1. All leads by date_create ───────────────────────────
    const leadsRes = await pool.query(`
      SELECT
        EXTRACT(DAY FROM date_create AT TIME ZONE 'Asia/Tashkent')::int AS day,
        (${SRC_CASE}) AS src,
        COUNT(*)::int AS cnt
      FROM leads
      WHERE date_create >= $1 AND date_create <= $2
        AND (${SRC_CASE}) IS NOT NULL
      GROUP BY day, src
    `, [since, until]);

    for (const row of leadsRes.rows) {
      result[row.src].leads[row.day - 1] += row.cnt;
    }

    // ── 2. Qualified leads ────────────────────────────────────
    const qualRes = await pool.query(`
      SELECT
        EXTRACT(DAY FROM l.date_create AT TIME ZONE 'Asia/Tashkent')::int AS day,
        (${SRC_CASE.replace(/utm_source/g,'l.utm_source').replace(/source_id/g,'l.source_id')}) AS src,
        COUNT(*)::int AS cnt
      FROM leads l
      JOIN stages s ON s.id = l.stage_id
        AND s.entity = 'lead'
        AND s.bitrix_id IN (${QUAL_BITRIX_IDS})
      WHERE l.date_create >= $1 AND l.date_create <= $2
        AND (${SRC_CASE.replace(/utm_source/g,'l.utm_source').replace(/source_id/g,'l.source_id')}) IS NOT NULL
      GROUP BY day, src
    `, [since, until]);

    for (const row of qualRes.rows) {
      result[row.src].qual_leads[row.day - 1] += row.cnt;
    }

    // ── 3. Meetings — entries in lead_stage_history for Konsultatsiya stage ─
    const meetingsRes = await pool.query(`
      SELECT
        EXTRACT(DAY FROM h.changed_at AT TIME ZONE 'Asia/Tashkent')::int AS day,
        (
          CASE
            WHEN LOWER(l.utm_source) IN ('facebook','fb','meta','facebook_ads','fb_ads','target','target_ads')
                 OR l.source_id = 'UC_O9BLGT' THEN 'target'
            WHEN LOWER(l.utm_source) IN ('instagram','ig')
                 OR l.source_id = 'UC_3O8GTF' THEN 'instagram'
            ELSE NULL
          END
        ) AS src,
        COUNT(*)::int AS cnt
      FROM lead_stage_history h
      JOIN leads l ON l.id = h.lead_id
      JOIN stages s ON s.id = h.stage_id
        AND s.entity = 'lead'
        AND s.bitrix_id IN (${MEETING_BITRIX_IDS})
      WHERE h.changed_at >= $1 AND h.changed_at <= $2
        AND (
          CASE
            WHEN LOWER(l.utm_source) IN ('facebook','fb','meta','facebook_ads','fb_ads','target','target_ads')
                 OR l.source_id = 'UC_O9BLGT' THEN 'target'
            WHEN LOWER(l.utm_source) IN ('instagram','ig')
                 OR l.source_id = 'UC_3O8GTF' THEN 'instagram'
            ELSE NULL
          END
        ) IS NOT NULL
      GROUP BY day, src
    `, [since, until]);

    for (const row of meetingsRes.rows) {
      result[row.src].meetings[row.day - 1] += row.cnt;
    }

    // ── 4. Deals created (count + sum) ───────────────────────
    const dealsRes = await pool.query(`
      SELECT
        EXTRACT(DAY FROM date_create AT TIME ZONE 'Asia/Tashkent')::int AS day,
        (${SRC_CASE.replace(/utm_source/g,'d.utm_source').replace(/source_id/g,'d.source_id')}) AS src,
        COUNT(*)::int AS cnt,
        COALESCE(SUM(opportunity), 0)::numeric AS total
      FROM deals d
      WHERE date_create >= $1 AND date_create <= $2
        AND (${SRC_CASE.replace(/utm_source/g,'d.utm_source').replace(/source_id/g,'d.source_id')}) IS NOT NULL
      GROUP BY day, src
    `, [since, until]);

    for (const row of dealsRes.rows) {
      result[row.src].deals[row.day - 1]    += row.cnt;
      result[row.src].deals_sum[row.day - 1] += parseFloat(row.total);
    }

    // ── 5. Won deals (sales_count + sales_sum) ───────────────
    const salesRes = await pool.query(`
      SELECT
        EXTRACT(DAY FROM COALESCE(d.uf_sale_date, d.closedate, d.date_create) AT TIME ZONE 'Asia/Tashkent')::int AS day,
        (${SRC_CASE.replace(/utm_source/g,'d.utm_source').replace(/source_id/g,'d.source_id')}) AS src,
        COUNT(*)::int AS cnt,
        COALESCE(SUM(d.opportunity), 0)::numeric AS total
      FROM deals d
      JOIN stages s ON s.id = d.stage_id AND s.is_won = TRUE
      WHERE COALESCE(d.uf_sale_date, d.closedate, d.date_create) >= $1
        AND COALESCE(d.uf_sale_date, d.closedate, d.date_create) <= $2
        AND (${SRC_CASE.replace(/utm_source/g,'d.utm_source').replace(/source_id/g,'d.source_id')}) IS NOT NULL
      GROUP BY day, src
    `, [since, until]);

    for (const row of salesRes.rows) {
      result[row.src].sales_count[row.day - 1] += row.cnt;
      result[row.src].sales_sum[row.day - 1]   += parseFloat(row.total);
    }

    // ── 6. Cancelled deals ───────────────────────────────────
    const cancelRes = await pool.query(`
      SELECT
        EXTRACT(DAY FROM d.date_modify AT TIME ZONE 'Asia/Tashkent')::int AS day,
        (${SRC_CASE.replace(/utm_source/g,'d.utm_source').replace(/source_id/g,'d.source_id')}) AS src,
        COUNT(*)::int AS cnt
      FROM deals d
      JOIN stages s ON s.id = d.stage_id AND s.is_final = TRUE AND s.is_won = FALSE
      WHERE d.date_modify >= $1 AND d.date_modify <= $2
        AND (${SRC_CASE.replace(/utm_source/g,'d.utm_source').replace(/source_id/g,'d.source_id')}) IS NOT NULL
      GROUP BY day, src
    `, [since, until]);

    for (const row of cancelRes.rows) {
      result[row.src].cancelled[row.day - 1] += row.cnt;
    }

    // Round all money values to 2dp
    for (const src of SRCS) {
      result[src].sales_sum  = result[src].sales_sum.map(v => Math.round(v * 100) / 100);
      result[src].deals_sum  = result[src].deals_sum.map(v => Math.round(v * 100) / 100);
    }

    res.json({ month: monthKey, year, data: result });
  } catch (err) {
    console.error('[marketing/kunlik]', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

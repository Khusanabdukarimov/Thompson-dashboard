const { Router } = require('express');
const pool = require('../db/pool');

const router = Router();

const MONTH_NUMS = {
  yanvar:1, fevral:2, mart:3, aprel:4, may:5, iyun:6,
  iyul:7, avgust:8, sentabr:9, oktabr:10, noyabr:11, dekabr:12,
};

// Qualifying lead stage bitrix_ids
const QUAL_STAGES = [
  'IN_PROCESS','PROCESSED','UC_1KPATX','UC_Q2U9EL','UC_KXC3ZW',
  'UC_L28G68','CONVERTED','CONVERTED_CONSULT','CONSULTATION',
  'CALLBACK','THINKING','NO_ANSWER',
];
const QUAL_LIST = QUAL_STAGES.map(s => `'${s}'`).join(',');

// Meeting (Konsultatsiya) stage bitrix_ids
const MEETING_STAGES = ['UC_L28G68','CONSULTATION'];
const MEETING_LIST   = MEETING_STAGES.map(s => `'${s}'`).join(',');

// Normalize phone → last 9 digits (handles +998XXXXXXXXX, 0XXXXXXXXX, local)
const PHONE_NORM = `RIGHT(REGEXP_REPLACE({col}, '[^0-9]', '', 'g'), 9)`;

function normExpr(col) { return PHONE_NORM.replace('{col}', col); }

function makeEmpty(n) { return Array(n).fill(0); }

// Platform detection from adset/campaign name:
//   adset contains " I/" or starts with "I/" → instagram
//   otherwise → target
const PLATFORM_CASE = `
  CASE
    WHEN adset_name ~ '(^|\\s|-)I/'
      OR LOWER(adset_name) LIKE '%instagram%'
      OR LOWER(campaign_name) LIKE '%instagram%'
    THEN 'instagram'
    ELSE 'target'
  END
`;

// GET /api/marketing/kunlik?month=iyun&year=2026
router.get('/kunlik', async (req, res) => {
  const monthKey = (req.query.month || '').toLowerCase();
  const year     = parseInt(req.query.year) || new Date().getFullYear();
  const monthNum = MONTH_NUMS[monthKey];
  if (!monthNum) return res.status(400).json({ error: `Unknown month: ${monthKey}` });

  const daysInMonth = new Date(year, monthNum, 0).getDate();
  const since = `${year}-${String(monthNum).padStart(2,'0')}-01 00:00:00`;
  const until = `${year}-${String(monthNum).padStart(2,'0')}-${String(daysInMonth).padStart(2,'0')} 23:59:59`;

  const SRCS    = ['target', 'instagram'];
  const METRICS = ['leads','qual_leads','meetings','deals','deals_sum','sales_count','sales_sum','cancelled'];

  const result = {};
  for (const src of SRCS) {
    result[src] = {};
    for (const m of METRICS) result[src][m] = makeEmpty(daysInMonth);
  }

  try {
    // ── 1. facebook_leads: count ALL submissions per day+platform ─
    //    Lidlar soni = total facebook form submissions
    const fbLeadsRes = await pool.query(`
      SELECT
        EXTRACT(DAY FROM created_time AT TIME ZONE 'Asia/Tashkent')::int AS day,
        (${PLATFORM_CASE}) AS src,
        COUNT(*)::int AS cnt
      FROM facebook_leads
      WHERE created_time >= $1 AND created_time <= $2
      GROUP BY day, src
    `, [since, until]);

    for (const row of fbLeadsRes.rows) {
      if (row.day >= 1 && row.day <= daysInMonth) {
        result[row.src].leads[row.day - 1] += row.cnt;
      }
    }

    // ── 2. Match facebook_leads → Bitrix leads by phone ──────────
    //    Used for: qual_leads, meetings (from stage history), cancelled
    const fbLeadMatchRes = await pool.query(`
      WITH fb AS (
        SELECT
          fl.id,
          EXTRACT(DAY FROM fl.created_time AT TIME ZONE 'Asia/Tashkent')::int AS day,
          (${PLATFORM_CASE.replace(/adset_name/g,'fl.adset_name').replace(/campaign_name/g,'fl.campaign_name')}) AS src,
          ${normExpr('COALESCE(fl.phone,\'\')')} AS phone_norm
        FROM facebook_leads fl
        WHERE fl.created_time >= $1 AND fl.created_time <= $2
          AND LENGTH(REGEXP_REPLACE(COALESCE(fl.phone,''), '[^0-9]', '', 'g')) >= 7
      )
      SELECT DISTINCT ON (f.id)
        f.id      AS fb_id,
        f.day,
        f.src,
        l.id      AS lead_id,
        s.bitrix_id AS stage_bitrix_id,
        s.is_final,
        s.is_won
      FROM fb f
      JOIN lead_phones lp
        ON ${normExpr('lp.phone')} = f.phone_norm
      JOIN leads l ON l.id = lp.lead_id
      LEFT JOIN stages s ON s.id = l.stage_id AND s.entity = 'lead'
      ORDER BY f.id, l.date_create DESC
    `, [since, until]);

    for (const row of fbLeadMatchRes.rows) {
      if (!row.day || row.day < 1 || row.day > daysInMonth) continue;
      const i   = row.day - 1;
      const src = row.src;

      if (QUAL_STAGES.includes(row.stage_bitrix_id)) {
        result[src].qual_leads[i]++;
      }
      if (row.is_final && !row.is_won) {
        result[src].cancelled[i]++;
      }
    }

    // ── 3. Deal-based metrics: direct query from deals table ─────
    //    meetings    = Uchrashuvlar soni  = deals in NEW stage (Uchrashuv o'tkazildi)
    //    deals       = Kelishuv bo'ldi    = deals in UC_W35V62 stage
    //    deals_sum   = Kelishuv summasi   = opportunity sum for UC_W35V62 deals
    //    sales_count = Sotuvlar soni      = won deals (is_won)
    //    sales_sum   = Sotuvlar summasi   = opportunity sum for won deals
    //    cancelled   = Bekor bo'ldi       = is_final AND NOT is_won deals
    //
    //    Source classification by deal.source_id:
    //      target    = UC_O9BLGT (Facebook/Target ads)
    //      instagram = UC_3O8GTF | UC_89FPH6 (Instagram)
    const dealMetricsRes = await pool.query(`
      SELECT
        EXTRACT(DAY FROM d.date_create AT TIME ZONE 'Asia/Tashkent')::int AS day,
        CASE
          WHEN d.source_id IN ('UC_O9BLGT') THEN 'target'
          WHEN d.source_id IN ('UC_3O8GTF','UC_89FPH6') THEN 'instagram'
          ELSE NULL
        END AS src,
        s.bitrix_id AS stage_bid,
        s.is_won,
        s.is_final,
        COALESCE(d.opportunity, 0)::numeric AS opp
      FROM deals d
      LEFT JOIN stages s ON s.id = d.stage_id AND s.entity = 'deal'
      WHERE d.date_create >= $1 AND d.date_create <= $2
        AND CASE
              WHEN d.source_id IN ('UC_O9BLGT') THEN 'target'
              WHEN d.source_id IN ('UC_3O8GTF','UC_89FPH6') THEN 'instagram'
              ELSE NULL
            END IS NOT NULL
    `, [since, until]);

    for (const row of dealMetricsRes.rows) {
      if (!row.day || row.day < 1 || row.day > daysInMonth) continue;
      const i   = row.day - 1;
      const src = row.src;
      const opp = parseFloat(row.opp) || 0;

      // Uchrashuvlar soni = deals in NEW stage (Uchrashuv o'tkazildi)
      if (row.stage_bid === 'NEW') {
        result[src].meetings[i]++;
      }

      // Kelishuv bo'ldi = deals in UC_W35V62 (Kelishuv bo'ldi) stage
      if (row.stage_bid === 'UC_W35V62') {
        result[src].deals[i]++;
        result[src].deals_sum[i] = Math.round((result[src].deals_sum[i] + opp) * 100) / 100;
      }

      // Bekor bo'ldi = final + not won
      if (row.is_final && !row.is_won) {
        result[src].cancelled[i]++;
      }
    }

    // ── 4. Sales metrics: by uf_bp_sale_date (actual payment date) ──
    //    Filter by FB/IG source_ids. UC_O9BLGT → target unless utm_source = ig/instagram
    //    (meaning the target ad ran on instagram placement → goes to instagram section).
    //    UC_3O8GTF + UC_89FPH6 always → instagram.
    const salesRes = await pool.query(`
      SELECT
        EXTRACT(DAY FROM d.uf_bp_sale_date AT TIME ZONE 'Asia/Tashkent')::int AS day,
        CASE
          WHEN d.source_id = 'UC_O9BLGT'
            AND LOWER(TRIM(d.utm_source)) IN ('instagram','ig') THEN 'instagram'
          WHEN d.source_id = 'UC_O9BLGT' THEN 'target'
          WHEN d.source_id IN ('UC_3O8GTF','UC_89FPH6') THEN 'instagram'
          ELSE NULL
        END AS src,
        COUNT(*)::int AS cnt,
        COALESCE(SUM(d.uf_paid_sum), 0)::numeric AS paid_sum
      FROM deals d
      WHERE d.uf_bp_sale_date IS NOT NULL
        AND d.uf_bp_sale_date >= $1
        AND d.uf_bp_sale_date <= $2
        AND d.source_id IN ('UC_O9BLGT','UC_3O8GTF','UC_89FPH6')
      GROUP BY day, src
    `, [since, until]);

    for (const row of salesRes.rows) {
      if (!row.day || row.day < 1 || row.day > daysInMonth) continue;
      const i   = row.day - 1;
      const src = row.src;
      result[src].sales_count[i] += row.cnt;
      result[src].sales_sum[i]    = Math.round((result[src].sales_sum[i] + parseFloat(row.paid_sum)) * 100) / 100;
    }

    res.json({ month: monthKey, year, data: result });
  } catch (err) {
    console.error('[marketing/kunlik]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Schema ────────────────────────────────────────────────────────
async function ensureSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS kunlik_plans (
      id         SERIAL PRIMARY KEY,
      section    TEXT NOT NULL,
      metric_key TEXT NOT NULL,
      month      INTEGER NOT NULL,
      year       INTEGER NOT NULL,
      plan_value NUMERIC(15,2) NOT NULL DEFAULT 0,
      UNIQUE(section, metric_key, month, year)
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS kunlik_overrides (
      id         SERIAL PRIMARY KEY,
      section    TEXT NOT NULL,
      metric_key TEXT NOT NULL,
      month      INTEGER NOT NULL,
      year       INTEGER NOT NULL,
      day        INTEGER NOT NULL,
      value      NUMERIC(15,2) NOT NULL,
      UNIQUE(section, metric_key, month, year, day)
    )
  `);
}
ensureSchema().catch(e => console.error('[marketing] schema error:', e.message));

// GET /api/marketing/kunlik-meta?month=iyun&year=2026
// Returns plans + overrides for both sections
router.get('/kunlik-meta', async (req, res) => {
  const monthKey = (req.query.month || '').toLowerCase();
  const year     = parseInt(req.query.year) || new Date().getFullYear();
  const monthNum = MONTH_NUMS[monthKey];
  if (!monthNum) return res.status(400).json({ error: `Unknown month: ${monthKey}` });

  try {
    const plansRes = await pool.query(
      'SELECT section, metric_key, plan_value FROM kunlik_plans WHERE month=$1 AND year=$2',
      [monthNum, year]
    );
    const overRes  = await pool.query(
      'SELECT section, metric_key, day, value FROM kunlik_overrides WHERE month=$1 AND year=$2',
      [monthNum, year]
    );

    // Structure: { target: { budget: 1500, leads: 550, ... }, instagram: {...} }
    const plans = { target: {}, instagram: {} };
    for (const r of plansRes.rows) plans[r.section][r.metric_key] = parseFloat(r.plan_value);

    // Structure: { target: { budget: { 1: 51, 2: 63 }, ... }, instagram: {...} }
    const overrides = { target: {}, instagram: {} };
    for (const r of overRes.rows) {
      if (!overrides[r.section][r.metric_key]) overrides[r.section][r.metric_key] = {};
      overrides[r.section][r.metric_key][r.day] = parseFloat(r.value);
    }

    res.json({ month: monthKey, year, plans, overrides });
  } catch (err) {
    console.error('[marketing/kunlik-meta GET]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/marketing/kunlik-plan
// Body: { section, metric_key, month, year, value }
router.put('/kunlik-plan', async (req, res) => {
  const { section, metric_key, month, year, value } = req.body;
  const monthNum = MONTH_NUMS[(month || '').toLowerCase()];
  if (!monthNum || !section || !metric_key)
    return res.status(400).json({ error: 'section, metric_key, month, year, value required' });

  try {
    await pool.query(`
      INSERT INTO kunlik_plans (section, metric_key, month, year, plan_value)
      VALUES ($1,$2,$3,$4,$5)
      ON CONFLICT (section, metric_key, month, year)
      DO UPDATE SET plan_value = EXCLUDED.plan_value
    `, [section, metric_key, monthNum, year, parseFloat(value) || 0]);
    res.json({ ok: true });
  } catch (err) {
    console.error('[marketing/kunlik-plan PUT]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/marketing/kunlik-override
// Body: { section, metric_key, month, year, day, value }
router.put('/kunlik-override', async (req, res) => {
  const { section, metric_key, month, year, day, value } = req.body;
  const monthNum = MONTH_NUMS[(month || '').toLowerCase()];
  if (!monthNum || !section || !metric_key || !day)
    return res.status(400).json({ error: 'section, metric_key, month, year, day, value required' });

  try {
    if (value === null || value === '' || value === undefined) {
      // Delete override (revert to auto)
      await pool.query(
        'DELETE FROM kunlik_overrides WHERE section=$1 AND metric_key=$2 AND month=$3 AND year=$4 AND day=$5',
        [section, metric_key, monthNum, year, day]
      );
    } else {
      await pool.query(`
        INSERT INTO kunlik_overrides (section, metric_key, month, year, day, value)
        VALUES ($1,$2,$3,$4,$5,$6)
        ON CONFLICT (section, metric_key, month, year, day)
        DO UPDATE SET value = EXCLUDED.value
      `, [section, metric_key, monthNum, year, day, parseFloat(value) || 0]);
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('[marketing/kunlik-override PUT]', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

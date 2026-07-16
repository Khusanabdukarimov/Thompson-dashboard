const { Router } = require('express');
const pool = require('../db/pool');
const { computeCallStatsFull } = require('../services/callStats');

const router = Router();

const fail = (res, tag) => (err) => {
  console.error(`[calls/${tag}] ${err.message}`);
  res.status(500).json({ error: err.message });
};

/** "2026-07-15" + n days → "2026-07-16" (UTC, date-only). */
function addDaysISO(iso, days) {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Shared filter: $1 from · $2 to · $3 operator_ext · $4 direction.
// from/to are dates in Asia/Tashkent; the pool sets that session TZ so the
// ::date cast on a timestamptz lands on the right local day.
const CALL_WHERE = `
      ($1::date IS NULL OR c.start_stamp::date >= $1::date)
  AND ($2::date IS NULL OR c.start_stamp::date <= $2::date)
  AND ($3::text IS NULL OR c.operator_ext = ANY(string_to_array($3, ',')))
  AND ($4::text IS NULL OR c.direction    = ANY(string_to_array($4, ',')))`;

const params = (q) => [q.from || null, q.to || null, q.operator_ext || null, q.direction || null];

// ── Per-operator call scorecard ─────────────────────────────────
/**
 * GET /call-stats — one row per PBX extension.
 * answered = a live conversation (talk_time > 0). missed_inbound = a customer
 * call nobody talked to — the call-backs owed.
 */
router.get('/call-stats', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `WITH fc AS (SELECT c.* FROM pbx_calls c WHERE ${CALL_WHERE})
       SELECT u.ext                                                          AS operator_ext,
              u.name                                                         AS full_name,
              COUNT(fc.uuid)::int                                            AS total_calls,
              COUNT(*) FILTER (WHERE fc.direction = 'inbound')::int          AS inbound_calls,
              COUNT(*) FILTER (WHERE fc.direction = 'outbound')::int         AS outbound_calls,
              COUNT(*) FILTER (WHERE fc.direction = 'local')::int            AS local_calls,
              COUNT(*) FILTER (WHERE fc.answered)::int                       AS answered_calls,
              COUNT(*) FILTER (WHERE NOT fc.answered)::int                   AS unanswered_calls,
              COALESCE(SUM(fc.talk_time), 0)::int                            AS total_talk,
              COALESCE(ROUND(AVG(fc.talk_time) FILTER (WHERE fc.answered)), 0)::int AS avg_talk,
              COUNT(DISTINCT fc.customer_norm)::int                          AS unique_customers
       FROM pbx_users u
       LEFT JOIN fc ON fc.operator_ext = u.ext
       GROUP BY u.ext, u.name
       ORDER BY total_calls DESC`,
      params(req.query),
    );
    res.json(rows);
  } catch (err) {
    fail(res, 'call-stats')(err);
  }
});

// ── Headline totals ─────────────────────────────────────────────
/** GET /call-global-stats — the KPI row above the per-operator table. */
router.get('/call-global-stats', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `WITH fc AS (SELECT c.* FROM pbx_calls c WHERE ${CALL_WHERE})
       SELECT COUNT(*)::int                                            AS total_calls,
              COUNT(*) FILTER (WHERE direction = 'inbound')::int        AS inbound_calls,
              COUNT(*) FILTER (WHERE direction = 'outbound')::int       AS outbound_calls,
              COUNT(*) FILTER (WHERE direction = 'local')::int          AS local_calls,
              COUNT(*) FILTER (WHERE answered)::int                     AS answered_calls,
              COUNT(*) FILTER (WHERE direction = 'inbound' AND NOT answered)::int AS missed_inbound,
              ROUND(COUNT(*) FILTER (WHERE answered)::numeric
                    / NULLIF(COUNT(*), 0) * 100, 1)                     AS answered_pct,
              -- share of inbound the team actually picked up
              ROUND(COUNT(*) FILTER (WHERE direction = 'inbound' AND answered)::numeric
                    / NULLIF(COUNT(*) FILTER (WHERE direction = 'inbound'), 0) * 100, 1) AS inbound_answered_pct,
              COALESCE(SUM(talk_time), 0)::int                          AS total_talk,
              COALESCE(ROUND(AVG(talk_time) FILTER (WHERE answered)), 0)::int AS avg_talk
       FROM fc`,
      params(req.query),
    );
    res.json(rows[0] || {});
  } catch (err) {
    fail(res, 'call-global-stats')(err);
  }
});

// ── Missed inbound needing a call-back ──────────────────────────
/**
 * GET /call-missed — inbound calls nobody answered, de-duplicated to the latest
 * per customer, minus customers who were later reached. This is the "ne
 * perezvonili" list: who still needs calling back.
 */
router.get('/call-missed', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `WITH fc AS (SELECT c.* FROM pbx_calls c WHERE ${CALL_WHERE}),
       missed AS (
         SELECT DISTINCT ON (customer_norm)
                customer_norm, customer_number, start_stamp, uuid
         FROM fc
         WHERE direction = 'inbound' AND NOT answered AND customer_norm IS NOT NULL
         ORDER BY customer_norm, start_stamp DESC
       )
       SELECT m.customer_number,
              m.customer_norm,
              m.start_stamp AS last_missed_at,
              -- was this customer ever reached (in or out) in the window?
              EXISTS (
                SELECT 1 FROM fc r
                WHERE r.customer_norm = m.customer_norm AND r.answered
              ) AS later_reached
       FROM missed m
       ORDER BY m.start_stamp DESC`,
      params(req.query),
    );
    const pending = rows.filter((r) => !r.later_reached);
    res.json({ total_missed_customers: rows.length, pending_callback: pending.length, items: rows });
  } catch (err) {
    fail(res, 'call-missed')(err);
  }
});

// ══════════════════════════════════════════════════════════════════
// Frontend-facing endpoints (CallStatistikasi.tsx)
//
// These match the reference project's contract exactly so the existing page
// renders unchanged. Its filters use `responsible_id` and `from`/`to`; here a
// "responsible" IS a PBX extension, so responsible_id == the extension number.
// ══════════════════════════════════════════════════════════════════

// The page sends: from, to, responsible_id (=ext), phone, call_kind, status,
// duration_from, duration_to. source/stage are Bitrix concepts with no OnlinePBX
// analogue and are accepted-but-ignored.
function fullFilterWhere() {
  return `
        ($1::date IS NULL OR (c.start_stamp AT TIME ZONE 'Asia/Tashkent')::date >= $1::date)
    AND ($3::date IS NULL OR (c.start_stamp AT TIME ZONE 'Asia/Tashkent')::date <= $3::date)
    AND c.start_stamp IS NOT NULL`;
}

/**
 * GET /call-stats-full — the whole CallStatistikasi payload (PyCallStatsResult).
 *
 * Rows are pulled for [from, to+1 day] with an `in_range` flag: the extra day
 * lets a call missed on the last day still find a next-day callback, while only
 * in-range rows are counted. All metric logic lives in services/callStats.js.
 */
router.get('/call-stats-full', async (req, res) => {
  const from = req.query.from || null;
  const to = req.query.to || null;
  const respId = req.query.responsible_id ? String(req.query.responsible_id) : null;
  const phone = req.query.phone ? String(req.query.phone).replace(/\D/g, '') : null;
  const stage = req.query.stage && req.query.stage !== 'all' ? String(req.query.stage) : null;

  try {
    const { rows } = await pool.query(
      `SELECT c.uuid,
              CASE WHEN c.operator_ext ~ '^[0-9]+$' THEN c.operator_ext::int ELSE NULL END AS responsible_id,
              u.name AS full_name,
              c.direction, c.customer_norm, c.customer_number,
              c.start_stamp, c.duration, c.talk_time AS talk, c.answered,
              (
                ($1::date IS NULL OR (c.start_stamp AT TIME ZONE 'Asia/Tashkent')::date >= $1::date)
                AND ($2::date IS NULL OR (c.start_stamp AT TIME ZONE 'Asia/Tashkent')::date <= $2::date)
              ) AS in_range
       FROM pbx_calls c
       LEFT JOIN pbx_users u ON u.ext = c.operator_ext
       WHERE c.start_stamp IS NOT NULL
         AND ($1::date IS NULL OR (c.start_stamp AT TIME ZONE 'Asia/Tashkent')::date >= $1::date)
         -- $3 = to + 1 day, the callback look-ahead
         AND ($3::date IS NULL OR (c.start_stamp AT TIME ZONE 'Asia/Tashkent')::date <= $3::date)
         AND ($4::text IS NULL OR c.customer_norm LIKE '%' || $4 || '%')
         -- Bosqich filter: keep calls whose newest same-phone lead is in $5.
         AND ($5::text IS NULL OR $5::text = (
           SELECT s.bitrix_id
           FROM lead_phones lp
           JOIN leads l ON l.id = lp.lead_id
           LEFT JOIN stages s ON s.id = l.stage_id
           WHERE RIGHT(regexp_replace(lp.phone, '\\D', '', 'g'), 9) = c.customer_norm
           ORDER BY l.date_create DESC NULLS LAST
           LIMIT 1
         ))
       ORDER BY c.start_stamp DESC`,
      [from, to, to ? addDaysISO(to, 1) : null, phone, stage],
    );
    // Operator filter is applied inside the compute (not in SQL) so the callback
    // map stays global — a colleague's callback to the same customer still counts.
    res.json(computeCallStatsFull(rows, from || '', to || '', respId ? Number(respId) : null));
  } catch (err) {
    fail(res, 'call-stats-full')(err);
  }
});

/**
 * GET /call-list — the per-operator drill-down (CallListRow[]).
 * Returns a bare array, matching the reference contract.
 */
router.get('/call-list', async (req, res) => {
  const from = req.query.from || null;
  const to = req.query.to || null;
  const respId = req.query.responsible_id ? String(req.query.responsible_id) : null;
  const phone = req.query.phone ? String(req.query.phone).replace(/\D/g, '') : null;
  const kind = req.query.call_kind || null; // inbound|outbound|callback
  const stage = req.query.stage && req.query.stage !== 'all' ? String(req.query.stage) : null;

  try {
    const { rows } = await pool.query(
      `SELECT c.uuid AS id,
              c.customer_number AS phone_number,
              CASE c.direction WHEN 'outbound' THEN 1 WHEN 'inbound' THEN 2 ELSE NULL END AS call_type,
              c.duration,
              c.start_stamp AS call_start,
              CASE WHEN c.answered THEN 200 ELSE NULL END AS status_code,
              c.hangup_cause AS status_name,
              ld.lead_id,
              CASE WHEN ld.lead_id IS NOT NULL THEN 'lead' END AS crm_entity_type,
              ld.lead_title,
              ld.stage_name,
              ld.stage_bitrix_id
       FROM pbx_calls c
       -- Lead match by phone, entirely in Postgres (no Bitrix round-trips):
       -- lead_phones is normalised to the same last-9-digits form as
       -- customer_norm. Newest lead wins when a number has several.
       LEFT JOIN LATERAL (
         SELECT l.id AS lead_id, l.title AS lead_title,
                s.name AS stage_name, s.bitrix_id AS stage_bitrix_id
         FROM lead_phones lp
         JOIN leads l ON l.id = lp.lead_id
         LEFT JOIN stages s ON s.id = l.stage_id
         WHERE RIGHT(regexp_replace(lp.phone, '\\D', '', 'g'), 9) = c.customer_norm
         ORDER BY l.date_create DESC NULLS LAST
         LIMIT 1
       ) ld ON c.customer_norm IS NOT NULL
       WHERE c.start_stamp IS NOT NULL
         AND c.direction <> 'local'
         AND ($1::date IS NULL OR (c.start_stamp AT TIME ZONE 'Asia/Tashkent')::date >= $1::date)
         AND ($2::date IS NULL OR (c.start_stamp AT TIME ZONE 'Asia/Tashkent')::date <= $2::date)
         AND ($3::int  IS NULL OR (c.operator_ext ~ '^[0-9]+$' AND c.operator_ext::int = $3::int))
         AND ($4::text IS NULL OR c.customer_norm LIKE '%' || $4 || '%')
         AND ($5::text IS NULL OR c.direction = $5::text)
         AND ($6::text IS NULL OR ld.stage_bitrix_id = $6::text)
       ORDER BY c.start_stamp DESC
       LIMIT 1000`,
      [from, to, respId, phone, kind === 'inbound' || kind === 'outbound' ? kind : null, stage],
    );
    res.json(rows);
  } catch (err) {
    fail(res, 'call-list')(err);
  }
});

// ── Daily volume, for a trend chart ─────────────────────────────
/** GET /call-daily — calls per local day, split by direction and answered. */
router.get('/call-daily', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `WITH fc AS (SELECT c.* FROM pbx_calls c WHERE ${CALL_WHERE})
       SELECT start_stamp::date                                       AS day,
              COUNT(*)::int                                            AS total,
              COUNT(*) FILTER (WHERE direction = 'inbound')::int       AS inbound,
              COUNT(*) FILTER (WHERE direction = 'outbound')::int      AS outbound,
              COUNT(*) FILTER (WHERE answered)::int                    AS answered,
              COUNT(*) FILTER (WHERE direction = 'inbound' AND NOT answered)::int AS missed_inbound
       FROM fc
       WHERE start_stamp IS NOT NULL
       GROUP BY start_stamp::date
       ORDER BY day`,
      params(req.query),
    );
    res.json(rows);
  } catch (err) {
    fail(res, 'call-daily')(err);
  }
});

// ── Filter options + ops ────────────────────────────────────────
/**
 * GET /call-filter-options — reference shape { responsibles, sources }.
 * A "responsible" is a PBX extension (id = ext number). Only extensions that
 * actually placed/took a call are offered.
 */
router.get('/call-filter-options', async (_req, res) => {
  try {
    const [ops, stages] = await Promise.all([
      pool.query(
        `SELECT DISTINCT (u.ext)::int AS id, u.name AS full_name
         FROM pbx_users u
         JOIN pbx_calls c ON c.operator_ext = u.ext
         WHERE u.ext ~ '^[0-9]+$'
         ORDER BY full_name`,
      ),
      // Lead stages as they exist on the portal right now — the Bosqich filter
      // matches against the lead each call resolves to by phone.
      pool.query(
        `SELECT bitrix_id, name FROM stages WHERE entity = 'lead' ORDER BY sort_order`,
      ),
    ]);
    res.json({
      responsibles: ops.rows,
      sources: [{ id: 'onlinepbx', name: 'OnlinePBX' }],
      stages: stages.rows,
    });
  } catch (err) {
    fail(res, 'call-filter-options')(err);
  }
});

/** POST /sync-calls — pull the last `hours` (default 24) on demand. */
router.post('/sync-calls', async (req, res) => {
  const hours = parseInt(req.body?.hours || req.query.hours, 10) || 24;
  try {
    const { syncRecentCalls } = require('../sync/syncCalls');
    const result = await syncRecentCalls(hours);
    res.json({ ok: true, hours, ...result });
  } catch (err) {
    fail(res, 'sync-calls')(err);
  }
});

module.exports = router;

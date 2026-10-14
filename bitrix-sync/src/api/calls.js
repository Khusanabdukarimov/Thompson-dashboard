const { Router } = require('express');
const pool = require('../db/pool');
const { computeCallStatsFull } = require('../services/callStats');
const { teamOf } = require('../config/calls');

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

// Internal = extension ↔ extension (101 → 100). The PBX tags most of them 'local',
// but some arrive as inbound/outbound with an extension on BOTH sides (e.g. 100 → 100),
// so direction alone is not enough. Needs INTERNAL_JOINS on the query.
const INTERNAL_JOINS = `
       LEFT JOIN pbx_users ia ON ia.ext = c.caller_number
       LEFT JOIN pbx_users ib ON ib.ext = c.destination_number`;
const IS_INTERNAL = `(c.direction = 'local' OR (ia.ext IS NOT NULL AND ib.ext IS NOT NULL))`;

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
 * What the call page's numbers are computed from, shared by /call-stats-full and
 * /call-not-recalled so that the card and the list behind it can not drift apart.
 *
 * PBX rows are pulled for [from, to+1 day] with an `in_range` flag: the extra day
 * lets a call missed on the last day still find a next-day callback, while only
 * in-range rows are counted. All metric logic lives in services/callStats.js.
 */
const INPUTS_TTL_MS = 90_000;      // the data is only as fresh as the 10-min sync anyway
const INPUTS_MAX_KEYS = 6;
const INPUTS_MAX_ROWS = 80_000;    // a year-wide range is not worth holding in memory
const inputsCache = new Map();     // key -> { at, promise }

/** One or several operators ("12,14,100"); blanks are dropped BEFORE Number() (Number('') is 0 = "operator 0"). */
function parseRespIds(query) {
  return String(query.responsible_id || '').split(',').map((x) => x.trim()).filter(Boolean)
    .map(Number).filter((n) => Number.isInteger(n));
}

/**
 * loadCallInputs with a short-lived cache. The page asks for the stats, a moment later
 * for the "Ne perezvonili" list, then for each further page of it — all with the same
 * filters — and the slow part is reading the PBX rows (~2-7 s for a month). So they are
 * read once and reused. Operators are not part of the key: they filter inside the compute.
 * Callers must treat the returned rows / events as read-only.
 */
async function loadCallInputs(query) {
  const from = query.from || null;
  const to = query.to || null;
  const respIds = parseRespIds(query);
  const phone = query.phone ? String(query.phone).replace(/\D/g, '') : null;
  const source = query.source && query.source !== 'all' ? String(query.source) : null;
  const stage = query.stage && query.stage !== 'all' ? String(query.stage) : null;
  const key = JSON.stringify([from, to, phone, source, stage]);

  const hit = inputsCache.get(key);
  if (hit && Date.now() - hit.at < INPUTS_TTL_MS) return { ...(await hit.promise), respIds };

  const promise = readCallInputs({ from, to, phone, source, stage });
  inputsCache.set(key, { at: Date.now(), promise });
  while (inputsCache.size > INPUTS_MAX_KEYS) inputsCache.delete(inputsCache.keys().next().value);
  try {
    const inputs = await promise;
    if (inputs.rows.length > INPUTS_MAX_ROWS) inputsCache.delete(key);
    return { ...inputs, respIds };
  } catch (err) {
    inputsCache.delete(key);            // never cache a failure
    throw err;
  }
}

async function readCallInputs({ from, to, phone, source, stage }) {
  const { rows } = await pool.query(
    `SELECT c.uuid,
            COALESCE(u.responsible_id, CASE WHEN c.operator_ext ~ '^[0-9]+$' THEN c.operator_ext::int ELSE NULL END) AS responsible_id,
            c.operator_ext, c.hangup_cause,
            COALESCE(u.name, u.ext) AS full_name,
            c.direction, c.customer_norm, c.customer_number,
            c.start_stamp, c.duration, c.talk_time AS talk, c.answered,
            ${IS_INTERNAL} AS internal,
            (
              ($1::date IS NULL OR (c.start_stamp AT TIME ZONE 'Asia/Tashkent')::date >= $1::date)
              AND ($2::date IS NULL OR (c.start_stamp AT TIME ZONE 'Asia/Tashkent')::date <= $2::date)
            ) AS in_range
     FROM pbx_calls c
     LEFT JOIN pbx_users u ON u.ext = c.operator_ext${INTERNAL_JOINS}
     WHERE c.start_stamp IS NOT NULL
       AND ($1::date IS NULL OR (c.start_stamp AT TIME ZONE 'Asia/Tashkent')::date >= $1::date)
       -- $3 = to + 1 day, the callback look-ahead
       AND ($3::date IS NULL OR (c.start_stamp AT TIME ZONE 'Asia/Tashkent')::date <= $3::date)
       AND ($4::text IS NULL OR c.customer_norm LIKE '%' || $4 || '%')
       AND ($6::text IS NULL OR (CASE WHEN c.uuid LIKE 'moizvonki:%' THEN 'moizvonki' ELSE 'onlinepbx' END) = $6::text)
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
    [from, to, to ? addDaysISO(to, 1) : null, phone, stage, source],
  );
  // Whose missed call is it? Bitrix24 knows (the CRM entity's responsible); the PBX does
  // not — a queue call that rang out has no operator. Moizvonki calls are not in Bitrix's
  // list, so that source keeps the PBX's own figures, as does any failure to read the table.
  let bxMissed = null;
  if (source !== 'moizvonki') {
    try {
      ({ rows: bxMissed } = await pool.query(
        `SELECT m.id, m.call_start, m.phone, m.phone_norm, m.responsible_id, m.crm_entity_type, m.crm_entity_id
         FROM bx_missed_calls m
         WHERE ($1::date IS NULL OR (m.call_start AT TIME ZONE 'Asia/Tashkent')::date >= $1::date)
           AND ($2::date IS NULL OR (m.call_start AT TIME ZONE 'Asia/Tashkent')::date <= $2::date)
           AND ($3::text IS NULL OR m.phone_norm LIKE '%' || $3 || '%')
           -- same Bosqich rule as the call rows: the newest lead with this phone is in $4
           AND ($4::text IS NULL OR $4::text = (
             SELECT s.bitrix_id
             FROM lead_phones lp
             JOIN leads l ON l.id = lp.lead_id
             LEFT JOIN stages s ON s.id = l.stage_id
             WHERE RIGHT(regexp_replace(lp.phone, '\\D', '', 'g'), 9) = m.phone_norm
             ORDER BY l.date_create DESC NULLS LAST
             LIMIT 1
           ))`,
        [from, to, phone, stage],
      ));
    } catch (err) {
      console.warn(`[calls/call-stats-full] bx_missed_calls unavailable, using PBX missed calls: ${err.message}`);
    }
  }
  return { rows, bxMissed, from, to };
}

/** GET /call-stats-full — the whole CallStatistikasi payload (PyCallStatsResult). */
router.get('/call-stats-full', async (req, res) => {
  try {
    const { rows, bxMissed, from, to, respIds } = await loadCallInputs(req.query);
    // Operator filter is applied inside the compute (not in SQL) so the callback
    // map stays global — a colleague's callback to the same customer still counts.
    res.json(computeCallStatsFull(rows, from || '', to || '', respIds.length ? respIds : null, bxMissed));
  } catch (err) {
    fail(res, 'call-stats-full')(err);
  }
});

/**
 * GET /call-not-recalled — the list behind the "Ne perezvonili" card: every missed call
 * nobody talked to the customer about within 24h. Same filters as /call-stats-full and
 * the same compute, so the rows always add up to the card.
 *
 * Paged on the server: ?limit= (default 20, max 1000) &offset=. `summary` always covers the
 * whole list; only the rows of the requested page are enriched, so a page is cheap even
 * when the list has thousands of calls (and the PBX rows behind it are cached, see
 * loadCallInputs, so the next page does not hit the database for them again).
 *
 * What the PBX knows about a call (who it rang, how long the customer waited, why it
 * ended) comes from the PBX rows already in memory, matched on number and start time
 * (±2 min). The lead (the one Bitrix linked, else the newest with that phone), its stage
 * and its responsible are looked up for the page's rows only.
 *
 * status: never   no conversation with that number since;
 *         late    reached, but after the 24h (callback_at / delay_s say when);
 *         open    the 24h are not over yet — a callback may still come.
 */
const NOT_RECALLED_DEFAULT_LIMIT = 20;
const NOT_RECALLED_MAX_LIMIT = 1000;
const PBX_MATCH_WINDOW_MS = 120_000;

/** (number, time) → the PBX row of that missed call: inbound, unanswered, same number, nearest start within ±2 min. */
function buildPbxMatcher(rows) {
  const byNum = new Map();
  for (const r of rows) {
    if (r.direction !== 'inbound' || r.answered || r.internal || !r.customer_norm) continue;
    const t = new Date(r.start_stamp).getTime();
    if (Number.isNaN(t)) continue;
    if (!byNum.has(r.customer_norm)) byNum.set(r.customer_norm, []);
    byNum.get(r.customer_norm).push({ t, r });
  }
  return (num, at) => {
    let best = null, bestGap = PBX_MATCH_WINDOW_MS + 1;
    for (const c of byNum.get(num) || []) {
      const gap = Math.abs(c.t - at);
      if (gap <= PBX_MATCH_WINDOW_MS && gap < bestGap) { best = c.r; bestGap = gap; }
    }
    return best;
  };
}

router.get('/call-not-recalled', async (req, res) => {
  try {
    const limit = Math.min(NOT_RECALLED_MAX_LIMIT, Math.max(1, parseInt(req.query.limit, 10) || NOT_RECALLED_DEFAULT_LIMIT));
    const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);

    const { rows, bxMissed, from, to, respIds } = await loadCallInputs(req.query);
    const stats = computeCallStatsFull(rows, from || '', to || '', respIds.length ? respIds : null, bxMissed, { detail: true });
    const events = stats.missed_detail.not_recalled.slice().sort((a, b) => b.at - a.at);

    // PBX side, for every event (cheap: in memory) so the summary covers the whole list.
    const match = buildPbxMatcher(rows);
    const attempts = new Map();
    for (const e of events) if (e.num) attempts.set(e.num, (attempts.get(e.num) || 0) + 1);
    const base = events.map((e) => {
      const p = e.num ? match(e.num, e.at) : null;
      return {
        key: e.key,
        phone: e.phone || e.num || null,
        call_start: new Date(e.at).toISOString(),
        matched: !!p,                                        // false = the PBX has no record of this call
        operator: p && p.operator_ext ? p.full_name : null,  // null while matched = it rang out in the queue
        wait_s: p ? Number(p.duration) || 0 : null,
        reason: p ? p.hangup_cause || null : null,
        attempts: e.num ? attempts.get(e.num) : 1,
        status: e.status,
        callback_at: e.callback_at ? new Date(e.callback_at).toISOString() : null,
        delay_s: e.callback_at ? Math.round((e.callback_at - e.at) / 1000) : null,
      };
    });

    // Lead / stage / responsible — only for the rows being returned.
    const pageEvents = events.slice(offset, offset + limit);
    const { rows: lookup } = pageEvents.length ? await pool.query(
      `SELECT e.k AS key, lead.lead_id, lead.stage_name, lead.stage_bid,
              TRIM(COALESCE(r.name, '') || ' ' || COALESCE(r.last_name, '')) AS responsible,
              COALESCE(e.rid, lead.lead_resp) AS responsible_id
       FROM unnest($1::text[], $2::text[], $3::int[], $4::bigint[]) AS e(k, num, rid, hint)
       LEFT JOIN LATERAL (
         SELECT l.id AS lead_id, l.responsible_id AS lead_resp, s.name AS stage_name, s.bitrix_id AS stage_bid
         FROM leads l LEFT JOIN stages s ON s.id = l.stage_id
         WHERE l.id = CASE WHEN e.hint > 0 THEN e.hint ELSE (
           SELECT l2.id FROM lead_phones lp JOIN leads l2 ON l2.id = lp.lead_id
           WHERE RIGHT(regexp_replace(lp.phone, '\\D', '', 'g'), 9) = e.num
           ORDER BY l2.date_create DESC NULLS LAST LIMIT 1) END
       ) lead ON TRUE
       LEFT JOIN responsibles r ON r.id = COALESCE(e.rid, lead.lead_resp)`,
      [pageEvents.map((e) => e.key), pageEvents.map((e) => e.num || ''), pageEvents.map((e) => e.rid), pageEvents.map((e) => e.hint || 0)],
    ) : { rows: [] };
    const leadByKey = new Map(lookup.map((l) => [l.key, l]));
    const items = base.slice(offset, offset + limit).map((it) => {
      const l = leadByKey.get(it.key) || {};
      return {
        ...it,
        lead_id: l.lead_id != null ? Number(l.lead_id) : null,
        stage_name: l.stage_name || null,
        stage_bid: l.stage_bid || null,
        responsible: l.responsible || null,
        responsible_id: l.responsible_id != null ? Number(l.responsible_id) : null,
      };
    });

    const avg = (xs) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : 0);
    const late = base.filter((x) => x.status === 'late');
    res.json({
      window_hours: 24,
      source: Array.isArray(bxMissed) ? 'bitrix24' : 'pbx',
      summary: {                                                    // always the whole list, whatever the page
        total: base.length,                                         // == the card
        unique_numbers: new Set(events.map((e) => e.num || e.key)).size,
        late: late.length,                                          // reached, but after the 24h
        not_reached: base.length - late.length,                     // never, or the 24h is still running
        still_open: base.filter((x) => x.status === 'open').length,
        avg_wait_s: avg(base.filter((x) => x.wait_s != null).map((x) => x.wait_s)),
        missed_total: stats.missed_detail.total,                    // every missed call in the period
      },
      offset, limit,
      items,
    });
  } catch (err) {
    fail(res, 'call-not-recalled')(err);
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
  const source = req.query.source && req.query.source !== 'all' ? String(req.query.source) : null;
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
       LEFT JOIN pbx_users u ON u.ext = c.operator_ext${INTERNAL_JOINS}
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
         AND NOT ${IS_INTERNAL}
         AND ($1::date IS NULL OR (c.start_stamp AT TIME ZONE 'Asia/Tashkent')::date >= $1::date)
         AND ($2::date IS NULL OR (c.start_stamp AT TIME ZONE 'Asia/Tashkent')::date <= $2::date)
         AND ($3::int  IS NULL OR u.responsible_id = $3::int OR (c.operator_ext ~ '^[0-9]+$' AND c.operator_ext::int = $3::int))
         AND ($4::text IS NULL OR c.customer_norm LIKE '%' || $4 || '%')
         AND ($5::text IS NULL OR c.direction = $5::text)
         AND ($6::text IS NULL OR ld.stage_bitrix_id = $6::text)
         AND ($7::text IS NULL OR (CASE WHEN c.uuid LIKE 'moizvonki:%' THEN 'moizvonki' ELSE 'onlinepbx' END) = $7::text)
       ORDER BY c.start_stamp DESC
       LIMIT 1000`,
      [from, to, respId, phone, kind === 'inbound' || kind === 'outbound' ? kind : null, stage, source],
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
 * A "responsible" is a PBX extension (id = Bitrix user id, else the ext number). Only
 * extensions that actually placed/took a call are offered. `team` is the tag in the
 * extension's name (TLC / TIS / TL, null if none) — the picker groups by it.
 */
router.get('/call-filter-options', async (_req, res) => {
  try {
    const [ops, stages] = await Promise.all([
      pool.query(
         `SELECT DISTINCT COALESCE(u.responsible_id, CASE WHEN u.ext ~ '^[0-9]+$' THEN u.ext::int END) AS id, u.name AS full_name
         FROM pbx_users u
         JOIN pbx_calls c ON c.operator_ext = u.ext
         WHERE u.ext ~ '^[0-9]+$' OR u.responsible_id IS NOT NULL
         ORDER BY full_name`,
      ),
      // Lead stages as they exist on the portal right now — the Bosqich filter
      // matches against the lead each call resolves to by phone.
      pool.query(
        `SELECT bitrix_id, name FROM stages WHERE entity = 'lead' ORDER BY sort_order`,
      ),
    ]);
    res.json({
      responsibles: ops.rows.map((r) => ({ ...r, team: teamOf(r.full_name) })),
      sources: [{ id: 'onlinepbx', name: 'OnlinePBX' }, { id: 'moizvonki', name: 'Moizvonki' }],
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

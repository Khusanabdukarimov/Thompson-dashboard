const { Router } = require('express');
const pool = require('../db/pool');
const { tzFromOpt, tzToOpt } = require('./tzDate');
const { computeCallStatsFull, isContact } = require('../services/callStats');
const { teamOf } = require('../config/calls');
const { describeSchedules, DEFAULT_SCHEDULE, workSeconds } = require('../config/workHours');

const router = Router();

const { REASON_FIELDS } = require('../config/leadReasons');
const { bitrixPost } = require('../services/bitrix');

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
 * answered = a live conversation (talk_time > 10 s). missed_inbound = a customer
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
              COALESCE(SUM(fc.talk_time) FILTER (WHERE fc.answered), 0)::int AS total_talk,
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
              COALESCE(SUM(talk_time) FILTER (WHERE answered), 0)::int AS total_talk,
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
        ${tzFromOpt('c.start_stamp', '$1')}
    AND ${tzToOpt('c.start_stamp', '$3')}
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
            -- an operator's phone rang during the call (PBX event log), for the missed-call reason
            (c.events @> '[{"type":"user"}]'::jsonb) AS rang_op,
            COALESCE(u.name, u.ext) AS full_name,
            c.direction, c.customer_norm, c.customer_number,
            c.start_stamp, c.duration, c.talk_time AS talk, c.answered,
            ${IS_INTERNAL} AS internal,
            (
              ${tzFromOpt('c.start_stamp', '$1')}
              AND ${tzToOpt('c.start_stamp', '$2')}
            ) AS in_range
     FROM pbx_calls c
     LEFT JOIN pbx_users u ON u.ext = c.operator_ext${INTERNAL_JOINS}
     WHERE c.start_stamp IS NOT NULL
       AND ${tzFromOpt('c.start_stamp', '$1')}
       -- $3 = to + 1 day, the callback look-ahead
       AND ${tzToOpt('c.start_stamp', '$3')}
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
         WHERE ${tzFromOpt('m.call_start', '$1')}
           AND ${tzToOpt('m.call_start', '$2')}
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
 * The lists behind two cards of the call page, both from the card's own compute (same
 * filters as /call-stats-full), so the rows always add up to the card:
 *
 *   GET /call-not-recalled  "Ne perezvonili": every missed call nobody talked to the
 *                           customer about within 24h. ?basis=pbx builds it from the OnlinePBX
 *                           call records instead of Bitrix24's missed-call registrations.
 *   GET /call-missed-list   "Propushenniy": every missed call, called back or not.
 *   GET /call-reaction-list "Reaksiya vaqti": the missed calls reached within 24h, with the
 *                           callback (when, who, operator call or the customer's own redial)
 *                           and `summary.reaction`: average (== the card), median, the split
 *                           by who made the contact, and how many fall in each delay band.
 *                           ?sort=slow lists the longest waits first (default: newest first).
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
 * delay_s is the real time until the callback; work_delay_s the same counted in the working
 * hours of the team that owns the lead (what "Reaksiya vaqti" averages — config/workHours.js).
 *
 * status: recalled reached within the 24h (callback_at / delay_s say when) — only in the
 *                   full list;
 *         never   no conversation with that number since;
 *         late    reached, but after the 24h (callback_at / delay_s say when);
 *         open    the 24h are not over yet — a callback may still come.
 *
 * summary is always about the whole period, whichever list or page: total (this list's
 * length), unique_numbers, recalled (within 24h), not_recalled (= the "Ne perezvonili"
 * card; late + not_reached), late, not_reached, still_open, avg_wait_s, missed_total.
 */
const NOT_RECALLED_DEFAULT_LIMIT = 20;
const NOT_RECALLED_MAX_LIMIT = 1000;
const PBX_MATCH_WINDOW_MS = 120_000;

/** Delay bands of the Reaksiya vaqti list, in working seconds (upper bound exclusive). */
const REACTION_BANDS = [
  { id: 'lt5m', max: 300 },
  { id: 'lt15m', max: 900 },
  { id: 'lt1h', max: 3600 },
  { id: 'lt4h', max: 4 * 3600 },
  { id: 'gte4h', max: Infinity },
];

/** (number, time) → the answered call that counted as the callback (exact start, as callStats found it). */
function buildContactMatcher(rows) {
  const byKey = new Map();
  for (const r of rows) {
    if (!isContact(r)) continue;
    const t = new Date(r.start_stamp).getTime();
    if (!Number.isNaN(t) && !byKey.has(`${r.customer_norm}|${t}`)) byKey.set(`${r.customer_norm}|${t}`, r);
  }
  return (num, at) => byKey.get(`${num}|${at}`) || null;
}

/**
 * Why a missed call was missed, in words — the PBX's own hangup_cause is NORMAL_CLEARING for
 * ~93% of them (the customer hung up; for the PBX that is a normal end), so on its own it says
 * nothing. Read with the event log (did any operator's phone ring?) and the time of day:
 *   tech         line / routing error (EXCHANGE_ROUTING_ERROR, DESTINATION_OUT_OF_ORDER, ...)
 *   after_hours  outside the company day (config/workHours.js DEFAULT_SCHEDULE)
 *   cancel       the customer hung up at once (ORIGINATOR_CANCEL)
 *   no_answer    a direct call to one operator, not picked up (NO_ANSWER)
 *   rang         operators' phones rang, nobody picked up, the customer hung up
 *   queue        the customer hung up in the menu / queue before any operator's phone rang
 */
const TECH_CAUSES = new Set([
  'EXCHANGE_ROUTING_ERROR', 'DESTINATION_OUT_OF_ORDER', 'NETWORK_OUT_OF_ORDER', 'NORMAL_TEMPORARY_FAILURE',
  'CHAN_NOT_IMPLEMENTED', 'PROTOCOL_ERROR', 'NORMAL_CIRCUIT_CONGESTION', 'NO_ROUTE_DESTINATION',
  'INTERWORKING', 'RECOVERY_ON_TIMER_EXPIRE',
]);
function missReason(p, atMs) {
  if (!p) return null;
  const cause = p.hangup_cause || '';
  if (TECH_CAUSES.has(cause)) return 'tech';
  const [open, close] = DEFAULT_SCHEDULE;
  const hour = new Date(atMs + 5 * 3600e3).getUTCHours(); // Asia/Tashkent
  if (hour < open || hour >= close) return 'after_hours';
  if (cause === 'ORIGINATOR_CANCEL') return 'cancel';
  if (cause === 'NO_ANSWER') return 'no_answer';
  return p.rang_op ? 'rang' : 'queue';
}

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

async function serveMissedList(req, res, scope) {
  try {
    const limit = Math.min(NOT_RECALLED_MAX_LIMIT, Math.max(1, parseInt(req.query.limit, 10) || NOT_RECALLED_DEFAULT_LIMIT));
    const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);

    const loaded = await loadCallInputs(req.query);
    const { rows, from, to, respIds } = loaded;
    // ?basis=pbx: the missed calls (and so the list) come from the OnlinePBX call records themselves
    // instead of Bitrix24's registrations — what the "Ne perezvonili" dialog shows. The same compute
    // runs either way; Bitrix24 events are just left out. `card` then carries the Bitrix24-based
    // figure the page card shows, so a difference between the two is visible, not a surprise.
    const pbxBasis = req.query.basis === 'pbx';
    const bxMissed = pbxBasis ? null : loaded.bxMissed;
    const operators = respIds.length ? respIds : null;
    const stats = computeCallStatsFull(rows, from || '', to || '', operators, bxMissed, { detail: true });
    const cardStats = pbxBasis && Array.isArray(loaded.bxMissed)
      ? computeCallStatsFull(rows, from || '', to || '', operators, loaded.bxMissed)
      : null;
    const detail = stats.missed_detail;
    const events = (scope === 'all' ? detail.recalled_events.concat(detail.not_recalled)
      : scope === 'reaction' ? detail.recalled_events.slice() : detail.not_recalled.slice());
    if (scope === 'reaction' && req.query.sort === 'slow') events.sort((a, b) => (b.work_delay_s - a.work_delay_s) || (b.at - a.at));
    else events.sort((a, b) => b.at - a.at);

    // PBX side, for every event (cheap: in memory) so the summary covers the whole list.
    const match = buildPbxMatcher(rows);
    const contactOf = buildContactMatcher(rows);
    const attempts = new Map();
    for (const e of events) if (e.num) attempts.set(e.num, (attempts.get(e.num) || 0) + 1);
    const base = events.map((e) => {
      const p = e.num ? match(e.num, e.at) : null;
      const cb = e.num && e.callback_at ? contactOf(e.num, e.callback_at) : null;
      return {
        key: e.key,
        phone: e.phone || e.num || null,
        call_start: new Date(e.at).toISOString(),
        matched: !!p,                                        // false = the PBX has no record of this call
        operator: p && p.operator_ext ? p.full_name : null,  // null while matched = it rang out in the queue
        wait_s: p ? Number(p.duration) || 0 : null,
        reason: p ? p.hangup_cause || null : null,                 // the PBX's raw code
        reason_kind: missReason(p, e.at),                           // ...and what it means (see missReason)
        attempts: e.num ? attempts.get(e.num) : 1,
        status: e.status,
        callback_at: e.callback_at ? new Date(e.callback_at).toISOString() : null,
        delay_s: e.callback_at ? Math.round((e.callback_at - e.at) / 1000) : null,       // real time until the callback
        work_delay_s: e.work_delay_s ?? null,                                          // ...counted in the team's working hours
        team: e.team || null,
        // the call that counted as the contact: an operator's callback (outbound) or the customer
        // calling again and getting through (inbound); who talked, and through which system
        callback_dir: cb ? cb.direction : null,
        callback_by: cb ? (cb.operator_ext ? cb.full_name || cb.operator_ext : null) : null,
        callback_source: cb ? (String(cb.uuid).startsWith('moizvonki:') ? 'moizvonki' : 'onlinepbx') : null,
        callback_answered: cb ? !!cb.answered : null,  // false = the operator called, the customer did not pick up
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
    const lateCount = detail.not_recalled.filter((e) => e.status === 'late').length;
    let reaction;
    if (scope === 'reaction') {
      const works = base.map((x) => x.work_delay_s || 0);
      const sorted = works.slice().sort((a, b) => a - b);
      reaction = {
        avg_work_s: avg(works),                                     // == the "Reaksiya vaqti" card
        median_work_s: sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0,
        avg_clock_s: avg(base.map((x) => x.delay_s || 0)),          // the same, in plain clock time
        by_operator: base.filter((x) => x.callback_dir === 'outbound').length,
        by_customer: base.filter((x) => x.callback_dir === 'inbound').length,
        bands: REACTION_BANDS.map((b, i) => ({
          id: b.id,
          count: works.filter((w) => w >= (i ? REACTION_BANDS[i - 1].max : 0) && w < b.max).length,
        })),
      };
    }
    res.json({
      window_hours: 24,
      work_hours: describeSchedules(),                              // what work_delay_s is measured against
      source: Array.isArray(bxMissed) ? 'bitrix24' : 'pbx',
      // The figures the page cards show (Bitrix24-based), only when this list is built another way.
      card: cardStats ? { source: 'bitrix24', ne_perezvonili: cardStats.ne_perezvonili, missed_inbound: cardStats.missed_inbound } : null,
      summary: {                                                    // always the whole period, whatever the page
        total: base.length,                                         // this list's length == its card
        unique_numbers: new Set(events.map((e) => e.num || e.key)).size,
        recalled: detail.recalled,                                  // called back within the 24h
        not_recalled: detail.not_recalled.length,                   // == the "Ne perezvonili" card
        late: lateCount,                                            // ...of which reached, but after the 24h
        not_reached: detail.not_recalled.length - lateCount,        // ...never, or the 24h is still running
        still_open: detail.not_recalled.filter((e) => e.status === 'open').length,
        avg_wait_s: avg(base.filter((x) => x.wait_s != null).map((x) => x.wait_s)),
        missed_total: detail.total,                                 // == the "Propushenniy" card
        reasons: base.reduce((acc, x) => { const k = x.reason_kind || 'unknown'; acc[k] = (acc[k] || 0) + 1; return acc; }, {}),
        ...(reaction ? { reaction } : {}),
      },
      offset, limit,
      items,
    });
  } catch (err) {
    fail(res, scope === 'all' ? 'call-missed-list' : scope === 'reaction' ? 'call-reaction-list' : 'call-not-recalled')(err);
  }
}
router.get('/call-not-recalled', (req, res) => serveMissedList(req, res, 'not_recalled'));
router.get('/call-missed-list', (req, res) => serveMissedList(req, res, 'all'));
router.get('/call-reaction-list', (req, res) => serveMissedList(req, res, 'reaction'));

/**
 * GET /call-list — the per-operator drill-down (CallListRow[]).
 * Returns a bare array, matching the reference contract.
 */
router.get('/call-list', async (req, res) => {
  const from = req.query.from || null;
  const to = req.query.to || null;
  const respId = req.query.responsible_id ? String(req.query.responsible_id) : null;
  // A PBX/Moizvonki line not linked to a Bitrix user ("mz:3") is asked for by its extension.
  const ext = req.query.ext ? String(req.query.ext) : null;
  const phone = req.query.phone ? String(req.query.phone).replace(/\D/g, '') : null;
  const source = req.query.source && req.query.source !== 'all' ? String(req.query.source) : null;
  const kind = req.query.call_kind || null; // inbound|outbound|callback
  const stage = req.query.stage && req.query.stage !== 'all' ? String(req.query.stage) : null;

  try {
    // The operator's extensions first, so the calls are read through the (operator_ext,
    // start_stamp) index instead of scanning every call of the period and filtering after
    // (a month for one operator took ~3 s that way). An extension equal to the Bitrix id
    // still counts as theirs, as before.
    let exts = null;
    if (ext) exts = [ext];
    else if (respId && /^\d+$/.test(respId)) {
      const { rows: us } = await pool.query('SELECT ext FROM pbx_users WHERE responsible_id = $1', [Number(respId)]);
      exts = [...new Set([...us.map((u) => u.ext), respId])];
    }
    // The lead lookup (the slow part) runs only for the rows returned — unless the Bosqich
    // filter needs it to choose them.
    const { rows } = await pool.query(
      `WITH base AS (
         SELECT c.uuid, c.customer_number, c.customer_norm, c.direction, c.duration, c.talk_time, c.start_stamp,
                c.answered, c.hangup_cause
         FROM pbx_calls c${INTERNAL_JOINS}
         WHERE c.start_stamp IS NOT NULL
           AND NOT ${IS_INTERNAL}
           AND ${tzFromOpt('c.start_stamp', '$1')}
           AND ${tzToOpt('c.start_stamp', '$2')}
           AND ($3::text[] IS NULL OR c.operator_ext = ANY($3::text[]))
           AND ($4::text IS NULL OR c.customer_norm LIKE '%' || $4 || '%')
           AND ($5::text IS NULL OR c.direction = $5::text)
           AND ($7::text IS NULL OR (CASE WHEN c.uuid LIKE 'moizvonki:%' THEN 'moizvonki' ELSE 'onlinepbx' END) = $7::text)
         ORDER BY c.start_stamp DESC
         ${stage ? '' : 'LIMIT 1000'}
       )
       SELECT c.uuid AS id,
              c.customer_number AS phone_number,
              CASE c.direction WHEN 'outbound' THEN 1 WHEN 'inbound' THEN 2 ELSE NULL END AS call_type,
              c.duration,
              c.talk_time,
              c.start_stamp AS call_start,
              CASE WHEN c.answered THEN 200 ELSE NULL END AS status_code,
              c.hangup_cause AS status_name,
              ld.lead_id,
              CASE WHEN ld.lead_id IS NOT NULL THEN 'lead' END AS crm_entity_type,
              ld.lead_title,
              ld.stage_name,
              ld.stage_bitrix_id,
              rs.reason AS stage_reason
       FROM base c
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
       -- Why the lead is Bekor bo'ldi / Sifatsiz: the same reason fields the Lidlar page reads.
       LEFT JOIN LATERAL (
         SELECT COALESCE(re.value, rv.value) AS reason
         FROM lead_uf_values rv
         LEFT JOIN lead_uf_enums re ON re.field_code = rv.field_code AND re.enum_id = rv.value
         CROSS JOIN LATERAL (SELECT CASE ld.stage_bitrix_id WHEN 'UC_L8G2B9' THEN $8::text[] ELSE $9::text[] END AS fields) f
         WHERE rv.lead_id = ld.lead_id AND rv.field_code = ANY(f.fields)
           AND TRIM(COALESCE(re.value, rv.value)) NOT IN ('', '—', '-', 'false')   -- a dash option is "not given"
         ORDER BY array_position(f.fields, rv.field_code)   -- first filled field wins (config/leadReasons.js)
         LIMIT 1
       ) rs ON ld.stage_bitrix_id IN ('UC_L8G2B9', 'JUNK')
       WHERE ($6::text IS NULL OR ld.stage_bitrix_id = $6::text)
       ORDER BY c.start_stamp DESC
       LIMIT 1000`,
      [from, to, exts, phone, kind === 'inbound' || kind === 'outbound' ? kind : null, stage, source, REASON_FIELDS.bekor, REASON_FIELDS.sifatsiz],
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
 * extension's name (TLC / TIS / TL, null if none) — the picker groups by it. An extension
 * the PBX has no name for (a new one) is listed by its number, never with a null name.
 */
router.get('/call-filter-options', async (_req, res) => {
  try {
    const [ops, stages] = await Promise.all([
      pool.query(
         `SELECT DISTINCT COALESCE(u.responsible_id, CASE WHEN u.ext ~ '^[0-9]+$' THEN u.ext::int END) AS id,
                COALESCE(NULLIF(u.name, ''), u.ext) AS full_name
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

// ── Reaction times (the Reaksiya vaqti card's three views) ───────
// 1. how fast an incoming call is picked up   — /call-answer-speed
// 2. how fast a missed call is called back    — /call-reaction-list (above)
// 3. how fast a new non-call lead gets a call — /call-lead-first-call

const median = (xs) => {
  if (!xs.length) return null;
  const a = [...xs].sort((x, y) => x - y), m = Math.floor(a.length / 2);
  return Math.round(a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2);
};
const mean = (xs) => (xs.length ? Math.round(xs.reduce((s, x) => s + x, 0) / xs.length) : null);
const bandsOf = (xs, edges) => edges.map(([id, lo, hi]) => ({ id, count: xs.filter((x) => x >= lo && x < hi).length }));

/**
 * GET /call-answer-speed — answered incoming calls: how long the customer waited before an
 * operator picked up. OnlinePBX: duration − talk time (includes the greeting / menu); Moizvonki:
 * answer_time − start_time. Per operator and in bands.
 */
router.get('/call-answer-speed', async (req, res) => {
  const { from, to } = req.query;
  try {
    const { rows } = await pool.query(
      `SELECT COALESCE(u.name, c.operator_ext, 'Navbat') AS operator,
              CASE WHEN c.uuid LIKE 'moizvonki:%'
                   THEN CASE WHEN (c.raw->'raw'->>'answer_time')::bigint > 0
                             THEN GREATEST(0, (c.raw->'raw'->>'answer_time')::bigint - (c.raw->'raw'->>'start_time')::bigint) END
                   ELSE GREATEST(0, c.duration - c.talk_time) END AS wait_s
       FROM pbx_calls c${INTERNAL_JOINS}
       LEFT JOIN pbx_users u ON u.ext = c.operator_ext
       WHERE c.direction = 'inbound' AND c.answered AND NOT ${IS_INTERNAL}
         AND ${tzFromOpt('c.start_stamp', '$1')} AND ${tzToOpt('c.start_stamp', '$2')}`,
      [from || null, to || null]);
    const waits = rows.map((r) => r.wait_s).filter((v) => v != null).map(Number);
    const byOp = new Map();
    for (const r of rows) {
      if (r.wait_s == null) continue;
      if (!byOp.has(r.operator)) byOp.set(r.operator, []);
      byOp.get(r.operator).push(Number(r.wait_s));
    }
    res.json({
      summary: {
        count: waits.length, avg_s: mean(waits), median_s: median(waits),
        within_20s: waits.filter((w) => w < 20).length,
        bands: bandsOf(waits, [['lt10s', 0, 10], ['lt20s', 10, 20], ['lt40s', 20, 40], ['lt60s', 40, 60], ['gte60s', 60, Infinity]]),
      },
      by_operator: [...byOp.entries()]
        .map(([name, ws]) => ({ name, count: ws.length, avg_s: mean(ws), median_s: median(ws) }))
        .sort((a, b) => b.count - a.count),
    });
  } catch (err) {
    fail(res, 'call-answer-speed')(err);
  }
});

/**
 * GET /call-lead-first-call — leads that did NOT come from a phone call (Instagram, Kids,
 * Maktab baner, site, Telegram...): time from the lead's creation to the first operator call to
 * its number (picked up or not), within 7 days. Leads created by a call are left out: source
 * CALL, or a title the telephony gives them ("Входящий / Пропущенный / Клиент не ответил /
 * Исходящий ..."). The wait is counted in working hours (DEFAULT_SCHEDULE), like Reaksiya vaqti.
 */
const CALL_LEAD_TITLE = '^(Входящий|Пропущенный|Клиент не ответил|Исходящий)';
router.get('/call-lead-first-call', async (req, res) => {
  const { from, to } = req.query;
  try {
    // Three plain lookups joined here: a per-lead LATERAL over pbx_calls scanned every call of
    // the week for each lead (~2 min for a month); this way it is two index lookups (~3 s).
    const { rows: leads } = await pool.query(
      `SELECT l.id AS lead_id, l.title, l.date_create, COALESCE(ls.name, l.source_id, 'Manbasiz') AS source,
              TRIM(COALESCE(r.name, '') || ' ' || COALESCE(r.last_name, '')) AS responsible
       FROM leads l
       LEFT JOIN lead_sources ls ON ls.source_id = l.source_id
       LEFT JOIN responsibles r ON r.id = l.responsible_id
       WHERE ${tzFromOpt('l.date_create', '$1')} AND ${tzToOpt('l.date_create', '$2')}
         AND l.source_id IS DISTINCT FROM 'CALL'
         AND COALESCE(l.title, '') !~* $3
       ORDER BY l.date_create DESC`,
      [from || null, to || null, CALL_LEAD_TITLE]);
    const ids = leads.map((l) => l.lead_id);
    const { rows: phones } = ids.length ? await pool.query(
      `SELECT DISTINCT lead_id, RIGHT(regexp_replace(phone, '\\D', '', 'g'), 9) AS norm
       FROM lead_phones WHERE lead_id = ANY($1::int[])`, [ids]) : { rows: [] };
    const norms = [...new Set(phones.map((p) => p.norm).filter((n) => n && n.length === 9))];
    const created = leads.map((l) => new Date(l.date_create).getTime());
    const { rows: calls } = norms.length ? await pool.query(
      `SELECT c.customer_norm, c.start_stamp, c.answered, COALESCE(u.name, c.operator_ext) AS caller
       FROM pbx_calls c LEFT JOIN pbx_users u ON u.ext = c.operator_ext
       WHERE c.direction = 'outbound' AND c.customer_norm = ANY($1::text[])
         AND c.start_stamp >= $2 AND c.start_stamp < $3
       ORDER BY c.start_stamp`,
      [norms, new Date(Math.min(...created) - 120_000), new Date(Math.max(...created) + 7 * 86_400_000)]) : { rows: [] };
    const callsByNorm = new Map();
    for (const c of calls) {
      if (!callsByNorm.has(c.customer_norm)) callsByNorm.set(c.customer_norm, []);
      callsByNorm.get(c.customer_norm).push({ at: new Date(c.start_stamp).getTime(), answered: c.answered, caller: c.caller });
    }
    const normsByLead = new Map();
    for (const p of phones) {
      if (!normsByLead.has(p.lead_id)) normsByLead.set(p.lead_id, []);
      normsByLead.get(p.lead_id).push(p.norm);
    }
    const rows = leads.map((l, i) => {
      const t0 = created[i] - 120_000, t1 = created[i] + 7 * 86_400_000;
      let first = null;
      for (const n of normsByLead.get(l.lead_id) ?? []) {
        const hit = (callsByNorm.get(n) ?? []).find((c) => c.at >= t0 && c.at < t1);   // calls are sorted
        if (hit && (!first || hit.at < first.at)) first = hit;
      }
      return { ...l, first_call: first ? new Date(first.at) : null, answered: first?.answered ?? null, caller: first?.caller ?? null };
    });

    const items = rows.map((r) => {
      const created = new Date(r.date_create).getTime();
      const called = r.first_call ? new Date(r.first_call).getTime() : null;
      return {
        lead_id: r.lead_id, title: r.title, source: r.source, responsible: r.responsible || null,
        created_at: new Date(created).toISOString(),
        first_call_at: called ? new Date(called).toISOString() : null,
        answered: called ? !!r.answered : null,
        caller: r.caller || null,
        delay_s: called ? Math.max(0, Math.round((called - created) / 1000)) : null,
        work_delay_s: called ? workSeconds(created, Math.max(created, called)) : null,
      };
    });
    const calledItems = items.filter((i) => i.work_delay_s != null);
    const ws = calledItems.map((i) => i.work_delay_s);
    const group = (keyOf) => {
      const m = new Map();
      for (const i of items) {
        const k = keyOf(i); if (!k) continue;
        if (!m.has(k)) m.set(k, { name: k, total: 0, called: 0, w: [] });
        const g = m.get(k); g.total++;
        if (i.work_delay_s != null) { g.called++; g.w.push(i.work_delay_s); }
      }
      return [...m.values()].map(({ w, ...g }) => ({ ...g, avg_s: mean(w), median_s: median(w) })).sort((a, b) => b.total - a.total);
    };
    res.json({
      summary: {
        total: items.length, called: calledItems.length, not_called: items.length - calledItems.length,
        avg_work_s: mean(ws), median_work_s: median(ws), avg_clock_s: mean(calledItems.map((i) => i.delay_s)),
        bands: bandsOf(ws, [['lt5m', 0, 300], ['lt15m', 300, 900], ['lt1h', 900, 3600], ['lt4h', 3600, 14400], ['gte4h', 14400, Infinity]]),
      },
      by_source: group((i) => i.source),
      by_operator: group((i) => i.caller).filter((g) => g.called > 0),
      items: items.slice(0, Math.min(5000, parseInt(req.query.limit, 10) || 3000)),
    });
  } catch (err) {
    fail(res, 'call-lead-first-call')(err);
  }
});

// ── Who owns a number in Bitrix ─────────────────────────────────
// A call row with no matching lead is usually an existing client: a Bitrix CONTACT (with
// deals), whose phones we do not store. On click, ask Bitrix once (crm.duplicate.findbycomm)
// and open what it returns. Cached, so a number is looked up at most once an hour.
const ownerCache = new Map();
const OWNER_TTL_MS = 60 * 60 * 1000;

/** GET /bitrix-owner?phone=901234567 → { type: 'lead' | 'contact' | 'company' | null, id } */
router.get('/bitrix-owner', async (req, res) => {
  const norm = String(req.query.phone || '').replace(/\D/g, '').slice(-9);
  if (norm.length !== 9) return res.status(400).json({ error: 'phone required' });
  const hit = ownerCache.get(norm);
  if (hit && Date.now() - hit.at < OWNER_TTL_MS) return res.json(hit.owner);
  try {
    const values = [norm, `998${norm}`, `+998${norm}`];
    let owner = { type: null, id: null };
    for (const t of ['LEAD', 'CONTACT', 'COMPANY']) {
      const r = await bitrixPost('crm.duplicate.findbycomm', { type: 'PHONE', values, entity_type: t });
      const ids = r?.result?.[t];
      if (Array.isArray(ids) && ids.length) { owner = { type: t.toLowerCase(), id: Math.max(...ids.map(Number)) }; break; }
    }
    ownerCache.set(norm, { at: Date.now(), owner });
    res.json(owner);
  } catch (err) {
    fail(res, 'bitrix-owner')(err);
  }
});

// ── Moizvonki accounts (Sozlamalar) ─────────────────────────────
// Moizvonki reports a call by the manager's login email (thompson.menejer3@gmail.com), which
// matches no Bitrix user, so the name shown for that account is typed in by hand.

/** GET /moizvonki-users — every Moizvonki account, with its 30-day call count. */
router.get('/moizvonki-users', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT u.ext, u.email, u.name, u.custom_name,
              (SELECT count(*)::int FROM pbx_calls c
               WHERE c.operator_ext = u.ext AND c.start_stamp > now() - interval '30 days') AS calls_30d
       FROM pbx_users u
       WHERE u.ext LIKE 'mz:%'
       ORDER BY length(u.ext), u.ext`);
    res.json(rows);
  } catch (err) {
    fail(res, 'moizvonki-users')(err);
  }
});

/** PUT /moizvonki-users/:ext { name } — set the shown name; an empty name goes back to the default. */
router.put('/moizvonki-users/:ext', async (req, res) => {
  const ext = String(req.params.ext || '');
  const name = String(req.body?.name ?? '').trim().slice(0, 80);
  if (!/^mz:\d+$/.test(ext)) return res.status(400).json({ error: 'not a Moizvonki account' });
  try {
    const { rows } = await pool.query(
      `UPDATE pbx_users
       SET custom_name = NULLIF($2, ''),
           name = COALESCE(NULLIF($2, ''),
                           CASE WHEN email ~* 'menejer\\D*\\d+'
                                THEN 'Menejer ' || (substring(email from '(?i)menejer\\D*(\\d+)'))::int
                                ELSE COALESCE(email, ext) END)
       WHERE ext = $1
       RETURNING ext, email, name, custom_name`,
      [ext, name]);
    if (!rows.length) return res.status(404).json({ error: 'not found' });
    res.json(rows[0]);
  } catch (err) {
    fail(res, 'moizvonki-users/put')(err);
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

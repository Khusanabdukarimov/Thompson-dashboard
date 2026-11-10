const { Router } = require('express');
const pool = require('../db/pool');
const { tzFromOpt, tzToOpt } = require('./tzDate');
const { computeCallStatsFull, isContact } = require('../services/callStats');
const { teamOf, operatorNameRank, operatorDisplayName, MIN_CALLBACK_DIAL_S } = require('../config/calls');
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

/** The phone search box: digits only, and a full number ("998 90 123 45 67") cut to the
 *  9-digit form the calls are stored in — otherwise it never matched. Partial input still works. */
function phoneNeedle(v) {
  const d = String(v || '').replace(/\D/g, '');
  return d ? d.slice(-9) : null;
}

/** The page's Holat / Qo'ng'iroq turi / Davomiylik filters (services/callStats.js passRow). */
function parseCallFilter(query) {
  const num = (v) => (v === undefined || v === null || v === '' ? null : Number.isFinite(Number(v)) ? Math.max(0, Number(v)) : null);
  const pick = (v, allowed) => (allowed.includes(String(v)) ? String(v) : null);
  return {
    status: pick(query.status, ['success', 'failed', 'missed', 'ndz', 'recalled', 'unrecalled']),
    kind: pick(query.call_kind, ['inbound', 'outbound', 'callback']),
    durFrom: num(query.duration_from),
    durTo: num(query.duration_to),
  };
}

/**
 * A line's shown name. A line linked to a Bitrix user shows that user's name as Bitrix writes it
 * (plus the line's team tag) — the PBX's own label goes stale when a line is handed to someone new
 * (ext 105 was still "Diyora | TLC" while Bitrix knew it as Marjona's). An unlinked line keeps the
 * PBX label, else its number. `u` is the pbx_users alias.
 */
const LINE_NAME = (u = 'u') => `COALESCE(
  (SELECT NULLIF(TRIM(COALESCE(rn.name, '') || ' ' || COALESCE(rn.last_name, '')), '')
          -- the team tag, unless the Bitrix name already carries one ("Midassa | Umida")
          || CASE WHEN rn.name || COALESCE(rn.last_name, '') LIKE '%|%' THEN ''
                  ELSE COALESCE(' | ' || substring(${u}.name from '\\m(TLC|TIS|TL)\\M'), '') END
   FROM responsibles rn WHERE rn.id = ${u}.responsible_id),
  NULLIF(${u}.name, ''), ${u}.ext)`;

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
 * answered = a connection (talk_time > 0, as Bitrix24). missed_inbound = a customer
 * call nobody talked to — the call-backs owed.
 */
router.get('/call-stats', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `WITH fc AS (SELECT c.* FROM pbx_calls c WHERE ${CALL_WHERE})
       SELECT u.ext                                                          AS operator_ext,
              ${LINE_NAME('u')}                                              AS full_name,
              COUNT(fc.uuid)::int                                            AS total_calls,
              COUNT(*) FILTER (WHERE fc.direction = 'inbound')::int          AS inbound_calls,
              COUNT(*) FILTER (WHERE fc.direction = 'outbound')::int         AS outbound_calls,
              COUNT(*) FILTER (WHERE fc.direction = 'local')::int            AS local_calls,
              COUNT(*) FILTER (WHERE fc.answered)::int                       AS answered_calls,
              COUNT(*) FILTER (WHERE NOT fc.answered)::int                   AS unanswered_calls,
              COALESCE(SUM(fc.talk_time) FILTER (WHERE fc.answered), 0)::int AS total_talk,
              COALESCE(ROUND(AVG(fc.talk_time) FILTER (WHERE fc.talk_time > 10)), 0)::int AS avg_talk,   -- per real conversation
              COUNT(DISTINCT fc.customer_norm)::int                          AS unique_customers
       FROM pbx_users u
       LEFT JOIN fc ON fc.operator_ext = u.ext
       GROUP BY u.ext, u.name, u.responsible_id
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
              COALESCE(ROUND(AVG(talk_time) FILTER (WHERE talk_time > 10)), 0)::int AS avg_talk   -- per real conversation
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
  const phone = phoneNeedle(query.phone);
  // Manba is applied inside the compute, not here: the callback map must keep both systems
  // (a Moizvonki callback to an OnlinePBX miss still reached the customer).
  const source = query.source === 'onlinepbx' || query.source === 'moizvonki' ? String(query.source) : null;
  const stage = query.stage && query.stage !== 'all' ? String(query.stage) : null;
  const filter = parseCallFilter(query);
  const key = JSON.stringify([from, to, phone, stage]);

  const hit = inputsCache.get(key);
  if (hit && Date.now() - hit.at < INPUTS_TTL_MS) return { ...(await hit.promise), respIds, source, filter };

  const promise = readCallInputs({ from, to, phone, stage });
  inputsCache.set(key, { at: Date.now(), promise });
  while (inputsCache.size > INPUTS_MAX_KEYS) inputsCache.delete(inputsCache.keys().next().value);
  try {
    const inputs = await promise;
    if (inputs.rows.length > INPUTS_MAX_ROWS) inputsCache.delete(key);
    return { ...inputs, respIds, source, filter };
  } catch (err) {
    inputsCache.delete(key);            // never cache a failure
    throw err;
  }
}

/** How many days after the period the calls are read: day 1 finds the 24h callbacks of a miss on
 *  the last day; the rest only tells a late callback ("late", reached after 24h) from none at all. */
const LOOKAHEAD_DAYS = 3;

async function readCallInputs({ from, to, phone, stage }) {
  const { rows } = await pool.query(
    `SELECT c.uuid,
            COALESCE(u.responsible_id, CASE WHEN c.operator_ext ~ '^[0-9]+$' THEN c.operator_ext::int ELSE NULL END) AS responsible_id,
            c.operator_ext, c.hangup_cause,
            -- an operator's phone rang during the call (PBX event log), for the missed-call reason
            (c.events @> '[{"type":"user"}]'::jsonb) AS rang_op,
            ${LINE_NAME('u')} AS full_name,
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
       -- $6 = from - 1 day: a contact in the 24h BEFORE a miss also means the number was touched
       AND ${tzFromOpt('c.start_stamp', '$6')}
       -- $3 = to + LOOKAHEAD_DAYS, the callback look-ahead
       AND ${tzToOpt('c.start_stamp', '$3')}
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
    [from, to, to ? addDaysISO(to, LOOKAHEAD_DAYS) : null, phone, stage, from ? addDaysISO(from, -1) : null],
  );
  // Whose missed call is it? Bitrix24 knows (the CRM entity's responsible); the PBX does
  // not — a queue call that rang out has no operator. Bitrix registers the misses of both
  // OnlinePBX and Moizvonki; a failure to read the table falls back to the PBX's own.
  let bxMissed = null;
  {
    try {
      ({ rows: bxMissed } = await pool.query(
        // The owner is the lead's CURRENT responsible: the stored one is frozen at sync time, and
        // 14.5% of November's had since moved to someone else. A contact keeps the stored owner.
        `SELECT m.id, m.call_start, m.phone, m.phone_norm,
                COALESCE(cl.responsible_id, m.responsible_id) AS responsible_id, m.crm_entity_type, m.crm_entity_id
         FROM bx_missed_calls m
         LEFT JOIN leads cl ON m.crm_entity_type = 'LEAD' AND cl.id = m.crm_entity_id
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

  // A callback can come any time later ("contacted at least once" — no 24h limit): for every number with a
  // miss in the period, the first contact after the look-ahead window, if any. Added as out-of-range rows
  // so the callback map sees it (counted nowhere else).
  if (to) {
    const nums = [...new Set([
      ...rows.filter((r) => r.in_range && r.direction === 'inbound' && !r.answered && r.customer_norm).map((r) => r.customer_norm),
      ...(bxMissed || []).map((e) => e.phone_norm).filter(Boolean),
    ])];
    if (nums.length) {
      const { rows: later } = await pool.query(
        `SELECT DISTINCT ON (c.customer_norm)
                c.uuid, u.responsible_id, c.operator_ext, ${LINE_NAME('u')} AS full_name,
                c.direction, c.customer_norm, c.customer_number, c.start_stamp, c.duration, c.talk_time AS talk, c.answered,
                FALSE AS internal, FALSE AS in_range
         FROM pbx_calls c
         LEFT JOIN pbx_users u ON u.ext = c.operator_ext
         WHERE c.customer_norm = ANY($1::text[])
           AND NOT ${tzToOpt('c.start_stamp', '$2')}
           AND c.direction <> 'local' AND (c.answered OR c.direction = 'outbound')
         ORDER BY c.customer_norm, c.start_stamp`,
        [nums, addDaysISO(to, LOOKAHEAD_DAYS)]);
      for (const r of later) rows.push(r);
    }
  }

  // Who is who, independent of the filters: each Bitrix user's team (from their lines' names —
  // it picks the working hours a callback is measured in) and every Bitrix user's name (an owner
  // of missed calls with no calls of their own still gets a named row).
  const missedNums = [...new Set(rows.filter((r) => r.in_range && r.direction === 'inbound' && !r.answered && !r.internal && r.customer_norm).map((r) => r.customer_norm))];
  const [teamsQ, namesQ, leadOwnQ] = await Promise.all([
    pool.query('SELECT responsible_id, name FROM pbx_users WHERE responsible_id IS NOT NULL'),
    pool.query(`SELECT id, TRIM(COALESCE(name, '') || ' ' || COALESCE(last_name, '')) AS full_name FROM responsibles`),
    // The newest lead's owner per missed number — whose a PBX-only miss is when Bitrix registered none.
    missedNums.length ? pool.query(
      `SELECT DISTINCT ON (n.num) n.num, l.responsible_id
       FROM unnest($1::text[]) AS n(num)
       JOIN lead_phones lp ON RIGHT(regexp_replace(lp.phone, '\\D', '', 'g'), 9) = n.num
       JOIN leads l ON l.id = lp.lead_id
       WHERE l.responsible_id IS NOT NULL
       ORDER BY n.num, l.date_create DESC NULLS LAST`, [missedNums]) : { rows: [] },
  ]);
  const teamByRid = new Map();
  for (const t of teamsQ.rows) { const team = teamOf(t.name); if (team && !teamByRid.has(String(t.responsible_id))) teamByRid.set(String(t.responsible_id), team); }
  const ownerNames = new Map(namesQ.rows.filter((n) => n.full_name).map((n) => [String(n.id), n.full_name]));
  const leadOwner = new Map(leadOwnQ.rows.map((o) => [o.num, Number(o.responsible_id)]));
  // A PBX miss's owner: the Bitrix registration of the same call (same number, ±2 min), else the lead's owner.
  const bxByNum = new Map();
  for (const e of bxMissed || []) {
    if (!e.phone_norm) continue;
    if (!bxByNum.has(e.phone_norm)) bxByNum.set(e.phone_norm, []);
    bxByNum.get(e.phone_norm).push({ t: new Date(e.call_start).getTime(), rid: e.responsible_id });
  }
  const missOwner = (r) => {
    const t = new Date(r.start_stamp).getTime();
    let best = null, gap = PBX_MATCH_WINDOW_MS + 1;
    for (const e of bxByNum.get(r.customer_norm) || []) { const g = Math.abs(e.t - t); if (g < gap && e.rid != null) { gap = g; best = e.rid; } }
    return best != null ? Number(best) : leadOwner.get(r.customer_norm) ?? null;
  };
  return { rows, bxMissed, from, to, teamByRid, ownerNames, missOwner };
}

/** The compute options shared by every endpoint that reads loadCallInputs. */
function computeOpts(inputs, extra = {}) {
  return { teamByRid: inputs.teamByRid, ownerNames: inputs.ownerNames, missOwner: inputs.missOwner, source: inputs.source, filter: inputs.filter, ...extra };
}
/** Bitrix24's missed calls — they cover both systems (Moizvonki's arrive on line REST_APP:120);
 *  under a Manba filter the compute keeps the ones of that system. */
const bxFor = (inputs) => inputs.bxMissed;

/** GET /call-stats-full — the whole CallStatistikasi payload (PyCallStatsResult). */
router.get('/call-stats-full', async (req, res) => {
  try {
    const inputs = await loadCallInputs(req.query);
    const { rows, from, to, respIds } = inputs;
    // Operator filter is applied inside the compute (not in SQL) so the callback
    // map stays global — a colleague's callback to the same customer still counts.
    const out = computeCallStatsFull(rows, from || '', to || '', respIds.length ? respIds : null, bxFor(inputs), computeOpts(inputs));
    // When each feed last completed (OnlinePBX, Moizvonki, Bitrix24 missed calls) — the page shows
    // how fresh its numbers are, so a call made 5 minutes ago missing is not a surprise.
    const { rows: fresh } = await pool.query(
      `SELECT entity, last_sync FROM sync_state WHERE entity IN ('calls', 'moizvonki_calls', 'bx_missed')`);
    out.data_as_of = Object.fromEntries(fresh.map((f) => [f.entity, f.last_sync]));
    res.json(out);
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
 *         late    reached, but after the 24h (callback_at / delay_s say when) — in the full list;
 *         before  touched in the 24h BEFORE the miss (callback_at = that contact) — in the full list;
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
    const bxMissed = pbxBasis ? null : bxFor(loaded);
    const operators = respIds.length ? respIds : null;
    const stats = computeCallStatsFull(rows, from || '', to || '', operators, bxMissed, computeOpts(loaded, { detail: true }));
    const cardStats = pbxBasis && Array.isArray(bxFor(loaded))
      ? computeCallStatsFull(rows, from || '', to || '', operators, bxFor(loaded), computeOpts(loaded))
      : null;
    const detail = stats.missed_detail;
    const events = (scope === 'all' ? detail.recalled_events.concat(detail.not_recalled)
      // the reaction list is about callbacks: a miss "reached" only by a contact BEFORE it has no callback
      : scope === 'reaction' ? detail.recalled_events.filter((e) => e.status !== 'before') : detail.not_recalled.slice());
    if (scope === 'reaction' && req.query.sort === 'slow') events.sort((a, b) => (b.work_delay_s - a.work_delay_s) || (b.at - a.at));
    else events.sort((a, b) => b.at - a.at);

    // PBX side, for every event (cheap: in memory) so the summary covers the whole list.
    const match = buildPbxMatcher(rows);
    const contactOf = buildContactMatcher(rows);
    // every missed call from that number in the period (called back or not), as the tooltip says
    const attempts = new Map();
    for (const e of detail.recalled_events.concat(detail.not_recalled)) if (e.num) attempts.set(e.num, (attempts.get(e.num) || 0) + 1);
    const base = events.map((e) => {
      const p = e.num ? match(e.num, e.at) : null;
      const cb = e.num && e.callback_at ? contactOf(e.num, e.callback_at) : null;
      return {
        key: e.key,
        phone: e.phone || e.num || null,
        call_start: new Date(e.at).toISOString(),
        matched: !!p,                                        // false = the PBX has no record of this call
        operator: p && p.operator_ext ? operatorDisplayName(p.full_name) : null,  // null while matched = it rang out in the queue
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
        callback_by: cb ? (cb.operator_ext ? operatorDisplayName(cb.full_name) || cb.operator_ext : null) : null,
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
    const lateCount = detail.recalled_events.filter((e) => e.status === 'late').length;   // reached, but after 24h
    let reaction;
    if (scope === 'reaction') {
      const works = base.map((x) => x.work_delay_s || 0);
      reaction = {
        avg_work_s: avg(works),
        median_work_s: median(works) ?? 0,                               // == the "Reaksiya vaqti" card (same median)
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
        late: lateCount,                                            // reached after the 24h (not in Ne perezvonili)
        before: detail.recalled_events.filter((e) => e.status === 'before').length,   // touched in the 24h before the miss
        not_reached: detail.not_recalled.length,                    // never touched, or the 24h is still running
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

/** An operator's whole period, not the newest 1 000 (that cut made the panel's counts disagree with its
 *  row in the table: Hosiyat 2 522 calls, 1 000 listed). The ceiling only guards a year-wide range. */
const CALL_LIST_MAX = 20000;

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
  const phone = phoneNeedle(req.query.phone);
  const source = req.query.source === 'onlinepbx' || req.query.source === 'moizvonki' ? String(req.query.source) : null;
  const stage = req.query.stage && req.query.stage !== 'all' ? String(req.query.stage) : null;
  // Holat / Qo'ng'iroq turi / Davomiylik — the same meanings as the cards (services/callStats.js passRow).
  const cf = parseCallFilter(req.query);

  try {
    // The operator's extensions first, so the calls are read through the (operator_ext,
    // start_stamp) index instead of scanning every call of the period and filtering after
    // (a month for one operator took ~3 s that way). An unlinked extension whose number equals the
    // Bitrix id counts as theirs (the stats rows do the same); one linked to someone else does not.
    let exts = null;
    if (ext) exts = [ext];
    else if (respId && /^\d+$/.test(respId)) {
      const { rows: us } = await pool.query(
        'SELECT ext FROM pbx_users WHERE responsible_id = $1 OR (ext = $2 AND responsible_id IS NULL)', [Number(respId), respId]);
      exts = us.length ? us.map((u) => u.ext) : [respId];
    }
    // The lead lookup (the slow part) runs only for the rows returned — unless the Bosqich
    // filter needs it to choose them.
    const { rows } = await pool.query(
      `WITH base AS MATERIALIZED (
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
           AND ($11::int IS NULL OR c.duration >= $11::int)
           AND ($12::int IS NULL OR c.duration <= $12::int)
           -- Callback: an operator's call to a number that had a missed inbound in the 24h before.
           AND (NOT $13::bool OR (c.direction = 'outbound' AND (c.answered OR c.duration >= ${MIN_CALLBACK_DIAL_S}) AND EXISTS (
             SELECT 1 FROM pbx_calls m WHERE m.customer_norm = c.customer_norm AND m.direction = 'inbound' AND NOT m.answered
               AND m.start_stamp < c.start_stamp AND m.start_stamp >= c.start_stamp - interval '24 hours'
               AND ${tzFromOpt('m.start_stamp', '$1')})))
           AND ($10::text IS NULL
             OR ($10 = 'success' AND c.answered) OR ($10 = 'failed' AND NOT c.answered)
             OR ($10 = 'missed' AND c.direction = 'inbound' AND NOT c.answered)
             OR ($10 = 'ndz' AND c.direction = 'outbound' AND NOT c.answered)
             OR ($10 IN ('recalled', 'unrecalled') AND c.direction = 'inbound' AND NOT c.answered
                 AND ($10 = 'recalled') = EXISTS (
                   -- touched: any contact after the miss (no time limit), or in the 24h before it
                   SELECT 1 FROM pbx_calls k WHERE k.customer_norm = c.customer_norm AND k.direction <> 'local'
                     AND (k.answered OR (k.direction = 'outbound' AND k.duration >= ${MIN_CALLBACK_DIAL_S}))
                     AND k.start_stamp <> c.start_stamp AND k.start_stamp >= c.start_stamp - interval '24 hours')))
         ORDER BY c.start_stamp DESC
         LIMIT ${CALL_LIST_MAX}
       ),
       -- One lead lookup per distinct number (not per call): an operator calls the same numbers often.
       -- MATERIALIZED: the planner guessed 1 row for base and re-ran this per call (31 s for a day).
       ld AS MATERIALIZED (
         SELECT n.customer_norm, x.*
         FROM (SELECT DISTINCT customer_norm FROM base WHERE customer_norm IS NOT NULL) n
         CROSS JOIN LATERAL (
           SELECT l.id AS lead_id, l.title AS lead_title, s.name AS stage_name, s.bitrix_id AS stage_bitrix_id
           FROM lead_phones lp
           JOIN leads l ON l.id = lp.lead_id
           LEFT JOIN stages s ON s.id = l.stage_id
           WHERE RIGHT(regexp_replace(lp.phone, '\\D', '', 'g'), 9) = n.customer_norm
           ORDER BY l.date_create DESC NULLS LAST
           LIMIT 1
         ) x
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
       -- Lead match by phone, entirely in Postgres (no Bitrix round-trips): lead_phones is
       -- normalised to the same last-9-digits form as customer_norm; newest lead wins.
       LEFT JOIN ld ON ld.customer_norm = c.customer_norm
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
       ORDER BY c.start_stamp DESC`,
      [from, to, exts, phone, cf.kind === 'inbound' || cf.kind === 'outbound' ? cf.kind : null, stage, source,
        REASON_FIELDS.bekor, REASON_FIELDS.sifatsiz, cf.status, cf.durFrom, cf.durTo, cf.kind === 'callback'],
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
                ${LINE_NAME('u')} AS full_name
         FROM pbx_users u
         JOIN pbx_calls c ON c.operator_ext = u.ext
         WHERE u.ext ~ '^[0-9]+$' OR u.responsible_id IS NOT NULL`,
      ),
      // Lead stages as they exist on the portal right now — the Bosqich filter
      // matches against the lead each call resolves to by phone.
      pool.query(
        `SELECT bitrix_id, name FROM stages WHERE entity = 'lead' ORDER BY sort_order`,
      ),
    ]);
    // One entry per employee, however many lines they have: the best name, the team of any line.
    const people = new Map();
    for (const r of ops.rows) {
      const p = people.get(r.id) ?? { id: r.id, full_name: '', team: null, rank: -1 };
      const rank = operatorNameRank(r.full_name);
      if (rank > p.rank) { p.full_name = operatorDisplayName(r.full_name); p.rank = rank; }
      p.team = p.team || teamOf(r.full_name);
      people.set(r.id, p);
    }
    res.json({
      responsibles: [...people.values()]
        .map(({ rank, ...p }) => p)
        .sort((a, b) => a.full_name.localeCompare(b.full_name)),
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

/** Line (extension / Moizvonki account) → the one name its employee's lines share. */
async function lineOwners() {
  const { rows } = await pool.query(`SELECT u.ext, ${LINE_NAME('u')} AS name, u.responsible_id FROM pbx_users u`);
  const best = new Map();
  for (const u of rows) {
    if (u.responsible_id == null) continue;
    const cur = best.get(u.responsible_id);
    if (!cur || operatorNameRank(u.name) > operatorNameRank(cur)) best.set(u.responsible_id, u.name);
  }
  return new Map(rows.map((u) => [u.ext, operatorDisplayName(best.get(u.responsible_id) ?? u.name) || null]));
}

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
      `SELECT c.operator_ext,
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
    const names = await lineOwners();
    const byOp = new Map();
    for (const r of rows) {
      if (r.wait_s == null) continue;
      const operator = names.get(r.operator_ext) || r.operator_ext || 'Navbat';
      if (!byOp.has(operator)) byOp.set(operator, []);
      byOp.get(operator).push(Number(r.wait_s));
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
      `SELECT c.customer_norm, c.start_stamp, c.answered, c.operator_ext
       FROM pbx_calls c
       WHERE c.direction = 'outbound' AND c.customer_norm = ANY($1::text[])
         AND c.start_stamp >= $2 AND c.start_stamp < $3
       ORDER BY c.start_stamp`,
      [norms, new Date(Math.min(...created) - 120_000), new Date(Math.max(...created) + 7 * 86_400_000)]) : { rows: [] };
    const owners = await lineOwners();
    const callsByNorm = new Map();
    for (const c of calls) {
      if (!callsByNorm.has(c.customer_norm)) callsByNorm.set(c.customer_norm, []);
      callsByNorm.get(c.customer_norm).push({ at: new Date(c.start_stamp).getTime(), answered: c.answered, caller: owners.get(c.operator_ext) || c.operator_ext });
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
      const r = await bitrixPost('crm.duplicate.findbycomm', { type: 'PHONE', values, entity_type: t }, { fast: true });
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
           name = COALESCE(NULLIF($2, ''), auto_name,
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

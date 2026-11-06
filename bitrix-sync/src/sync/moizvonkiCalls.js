const pool = require('../db/pool');
const moizvonki = require('../services/moizvonki');
const { upsertCall, upsertUser, nowUnix } = require('./syncCalls');
const { bx } = require('./bxMissedCalls');

const DAY_SEC = 86400;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function normalizeCall(raw) {
  const outbound = Number(raw.direction) === 1;
  const operator = `mz:${raw.user_id || raw.user_account || 'unknown'}`;
  const start = Number(raw.start_time || 0);
  const end = Number(raw.end_time || start + Number(raw.duration || 0));
  return {
    uuid: `moizvonki:${raw.db_call_id || raw.event_pbx_call_id || `${raw.user_id}:${start}`}`,
    accountcode: outbound ? 'outbound' : 'inbound',
    caller_id_number: outbound ? operator : (raw.client_number || null),
    caller_id_name: raw.client_name || null,
    destination_number: outbound ? (raw.client_number || null) : operator,
    operator_ext: operator,
    start_stamp: start,
    end_stamp: end,
    duration: Number(raw.duration || 0),
    user_talk_time: raw.answered ? Number(raw.duration || 0) : 0,
    contacted: Boolean(raw.answered),
    hangup_cause: raw.answered ? 'ANSWERED' : 'NO_ANSWER',
    gateway: 'moizvonki',
    events: [],
    raw,
  };
}

async function collectRange(fromUnix, toUnix) {
  const records = new Map();
  for (let start = fromUnix; start < toUnix; start += DAY_SEC) {
    const end = Math.min(start + DAY_SEC, toUnix);
    let offset = 0;
    while (true) {
      const page = await moizvonki.listCalls(start, end, offset);
      for (const raw of page.results || []) {
        const normalized = normalizeCall(raw);
        records.set(normalized.uuid, normalized);
      }
      const next = page.results_next_offset;
      if (next == null || !(page.results || []).length || Number(next) <= offset) break;
      offset = Number(next);
      await sleep(120);
    }
    await sleep(120);
  }
  return [...records.values()];
}

/** "thompson.menejer3@gmail.com" → "Menejer 3": readable until a name is set in Sozlamalar. */
function defaultMzName(user) {
  const m = /menejer\D*(\d+)/i.exec(user.email || '');
  return m ? `Menejer ${Number(m[1])}` : (user.email || user.ext);
}

async function syncMoizUsers(records) {
  const users = new Map();
  for (const rec of records) {
    const raw = rec.raw || {};
    if (!users.has(rec.operator_ext)) users.set(rec.operator_ext, { ext: rec.operator_ext, email: raw.user_account || null });
  }
  for (const user of users.values()) {
    const responsible = user.email
      ? (await pool.query(`SELECT id, name, last_name FROM responsibles WHERE LOWER(email) = LOWER($1) LIMIT 1`, [user.email])).rows[0]
      : null;
    const name = responsible ? [responsible.name, responsible.last_name].filter(Boolean).join(' ') : defaultMzName(user);
    await upsertUser(user.ext, name, true, pool, responsible?.id || null);
    if (user.email) await pool.query('UPDATE pbx_users SET email = $2 WHERE ext = $1', [user.ext, user.email]);
  }
  return users.size;
}

// ── Who uses each account ───────────────────────────────────────
// Moizvonki reports only a login email (thompson.menejer3@gmail.com), which matches no Bitrix
// user. But its Bitrix app also registers every call in the telephony log, under the employee
// who made it. Matching the two (same number, within 2 minutes) links each account to its employee,
// by itself, including a new account or one that changes hands (its past calls then follow the new
// owner). The link puts the account's calls on the employee's row. Checked by hand on 2026-11-06:
// 797 of 837 calls matched, 79-100% of each account's calls on one employee.
const BITRIX_LINE = process.env.MOIZVONKI_BITRIX_LINE || 'REST_APP:120';   // the app's line in the log
const OWNER_WINDOW_DAYS = 3;
const OWNER_MIN_CALLS = 3;      // fewer matches: keep the current name
const OWNER_MIN_SHARE = 0.6;    // no clear majority (a shared phone): keep the current name
const MATCH_MS = 2 * 60 * 1000;
const SYSTEM_USER = '1';        // calls that rang in a queue sit on this account, not on a person

async function resolveMoizOwners({ dryRun = false, days = OWNER_WINDOW_DAYS } = {}) {
  const to = nowUnix(), from = to - days * DAY_SEC;
  const iso = (unix) => new Date(unix * 1000).toISOString().replace(/\.\d{3}Z$/, '+00:00');
  const byNumber = new Map();
  for (let start = 0; ;) {
    const res = await bx('voximplant.statistic.get', {
      FILTER: { '>=CALL_START_DATE': iso(from), '<=CALL_START_DATE': iso(to), PORTAL_NUMBER: BITRIX_LINE },
      SORT: 'ID', ORDER: 'ASC', start,
    });
    const page = res.result || [];
    for (const r of page) {
      const n = String(r.PHONE_NUMBER || '').replace(/\D/g, '').slice(-9);
      if (!byNumber.has(n)) byNumber.set(n, []);
      byNumber.get(n).push({ at: new Date(r.CALL_START_DATE).getTime(), user: String(r.PORTAL_USER_ID) });
    }
    if (res.next == null || !page.length) break;
    start = res.next;
    await sleep(400);
  }

  const { rows: calls } = await pool.query(
    `SELECT operator_ext, customer_norm, start_stamp FROM pbx_calls
     WHERE uuid LIKE 'moizvonki:%' AND start_stamp >= to_timestamp($1)`, [from]);
  const tally = new Map();
  for (const c of calls) {
    const at = new Date(c.start_stamp).getTime();
    const hit = (byNumber.get(c.customer_norm) || [])
      .filter((b) => Math.abs(b.at - at) < MATCH_MS && b.user !== SYSTEM_USER)
      .sort((a, b) => Math.abs(a.at - at) - Math.abs(b.at - at))[0];
    if (!hit) continue;
    if (!tally.has(c.operator_ext)) tally.set(c.operator_ext, new Map());
    const t = tally.get(c.operator_ext);
    t.set(hit.user, (t.get(hit.user) || 0) + 1);
  }

  const { rows: people } = await pool.query(`SELECT id::text AS id, TRIM(COALESCE(name, '') || ' ' || COALESCE(last_name, '')) AS name FROM responsibles`);
  const nameOf = new Map(people.map((p) => [p.id, p.name]));
  const decided = [];
  for (const [ext, t] of tally) {
    const total = [...t.values()].reduce((s, n) => s + n, 0);
    const [user, n] = [...t.entries()].sort((a, b) => b[1] - a[1])[0];
    if (total < OWNER_MIN_CALLS || n / total < OWNER_MIN_SHARE || !nameOf.get(user)) continue;
    const name = `${nameOf.get(user)} · Moizvonki`;
    decided.push({ ext, name, responsible_id: Number(user), matched: n, of: total });
    if (!dryRun) {
      await pool.query('UPDATE pbx_users SET auto_name = $2, name = COALESCE(custom_name, $2), responsible_id = $3 WHERE ext = $1', [ext, name, Number(user)]);
    }
  }
  console.log(`[calls] Moizvonki names: ${decided.length} accounts resolved from the Bitrix call log`);
  return decided;
}

async function syncMoizvonkiRange(fromUnix, toUnix) {
  const records = await collectRange(fromUnix, toUnix);
  await syncMoizUsers(records);
  for (const record of records) await upsertCall(record, record.operator_ext);
  await pool.query(`INSERT INTO sync_state (entity, last_sync, total_rows) VALUES ('moizvonki_calls', NOW(), $1) ON CONFLICT (entity) DO UPDATE SET last_sync = NOW(), total_rows = $1`, [records.length]);
  console.log(`[calls] Moizvonki synced ${records.length} calls`);
  return { total: records.length };
}

async function syncRecentMoizvonkiCalls(lookbackHours = 3) {
  const to = nowUnix();
  return syncMoizvonkiRange(to - lookbackHours * 3600, to);
}

module.exports = { syncMoizvonkiRange, syncRecentMoizvonkiCalls, resolveMoizOwners };

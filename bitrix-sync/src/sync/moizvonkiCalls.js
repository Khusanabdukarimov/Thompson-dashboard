const pool = require('../db/pool');
const moizvonki = require('../services/moizvonki');
const { upsertCall, upsertUser, nowUnix } = require('./syncCalls');

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
    const name = responsible ? [responsible.name, responsible.last_name].filter(Boolean).join(' ') : (user.email || user.ext);
    await upsertUser(user.ext, name, true, pool, responsible?.id || null);
  }
  return users.size;
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

module.exports = { syncMoizvonkiRange, syncRecentMoizvonkiCalls };

/**
 * The whole Bitrix24 call log → bx_calls: what Bitrix's "Детализация звонков" shows in its CRM
 * column. Every call is registered there against the CRM record it landed on — a LEAD, a
 * CONTACT (an existing client), a DEAL or a COMPANY — and that record is where the dashboard
 * must send you, not to whatever lead happens to share the phone number: on 2026-11-10 a third
 * of the calls (545 of 1 773) were filed under a Contact, and the number-based guess linked an
 * unrelated lead for 234 of them (and a different lead than Bitrix's for 44 of the lead calls).
 *
 * Source: voximplant.statistic.get, every call type. A PBX/Moizvonki call is matched to its
 * Bitrix record by number and start time (±2.5 min, see crmOfCalls in api/calls.js); 99% match.
 *
 * Names: a lead's title and a mirrored deal's title are read from our own tables; a CONTACT /
 * COMPANY / unmirrored DEAL is fetched once (50 ids per request) into bx_entity_names.
 *
 * bx_missed_calls (bxMissedCalls.js) stays as it is: it carries the owner of a missed call, which
 * the Propushenniy figures need. This table is only about where the call is filed.
 *
 * History: node src/sync/backfillBxCallLog.js [from YYYY-MM-DD] [to YYYY-MM-DD]
 */
const pool = require('../db/pool');
const { bx } = require('./bxMissedCalls');
const { normalizePhone } = require('../config/calls');

const PAGE_DELAY_MS = 400;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Entities we have no local copy of (or may not): how to ask Bitrix for a name.
const NAMED = {
  CONTACT: { method: 'crm.contact.list', select: ['ID', 'NAME', 'LAST_NAME'],
    title: (e) => [e.NAME, e.LAST_NAME].map((s) => String(s || '').trim()).filter(Boolean).join(' ') || 'Без имени' },
  COMPANY: { method: 'crm.company.list', select: ['ID', 'TITLE'], title: (e) => String(e.TITLE || '').trim() },
  DEAL:    { method: 'crm.deal.list',    select: ['ID', 'TITLE'], title: (e) => String(e.TITLE || '').trim() },
};

async function ensureSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS bx_calls (
      id              BIGINT PRIMARY KEY,      -- voximplant.statistic.get ID
      call_start      TIMESTAMPTZ NOT NULL,
      phone_norm      TEXT,                    -- last 9 digits, same form as pbx_calls.customer_norm
      call_type       SMALLINT,                -- 1 outbound · 2 inbound · 3 inbound redirect · 4 callback
      duration        INTEGER,
      failed_code     TEXT,                    -- 200 answered, 304 missed, ...
      crm_entity_type TEXT,                    -- LEAD | CONTACT | DEAL | COMPANY (the CRM column)
      crm_entity_id   BIGINT,
      crm_activity_id BIGINT,
      portal_user_id  INTEGER,
      synced_at       TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS bx_calls_phone_start_idx ON bx_calls(phone_norm, call_start);
    CREATE INDEX IF NOT EXISTS bx_calls_start_idx ON bx_calls(call_start);
    CREATE TABLE IF NOT EXISTS bx_entity_names (
      type       TEXT NOT NULL,
      id         BIGINT NOT NULL,
      title      TEXT,
      fetched_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (type, id)
    );
  `);
}

const bxDate = (unix) => new Date(unix * 1000).toISOString().replace(/\.\d{3}Z$/, '+00:00');

/** Every call with CALL_START_DATE in [fromUnix, toUnix], whatever its type. */
async function fetchCalls(fromUnix, toUnix) {
  const out = new Map();
  let start = 0;
  for (;;) {
    const res = await bx('voximplant.statistic.get', {
      FILTER: { '>=CALL_START_DATE': bxDate(fromUnix), '<=CALL_START_DATE': bxDate(toUnix) },
      SORT: 'ID', ORDER: 'ASC', start,
    });
    const page = res.result || [];
    for (const r of page) out.set(String(r.ID), r);
    if (res.next == null || !page.length) break;
    start = res.next;
    await sleep(PAGE_DELAY_MS);
  }
  return [...out.values()];
}

/** Bitrix record → bx_calls row. */
function toRow(r) {
  const entityId = parseInt(r.CRM_ENTITY_ID, 10) || null;
  return {
    id: parseInt(r.ID, 10),
    call_start: new Date(r.CALL_START_DATE).toISOString(),
    phone_norm: normalizePhone(r.PHONE_NUMBER),
    call_type: parseInt(r.CALL_TYPE, 10) || null,
    duration: parseInt(r.CALL_DURATION, 10) || 0,
    failed_code: r.CALL_FAILED_CODE != null ? String(r.CALL_FAILED_CODE) : null,
    crm_entity_type: entityId ? (r.CRM_ENTITY_TYPE || null) : null,
    crm_entity_id: entityId,
    crm_activity_id: parseInt(r.CRM_ACTIVITY_ID, 10) || null,
    portal_user_id: parseInt(r.PORTAL_USER_ID, 10) || null,
  };
}

async function upsertRows(rows, db = pool) {
  if (!rows.length) return;
  const col = (k) => rows.map((r) => r[k]);
  await db.query(
    `INSERT INTO bx_calls
       (id, call_start, phone_norm, call_type, duration, failed_code, crm_entity_type, crm_entity_id, crm_activity_id, portal_user_id, synced_at)
     SELECT id, call_start, phone_norm, call_type, duration, failed_code, crm_entity_type, crm_entity_id, crm_activity_id, portal_user_id, NOW()
     FROM unnest($1::bigint[], $2::timestamptz[], $3::text[], $4::smallint[], $5::int[], $6::text[], $7::text[], $8::bigint[], $9::bigint[], $10::int[])
       AS v(id, call_start, phone_norm, call_type, duration, failed_code, crm_entity_type, crm_entity_id, crm_activity_id, portal_user_id)
     ON CONFLICT (id) DO UPDATE SET
       call_start      = EXCLUDED.call_start,
       phone_norm      = EXCLUDED.phone_norm,
       call_type       = EXCLUDED.call_type,
       duration        = EXCLUDED.duration,
       failed_code     = EXCLUDED.failed_code,
       -- a call can be filed under a record some time after it ended: take the newest binding,
       -- but never replace a known one with "none" (a re-pull that raced the CRM)
       crm_entity_type = COALESCE(EXCLUDED.crm_entity_type, bx_calls.crm_entity_type),
       crm_entity_id   = COALESCE(EXCLUDED.crm_entity_id, bx_calls.crm_entity_id),
       crm_activity_id = COALESCE(EXCLUDED.crm_activity_id, bx_calls.crm_activity_id),
       portal_user_id  = EXCLUDED.portal_user_id,
       synced_at       = NOW()`,
    [col('id'), col('call_start'), col('phone_norm'), col('call_type'), col('duration'), col('failed_code'),
     col('crm_entity_type'), col('crm_entity_id'), col('crm_activity_id'), col('portal_user_id')],
  );
}

/** Names for the CONTACT / COMPANY / DEAL records the rows point at that we do not know yet. */
async function resolveNames(rows, db = pool) {
  const wanted = {};
  for (const r of rows) if (NAMED[r.crm_entity_type] && r.crm_entity_id) (wanted[r.crm_entity_type] = wanted[r.crm_entity_type] || new Set()).add(Number(r.crm_entity_id));
  let fetched = 0;
  for (const [type, set] of Object.entries(wanted)) {
    let ids = [...set];
    const { rows: known } = await db.query(
      `SELECT id FROM bx_entity_names WHERE type = $1 AND id = ANY($2::bigint[])`, [type, ids]);
    const have = new Set(known.map((k) => Number(k.id)));
    ids = ids.filter((id) => !have.has(id));
    if (type === 'DEAL' && ids.length) {          // a deal we mirror needs no request
      const { rows: local } = await db.query(`SELECT id FROM deals WHERE id = ANY($1::int[]) AND title IS NOT NULL`, [ids]);
      const mirrored = new Set(local.map((d) => Number(d.id)));
      ids = ids.filter((id) => !mirrored.has(id));
    }
    for (let i = 0; i < ids.length; i += 50) {
      const batch = ids.slice(i, i + 50);
      const { method, select, title } = NAMED[type];
      const res = await bx(method, { filter: { ID: batch }, select });
      const got = new Map((res.result || []).map((e) => [Number(e.ID), title(e)]));
      // an id Bitrix does not return (deleted) is stored empty, so it is not asked for again
      await db.query(
        `INSERT INTO bx_entity_names (type, id, title, fetched_at)
         SELECT $1, v.id, v.title, NOW() FROM unnest($2::bigint[], $3::text[]) AS v(id, title)
         ON CONFLICT (type, id) DO UPDATE SET title = EXCLUDED.title, fetched_at = NOW()`,
        [type, batch, batch.map((id) => got.get(id) ?? '')]);
      fetched += batch.length;
      await sleep(PAGE_DELAY_MS);
    }
  }
  return fetched;
}

async function syncBxCallLogRange(fromUnix, toUnix) {
  const records = await fetchCalls(fromUnix, toUnix);
  const rows = records.map(toRow).filter((r) => r.id && r.call_start && r.phone_norm);
  await upsertRows(rows);
  const named = await resolveNames(rows);
  await pool.query(
    `INSERT INTO sync_state (entity, last_sync, total_rows) VALUES ('bx_calls', NOW(), $1)
     ON CONFLICT (entity) DO UPDATE SET last_sync = NOW(), total_rows = $1`, [rows.length]);
  return { total: rows.length, named, bound: rows.filter((r) => r.crm_entity_id).length };
}

/** Rolling incremental sync: re-pull the last N hours (default 3), so a late filing is picked up. */
async function syncRecentBxCallLog(lookbackHours = 3) {
  const to = Math.floor(Date.now() / 1000);
  return syncBxCallLogRange(to - lookbackHours * 3600, to);
}

module.exports = { ensureSchema, fetchCalls, toRow, upsertRows, resolveNames, syncBxCallLogRange, syncRecentBxCallLog };

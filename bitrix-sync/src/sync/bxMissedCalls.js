/**
 * Bitrix24 missed inbound calls → bx_missed_calls.
 *
 * The PBX cannot say whose a missed call is: a call that rings out in a queue has
 * no operator, so per-operator "Propushenniy" came out as 0 (1955 of 2009 missed
 * calls in 1-12 Oct had none). Bitrix24 does know — the call is registered
 * against a CRM entity, and the person who has to call back is that entity's
 * responsible. Its own PORTAL_USER_ID is no help: 96% of missed calls carry user 1.
 *
 * Source: voximplant.statistic.get, CALL_TYPE 2/3 (inbound) with CALL_FAILED_CODE
 * 304 (missed). Owner = ASSIGNED_BY_ID of the linked LEAD / CONTACT / DEAL /
 * COMPANY, resolved at sync time so it is the owner when the call happened (the
 * 3h lookback re-resolves it if the lead is reassigned right after). A LEAD or DEAL
 * we already mirror is looked up locally; everything else costs one Bitrix call
 * per 50 ids.
 *
 * Operator rows come from the PBX, so a Bitrix responsible is matched to a row
 * through pbx_users.responsible_id (see linkUsersByInnerPhone in syncCalls.js).
 *
 * History: node src/sync/backfillBxMissedCalls.js [from YYYY-MM-DD] [to YYYY-MM-DD]
 */
const pool = require('../db/pool');
const { bitrixPost } = require('../services/bitrix');
const { normalizePhone } = require('../config/calls');

const MISSED_CODE = '304';
const INBOUND_TYPES = [2, 3]; // inbound, inbound redirect
const PAGE_DELAY_MS = 400;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Bitrix entity type → list method, and (when we mirror it) the local table.
const ENTITY = {
  LEAD:    { method: 'crm.lead.list',    table: 'leads' },
  CONTACT: { method: 'crm.contact.list', table: null },
  DEAL:    { method: 'crm.deal.list',    table: 'deals' },
  COMPANY: { method: 'crm.company.list', table: null },
};

async function ensureSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS bx_missed_calls (
      id              BIGINT PRIMARY KEY,      -- voximplant.statistic.get ID
      call_start      TIMESTAMPTZ NOT NULL,
      phone           TEXT,
      phone_norm      TEXT,                    -- last 9 digits, same form as pbx_calls.customer_norm
      portal_user_id  INTEGER,
      crm_entity_type TEXT,
      crm_entity_id   BIGINT,
      responsible_id  INTEGER,                 -- owner of the CRM entity: who must call back
      synced_at       TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS bx_missed_calls_start_idx ON bx_missed_calls(call_start);
    CREATE INDEX IF NOT EXISTS bx_missed_calls_phone_idx ON bx_missed_calls(phone_norm);
  `);
}

/** One Bitrix REST call with the retries this API needs (rate limits, flaky network). */
async function bx(method, params) {
  let lastErr;
  for (let attempt = 1; attempt <= 6; attempt++) {
    try {
      const res = await bitrixPost(method, params);
      if (res && res.error) {
        if (res.error === 'QUERY_LIMIT_EXCEEDED' || res.error === 'OVERLOAD_LIMIT') {
          await sleep(attempt * 3000);
          continue;
        }
        throw new Error(`${method}: ${res.error} ${res.error_description || ''}`.trim());
      }
      return res;
    } catch (err) {
      lastErr = err;
      if (/^[a-z.]+: [A-Z_]+/.test(err.message)) throw err; // a real API error, not transient
      await sleep(attempt * 2000);
    }
  }
  throw lastErr || new Error(`${method} failed`);
}

const bxDate = (unix) => new Date(unix * 1000).toISOString().replace(/\.\d{3}Z$/, '+00:00');

/** Every missed inbound call with CALL_START_DATE in [fromUnix, toUnix]. */
async function fetchMissed(fromUnix, toUnix) {
  const out = new Map();
  for (const type of INBOUND_TYPES) {
    let start = 0;
    for (;;) {
      const res = await bx('voximplant.statistic.get', {
        FILTER: {
          '>=CALL_START_DATE': bxDate(fromUnix),
          '<=CALL_START_DATE': bxDate(toUnix),
          CALL_TYPE: type,
          CALL_FAILED_CODE: MISSED_CODE,
        },
        SORT: 'ID', ORDER: 'ASC', start,
      });
      const page = res.result || [];
      for (const r of page) out.set(String(r.ID), r);
      if (res.next == null || !page.length) break;
      start = res.next;
      await sleep(PAGE_DELAY_MS);
    }
  }
  return [...out.values()];
}

/** "LEAD:123" → responsible id, for every CRM entity the records point at. */
async function resolveOwners(records) {
  const wanted = {};
  for (const r of records) {
    const t = r.CRM_ENTITY_TYPE, id = parseInt(r.CRM_ENTITY_ID, 10);
    if (ENTITY[t] && id) (wanted[t] = wanted[t] || new Set()).add(id);
  }
  const owners = new Map();
  for (const [type, set] of Object.entries(wanted)) {
    let ids = [...set];
    const { table, method } = ENTITY[type];
    if (table) {
      const { rows } = await pool.query(
        `SELECT id, responsible_id FROM ${table} WHERE id = ANY($1::int[]) AND responsible_id IS NOT NULL`, [ids]);
      for (const row of rows) owners.set(`${type}:${row.id}`, row.responsible_id);
      ids = ids.filter((id) => !owners.has(`${type}:${id}`));
    }
    for (let i = 0; i < ids.length; i += 50) {
      const res = await bx(method, { filter: { ID: ids.slice(i, i + 50) }, select: ['ID', 'ASSIGNED_BY_ID'] });
      for (const e of res.result || []) {
        const owner = parseInt(e.ASSIGNED_BY_ID, 10);
        if (owner) owners.set(`${type}:${parseInt(e.ID, 10)}`, owner);
      }
      await sleep(PAGE_DELAY_MS);
    }
  }
  return owners;
}

/** Bitrix record → bx_missed_calls row. */
function toRow(r, owners) {
  const portalUser = parseInt(r.PORTAL_USER_ID, 10) || null;
  const entityId = parseInt(r.CRM_ENTITY_ID, 10) || null;
  const owner = owners.get(`${r.CRM_ENTITY_TYPE}:${entityId}`);
  return {
    id: parseInt(r.ID, 10),
    call_start: new Date(r.CALL_START_DATE).toISOString(),
    phone: r.PHONE_NUMBER || null,
    phone_norm: normalizePhone(r.PHONE_NUMBER),
    portal_user_id: portalUser,
    crm_entity_type: r.CRM_ENTITY_TYPE || null,
    crm_entity_id: entityId,
    // No CRM owner: fall back to the user the call was registered on, unless that is
    // the default user 1 — the one every unattributed call lands on.
    responsible_id: owner ?? (portalUser && portalUser !== 1 ? portalUser : null),
  };
}

async function upsertRows(rows, db = pool) {
  if (!rows.length) return;
  const col = (k) => rows.map((r) => r[k]);
  await db.query(
    `INSERT INTO bx_missed_calls
       (id, call_start, phone, phone_norm, portal_user_id, crm_entity_type, crm_entity_id, responsible_id, synced_at)
     SELECT id, call_start, phone, phone_norm, portal_user_id, crm_entity_type, crm_entity_id, responsible_id, NOW()
     FROM unnest($1::bigint[], $2::timestamptz[], $3::text[], $4::text[], $5::int[], $6::text[], $7::bigint[], $8::int[])
       AS v(id, call_start, phone, phone_norm, portal_user_id, crm_entity_type, crm_entity_id, responsible_id)
     ON CONFLICT (id) DO UPDATE SET
       call_start      = EXCLUDED.call_start,
       phone           = EXCLUDED.phone,
       phone_norm      = EXCLUDED.phone_norm,
       portal_user_id  = EXCLUDED.portal_user_id,
       crm_entity_type = EXCLUDED.crm_entity_type,
       crm_entity_id   = EXCLUDED.crm_entity_id,
       -- never replace a known owner with "unknown" (a lookup that failed this time)
       responsible_id  = COALESCE(EXCLUDED.responsible_id, bx_missed_calls.responsible_id),
       synced_at       = NOW()`,
    [col('id'), col('call_start'), col('phone'), col('phone_norm'), col('portal_user_id'),
     col('crm_entity_type'), col('crm_entity_id'), col('responsible_id')],
  );
}

async function syncBxMissedRange(fromUnix, toUnix) {
  const records = await fetchMissed(fromUnix, toUnix);
  const owners = await resolveOwners(records);
  const rows = records.map((r) => toRow(r, owners));
  await upsertRows(rows);
  return { total: rows.length, unresolved: rows.filter((r) => r.responsible_id == null).length };
}

/** Rolling incremental sync: re-pull the last N hours (default 3). */
async function syncRecentBxMissed(lookbackHours = 3) {
  const to = Math.floor(Date.now() / 1000);
  return syncBxMissedRange(to - lookbackHours * 3600, to);
}

module.exports = {
  ensureSchema, fetchMissed, resolveOwners, toRow, upsertRows, syncBxMissedRange, syncRecentBxMissed,
};

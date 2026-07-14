/**
 * One-time backfill: fetches all leads with every UF_* field and fills
 * lead_uf_fields / lead_uf_enums / lead_uf_values. Touches nothing else
 * (no stage resolution, no Bitrix writes, no deals/contacts).
 *
 * Uses ID-cursor pagination (start=-1) — the offset-based `start` pagination
 * recounts the whole table on every page and triggered OVERLOAD_LIMIT on a
 * 198k-lead portal. On OVERLOAD_LIMIT it sleeps 5 minutes and retries.
 *
 * Run:    node src/sync/backfillLeadUf.js [resumeFromLeadId]
 */
require('dotenv').config();
const pool = require('../db/pool');
const { bitrixCall } = require('../services/bitrix');
const { ensureSchema, syncLeadUfMeta, upsertLeadUfValues } = require('../services/ufSync');

const PAGE_DELAY_MS = 1200;
const OVERLOAD_WAIT_MS = 5 * 60 * 1000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchPage(lastId) {
  for (;;) {
    let res;
    try {
      res = await bitrixCall('crm.lead.list', {
        order: { ID: 'ASC' },
        filter: { '>ID': lastId },
        select: ['ID', 'UF_*'],
        start: -1,
      });
    } catch (e) {
      console.warn(`[backfill] request error after ID ${lastId}: ${e.message} — retrying in 30s`);
      await sleep(30000);
      continue;
    }
    if (res && res.result) return res.result;
    const err = res && res.error;
    if (err === 'OVERLOAD_LIMIT' || err === 'QUERY_LIMIT_EXCEEDED') {
      console.warn(`[backfill] ${err} after ID ${lastId} — sleeping 5 min`);
      await sleep(OVERLOAD_WAIT_MS);
      continue;
    }
    throw new Error(`crm.lead.list failed after ID ${lastId}: ${err} ${res && res.error_description || ''}`);
  }
}

async function main() {
  console.log('=== Lead UF backfill ===');
  await ensureSchema();
  await syncLeadUfMeta();

  let lastId = parseInt(process.argv[2] || '0', 10) || 0;
  let count = 0, skipped = 0;
  console.log(`[backfill] Starting from lead ID > ${lastId}`);

  for (;;) {
    const rows = await fetchPage(lastId);
    if (!rows.length) break;
    for (const r of rows) {
      try {
        await upsertLeadUfValues(r);
      } catch (e) {
        skipped++; // lead absent locally (deleted) — FK violation is expected
      }
      count++;
    }
    lastId = parseInt(rows[rows.length - 1].ID);
    if (count % 5000 < rows.length) {
      console.log(`[backfill] ${count} leads processed, cursor at ID ${lastId}`);
    }
    await sleep(PAGE_DELAY_MS);
  }

  const { rows } = await pool.query(
    `SELECT count(*)::int AS vals, count(DISTINCT lead_id)::int AS leads FROM lead_uf_values`);
  console.log(`[backfill] Done: processed ${count} (${skipped} skipped), table now has ${rows[0].vals} values for ${rows[0].leads} leads`);
  await pool.end();
}

main().catch((err) => {
  console.error('[backfill] Fatal error:', err);
  process.exit(1);
});

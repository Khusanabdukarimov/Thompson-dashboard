/**
 * One-time backfill: fetches all leads with every UF_* field and fills
 * lead_uf_fields / lead_uf_enums / lead_uf_values. Touches nothing else
 * (no stage resolution, no Bitrix writes, no deals/contacts).
 * Run: node src/sync/backfillLeadUf.js
 */
require('dotenv').config();
const pool = require('../db/pool');
const { fetchAll } = require('../services/bitrix');
const { ensureSchema, syncLeadUfMeta, upsertLeadUfValues } = require('../services/ufSync');

async function main() {
  console.log('=== Lead UF backfill ===');
  await ensureSchema();
  await syncLeadUfMeta();

  console.log('[backfill] Fetching leads (ID + UF_*)...');
  const leads = await fetchAll('crm.lead.list', {}, ['ID', 'UF_*']);
  console.log(`[backfill] Got ${leads.length} leads, writing UF values...`);

  let count = 0, skipped = 0;
  for (const r of leads) {
    try {
      await upsertLeadUfValues(r);
    } catch (e) {
      // Lead may not exist locally (e.g. deleted) — FK violation is expected, skip
      skipped++;
    }
    count++;
    if (count % 1000 === 0) console.log(`[backfill] ${count}/${leads.length}`);
  }

  const { rows } = await pool.query(
    `SELECT count(*)::int AS vals, count(DISTINCT lead_id)::int AS leads FROM lead_uf_values`);
  console.log(`[backfill] Done: ${rows[0].vals} values for ${rows[0].leads} leads (${skipped} skipped)`);
  await pool.end();
}

main().catch((err) => {
  console.error('[backfill] Fatal error:', err);
  process.exit(1);
});

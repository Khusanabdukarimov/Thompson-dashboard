require('dotenv').config();
const pool = require('../src/db/pool');
const { fetchAll } = require('../src/services/bitrix');
const { upsertDeal } = require('../src/services/upsertDeal');
const { loadAll: loadStages } = require('../src/services/stageResolver');

const DEAL_SELECT = [
  'ID', 'ASSIGNED_BY_ID', 'STAGE_ID', 'OPPORTUNITY', 'CURRENCY_ID',
  'SOURCE_ID', 'UTM_SOURCE', 'DATE_CREATE', 'CLOSEDATE', 'UF_CRM_69EBC105EAA93',
];

async function syncDeals() {
  console.log('[sync] Fetching deals...');
  const deals = await fetchAll('crm.deal.list', {}, DEAL_SELECT);
  console.log(`[sync] Got ${deals.length} deals, upserting...`);

  let count = 0;
  for (const r of deals) {
    await upsertDeal(r);
    count++;
    if (count % 100 === 0) {
      console.log(`[sync] Deals progress: ${count}/${deals.length}`);
    }
  }

  await pool.query(
    `INSERT INTO sync_state (entity, last_sync, total_rows)
     VALUES ('deals', NOW(), $1)
     ON CONFLICT (entity) DO UPDATE SET last_sync = NOW(), total_rows = $1`,
    [deals.length]
  );

  console.log(`[sync] Deals done: ${deals.length} upserted`);
}

async function main() {
  console.log('=== Bitrix24 Deal-Only Backfill Sync ===');
  console.log('Loading stages...');
  await loadStages();
  await syncDeals();
  console.log('\n=== Sync complete ===');
  await pool.end();
}

main().catch((err) => {
  console.error('[sync] Fatal error:', err);
  process.exit(1);
});

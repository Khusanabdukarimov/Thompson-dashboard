require('dotenv').config();
const pool = require('../src/db/pool');
const { fetchAll } = require('../src/services/bitrix');
const { upsertDeal } = require('../src/services/upsertDeal');

const DEAL_SELECT = [
  'ID', 'ASSIGNED_BY_ID', 'STAGE_ID', 'OPPORTUNITY', 'CURRENCY_ID',
  'SOURCE_ID', 'UTM_SOURCE', 'DATE_CREATE', 'DATE_MODIFY', 'CLOSEDATE',
  'UF_CRM_69EBC105EAA93', 'UF_CRM_1779450406', 'CONTACT_ID',
];

async function syncDeals() {
  console.log('[backfill] Fetching deals...');
  const deals = await fetchAll('crm.deal.list', {}, DEAL_SELECT);
  console.log(`[backfill] Got ${deals.length} deals, upserting...`);

  let count = 0;
  for (const r of deals) {
    await upsertDeal(r);
    count++;
    if (count % 500 === 0) {
      console.log(`[backfill] Deals progress: ${count}/${deals.length}`);
    }
  }
  console.log(`[backfill] Deals done: ${deals.length} upserted`);
}

async function syncContacts() {
  console.log('[backfill] Fetching contacts...');
  const contacts = await fetchAll('crm.contact.list', {}, ['ID', 'PHONE']);
  console.log(`[backfill] Got ${contacts.length} contacts, upserting...`);

  await pool.query('DELETE FROM contact_phones');

  for (const c of contacts) {
    if (c.PHONE && Array.isArray(c.PHONE)) {
      for (const p of c.PHONE) {
        const phone = p.VALUE;
        if (phone) {
          await pool.query(
            `INSERT INTO contact_phones (contact_id, phone)
             VALUES ($1, $2)
             ON CONFLICT DO NOTHING`,
            [parseInt(c.ID), phone]
          );
        }
      }
    }
  }
  console.log(`[backfill] Contacts done: ${contacts.length} synced`);
}

async function main() {
  console.log('=== Fast Backfill Sync ===');
  await syncDeals();
  await syncContacts();

  console.log('[backfill] Populating deal_phones from contact_phones...');
  await pool.query('DELETE FROM deal_phones');
  await pool.query(`
    INSERT INTO deal_phones (deal_id, phone)
    SELECT DISTINCT d.id, cp.phone
    FROM deals d
    JOIN contact_phones cp ON cp.contact_id = d.contact_id
    ON CONFLICT DO NOTHING
  `);
  console.log('[backfill] deal_phones populated successfully');

  // Let's verify how many deal phone matches we got
  const { rows } = await pool.query(`
    SELECT COUNT(DISTINCT d.id) AS matched_deals, COUNT(d.id) AS total_deals
    FROM deals d
    JOIN deal_phones dp ON dp.deal_id = d.id
  `);
  console.log('\n=== Backfill results ===');
  console.log(`  Deals with phone numbers: ${matched_deals = rows[0].matched_deals}`);

  await pool.end();
}

main().catch((err) => {
  console.error('[backfill] Fatal error:', err);
  process.exit(1);
});

// Backfill lead_phones for leads that have no phone saved locally.
// Fetches PHONE field from Bitrix24 and upserts into lead_phones.
require('dotenv').config();
const pool = require('../src/db/pool');
const { bitrixCall } = require('../src/services/bitrix');

async function main() {
  // Find leads with no entry in lead_phones
  const { rows } = await pool.query(`
    SELECT l.id FROM leads l
    WHERE NOT EXISTS (SELECT 1 FROM lead_phones lp WHERE lp.lead_id = l.id)
    ORDER BY l.id DESC
  `);

  console.log(`Found ${rows.length} leads without phone. Fetching from Bitrix24...`);

  let updated = 0, skipped = 0, errors = 0;

  for (const { id } of rows) {
    try {
      const res = await bitrixCall('crm.lead.get', { id, select: ['ID', 'PHONE'] });
      const lead = res.result;
      if (!lead) { skipped++; continue; }

      const phones = Array.isArray(lead.PHONE) ? lead.PHONE : [];
      if (!phones.length) { skipped++; continue; }

      for (const p of phones) {
        const val = (p.VALUE || '').trim();
        if (!val) continue;
        await pool.query(
          `INSERT INTO lead_phones (lead_id, phone) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [id, val]
        );
      }
      updated++;
      if (updated % 50 === 0) console.log(`  ${updated} leads updated...`);
    } catch (e) {
      console.error(`Lead ${id} error:`, e.message);
      errors++;
    }
  }

  console.log(`\nDone. Updated: ${updated}, Skipped: ${skipped}, Errors: ${errors}`);
  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });

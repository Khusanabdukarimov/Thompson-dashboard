/**
 * One-time backfill: for all leads in the "Website" stage,
 * fetch their COMMENTS from Bitrix24 and update date_create if it's a valid ISO datetime.
 *
 * Usage:  node scripts/backfill_website_lead_dates.js
 */

require('dotenv').config();
const pool     = require('../src/db/pool');
const { fetchOne } = require('../src/services/bitrix');

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

function parseDate(s) {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

async function main() {
  // Get all leads whose title is 'Website' (website form leads)
  const leadsRes = await pool.query(
    `SELECT id, date_create FROM leads WHERE LOWER(TRIM(title)) = 'website' ORDER BY id`
  );
  console.log(`Found ${leadsRes.rows.length} leads in Website stage`);

  let updated = 0;
  let skipped = 0;

  for (const lead of leadsRes.rows) {
    try {
      const raw = await fetchOne('crm.lead.get', lead.id);
      if (!raw) { skipped++; continue; }

      const comment = (raw.COMMENTS || '').trim();
      if (!ISO_DATE_RE.test(comment)) { skipped++; continue; }

      const newDate = parseDate(comment);
      if (!newDate) { skipped++; continue; }

      await pool.query(
        `UPDATE leads SET date_create = $1 WHERE id = $2`,
        [newDate, lead.id]
      );
      console.log(`Lead ${lead.id}: ${lead.date_create} → ${newDate}`);
      updated++;
    } catch (err) {
      console.error(`Lead ${lead.id} error:`, err.message);
      skipped++;
    }
  }

  console.log(`\nDone. Updated: ${updated}, Skipped: ${skipped}`);
  await pool.end();
}

main().catch(err => { console.error(err); process.exit(1); });

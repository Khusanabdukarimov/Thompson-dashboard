'use strict';
require('dotenv').config();

const pool = require('../src/db/pool');
const { fetchOne } = require('../src/services/bitrix');
const { upsertLead } = require('../src/services/upsertLead');

async function main() {
  const { rows } = await pool.query(`
    SELECT DISTINCT entity_id
    FROM webhook_logs
    WHERE event IN ('ONCRMLEAD_ADD', 'ONCRMLEAD_UPDATE')
      AND processed = FALSE
    ORDER BY entity_id
  `);

  console.log(`Replaying ${rows.length} failed lead webhooks...`);
  let ok = 0, failed = 0;

  for (const { entity_id } of rows) {
    try {
      const raw = await fetchOne('crm.lead.get', entity_id);
      if (!raw) {
        console.log(`  [SKIP] ${entity_id} — not found in Bitrix`);
        await pool.query(
          `UPDATE webhook_logs SET processed = TRUE, error = 'lead not found in Bitrix'
           WHERE entity_id = $1 AND processed = FALSE`,
          [entity_id]
        );
        continue;
      }
      await upsertLead(raw);
      await pool.query(
        `UPDATE webhook_logs SET processed = TRUE, error = NULL
         WHERE entity_id = $1 AND processed = FALSE`,
        [entity_id]
      );
      console.log(`  [OK] ${entity_id}`);
      ok++;
    } catch (err) {
      console.error(`  [ERR] ${entity_id}: ${err.message}`);
      await pool.query(
        `UPDATE webhook_logs SET error = $1
         WHERE entity_id = $2 AND processed = FALSE`,
        [err.message, entity_id]
      ).catch(() => {});
      failed++;
    }
    await new Promise(r => setTimeout(r, 300)); // respect Bitrix rate limit
  }

  console.log(`\nDone: ${ok} ok, ${failed} failed`);
  await pool.end();
}

main().catch(err => { console.error(err); process.exit(1); });

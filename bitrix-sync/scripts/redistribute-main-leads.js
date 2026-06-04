/**
 * One-time script: redistribute IN_PROCESS leads that were previously
 * assigned to main responsible, equally (round-robin) across active
 * taqsimot distributors.
 * Run on server: node scripts/redistribute-main-leads.js
 */
require('dotenv').config();

const { bitrixCall } = require('../src/services/bitrix');
const pool = require('../src/db/pool');

async function run() {
  // Get active taqsimot distributors
  const { rows: distributors } = await pool.query(
    `SELECT id, name FROM responsibles WHERE taqsimot_pct > 0 AND active = TRUE ORDER BY id`
  );

  if (distributors.length === 0) {
    console.log('[redistribute] No active distributors found.');
    return;
  }

  console.log(`[redistribute] Distributors (${distributors.length}):`,
    distributors.map(d => `${d.name}(${d.id})`).join(', '));

  // Get all IN_PROCESS leads currently assigned to any of the distributors
  // that were synced recently (originally came from main responsible)
  const distIds = distributors.map(d => d.id);
  const { rows: leads } = await pool.query(
    `SELECT l.id
     FROM leads l
     JOIN stages s ON s.id = l.stage_id
     WHERE s.bitrix_id = 'IN_PROCESS'
       AND l.responsible_id = ANY($1::int[])
       AND (l.source_id IS NULL OR l.source_id != 'UC_1WUFJB')
     ORDER BY l.id`,
    [distIds]
  );

  console.log(`[redistribute] Found ${leads.length} leads to redistribute equally`);
  if (leads.length === 0) {
    console.log('[redistribute] Nothing to do.');
    return;
  }

  const counts = {};
  distributors.forEach(d => { counts[d.id] = 0; });

  let distributed = 0;
  let failed = 0;

  for (let i = 0; i < leads.length; i++) {
    const leadId = leads[i].id;
    const assignee = distributors[i % distributors.length];

    try {
      await pool.query('UPDATE leads SET responsible_id = $1 WHERE id = $2', [assignee.id, leadId]);

      bitrixCall('crm.lead.update', {
        id: leadId,
        fields: { ASSIGNED_BY_ID: assignee.id },
      }).catch(err => console.error(`[redistribute] Bitrix update failed for lead ${leadId}:`, err.message));

      counts[assignee.id]++;
      distributed++;
    } catch (err) {
      console.error(`[redistribute] Lead ${leadId} error: ${err.message}`);
      failed++;
    }
  }

  console.log('\n[redistribute] Result:');
  distributors.forEach(d => {
    console.log(`  ${d.name}: ${counts[d.id]} leads`);
  });
  console.log(`  Total distributed: ${distributed}, failed: ${failed}`);
}

run()
  .catch(err => console.error('[redistribute] Fatal:', err.message))
  .finally(() => pool.end());

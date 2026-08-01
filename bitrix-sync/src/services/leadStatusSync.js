const pool = require('../db/pool');
const { bitrixCall } = require('./bitrix');

/**
 * Pull the lead status dictionary from Bitrix and mirror it into `stages`.
 *
 * Why this exists: stages rows were previously created ad-hoc by stageResolver
 * whenever an unseen STATUS_ID showed up, which left them with name = bitrix_id
 * (UC_N0PI5R, UC_O7Y5NT) and guessed is_final/is_won flags. Dashboard metrics
 * key off those flags, so a wrong flag silently mis-counts leads.
 *
 * `semantics` is the value the reports actually care about — it mirrors Bitrix's
 * SEMANTICS for a lead status, normalised so in-progress is an explicit 'P'
 * rather than NULL:
 *   'P' in progress (Bitrix sends null)   'S' success/won   'F' failed/closed
 */
async function syncLeadStatuses() {
  const res = await bitrixCall('crm.status.list', { filter: { ENTITY_ID: 'STATUS' } });
  const list = res?.result ?? [];
  if (!list.length) throw new Error('crm.status.list returned no lead statuses');

  let updated = 0;
  for (const s of list) {
    const semantics = s.SEMANTICS === 'S' ? 'S' : s.SEMANTICS === 'F' ? 'F' : 'P';
    await pool.query(
      `INSERT INTO stages (entity, bitrix_id, name, sort_order, semantics, is_won, is_final)
       VALUES ('lead', $1, $2, $3, $4, $5, $6)
       ON CONFLICT (entity, bitrix_id) DO UPDATE SET
         name       = EXCLUDED.name,
         sort_order = EXCLUDED.sort_order,
         semantics  = EXCLUDED.semantics,
         is_won     = EXCLUDED.is_won,
         is_final   = EXCLUDED.is_final`,
      [
        s.STATUS_ID,
        s.NAME || s.STATUS_ID,
        parseInt(s.SORT, 10) || 0,
        semantics,
        semantics === 'S',
        semantics === 'S' || semantics === 'F',
      ]
    );
    updated++;
  }

  // stageResolver caches stages.id → invalidate so renamed rows are re-read.
  try { require('./stageResolver').invalidate(); } catch { /* optional */ }

  console.log(`[leadStatusSync] ${updated} lead statuses synced from Bitrix`);
  return updated;
}

module.exports = { syncLeadStatuses };

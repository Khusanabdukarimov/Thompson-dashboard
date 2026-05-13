const pool = require('../db/pool');
const { fetchOne } = require('../services/bitrix');
const { upsertLead } = require('../services/upsertLead');

/**
 * Handle ONCRMLEAD_UPDATE webhook.
 * Responds 200 immediately, processes async. Records stage change if applicable.
 */
async function leadUpdated(req, res) {
  res.sendStatus(200);

  const entityId = parseInt(req.body?.data?.FIELDS?.ID || req.body?.['data[FIELDS][ID]']);
  if (!entityId) return;

  try {
    await pool.query(
      `INSERT INTO webhook_logs (event, entity_id, payload)
       VALUES ('ONCRMLEAD_UPDATE', $1, $2)`,
      [entityId, JSON.stringify(req.body)]
    );

    // Capture current stage before upsert to detect transitions
    const before = await pool.query('SELECT stage_id FROM leads WHERE id = $1', [entityId]);
    const prevStageId = before.rows[0]?.stage_id || null;

    const raw = await fetchOne('crm.lead.get', entityId);
    if (!raw) return;

    await upsertLead(raw);

    // Record stage history if stage changed
    const after = await pool.query('SELECT stage_id FROM leads WHERE id = $1', [entityId]);
    const newStageId = after.rows[0]?.stage_id || null;

    if (newStageId && newStageId !== prevStageId) {
      await pool.query(
        'INSERT INTO lead_stage_history (lead_id, stage_id) VALUES ($1, $2)',
        [entityId, newStageId]
      );
    }

    await pool.query(
      'UPDATE webhook_logs SET processed = TRUE WHERE event = $1 AND entity_id = $2 AND processed = FALSE',
      ['ONCRMLEAD_UPDATE', entityId]
    );

    console.log(`[webhook] lead updated: ${entityId}`);
  } catch (err) {
    console.error(`[webhook] leadUpdated error for ${entityId}:`, err.message);
    await pool.query(
      `UPDATE webhook_logs SET error = $1
       WHERE event = 'ONCRMLEAD_UPDATE' AND entity_id = $2 AND processed = FALSE`,
      [err.message, entityId]
    ).catch(() => {});
  }
}

module.exports = leadUpdated;

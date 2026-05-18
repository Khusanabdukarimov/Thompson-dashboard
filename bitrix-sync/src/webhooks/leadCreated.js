const pool = require('../db/pool');
const { fetchOne } = require('../services/bitrix');
const { upsertLead } = require('../services/upsertLead');

const LEAD_SELECT = [
  'ID', 'ASSIGNED_BY_ID', 'STATUS_ID', 'OPPORTUNITY', 'SOURCE_ID',
  'UTM_SOURCE', 'UTM_MEDIUM', 'UTM_CAMPAIGN', 'UTM_CONTENT', 'UTM_TERM',
  'DATE_CREATE', 'DATE_MODIFY', 'NAME', 'LAST_NAME', 'TITLE',
  'UF_CRM_1775825731211', 'UF_CRM_1778260858916',
  'UF_CRM_1775824803703', 'UF_CRM_1775825155935', 'UF_CRM_1770281264686',
  'UF_CRM_1770976355232', 'UF_CRM_1770282341169',
];

/**
 * Handle ONCRMLEAD_ADD webhook.
 * Express handler — responds 200 immediately, processes async.
 */
async function leadCreated(req, res) {
  res.sendStatus(200);

  const entityId = parseInt(req.body?.data?.FIELDS?.ID || req.body?.['data[FIELDS][ID]']);
  if (!entityId) return;

  try {
    await pool.query(
      `INSERT INTO webhook_logs (event, entity_id, payload)
       VALUES ('ONCRMLEAD_ADD', $1, $2)`,
      [entityId, JSON.stringify(req.body)]
    );

    const raw = await fetchOne('crm.lead.get', entityId);
    if (!raw) return;

    await upsertLead(raw);

    // Record initial stage in history
    const lead = await pool.query('SELECT id, stage_id FROM leads WHERE id = $1', [entityId]);
    if (lead.rows.length && lead.rows[0].stage_id) {
      await pool.query(
        'INSERT INTO lead_stage_history (lead_id, stage_id) VALUES ($1, $2)',
        [entityId, lead.rows[0].stage_id]
      );
    }

    await pool.query(
      'UPDATE webhook_logs SET processed = TRUE WHERE event = $1 AND entity_id = $2 AND processed = FALSE',
      ['ONCRMLEAD_ADD', entityId]
    );

    console.log(`[webhook] lead created: ${entityId}`);
  } catch (err) {
    console.error(`[webhook] leadCreated error for ${entityId}:`, err.message);
    await pool.query(
      `UPDATE webhook_logs SET error = $1
       WHERE event = 'ONCRMLEAD_ADD' AND entity_id = $2 AND processed = FALSE`,
      [err.message, entityId]
    ).catch(() => {});
  }
}

module.exports = leadCreated;

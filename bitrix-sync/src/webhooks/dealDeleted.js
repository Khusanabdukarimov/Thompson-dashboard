const pool = require('../db/pool');

async function dealDeleted(req, res) {
  res.sendStatus(200);

  const entityId = parseInt(req.body?.data?.FIELDS?.ID || req.body?.['data[FIELDS][ID]']);
  if (!entityId) return;

  try {
    await pool.query(
      `INSERT INTO webhook_logs (event, entity_id, payload)
       VALUES ('ONCRMDEALDEL', $1, $2)`,
      [entityId, JSON.stringify(req.body)]
    );

    await pool.query('DELETE FROM deals WHERE id = $1', [entityId]);

    await pool.query(
      'UPDATE webhook_logs SET processed = TRUE WHERE event = $1 AND entity_id = $2 AND processed = FALSE',
      ['ONCRMDEALDEL', entityId]
    );

    console.log(`[webhook] deal deleted: ${entityId}`);
  } catch (err) {
    console.error(`[webhook] dealDeleted error for ${entityId}:`, err.message);
    await pool.query(
      `UPDATE webhook_logs SET error = $1
       WHERE event = 'ONCRMDEALDEL' AND entity_id = $2 AND processed = FALSE`,
      [err.message, entityId]
    ).catch(() => {});
  }
}

module.exports = dealDeleted;

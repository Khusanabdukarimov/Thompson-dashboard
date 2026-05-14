const pool = require('../db/pool');

/**
 * Handle ONTASKMANAGER_TASK_DELETE webhook.
 * Removes the task from the DB. No Bitrix24 API call needed.
 */
async function taskDeleted(req, res) {
  res.sendStatus(200);

  // Deleted events carry the ID in FIELDS_BEFORE
  const taskId = parseInt(
    req.body?.data?.FIELDS_BEFORE?.ID    ||
    req.body?.['data[FIELDS_BEFORE][ID]'] ||
    req.body?.data?.FIELDS?.ID            ||
    req.body?.['data[FIELDS][ID]']
  );
  if (!taskId || isNaN(taskId)) return;

  try {
    await pool.query(
      `INSERT INTO webhook_logs (event, entity_id, payload)
       VALUES ('ONTASKMANAGER_TASK_DELETE', $1, $2)`,
      [taskId, JSON.stringify(req.body)]
    );

    await pool.query('DELETE FROM tasks WHERE id = $1', [taskId]);

    await pool.query(
      `UPDATE webhook_logs SET processed = TRUE
       WHERE event = 'ONTASKMANAGER_TASK_DELETE' AND entity_id = $1 AND processed = FALSE`,
      [taskId]
    );

    console.log(`[webhook] task deleted: ${taskId}`);
  } catch (err) {
    console.error(`[webhook] taskDeleted error for ${taskId}:`, err.message);
    await pool.query(
      `UPDATE webhook_logs SET error = $1
       WHERE event = 'ONTASKMANAGER_TASK_DELETE' AND entity_id = $2 AND processed = FALSE`,
      [err.message, taskId]
    ).catch(() => {});
  }
}

module.exports = taskDeleted;

const pool = require('../db/pool');
const { fetchAll } = require('./bitrix');

/**
 * Mirror Bitrix users into `responsibles`.
 *
 * This table is the FK target for leads.responsible_id and deals.responsible_id,
 * so a user missing here does not merely leave the owner blank — Postgres
 * rejects the whole row. Before this ran on a schedule the table had last been
 * synced 2026-07-13, and ~8% of lead webhooks were failing with
 * leads_responsible_id_fkey: new leads never landed and updates were refused,
 * which froze existing rows at whatever stage they held when their owner was
 * still known.
 *
 * Inactive users are kept (marked active = FALSE) rather than deleted — their
 * historical leads still need a valid owner to point at.
 */
async function syncResponsibles() {
  const users = await fetchAll('user.get', {});
  if (!users.length) throw new Error('user.get returned no users');

  let n = 0;
  for (const u of users) {
    const id = parseInt(u.ID, 10);
    if (!id) continue;
    await pool.query(
      `INSERT INTO responsibles (id, name, last_name, email, work_position, active, synced_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       ON CONFLICT (id) DO UPDATE SET
         name          = EXCLUDED.name,
         last_name     = EXCLUDED.last_name,
         email         = EXCLUDED.email,
         work_position = EXCLUDED.work_position,
         active        = EXCLUDED.active,
         synced_at     = NOW()`,
      [
        id,
        u.NAME || `User ${id}`,
        u.LAST_NAME || null,
        u.EMAIL || null,
        u.WORK_POSITION || null,
        u.ACTIVE !== false && u.ACTIVE !== 'N',
      ]
    );
    n++;
  }

  await pool.query(
    `INSERT INTO sync_state (entity, last_sync, total_rows)
     VALUES ('users', NOW(), $1)
     ON CONFLICT (entity) DO UPDATE SET last_sync = NOW(), total_rows = $1`,
    [n]
  );

  console.log(`[responsibleSync] ${n} users synced`);
  return n;
}

module.exports = { syncResponsibles };

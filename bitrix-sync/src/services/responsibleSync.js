const pool = require('../db/pool');
const { fetchAll, bitrixPost } = require('./bitrix');

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
  await pool.query('ALTER TABLE responsibles ADD COLUMN IF NOT EXISTS department_ids INT[]');
  const users = await fetchAll('user.get', {});
  if (!users.length) throw new Error('user.get returned no users');

  let n = 0;
  for (const u of users) {
    const id = parseInt(u.ID, 10);
    if (!id) continue;
    await pool.query(
      `INSERT INTO responsibles (id, name, last_name, email, work_position, phone_inner, active, department_ids, synced_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
       ON CONFLICT (id) DO UPDATE SET
         name          = EXCLUDED.name,
         last_name     = EXCLUDED.last_name,
         email         = EXCLUDED.email,
         work_position = EXCLUDED.work_position,
         phone_inner   = EXCLUDED.phone_inner,
         active        = EXCLUDED.active,
         department_ids = EXCLUDED.department_ids,
         synced_at     = NOW()`,
      [
        id,
        u.NAME || `User ${id}`,
        u.LAST_NAME || null,
        u.EMAIL || null,
        u.WORK_POSITION || null,
        String(u.UF_PHONE_INNER || '').trim() || null, // internal phone = PBX extension
        u.ACTIVE !== false && u.ACTIVE !== 'N',
        (Array.isArray(u.UF_DEPARTMENT) ? u.UF_DEPARTMENT : []).map(Number).filter(Boolean),
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
  try { await syncDepartments(); }
  catch (err) { console.warn('[responsibleSync] departments skipped:', err.message); }
  // Extension numbers may just have changed hands; re-link the PBX operators.
  try { await require('../sync/syncCalls').linkUsersByInnerPhone(); }
  catch (err) { console.warn('[responsibleSync] PBX link skipped:', err.message); }
  return n;
}

/**
 * Bitrix company structure for the Lidlar "Bo'lim / Mas'ul" picker. The webhook
 * has no `department` scope, but im.department.get (im scope) returns the same
 * names; its full_name is "NAME / PARENT", which gives the tree. One request.
 */
async function syncDepartments() {
  await pool.query(`CREATE TABLE IF NOT EXISTS departments (
    id INT PRIMARY KEY, name TEXT NOT NULL, full_name TEXT, parent_id INT, synced_at TIMESTAMPTZ DEFAULT NOW())`);
  const { rows } = await pool.query('SELECT DISTINCT unnest(department_ids) AS id FROM responsibles');
  // Ask for every id a user points at plus a range, so parents nobody sits in directly come back too.
  const ids = [...new Set([...rows.map(r => Number(r.id)), ...Array.from({ length: 200 }, (_, i) => i + 1)])];
  const res = await bitrixPost('im.department.get', { ID: ids });
  if (res?.error) throw new Error(`${res.error} ${res.error_description || ''}`);
  const list = res?.result || [];
  if (!list.length) return 0;
  const idByName = new Map(list.map(d => [String(d.name).trim(), Number(d.id)]));
  for (const d of list) {
    const parentName = String(d.full_name || '').split(' / ')[1]?.trim();
    const parentId = parentName ? idByName.get(parentName) ?? null : null;
    await pool.query(
      `INSERT INTO departments (id, name, full_name, parent_id, synced_at) VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, full_name = EXCLUDED.full_name,
         parent_id = EXCLUDED.parent_id, synced_at = NOW()`,
      [Number(d.id), String(d.name).trim(), d.full_name || null, parentId === Number(d.id) ? null : parentId]
    );
  }
  console.log(`[responsibleSync] ${list.length} departments synced`);
  return list.length;
}

module.exports = { syncResponsibles, syncDepartments };

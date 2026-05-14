const pool = require('../db/pool');

// In-memory cache: "lead:NEW" → stages.id (integer)
const _cache = new Map();
let _loaded = false;

async function loadAll() {
  const { rows } = await pool.query('SELECT id, entity, bitrix_id FROM stages');
  rows.forEach((r) => _cache.set(`${r.entity}:${r.bitrix_id}`, r.id));
  _loaded = true;
}

/**
 * Resolve a Bitrix24 status string to the local stages.id.
 * Inserts a new stage row if not found (so unknown statuses don't break upserts).
 */
async function resolve(entity, bitrixId) {
  if (!bitrixId) return null;
  if (!_loaded) await loadAll();

  const key = `${entity}:${bitrixId}`;
  if (_cache.has(key)) return _cache.get(key);

  // Unknown stage — insert it so we don't lose data; never overwrite existing names
  let { rows } = await pool.query(
    `INSERT INTO stages (entity, bitrix_id, name, sort_order)
     VALUES ($1, $2, $3, 999)
     ON CONFLICT (entity, bitrix_id) DO NOTHING
     RETURNING id`,
    [entity, bitrixId, bitrixId]
  );

  if (!rows.length) {
    const res = await pool.query(
      'SELECT id FROM stages WHERE entity = $1 AND bitrix_id = $2',
      [entity, bitrixId]
    );
    rows = res.rows;
  }

  const id = rows[0].id;
  _cache.set(key, id);
  return id;
}

function invalidate() {
  _cache.clear();
  _loaded = false;
}

module.exports = { resolve, loadAll, invalidate };

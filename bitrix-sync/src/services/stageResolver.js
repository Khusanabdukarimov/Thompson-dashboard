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

  // Infer is_won / is_final from the Bitrix stage code pattern (e.g. C4:WON, C2:LOSE)
  const suffix   = bitrixId.includes(':') ? bitrixId.split(':').pop().toUpperCase() : '';
  const isWon    = suffix === 'WON';
  const isFinal  = isWon || suffix === 'LOSE' || suffix === 'LOSE';

  // Unknown stage — insert it so we don't lose data; never overwrite existing names
  let { rows } = await pool.query(
    `INSERT INTO stages (entity, bitrix_id, name, sort_order, is_won, is_final)
     VALUES ($1, $2, $3, 999, $4, $5)
     ON CONFLICT (entity, bitrix_id) DO UPDATE
       SET is_won   = CASE WHEN EXCLUDED.is_won   THEN TRUE ELSE stages.is_won   END,
           is_final = CASE WHEN EXCLUDED.is_final THEN TRUE ELSE stages.is_final END
     RETURNING id`,
    [entity, bitrixId, bitrixId, isWon, isFinal]
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

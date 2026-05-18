const pool = require('../src/db/pool');

async function main() {
  console.log('Querying Postgres for deals in C1 stages...');
  const { rows } = await pool.query(
    `SELECT d.id, d.title, s.bitrix_id, d.uf_cancel_reason
     FROM deals d
     JOIN stages s ON s.id = d.stage_id
     WHERE s.bitrix_id LIKE 'C1:%'
     LIMIT 10`
  );
  console.log('Local Postgres deals sample:', rows);
  await pool.end();
}

main().catch(console.error);

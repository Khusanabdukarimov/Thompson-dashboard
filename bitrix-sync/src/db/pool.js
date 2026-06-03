require('dotenv').config();
const { Pool, types } = require('pg');

// DATE (OID 1082): return as plain "YYYY-MM-DD" string instead of letting
// node-postgres convert through a JS Date, which applies the connection
// timezone (Asia/Tashkent, UTC+5) and shifts midnight on the 1st into the
// previous month in UTC — e.g. 2026-06-01 → "2026-05-31T19:00:00.000Z".
types.setTypeParser(1082, val => val);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  console.error('[pg] Unexpected pool error:', err.message);
});

pool.on('connect', (client) => {
  client.query("SET TIME ZONE 'Asia/Tashkent'");
});

module.exports = pool;

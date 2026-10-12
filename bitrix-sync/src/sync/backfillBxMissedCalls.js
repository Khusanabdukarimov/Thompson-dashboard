/**
 * One-time history load for bx_missed_calls (see bxMissedCalls.js). New calls are
 * picked up by the rolling sync; this only fills the past.
 *
 * Walks one day at a time (Tashkent midnight to midnight) so a failure loses at
 * most a day and can be resumed with the same arguments. Idempotent.
 *
 * Run:  node src/sync/backfillBxMissedCalls.js [from=2026-07-01] [to=today]
 *       (dates are Asia/Tashkent days; 2026-07-01 is the first day of PBX history)
 */
require('dotenv').config();
const pool = require('../db/pool');
const { ensureSchema, syncBxMissedRange } = require('./bxMissedCalls');

const TZ_OFFSET_S = 5 * 3600; // Asia/Tashkent, no DST
const DAY_S = 86400;
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));
// Tashkent midnight of "YYYY-MM-DD" as unix seconds.
const dayStart = (iso) => Math.floor(Date.parse(`${iso}T00:00:00Z`) / 1000) - TZ_OFFSET_S;
const todayTashkent = () => new Date(Date.now() + TZ_OFFSET_S * 1000).toISOString().slice(0, 10);

async function main() {
  const from = isDate(process.argv[2]) ? process.argv[2] : '2026-07-01';
  const to = isDate(process.argv[3]) ? process.argv[3] : todayTashkent();
  await ensureSchema();
  console.log(`=== Bitrix24 missed calls backfill ${from} → ${to} ===`);

  let days = 0, total = 0, unresolved = 0;
  for (let s = dayStart(from); s <= dayStart(to); s += DAY_S) {
    const day = new Date((s + TZ_OFFSET_S) * 1000).toISOString().slice(0, 10);
    const r = await syncBxMissedRange(s, s + DAY_S - 1);
    days++; total += r.total; unresolved += r.unresolved;
    console.log(`[bx-missed] ${day}: ${r.total} missed calls (${r.unresolved} without an owner)`);
  }
  console.log(`[bx-missed] Done — ${days} days, ${total} calls, ${unresolved} without an owner`);
  await pool.end();
}

main().catch((e) => { console.error('[bx-missed] FAILED:', e); process.exit(1); });

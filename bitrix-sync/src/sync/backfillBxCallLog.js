/**
 * One-time history load for bx_calls (see bxCallLog.js). New calls are picked up by the rolling
 * sync; this only fills the past, so the calls of earlier weeks open the CRM record Bitrix filed
 * them under.
 *
 * Walks one day at a time (Tashkent midnight to midnight) so a failure loses at most a day and can
 * be resumed with the same arguments. Idempotent. About 1 800 calls a day = ~36 Bitrix requests plus
 * the contact names (cached, so later days are cheaper); measured ~2 minutes for the first day, so
 * a month takes roughly an hour. The pages are paced for the portal's rate limit.
 *
 * Run:  node src/sync/backfillBxCallLog.js [from=2026-10-01] [to=today]
 *       (dates are Asia/Tashkent days)
 */
require('dotenv').config();
const pool = require('../db/pool');
const { ensureSchema, syncBxCallLogRange } = require('./bxCallLog');

const TZ_OFFSET_S = 5 * 3600; // Asia/Tashkent, no DST
const DAY_S = 86400;
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));
// Tashkent midnight of "YYYY-MM-DD" as unix seconds.
const dayStart = (iso) => Math.floor(Date.parse(`${iso}T00:00:00Z`) / 1000) - TZ_OFFSET_S;
const todayTashkent = () => new Date(Date.now() + TZ_OFFSET_S * 1000).toISOString().slice(0, 10);

async function main() {
  const from = isDate(process.argv[2]) ? process.argv[2] : '2026-10-01';
  const to = isDate(process.argv[3]) ? process.argv[3] : todayTashkent();
  await ensureSchema();
  console.log(`=== Bitrix24 call log backfill ${from} → ${to} ===`);

  let days = 0, total = 0, bound = 0;
  for (let s = dayStart(from); s <= dayStart(to); s += DAY_S) {
    const day = new Date((s + TZ_OFFSET_S) * 1000).toISOString().slice(0, 10);
    const r = await syncBxCallLogRange(s, s + DAY_S - 1);
    days++; total += r.total; bound += r.bound;
    console.log(`[bx-calls] ${day}: ${r.total} calls, ${r.bound} filed under a CRM record, ${r.named} names fetched`);
  }
  console.log(`[bx-calls] Done — ${days} days, ${total} calls, ${bound} filed under a CRM record`);
  await pool.end();
}

main().catch((e) => { console.error('[bx-calls] FAILED:', e); process.exit(1); });

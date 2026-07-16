/**
 * Backfill PBX call history for a date range (the periodic sync only sweeps
 * the last few hours; this pulls the past).
 *
 * Usage: node scripts/backfill_calls.js 2026-07-01 2026-07-15
 * Dates are inclusive, interpreted in Asia/Tashkent. Idempotent (upsert by uuid).
 */
require('dotenv').config();
const { syncUsers, syncCallRange } = require('../src/sync/syncCalls');

const TZ_OFFSET_SEC = 5 * 3600; // Asia/Tashkent

function dayStartUnix(iso) {
  const t = Date.parse(`${iso}T00:00:00Z`);
  if (Number.isNaN(t)) {
    console.error(`Bad date: ${iso} (expected YYYY-MM-DD)`);
    process.exit(1);
  }
  return t / 1000 - TZ_OFFSET_SEC;
}

async function main() {
  const [from, to] = process.argv.slice(2);
  if (!from || !to) {
    console.error('Usage: node scripts/backfill_calls.js <from YYYY-MM-DD> <to YYYY-MM-DD>');
    process.exit(1);
  }

  await syncUsers();
  const { total, stubbed } = await syncCallRange(dayStartUnix(from), dayStartUnix(to) + 86400);
  console.log(`calls synced: ${total} (${stubbed} stubbed) — ${from} → ${to}`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });

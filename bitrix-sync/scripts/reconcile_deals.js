#!/usr/bin/env node
/*
 * Re-pull deals from Bitrix for a date window and re-upsert them.
 *
 * Companion to reconcile_leads.js, and the more urgent of the two: deals took
 * the worst of the deals_responsible_id_fkey bug — 4162 failures against the
 * leads' 2414, with ONCRMDEALADD failing at 10.8%. Same two symptoms as leads:
 * deals we never stored, and deals frozen at an old stage because the update
 * that would have moved them was rejected whole.
 *
 * Pages on the ID cursor (filter[>ID], order by ID ASC) — offset paging skips
 * rows when records shift mid-run. upsertDeal is idempotent; safe to re-run and
 * safe to run live.
 *
 * Usage:
 *   node scripts/reconcile_deals.js --from=2026-07-01 [--to=2026-08-01]
 *   node scripts/reconcile_deals.js --from=2026-06-01 --by=modify
 */
require('dotenv').config();
const { upsertDeal } = require('../src/services/upsertDeal');
const pool = require('../src/db/pool');

const BASE = (process.env.BITRIX_WEBHOOK_URL || '').replace(/\/$/, '');
if (!BASE) { console.error('BITRIX_WEBHOOK_URL not set'); process.exit(1); }

const arg = (n) => (process.argv.find(a => a.startsWith(`--${n}=`)) || '').split('=')[1];
const from = arg('from');
const to   = arg('to');
const by   = arg('by') === 'modify' ? 'DATE_MODIFY' : 'DATE_CREATE';

if (!from) {
  console.error('Usage: node scripts/reconcile_deals.js --from=YYYY-MM-DD [--to=YYYY-MM-DD] [--by=create|modify]');
  process.exit(1);
}

const SELECT = [
  'ID', 'ASSIGNED_BY_ID', 'STAGE_ID', 'OPPORTUNITY', 'CURRENCY_ID',
  'SOURCE_ID', 'UTM_SOURCE', 'DATE_CREATE', 'DATE_MODIFY', 'CLOSEDATE', 'BEGINDATE',
  'CONTACT_ID', 'UF_*',
];

const dateFilter = () => {
  const f = { [`>=${by}`]: `${from}T00:00:00+05:00` };
  if (to) f[`<=${by}`] = `${to}T23:59:59+05:00`;
  return f;
};

function buildUrl(params) {
  const url = new URL(BASE + '/crm.deal.list.json');
  const walk = (p, v) => {
    if (Array.isArray(v)) v.forEach((x, i) => walk(`${p}[${i}]`, x));
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(`${p}[${k}]`, x);
    else url.searchParams.append(p, v);
  };
  for (const [k, v] of Object.entries(params)) walk(k, v);
  return url;
}

async function get(params, tries = 4) {
  for (let i = 1; ; i++) {
    try {
      const r = await fetch(buildUrl(params));
      const j = await r.json();
      if (j.error) throw new Error(`${j.error} ${j.error_description || ''}`);
      return j;
    } catch (e) {
      if (i >= tries) throw e;
      await new Promise(r => setTimeout(r, 1000 * i));
    }
  }
}

(async () => {
  const expected = (await get({ filter: dateFilter(), select: ['ID'] })).total;
  console.log(`[reconcile_deals] Bitrix reports ${expected} deals by ${by} ${from}${to ? ` → ${to}` : ''}`);

  let lastId = 0, fetched = 0, ok = 0, failed = 0;
  for (;;) {
    const j = await get({
      filter: { ...dateFilter(), '>ID': lastId },
      order: { ID: 'ASC' },
      select: SELECT,
      start: -1,
    });
    const batch = j.result || [];
    if (!batch.length) break;

    for (const r of batch) {
      fetched++;
      try { await upsertDeal(r); ok++; } catch (e) {
        failed++;
        if (failed <= 5) console.warn(`  deal ${r.ID}: ${e.message}`);
      }
      const id = parseInt(r.ID, 10);
      if (id > lastId) lastId = id;
    }
    process.stdout.write(`\r[reconcile_deals] ${fetched}/${expected} fetched, ${ok} upserted, ${failed} failed`);
    await new Promise(r => setTimeout(r, 400));
  }

  console.log(`\n[reconcile_deals] done — ${fetched} fetched of ${expected} expected, ${ok} upserted, ${failed} failed`);
  await pool.query(
    `INSERT INTO sync_state (entity, last_sync, total_rows)
     VALUES ('deals', NOW(), $1)
     ON CONFLICT (entity) DO UPDATE SET last_sync = NOW(), total_rows = $1`,
    [ok]
  );
  await pool.end();
  process.exit(fetched < expected ? 1 : 0);
})().catch(e => { console.error('\n[reconcile_deals] FAILED:', e.message); process.exit(1); });

#!/usr/bin/env node
/*
 * Re-pull leads from Bitrix for a date window and re-upsert them.
 *
 * Why this exists: leads are ingested by webhook only (ONCRMLEAD_ADD /
 * ONCRMLEAD_UPDATE), so anything lost to a restart or a network blip is never
 * recovered. Reconciling July 2026 showed both failure modes — leads we never
 * received, and leads held at a stale stage because we missed the *update* that
 * moved them (a surplus in early stages against a deficit in CONVERTED).
 * Separately, the create-webhook used to fetch a narrow field list and never
 * stored Proekt, so those leads fall outside the dashboard's Proekt scope until
 * they are re-pulled with UF_*.
 *
 * Paging walks the ID cursor (filter[>ID], order by ID ASC) rather than the
 * `start` offset. Offset paging silently skips rows when records are created or
 * re-sorted mid-run, which is why an earlier version kept landing 12297 of
 * 12614 July leads no matter how often it was re-run. An ID cursor cannot skip
 * or repeat.
 *
 * upsertLead is idempotent, so this is safe to re-run and safe to run live.
 *
 * Usage:
 *   node scripts/reconcile_leads.js --from=2026-07-01 [--to=2026-08-01]
 *   node scripts/reconcile_leads.js --from=2026-07-01 --by=modify
 *
 *   --by=create (default) reconciles leads CREATED in the window.
 *   --by=modify           reconciles leads CHANGED in the window — the right
 *                         mode for a routine catch-up sweep, since it also
 *                         picks up older leads that moved stage recently.
 */
require('dotenv').config();
const { upsertLead } = require('../src/services/upsertLead');
const pool = require('../src/db/pool');

const BASE = (process.env.BITRIX_WEBHOOK_URL || '').replace(/\/$/, '');
if (!BASE) { console.error('BITRIX_WEBHOOK_URL not set'); process.exit(1); }

const arg = (n) => (process.argv.find(a => a.startsWith(`--${n}=`)) || '').split('=')[1];
const from = arg('from');
const to   = arg('to');
const by   = arg('by') === 'modify' ? 'DATE_MODIFY' : 'DATE_CREATE';

if (!from) {
  console.error('Usage: node scripts/reconcile_leads.js --from=YYYY-MM-DD [--to=YYYY-MM-DD] [--by=create|modify]');
  process.exit(1);
}

// Pull every custom field: the dashboard reads Proekt, Proekt2 and both tashrif
// date fields, and a narrow select silently drops them from lead_uf_values.
const SELECT = [
  'ID', 'ASSIGNED_BY_ID', 'STATUS_ID', 'OPPORTUNITY', 'SOURCE_ID',
  'UTM_SOURCE', 'UTM_MEDIUM', 'UTM_CAMPAIGN', 'UTM_CONTENT', 'UTM_TERM',
  'DATE_CREATE', 'DATE_MODIFY', 'NAME', 'LAST_NAME', 'TITLE', 'COMMENTS', 'PHONE', 'WEB_FORM_ID',
  'UF_*',
];

const dateFilter = () => {
  const f = { [`>=${by}`]: `${from}T00:00:00+05:00` };
  if (to) f[`<=${by}`] = `${to}T23:59:59+05:00`;
  return f;
};

function buildUrl(params) {
  const url = new URL(BASE + '/crm.lead.list.json');
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

/** Authoritative count, so we can assert we actually fetched everything. */
async function bitrixTotal() {
  const j = await get({ filter: dateFilter(), select: ['ID'] });
  return j.total;
}

(async () => {
  const expected = await bitrixTotal();
  console.log(`[reconcile_leads] Bitrix reports ${expected} leads by ${by} ${from}${to ? ` → ${to}` : ''}`);

  let lastId = 0, fetched = 0, ok = 0, failed = 0;
  for (;;) {
    const j = await get({
      filter: { ...dateFilter(), '>ID': lastId },
      order: { ID: 'ASC' },
      select: SELECT,
      start: -1, // disable offset counting; we page on the ID cursor instead
    });
    const batch = j.result || [];
    if (!batch.length) break;

    for (const r of batch) {
      fetched++;
      try { await upsertLead(r); ok++; } catch (e) {
        failed++;
        if (failed <= 5) console.warn(`  lead ${r.ID}: ${e.message}`);
      }
      const id = parseInt(r.ID, 10);
      if (id > lastId) lastId = id;
    }
    process.stdout.write(`\r[reconcile_leads] ${fetched}/${expected} fetched, ${ok} upserted, ${failed} failed`);
    await new Promise(r => setTimeout(r, 400)); // stay under the REST rate limit
  }

  console.log(`\n[reconcile_leads] done — ${fetched} fetched of ${expected} expected, ${ok} upserted, ${failed} failed`);
  if (fetched < expected) {
    console.warn(`[reconcile_leads] WARNING: ${expected - fetched} leads were not returned by Bitrix — re-run to retry`);
  }

  await pool.query(
    `INSERT INTO sync_state (entity, last_sync, total_rows)
     VALUES ('leads', NOW(), $1)
     ON CONFLICT (entity) DO UPDATE SET last_sync = NOW(), total_rows = $1`,
    [ok]
  );
  await pool.end();
  process.exit(fetched < expected ? 1 : 0);
})().catch(e => { console.error('\n[reconcile_leads] FAILED:', e.message); process.exit(1); });

#!/usr/bin/env node
/*
 * Re-pull leads from Bitrix for a date window and re-upsert them.
 *
 * Leads are ingested by webhook only (ONCRMLEAD_ADD / ONCRMLEAD_UPDATE), so a
 * webhook lost to a restart or a network blip is never recovered. That shows up
 * two ways when reconciling against Bitrix:
 *   - leads we never received at all, and
 *   - leads we hold at a stale stage, because we missed the *update* that moved
 *     them. The signature is a surplus in early stages and a matching deficit in
 *     CONVERTED.
 * Re-upserting a window repairs both. upsertLead is idempotent, so this is safe
 * to re-run, and safe to run while the service is live.
 *
 * Usage:
 *   node scripts/reconcile_leads.js --from=2026-07-01 [--to=2026-07-31]
 *   node scripts/reconcile_leads.js --from=2026-07-01 --by=modify
 *
 *   --by=create (default) reconciles leads CREATED in the window.
 *   --by=modify           reconciles leads CHANGED in the window — use this for
 *                         a routine catch-up sweep, since it also picks up old
 *                         leads that moved stage recently.
 */
require('dotenv').config();
const { fetchAll } = require('../src/services/bitrix');
const { upsertLead } = require('../src/services/upsertLead');
const pool = require('../src/db/pool');

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
const LEAD_SELECT = [
  'ID', 'ASSIGNED_BY_ID', 'STATUS_ID', 'OPPORTUNITY', 'SOURCE_ID',
  'UTM_SOURCE', 'UTM_MEDIUM', 'UTM_CAMPAIGN', 'UTM_CONTENT', 'UTM_TERM',
  'DATE_CREATE', 'DATE_MODIFY', 'NAME', 'LAST_NAME', 'TITLE', 'COMMENTS', 'PHONE', 'WEB_FORM_ID',
  'UF_*',
];

(async () => {
  const filter = { [`>=${by}`]: `${from}T00:00:00+05:00` };
  if (to) filter[`<=${by}`] = `${to}T23:59:59+05:00`;

  console.log(`[reconcile_leads] fetching leads by ${by} ${from}${to ? ` → ${to}` : ''} …`);
  const leads = await fetchAll('crm.lead.list', filter, LEAD_SELECT);
  console.log(`[reconcile_leads] Bitrix returned ${leads.length} leads, upserting …`);

  let ok = 0, failed = 0;
  for (const r of leads) {
    try { await upsertLead(r); ok++; } catch (e) {
      failed++;
      if (failed <= 5) console.warn(`  lead ${r.ID}: ${e.message}`);
    }
    if ((ok + failed) % 500 === 0) {
      process.stdout.write(`\r[reconcile_leads] ${ok + failed}/${leads.length}`);
    }
  }

  console.log(`\n[reconcile_leads] done — ${ok} upserted, ${failed} failed`);
  await pool.query(
    `INSERT INTO sync_state (entity, last_sync, total_rows)
     VALUES ('leads', NOW(), $1)
     ON CONFLICT (entity) DO UPDATE SET last_sync = NOW(), total_rows = $1`,
    [ok]
  );
  await pool.end();
})().catch(e => { console.error('\n[reconcile_leads] FAILED:', e.message); process.exit(1); });

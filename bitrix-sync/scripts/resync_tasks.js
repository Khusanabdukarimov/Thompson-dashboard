#!/usr/bin/env node
/*
 * Re-pull every task from Bitrix and re-upsert it.
 *
 * Needed because tasks only ever arrive through the ONTASKADD / ONTASKUPDATE
 * webhooks, so rows written under the old (shifted) STATUS_MAP kept their wrong
 * status forever — status 5 "Completed" had been stored as 'rejected', which is
 * why "Tugatilgan" read zero for every operator.
 *
 * Safe to re-run: upsertTask is idempotent.
 *
 * Usage: node scripts/resync_tasks.js [--from=YYYY-MM-DD]
 */
require('dotenv').config();
const { upsertTask } = require('../src/services/upsertTask');

const BASE = (process.env.BITRIX_WEBHOOK_URL || '').replace(/\/$/, '');
if (!BASE) { console.error('BITRIX_WEBHOOK_URL not set'); process.exit(1); }

const fromArg = (process.argv.find(a => a.startsWith('--from=')) || '').split('=')[1];

const SELECT = [
  'ID', 'TITLE', 'STATUS', 'CREATED_BY', 'RESPONSIBLE_ID',
  'CREATED_DATE', 'CHANGED_DATE', 'CLOSED_DATE', 'DEADLINE', 'UF_CRM_TASK',
];

async function page(start) {
  const url = new URL(BASE + '/tasks.task.list.json');
  SELECT.forEach(f => url.searchParams.append('select[]', f));
  url.searchParams.append('order[ID]', 'ASC');
  url.searchParams.append('start', String(start));
  if (fromArg) url.searchParams.append('filter[>=CREATED_DATE]', `${fromArg}T00:00:00+05:00`);
  const r = await fetch(url);
  const j = await r.json();
  if (j.error) throw new Error(`${j.error} ${j.error_description}`);
  return j;
}

(async () => {
  let start = 0, seen = 0, ok = 0, failed = 0;
  const byStatus = {};
  for (;;) {
    const j = await page(start);
    const tasks = j.result?.tasks ?? [];
    if (!tasks.length) break;
    for (const t of tasks) {
      seen++;
      byStatus[t.status] = (byStatus[t.status] || 0) + 1;
      try { await upsertTask(t); ok++; } catch (e) {
        failed++;
        if (failed <= 5) console.warn(`  task ${t.id}: ${e.message}`);
      }
    }
    process.stdout.write(`\r[resync_tasks] ${seen} seen, ${ok} upserted, ${failed} failed`);
    if (j.next === undefined || j.next === null) break;
    start = j.next;
    await new Promise(r => setTimeout(r, 400)); // stay under the REST rate limit
  }
  console.log(`\n[resync_tasks] done — ${ok}/${seen} upserted, ${failed} failed`);
  console.log('[resync_tasks] Bitrix status distribution:', byStatus);
  process.exit(0);
})().catch(e => { console.error('\n[resync_tasks] FAILED:', e.message); process.exit(1); });

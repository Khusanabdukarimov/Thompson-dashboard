/**
 * One-time backfill for the Sdelkalar pipelines (Учебный центр = category 0,
 * Школа | YANGI = category 25): copies TITLE, Причина (UF_CRM_6075517B5CAD2) and
 * Стадия (для отчетов) (UF_CRM_6A364190B79ED) from Bitrix into deals.title /
 * deals.uf_prichina / deals.uf_report_stage for deals already in the DB.
 *
 * New and changed deals get all three from the webhooks via upsertDeal; this only
 * covers history. Touches nothing but those three columns, and only rows that
 * exist — it never inserts deals.
 *
 * Same paging as backfillLeadUf: ID cursor (start=-1), sleep on OVERLOAD_LIMIT.
 * One pass per category: bitrix.buildUrl flattens a filter array to "0,25",
 * which Bitrix reads as category 0 alone, so CATEGORY_ID must stay scalar.
 *
 * Run:    node src/sync/backfillDealDetails.js [resumeFromDealId]
 */
require('dotenv').config();
const pool = require('../db/pool');
const { bitrixCall } = require('../services/bitrix');

const PRICHINA = 'UF_CRM_6075517B5CAD2';
const REPORT_STAGE = 'UF_CRM_6A364190B79ED';
const CATEGORIES = [0, 25];
const PAGE_DELAY_MS = 1200;
const OVERLOAD_WAIT_MS = 5 * 60 * 1000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchPage(categoryId, lastId) {
  for (;;) {
    let res;
    try {
      res = await bitrixCall('crm.deal.list', {
        order: { ID: 'ASC' },
        filter: { '>ID': lastId, CATEGORY_ID: categoryId },
        select: ['ID', 'TITLE', PRICHINA, REPORT_STAGE],
        start: -1,
      });
    } catch (e) {
      console.warn(`[deal-details] request error after ID ${lastId}: ${e.message} — retrying in 30s`);
      await sleep(30000);
      continue;
    }
    if (res && res.result) return res.result;
    const err = res && res.error;
    if (err === 'OVERLOAD_LIMIT' || err === 'QUERY_LIMIT_EXCEEDED') {
      console.warn(`[deal-details] ${err} after ID ${lastId} — sleeping 5 min`);
      await sleep(OVERLOAD_WAIT_MS);
      continue;
    }
    throw new Error(`crm.deal.list failed after ID ${lastId}: ${err} ${res && res.error_description || ''}`);
  }
}

async function main() {
  console.log('=== Deal title + Причина + Стадия (для отчетов) backfill ===');
  await pool.query('ALTER TABLE deals ADD COLUMN IF NOT EXISTS uf_prichina TEXT');
  await pool.query('ALTER TABLE deals ADD COLUMN IF NOT EXISTS uf_report_stage TEXT');

  const resumeFrom = parseInt(process.argv[2] || '0', 10) || 0;
  let seen = 0, updated = 0;

  for (const categoryId of CATEGORIES) {
    let lastId = resumeFrom;
    console.log(`[deal-details] category ${categoryId}: starting from deal ID > ${lastId}`);

    for (;;) {
      const rows = await fetchPage(categoryId, lastId);
      if (!rows.length) break;
      const ids = [], titles = [], reasons = [], stages = [];
      for (const r of rows) {
        const p = Array.isArray(r[PRICHINA]) ? r[PRICHINA][0] : r[PRICHINA];
        ids.push(parseInt(r.ID, 10));
        titles.push(r.TITLE || null);
        reasons.push(p != null && String(p) !== '' ? String(p) : null);
        // Same normalisation as upsertDeal's ufText, so backfilled and live values match.
        const st = r[REPORT_STAGE] == null ? '' : String(Array.isArray(r[REPORT_STAGE]) ? r[REPORT_STAGE][0] ?? '' : r[REPORT_STAGE]);
        stages.push(st.replace(/\s+/g, ' ').trim() || null);
      }
      const { rowCount } = await pool.query(
        `UPDATE deals d SET title = v.t, uf_prichina = v.p, uf_report_stage = v.s
         FROM unnest($1::int[], $2::text[], $3::text[], $4::text[]) AS v(id, t, p, s)
         WHERE d.id = v.id
           AND (d.title IS DISTINCT FROM v.t OR d.uf_prichina IS DISTINCT FROM v.p
                OR d.uf_report_stage IS DISTINCT FROM v.s)`,
        [ids, titles, reasons, stages]
      );
      updated += rowCount;
      seen += rows.length;
      lastId = ids[ids.length - 1];
      if (seen % 1000 < rows.length) console.log(`[deal-details] category ${categoryId}: seen ${seen}, updated ${updated}, last ID ${lastId}`);
      await sleep(PAGE_DELAY_MS);
    }
  }

  console.log(`[deal-details] Done — seen ${seen} Bitrix deals, updated ${updated} DB rows`);
  await pool.end();
}

main().catch((e) => { console.error('[deal-details] FAILED:', e); process.exit(1); });

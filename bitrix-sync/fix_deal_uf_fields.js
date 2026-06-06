/**
 * Backfill payment fields for all existing deals from Bitrix24:
 *   uf_bp_sale_date  ← UF_CRM_10_1780604989 (BP sale date)
 *   uf_payment_date  ← UF_CRM_1779450159    (to'lov kiritilgan sana)
 *   uf_paid_sum      ← UF_CRM_1780643524    (to'langan summa)
 *   uf_remaining_sum ← UF_CRM_1780643502    (qolgan summa)
 *
 * Run from bitrix-sync dir:
 *   node fix_deal_uf_fields.js
 */
require('dotenv').config();
const pool = require('./src/db/pool');
const { fetchAll } = require('./src/services/bitrix');

function parseDate(s) {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

function parseNum(s) {
  if (s == null || s === '' || s === false) return null;
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

async function main() {
  console.log('[backfill] Fetching all deals from Bitrix24...');

  const deals = await fetchAll('crm.deal.list', {}, [
    'ID',
    'UF_CRM_10_1780604989',
    'UF_CRM_1779450159',
    'UF_CRM_1780643524',
    'UF_CRM_1780643502',
  ]);

  console.log(`[backfill] Got ${deals.length} deals. Updating DB...`);

  let updated = 0;
  let skipped = 0;

  for (const d of deals) {
    const id            = parseInt(d.ID);
    const bpSaleDate    = parseDate(d.UF_CRM_10_1780604989);
    const paymentDate   = parseDate(d.UF_CRM_1779450159);
    const paidSum       = parseNum(d.UF_CRM_1780643524);
    const remainingSum  = parseNum(d.UF_CRM_1780643502);

    if (bpSaleDate == null && paymentDate == null && paidSum == null && remainingSum == null) {
      skipped++;
      continue;
    }

    await pool.query(
      `UPDATE deals
          SET uf_bp_sale_date  = $1,
              uf_payment_date  = $2,
              uf_paid_sum      = $3,
              uf_remaining_sum = $4
        WHERE id = $5`,
      [bpSaleDate, paymentDate, paidSum, remainingSum, id]
    );
    updated++;

    if (updated % 100 === 0) {
      console.log(`  ${updated} updated...`);
    }
  }

  console.log(`[backfill] Done. updated=${updated}, skipped(all null)=${skipped}`);
  process.exit(0);
}

main().catch(err => {
  console.error('[backfill] ERROR:', err.message);
  process.exit(1);
});

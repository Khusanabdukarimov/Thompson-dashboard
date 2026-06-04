#!/usr/bin/env node
/**
 * update_source_to_target.js
 *
 * Facebook (UC_O9BLGT) va Instagram (UC_3O8GTF) manbali barcha lidlarni
 * Bitrix24 da "Target" (UC_89FPH6) ga o'zgartiradi.
 * Mahalliy DB da ham source_id va utm_source yangilanadi.
 *
 * Foydalanish:
 *   node scripts/update_source_to_target.js          — hisobot (dry run)
 *   node scripts/update_source_to_target.js --apply  — Bitrix24 + DB yangilaydi
 */

require('dotenv').config();
const { Pool } = require('pg');
const https = require('https');
const http  = require('http');

const pool  = new Pool({ connectionString: process.env.DATABASE_URL });
const APPLY = process.argv.includes('--apply');
const WEBHOOK_URL = process.env.BITRIX_WEBHOOK_URL;

const OLD_SOURCES  = ['UC_O9BLGT', 'UC_3O8GTF'];  // Facebook, Instagram
const NEW_SOURCE   = 'UC_89FPH6';                   // Target

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function httpPost(url, data) {
  return new Promise((resolve, reject) => {
    const body   = JSON.stringify(data);
    const urlObj = new URL(url);
    const lib    = url.startsWith('https') ? https : http;
    const req    = lib.request(
      { hostname: urlObj.hostname, path: urlObj.pathname + urlObj.search,
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } },
      (res) => {
        let buf = '';
        res.on('data', c => (buf += c));
        res.on('end', () => { try { resolve(JSON.parse(buf)); } catch { reject(new Error('JSON parse')); } });
        res.on('error', reject);
      }
    );
    req.setTimeout(20000, () => req.destroy(new Error('Timeout')));
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function run() {
  console.log('='.repeat(60));
  console.log('SOURCE_ID → Target (UC_89FPH6) yangilash');
  console.log(APPLY ? '⚠️  APPLY — Bitrix24 + DB yangilanadi' : '📊  DRY RUN');
  console.log('='.repeat(60));

  const { rows: stats } = await pool.query(`
    SELECT source_id, COUNT(*)::int AS soni
    FROM leads
    WHERE source_id = ANY($1)
    GROUP BY source_id ORDER BY soni DESC
  `, [OLD_SOURCES]);

  console.log('\nHozirgi holat:');
  let total = 0;
  for (const r of stats) {
    const label = r.source_id === 'UC_O9BLGT' ? 'Facebook' : 'Instagram';
    console.log(`  ${label} (${r.source_id}): ${r.soni} ta lid`);
    total += r.soni;
  }
  console.log(`  Jami: ${total} ta lid yangilanadi → Target (${NEW_SOURCE})`);

  if (!APPLY) {
    console.log('\n💡 Yangilash uchun: node scripts/update_source_to_target.js --apply');
    await pool.end();
    return;
  }

  if (!WEBHOOK_URL) {
    console.error('\n❌ BITRIX_WEBHOOK_URL .env da sozlanmagan!');
    await pool.end();
    return;
  }

  const { rows: leads } = await pool.query(
    `SELECT id, source_id, utm_source FROM leads
     WHERE source_id = ANY($1) ORDER BY id`,
    [OLD_SOURCES]
  );

  console.log(`\n${leads.length} ta lid yangilanmoqda...\n`);
  let ok = 0, fail = 0;

  for (const lead of leads) {
    try {
      // Bitrix24 da SOURCE_ID yangilash
      const bxRes = await httpPost(`${WEBHOOK_URL}/crm.lead.update`, {
        id: lead.id,
        fields: { SOURCE_ID: NEW_SOURCE },
      });

      if (bxRes.result === true || bxRes.result === 1) {
        ok++;
      } else {
        console.warn(`  ⚠️  #${lead.id}: ${JSON.stringify(bxRes)}`);
        fail++;
      }

      // DB da yangilash
      await pool.query(
        `UPDATE leads SET source_id = $1 WHERE id = $2`,
        [NEW_SOURCE, lead.id]
      );

      if (ok % 20 === 0 && ok > 0) process.stdout.write(`\r  ${ok}/${leads.length} tayyor...`);

      await sleep(600); // Bitrix24 rate limit: 2 req/s
    } catch (err) {
      console.error(`  ❌ #${lead.id}: ${err.message}`);
      fail++;
    }
  }

  console.log(`\n\n✅ Muvaffaqiyatli: ${ok} ta`);
  if (fail) console.log(`❌ Xato: ${fail} ta`);
  console.log('\nTugadi!');
  await pool.end();
}

run().catch(err => {
  console.error('Xato:', err.message);
  pool.end();
  process.exit(1);
});

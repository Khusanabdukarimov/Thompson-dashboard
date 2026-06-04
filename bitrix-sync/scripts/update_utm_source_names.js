#!/usr/bin/env node
/**
 * update_utm_source_names.js
 *
 * Bitrix24 lidlarida utm_source qiymatlarini to'liq nomga o'zgartiradi:
 *   ig  → Instagram
 *   fb  → Facebook
 *
 * Foydalanish:
 *   node scripts/update_utm_source_names.js          — faqat hisobot (DRY RUN)
 *   node scripts/update_utm_source_names.js --apply  — Bitrix24 + DB da yangilaydi
 */

require('dotenv').config();
const { Pool } = require('pg');
const https = require('https');
const http = require('http');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const APPLY = process.argv.includes('--apply');
const WEBHOOK_URL = process.env.BITRIX_WEBHOOK_URL;

const RENAME_MAP = {
  ig: 'Instagram',
  fb: 'Facebook',
};

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function httpPost(url, data) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data);
    const urlObj = new URL(url);
    const lib = url.startsWith('https') ? https : http;
    const req = lib.request(
      {
        hostname: urlObj.hostname,
        path: urlObj.pathname + urlObj.search,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      },
      (res) => {
        let buf = '';
        res.on('data', c => (buf += c));
        res.on('end', () => {
          try { resolve(JSON.parse(buf)); }
          catch (e) { reject(new Error('JSON parse: ' + e.message)); }
        });
        res.on('error', reject);
      }
    );
    req.setTimeout(20000, () => req.destroy(new Error('Timeout')));
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function updateBitrixLead(leadId, utmSource) {
  if (!WEBHOOK_URL) throw new Error('BITRIX_WEBHOOK_URL not set');
  const url = `${WEBHOOK_URL}/crm.lead.update`;
  const res = await httpPost(url, { id: leadId, fields: { UTM_SOURCE: utmSource } });
  return res;
}

async function run() {
  console.log('='.repeat(60));
  console.log('UTM Source nomlari yangilash');
  console.log(APPLY ? '⚠️  APPLY REJIMI — Bitrix24 + DB yangilanadi' : '📊  DRY RUN — faqat hisobot');
  console.log('='.repeat(60));

  // Hozirgi holat
  const { rows: stats } = await pool.query(`
    SELECT utm_source, COUNT(*)::int AS soni
    FROM leads
    WHERE utm_source IN (${Object.keys(RENAME_MAP).map((_, i) => `$${i + 1}`).join(',')})
    GROUP BY utm_source
    ORDER BY utm_source
  `, Object.keys(RENAME_MAP));

  console.log('\nHozirgi holat:');
  for (const r of stats) {
    console.log(`  "${r.utm_source}" → "${RENAME_MAP[r.utm_source]}" : ${r.soni} ta lid`);
  }
  const total = stats.reduce((s, r) => s + r.soni, 0);
  console.log(`  Jami: ${total} ta lid yangilanadi`);

  if (!APPLY) {
    console.log('\n💡 Yangilash uchun: node scripts/update_utm_source_names.js --apply');
    await pool.end();
    return;
  }

  if (!WEBHOOK_URL) {
    console.error('\n❌ BITRIX_WEBHOOK_URL .env da sozlanmagan!');
    await pool.end();
    return;
  }

  // Har bir utm_source uchun lidlarni olish va yangilash
  for (const [oldVal, newVal] of Object.entries(RENAME_MAP)) {
    const { rows: leads } = await pool.query(
      'SELECT id FROM leads WHERE utm_source = $1 ORDER BY id',
      [oldVal]
    );

    if (leads.length === 0) {
      console.log(`\n"${oldVal}": leads yo'q, o'tkazib yuborildi`);
      continue;
    }

    console.log(`\n"${oldVal}" → "${newVal}": ${leads.length} ta lid yangilanmoqda...`);
    let ok = 0, fail = 0;

    for (const lead of leads) {
      try {
        // Bitrix24 da yangilash
        const bxRes = await updateBitrixLead(lead.id, newVal);
        if (bxRes.result === true || bxRes.result === 1) {
          ok++;
        } else {
          console.warn(`  ⚠️  Lead #${lead.id} Bitrix24: ${JSON.stringify(bxRes)}`);
          fail++;
        }

        // Mahalliy DB da yangilash
        await pool.query('UPDATE leads SET utm_source = $1 WHERE id = $2', [newVal, lead.id]);

        if (ok % 10 === 0 && ok > 0) {
          process.stdout.write(`\r  ${ok}/${leads.length} yangilandi...`);
        }

        // Rate limit: 600ms oraliq (Bitrix24 2 req/s limit)
        await sleep(600);
      } catch (err) {
        console.error(`  ❌ Lead #${lead.id}: ${err.message}`);
        fail++;
      }
    }

    console.log(`\n  ✅ "${oldVal}" tugadi: ${ok} muvaffaqiyatli, ${fail} xato`);
  }

  console.log('\n🎉 Barcha yangilanishlar tugadi!');
  await pool.end();
}

run().catch(err => {
  console.error('Xato:', err.message);
  pool.end();
  process.exit(1);
});

#!/usr/bin/env node
/**
 * backfill_meta_conversions.js
 *
 * Mavjud sifatli Facebook lidlarni Meta Conversions API ga yuboradi.
 * Bu keyingi reklamalarda sifatli lidlar soni va narxini yaxshilaydi.
 *
 * Foydalanish:
 *   node scripts/backfill_meta_conversions.js          — faqat hisobot
 *   node scripts/backfill_meta_conversions.js --apply  — Meta ga yuboradi
 *   node scripts/backfill_meta_conversions.js --apply --limit=100  — faqat 100 ta
 */

require('dotenv').config();
const { Pool } = require('pg');
const { sendQualifiedLead } = require('../src/services/metaConversions');

const pool  = new Pool({ connectionString: process.env.DATABASE_URL });
const APPLY = process.argv.includes('--apply');
const LIMIT = parseInt((process.argv.find(a => a.startsWith('--limit=')) || '').replace('--limit=', '') || '0');

// Sifatli bosqichlar
const SIFATLI_BOSQICHLAR = [
  'UC_KXC3ZW', 'THINKING',
  'UC_L28G68', 'CONSULTATION',
  'UC_5G8244', 'NOT_TRANSFERRED',
  'UC_NAZK5J', 'RECYCLED',
  'CONVERTED_CONSULT', 'CONVERTED',
];

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function run() {
  console.log('='.repeat(60));
  console.log('Meta Conversions API — Sifatli lidlar backfill');
  console.log(APPLY ? '⚠️  APPLY — Meta ga yuboriladi' : '📊  DRY RUN — faqat hisobot');
  if (!process.env.META_PIXEL_ID) {
    console.error('\n❌ META_PIXEL_ID .env da sozlanmagan!');
    console.log('   echo "META_PIXEL_ID=xxxxxx" >> .env');
    console.log('   echo "META_CONVERSIONS_TOKEN=xxxxxx" >> .env');
    await pool.end();
    return;
  }
  console.log('='.repeat(60));

  // Sifatli bosqichlardagi Facebook lidlar
  const { rows: leads } = await pool.query(`
    SELECT
      l.id         AS lead_id,
      fl.id        AS leadgen_id,
      fl.phone,
      fl.email,
      s.bitrix_id  AS stage_bid,
      l.date_create
    FROM leads l
    JOIN stages s ON s.id = l.stage_id
    JOIN lead_phones lp ON lp.lead_id = l.id
    JOIN facebook_leads fl ON fl.phone = lp.phone
    WHERE s.bitrix_id = ANY($1::text[])
    GROUP BY l.id, fl.id, fl.phone, fl.email, s.bitrix_id, l.date_create
    ORDER BY l.date_create DESC
    ${LIMIT > 0 ? `LIMIT ${LIMIT}` : ''}
  `, [SIFATLI_BOSQICHLAR]);

  // Bosqich bo'yicha hisobot
  const byStage = {};
  for (const l of leads) {
    byStage[l.stage_bid] = (byStage[l.stage_bid] || 0) + 1;
  }

  console.log(`\nSifatli Facebook lidlar (${leads.length} ta):`);
  const stageNames = {
    'UC_KXC3ZW': "O'ylab ko'radi", 'THINKING': "O'ylab ko'radi",
    'UC_L28G68': 'Tashrif belgilandi', 'CONSULTATION': 'Tashrif belgilandi',
    'UC_5G8244': 'Kelmadi', 'NOT_TRANSFERRED': 'Kelmadi',
    'UC_NAZK5J': "Bekor bo'ldi", 'RECYCLED': "Bekor bo'ldi",
    'CONVERTED_CONSULT': 'Tashrif buyurdi', 'CONVERTED': 'Tashrif buyurdi',
  };
  for (const [bid, cnt] of Object.entries(byStage)) {
    console.log(`  ${stageNames[bid] || bid}: ${cnt} ta`);
  }

  if (!APPLY) {
    console.log('\n💡 Yuborish uchun: node scripts/backfill_meta_conversions.js --apply');
    console.log('💡 Test uchun:    node scripts/backfill_meta_conversions.js --apply --limit=10');
    await pool.end();
    return;
  }

  console.log(`\n${leads.length} ta lid Meta ga yuborilmoqda...`);
  let ok = 0, fail = 0, skipped = 0;

  for (const lead of leads) {
    try {
      const eventTime = lead.date_create
        ? Math.floor(new Date(lead.date_create).getTime() / 1000)
        : Math.floor(Date.now() / 1000);

      const result = await sendQualifiedLead({
        leadgenId:  lead.leadgen_id,
        phone:      lead.phone,
        email:      lead.email,
        eventTime,
        customData: { bitrix_stage: lead.stage_bid },
      });

      if (result?.events_received > 0) {
        ok++;
      } else if (result?.error) {
        console.warn(`  ⚠️  #${lead.lead_id}: ${JSON.stringify(result.error)}`);
        fail++;
      } else {
        skipped++;
      }

      if ((ok + fail + skipped) % 20 === 0) {
        process.stdout.write(`\r  ${ok + fail + skipped}/${leads.length} qayta ishlandi (✅${ok} ❌${fail})...`);
      }

      // Meta Conversions API rate limit: 200 req/hr = ~18 req/min
      await sleep(350);
    } catch (err) {
      console.error(`\n  ❌ #${lead.lead_id}: ${err.message}`);
      fail++;
    }
  }

  console.log(`\n\n✅ Muvaffaqiyatli: ${ok} ta`);
  if (fail)    console.log(`❌ Xato: ${fail} ta`);
  if (skipped) console.log(`⏭  O'tkazildi: ${skipped} ta`);
  console.log('\nTugadi! Meta algoritmi keyingi 24-48 soat ichida yaxshilanadi.');
  await pool.end();
}

run().catch(err => {
  console.error('Xato:', err.message);
  pool.end();
  process.exit(1);
});

#!/usr/bin/env node
/**
 * check_utm_status.js
 * Target lidlarning UTM holatini tekshiradi va muammolarni ko'rsatadi.
 *
 * Ishlatilishi:
 *   node scripts/check_utm_status.js
 */
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const TARGET_SOURCES = ['UC_89FPH6', 'UC_O9BLGT', 'UC_3O8GTF'];

async function run() {
  console.log('=== Target lidlardagi UTM holati ===\n');

  // 1. Umumiy statistika
  const { rows: total } = await pool.query(`
    SELECT source_id, COUNT(*) AS cnt
    FROM leads
    WHERE source_id = ANY($1)
    GROUP BY source_id ORDER BY cnt DESC
  `, [TARGET_SOURCES]);

  console.log('Manba bo\'yicha jami:');
  for (const r of total) console.log(`  ${r.source_id}: ${r.cnt} ta lid`);

  // 2. utm_source noto'g'ri yoki yo'q bo'lganlar
  const { rows: bad } = await pool.query(`
    SELECT
      source_id,
      utm_source,
      COUNT(*) AS cnt
    FROM leads
    WHERE source_id = ANY($1)
    GROUP BY source_id, utm_source
    ORDER BY cnt DESC
  `, [TARGET_SOURCES]);

  console.log('\nUTM Source taqsimoti:');
  for (const r of bad) {
    const flag = (!r.utm_source || ['ig','fb','instagram','facebook'].includes((r.utm_source||'').toLowerCase()))
      ? ' ⚠️ NOTO\'G\'RI'
      : '';
    console.log(`  [${r.source_id}] utm_source="${r.utm_source || 'NULL'}" → ${r.cnt} ta${flag}`);
  }

  // 3. So'nggi 50 ta FB/IG lid
  const { rows: recent } = await pool.query(`
    SELECT id, source_id, utm_source, utm_medium, utm_campaign, date_create
    FROM leads
    WHERE source_id = ANY($1)
    ORDER BY date_create DESC
    LIMIT 50
  `, [TARGET_SOURCES]);

  const wrong = recent.filter(r =>
    !r.utm_source ||
    ['ig','fb'].includes((r.utm_source||'').toLowerCase()) ||
    /leadmaster|webform|instantform/i.test(r.utm_source||'')
  );

  if (wrong.length > 0) {
    console.log(`\n⚠️  So'nggi 50 tadan ${wrong.length} ta noto'g'ri utm_source:`);;
    for (const r of wrong) {
      console.log(`  Lead #${r.id}: source_id=${r.source_id}, utm_source="${r.utm_source||'NULL'}", sana=${r.date_create?.toISOString().slice(0,10)}`);
    }
  } else {
    console.log('\n✅ So\'nggi 50 ta Target liddagi UTM to\'g\'ri!');
  }

  // 4. facebook_leads statistikasi
  const { rows: fb } = await pool.query(`
    SELECT
      COUNT(*) AS total,
      COUNT(bitrix_lead_id) AS with_bitrix_id,
      COUNT(phone) AS with_phone,
      MIN(created_time) AS oldest,
      MAX(created_time) AS newest
    FROM facebook_leads
  `);

  console.log('\n=== facebook_leads jadvali ===');
  console.log(`  Jami: ${fb[0].total}`);
  console.log(`  Bitrix24 lead_id bor: ${fb[0].with_bitrix_id}`);
  console.log(`  Telefon bor: ${fb[0].with_phone}`);
  console.log(`  Eng qadimgi: ${fb[0].oldest?.toISOString().slice(0,16) || 'yo\'q'}`);
  console.log(`  Eng yangi: ${fb[0].newest?.toISOString().slice(0,16) || 'yo\'q'}`);

  // 5. So'nggi 5 ta facebook lead
  const { rows: lastFb } = await pool.query(`
    SELECT id, full_name, phone, utm_source, bitrix_lead_id, created_time
    FROM facebook_leads
    ORDER BY created_time DESC
    LIMIT 5
  `);

  if (lastFb.length > 0) {
    console.log('\nSo\'nggi Facebook lidlar:');
    for (const r of lastFb) {
      console.log(`  [${r.created_time?.toISOString().slice(0,16)}] ${r.full_name} | ${r.phone||'tel yo\'q'} | utm=${r.utm_source||'?'} | bitrix=#${r.bitrix_lead_id||'YO\'Q'}`);
    }
  }

  await pool.end();
}

run().catch(e => { console.error(e.message); pool.end(); });

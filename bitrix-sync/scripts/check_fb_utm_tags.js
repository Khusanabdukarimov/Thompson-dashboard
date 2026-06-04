#!/usr/bin/env node
/**
 * check_fb_utm_tags.js
 *
 * Facebook/Instagram tomondan kelgan Bitrix24 lidlarida UTM metkalar bor-yo'qligini
 * tekshiradi va yo'qlarini to'g'irlaydi.
 *
 * Foydalanish:
 *   node scripts/check_fb_utm_tags.js          — faqat hisobot
 *   node scripts/check_fb_utm_tags.js --fix     — yo'qlarini to'g'irlaydi
 */

require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const FIX_MODE = process.argv.includes('--fix');

// Bitrix24 manba ID lari
const FB_SOURCE_ID = 'UC_O9BLGT';   // Facebook
const IG_SOURCE_ID = 'UC_3O8GTF';   // Instagram

async function run() {
  console.log('='.repeat(60));
  console.log('Facebook/Instagram Lidlar UTM Tekshiruvi');
  console.log(FIX_MODE ? '⚠️  FIX REJIMI — DB yangilanadi' : '📊  HISOBOT REJIMI — faqat o\'qiydi');
  console.log('='.repeat(60));

  // 1. Jami statistika
  const { rows: totals } = await pool.query(`
    SELECT
      source_id,
      COUNT(*)::int AS jami,
      COUNT(*) FILTER (WHERE utm_source IS NOT NULL AND utm_source != '')::int AS utm_bor,
      COUNT(*) FILTER (WHERE utm_source IS NULL OR utm_source = '')::int       AS utm_yoq
    FROM leads
    WHERE source_id IN ($1, $2)
    GROUP BY source_id
  `, [FB_SOURCE_ID, IG_SOURCE_ID]);

  const sourceNames = { [FB_SOURCE_ID]: 'Facebook', [IG_SOURCE_ID]: 'Instagram' };
  for (const row of totals) {
    const name = sourceNames[row.source_id] || row.source_id;
    const pct  = row.jami > 0 ? ((row.utm_bor / row.jami) * 100).toFixed(1) : '0.0';
    console.log(`\n${name} (${row.source_id}):`);
    console.log(`  Jami: ${row.jami} ta lid`);
    console.log(`  UTM bor: ${row.utm_bor} ta (${pct}%)`);
    console.log(`  UTM yo'q: ${row.utm_yoq} ta`);
  }

  // 2. UTM yo'q leadlarni ko'rish
  const { rows: missing } = await pool.query(`
    SELECT l.id, l.source_id, l.utm_source, l.utm_medium, l.utm_campaign, l.date_create
    FROM leads l
    WHERE l.source_id IN ($1, $2)
      AND (l.utm_source IS NULL OR l.utm_source = '')
    ORDER BY l.date_create DESC
    LIMIT 20
  `, [FB_SOURCE_ID, IG_SOURCE_ID]);

  if (missing.length > 0) {
    console.log(`\nUTM yo'q leadlar (oxirgi 20 ta):`);
    for (const l of missing) {
      const name = sourceNames[l.source_id] || l.source_id;
      const sana = l.date_create ? new Date(l.date_create).toLocaleDateString('uz-UZ') : '—';
      console.log(`  #${l.id} | ${name} | ${sana}`);
    }
  }

  // 3. utm_source qiymatlarini ko'rish
  const { rows: sources } = await pool.query(`
    SELECT
      COALESCE(NULLIF(utm_source, ''), 'NULL') AS utm_source,
      COUNT(*)::int AS soni
    FROM leads
    WHERE source_id IN ($1, $2)
    GROUP BY COALESCE(NULLIF(utm_source, ''), 'NULL')
    ORDER BY soni DESC
  `, [FB_SOURCE_ID, IG_SOURCE_ID]);

  console.log('\nFacebook/Instagram lidlardagi utm_source qiymatlari:');
  for (const s of sources) {
    console.log(`  "${s.utm_source}": ${s.soni} ta`);
  }

  // 4. "Leadmasterinstantform1" ni tekshirish
  const { rows: lmRows } = await pool.query(`
    SELECT l.id, l.source_id, l.utm_source, l.web_form_id, l.date_create
    FROM leads l
    WHERE LOWER(l.utm_source) LIKE '%leadmaster%'
       OR LOWER(l.utm_source) LIKE '%instantform%'
    ORDER BY l.date_create DESC
    LIMIT 10
  `);

  if (lmRows.length > 0) {
    console.log('\n"Leadmasterinstantform" tipidagi lidlar:');
    for (const l of lmRows) {
      const sana = l.date_create ? new Date(l.date_create).toLocaleDateString('uz-UZ') : '—';
      console.log(`  #${l.id} | source: ${l.source_id || 'NULL'} | utm: ${l.utm_source} | form_id: ${l.web_form_id || 'NULL'} | ${sana}`);
    }
    console.log('\n  ℹ️  "Leadmasterinstantform1" — bu Bitrix24\'ning o\'z CRM formasi nomi.');
    console.log('     Bu Facebook Lead Ad emas, balki Bitrix24 saytdagi tez-forma (instant form).');
    console.log('     Bitrix24 formasining UTM source sifatida forma nomi ishlatilgan.');
  }

  // 5. FIX: UTM yo'q leadlarni to'g'irlash
  if (FIX_MODE) {
    console.log('\n--- FIX BOSQICHI ---');

    // Facebook leadlarini to'g'irlash
    const { rowCount: fbFixed } = await pool.query(`
      UPDATE leads
      SET
        utm_source = 'fb',
        utm_medium = COALESCE(NULLIF(utm_medium, ''), 'paid')
      WHERE source_id = $1
        AND (utm_source IS NULL OR utm_source = '')
    `, [FB_SOURCE_ID]);
    console.log(`✅ Facebook: ${fbFixed} ta lid UTM source = 'fb' ga to'g'irlandi`);

    // Instagram leadlarini to'g'irlash
    const { rowCount: igFixed } = await pool.query(`
      UPDATE leads
      SET
        utm_source = 'ig',
        utm_medium = COALESCE(NULLIF(utm_medium, ''), 'paid')
      WHERE source_id = $1
        AND (utm_source IS NULL OR utm_source = '')
    `, [IG_SOURCE_ID]);
    console.log(`✅ Instagram: ${igFixed} ta lid UTM source = 'ig' ga to'g'irlandi`);

    // Facebook leads jadvalidan kampaniya ma'lumotlarini o'rnatish (telefon orqali moslashtirish)
    const { rowCount: campFixed } = await pool.query(`
      UPDATE leads l
      SET
        utm_campaign = COALESCE(NULLIF(l.utm_campaign, ''), fl.campaign_name),
        utm_content  = COALESCE(NULLIF(l.utm_content,  ''), fl.adset_name),
        utm_term     = COALESCE(NULLIF(l.utm_term,     ''), fl.ad_name)
      FROM lead_phones lp
      JOIN facebook_leads fl ON fl.phone = lp.phone
      WHERE lp.lead_id = l.id
        AND l.source_id IN ($1, $2)
        AND fl.campaign_name IS NOT NULL
        AND (l.utm_campaign IS NULL OR l.utm_campaign = '')
    `, [FB_SOURCE_ID, IG_SOURCE_ID]);
    console.log(`✅ Kampaniya ma'lumoti: ${campFixed} ta lid yangilandi (facebook_leads bilan moslashtirish)`);

    console.log('\nTo\'g\'irlash tugadi!');
  } else {
    console.log('\n💡 UTM yo\'qlarga to\'g\'irlash uchun: node scripts/check_fb_utm_tags.js --fix');
  }

  await pool.end();
}

run().catch(err => {
  console.error('Xato:', err.message);
  pool.end();
  process.exit(1);
});

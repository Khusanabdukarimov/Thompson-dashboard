#!/usr/bin/env node
require('dotenv').config();
const { Pool } = require('pg');
const { bitrixCall } = require('../src/services/bitrix');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function run() {
  const { rows: leads } = await pool.query(`
    SELECT l.id, l.date_create
    FROM leads l
    WHERE l.source_id IN ('UC_O9BLGT','UC_3O8GTF','UC_89FPH6')
      AND NOT EXISTS (SELECT 1 FROM lead_phones lp WHERE lp.lead_id = l.id)
    ORDER BY l.id DESC
  `);

  console.log('Telefonsiz FB lidlar:', leads.length);
  let fixed = 0, notfound = 0;

  for (const l of leads) {
    const { rows: fbl } = await pool.query(`
      SELECT id, phone, full_name FROM facebook_leads
      WHERE phone IS NOT NULL AND phone != ''
        AND ABS(EXTRACT(EPOCH FROM (created_time - $1::timestamptz))) < 3600
      ORDER BY ABS(EXTRACT(EPOCH FROM (created_time - $1::timestamptz))) ASC
      LIMIT 1
    `, [l.date_create]);

    if (!fbl.length) { notfound++; continue; }

    const { phone, id: fbId } = fbl[0];
    await pool.query(
      'INSERT INTO lead_phones (lead_id, phone) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [l.id, phone]
    );

    try {
      await bitrixCall('crm.lead.update', {
        id: l.id,
        fields: { PHONE: [{ VALUE: phone, VALUE_TYPE: 'WORK' }] },
      });
    } catch (e) {
      console.warn('  Bitrix update failed for #' + l.id + ':', e.message);
    }

    console.log('  #' + l.id + ' ← ' + phone + ' (FB: ' + fbId + ')');
    fixed++;
    await sleep(400);
  }

  console.log('\nTuzatildi:', fixed, '| Moslik topilmadi:', notfound);
  await pool.end();
}

run().catch(err => { console.error(err.message); pool.end(); });

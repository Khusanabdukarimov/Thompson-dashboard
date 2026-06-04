require('dotenv').config();
const pool = require('./src/db/pool');
const { bitrixCall } = require('./src/services/bitrix');
const { upsertLead } = require('./src/services/upsertLead');

const norms = [
  '+998900798777','+998945952515','+998911188212','+998903115149','+998912150846',
  '+998932047277','+998507440500','+998901819495','+998907797172','997692266',
  '+998955203666','+998888180733','+998903344051','979221501','+998914062442',
  '943610604','+998903061559','+998905327808','+998934459195','977472038'
].map(p => p.replace(/[^0-9]/g,'').slice(-9));

// Spam detection: name repeats in city/biznes/brend fields
function isSpam(fd, name) {
  if (!fd) return false;
  const n = (name || '').toLowerCase().trim();
  const city   = (fd.city || '').toLowerCase().trim();
  const biznes = (fd["biznesingiz_yo'nalishi:"] || '').toLowerCase().trim();
  const brend  = (fd["brendingiz_yoki_biznesingiz_nomi:"] || '').toLowerCase().trim();
  // spam if name==city==biznes==brend OR random chars (no vowels in name)
  const sameCount = [city, biznes, brend].filter(v => v === n || v.includes(n)).length;
  return sameCount >= 2;
}

async function main() {
  const { rows } = await pool.query(`
    SELECT full_name, phone, adset_name, campaign_name, ad_name, field_data,
           created_time AT TIME ZONE 'UTC' AS created_time
    FROM facebook_leads
    WHERE RIGHT(REGEXP_REPLACE(COALESCE(phone,''),'[^0-9]','','g'),9) = ANY($1)
      AND created_time >= '2026-06-01'
    ORDER BY created_time
  `, [norms]);

  const spam  = [];
  const valid = [];

  for (const row of rows) {
    if (isSpam(row.field_data, row.full_name)) spam.push(row);
    else valid.push(row);
  }

  console.log(`Spam: ${spam.length}, Valid: ${valid.length}\n`);
  console.log('=== SPAM (o\'tkazib yuboriladi) ===');
  spam.forEach(x => console.log(' ', x.full_name, x.phone));

  console.log('\n=== VALID (Bitrix24ga qo\'shiladi) ===');
  valid.forEach(x => {
    const fd = x.field_data || {};
    console.log(` ${x.full_name} | ${x.phone} | ${fd["qaysi_xizmatimizdan_foydalanmoqchisiz?"] || ''} | ${fd["biznesingiz_yo'nalishi:"] || ''}`);
  });

  console.log('\nBitrix24ga qo\'shish boshlandi...');

  let added = 0, errors = 0;
  for (const row of valid) {
    try {
      const fd = row.field_data || {};
      const xizmat  = fd["qaysi_xizmatimizdan_foydalanmoqchisiz?"] || '';
      const biznes  = fd["biznesingiz_yo'nalishi:"] || '';
      const brend   = fd["brendingiz_yoki_biznesingiz_nomi:"] || '';
      const city    = fd.city || '';

      const dateCreate = new Date(row.created_time).toISOString().replace('T', ' ').slice(0, 19);

      const res = await bitrixCall('crm.lead.add', {
        fields: {
          NAME:           row.full_name,
          PHONE:          [{ VALUE: row.phone, VALUE_TYPE: 'MOBILE' }],
          SOURCE_ID:      'UC_O9BLGT',
          UTM_SOURCE:     'ig',
          UTM_MEDIUM:     'paid',
          UTM_CAMPAIGN:   row.campaign_name,
          UTM_CONTENT:    row.adset_name,
          UTM_TERM:       row.ad_name,
          DATE_CREATE:    dateCreate,
          COMMENTS:       [
            city    ? `Shahar: ${city}`     : '',
            biznes  ? `Biznes: ${biznes}`   : '',
            brend   ? `Brend: ${brend}`     : '',
            xizmat  ? `Xizmat: ${xizmat}`   : '',
          ].filter(Boolean).join('\n'),
        }
      });

      const leadId = res.result;
      if (!leadId) throw new Error('No lead ID returned');

      // Sync to local DB
      const fullLead = await bitrixCall('crm.lead.get', { id: leadId });
      if (fullLead.result) await upsertLead(fullLead.result);

      console.log(`  ✓ ${row.full_name} → lead #${leadId}`);
      added++;
    } catch (e) {
      console.error(`  ✗ ${row.full_name}: ${e.message}`);
      errors++;
    }
  }

  console.log(`\nNatija: ${added} qo'shildi, ${errors} xato, ${spam.length} spam o'tkazildi`);
  await pool.end();
}

main().catch(e => { console.error(e); pool.end(); });

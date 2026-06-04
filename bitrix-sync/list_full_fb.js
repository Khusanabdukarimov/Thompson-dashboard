require('dotenv').config();
const pool = require('./src/db/pool');

const yoqPhones = [
  '+998900798777','+998945952515','+998911188212','+998903115149','+998912150846',
  '+998932047277','+998507440500','+998901819495','+998907797172','997692266',
  '+998955203666','+998888180733','+998903344051','979221501','+998914062442',
  '943610604','+998903061559','+998905327808','+998934459195','977472038'
];

const norms = yoqPhones.map(p => p.replace(/[^0-9]/g,'').slice(-9));

pool.query(`
  SELECT
    fl.full_name,
    fl.phone,
    fl.email,
    fl.created_time AT TIME ZONE 'Asia/Tashkent' AS sana,
    fl.campaign_name,
    fl.adset_name,
    fl.ad_name,
    fl.form_id,
    fl.field_data
  FROM facebook_leads fl
  WHERE RIGHT(REGEXP_REPLACE(COALESCE(fl.phone,''),'[^0-9]','','g'),9) = ANY($1)
    AND fl.created_time >= '2026-06-01'
  ORDER BY fl.created_time
`, [norms]).then(r => {
  r.rows.forEach((x, i) => {
    console.log(`\n--- ${i+1}. ${x.full_name} ---`);
    console.log(`Telefon:   ${x.phone}`);
    console.log(`Email:     ${x.email || '—'}`);
    console.log(`Sana:      ${new Date(x.sana).toLocaleString('uz')}`);
    console.log(`Kampaniya: ${x.campaign_name}`);
    console.log(`Ad set:    ${x.adset_name}`);
    console.log(`Ad:        ${x.ad_name}`);
    console.log(`Forma ID:  ${x.form_id}`);
    if (x.field_data && x.field_data.length) {
      console.log(`Form maydonlari:`);
      x.field_data.forEach(f => console.log(`  ${f.name}: ${Array.isArray(f.values) ? f.values.join(', ') : f.values}`));
    }
  });
  pool.end();
}).catch(e => { console.error(e.message); pool.end(); });

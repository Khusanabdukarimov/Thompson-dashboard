require('dotenv').config();
const pool = require('./src/db/pool');

const norms = [
  '+998900798777','+998945952515','+998911188212','+998903115149','+998912150846',
  '+998932047277','+998507440500','+998901819495','+998907797172','997692266',
  '+998955203666','+998888180733','+998903344051','979221501','+998914062442',
  '943610604','+998903061559','+998905327808','+998934459195','977472038'
].map(p => p.replace(/[^0-9]/g,'').slice(-9));

pool.query(`
  SELECT
    fl.full_name, fl.phone, fl.email,
    fl.created_time AT TIME ZONE 'Asia/Tashkent' AS sana,
    fl.ad_name, fl.adset_name,
    fl.field_data
  FROM facebook_leads fl
  WHERE RIGHT(REGEXP_REPLACE(COALESCE(fl.phone,''),'[^0-9]','','g'),9) = ANY($1)
    AND fl.created_time >= '2026-06-01'
  ORDER BY fl.created_time
`, [norms]).then(r => {
  r.rows.forEach((x, i) => {
    console.log(`\n=== ${i+1}. ${x.full_name} | ${x.phone} ===`);
    console.log(`Sana: ${new Date(x.sana).toLocaleString('uz')}`);
    console.log(`Reklama: ${x.ad_name}`);
    if (x.field_data && typeof x.field_data === 'object') {
      Object.entries(x.field_data).forEach(([k, v]) => console.log(`  ${k}: ${v}`));
    } else {
      console.log('  (field_data yoq)');
    }
  });
  pool.end();
}).catch(e => { console.error(e.message); pool.end(); });

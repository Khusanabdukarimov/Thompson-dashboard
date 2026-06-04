require('dotenv').config();
const pool = require('./src/db/pool');

pool.query(`
  SELECT
    fl.full_name,
    fl.phone,
    fl.created_time::date AS sana,
    CASE WHEN lp.lead_id IS NOT NULL THEN 'Bor' ELSE 'Yoq' END AS holat,
    lp.lead_id
  FROM facebook_leads fl
  LEFT JOIN lead_phones lp
    ON RIGHT(REGEXP_REPLACE(lp.phone,'[^0-9]','','g'),9)
     = RIGHT(REGEXP_REPLACE(COALESCE(fl.phone,''),'[^0-9]','','g'),9)
    AND LENGTH(REGEXP_REPLACE(COALESCE(fl.phone,''),'[^0-9]','','g')) >= 7
  WHERE fl.created_time >= '2026-06-01'
  ORDER BY fl.created_time DESC
`).then(r => {
  const bor = r.rows.filter(x => x.holat === 'Bor');
  const yoq = r.rows.filter(x => x.holat === 'Yoq');

  console.log('=== BITRIX24DA BOR (' + bor.length + ') ===');
  bor.forEach(x => console.log(x.sana + ' | ' + x.full_name.padEnd(22) + ' | ' + x.phone + ' | lead#' + x.lead_id));

  console.log('\n=== BITRIX24DA YOQ (' + yoq.length + ') ===');
  yoq.forEach(x => console.log(x.sana + ' | ' + x.full_name.padEnd(22) + ' | ' + x.phone));

  pool.end();
}).catch(e => { console.error(e.message); pool.end(); });

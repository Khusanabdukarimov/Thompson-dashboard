require('dotenv').config();
const pool = require('./src/db/pool');

pool.query(`
  SELECT
    fl.form_id,
    fl.adset_name,
    fl.campaign_name,
    COUNT(*) AS cnt
  FROM facebook_leads fl
  LEFT JOIN lead_phones lp
    ON RIGHT(REGEXP_REPLACE(lp.phone,'[^0-9]','','g'),9)
     = RIGHT(REGEXP_REPLACE(COALESCE(fl.phone,''),'[^0-9]','','g'),9)
    AND LENGTH(REGEXP_REPLACE(COALESCE(fl.phone,''),'[^0-9]','','g')) >= 7
  WHERE fl.created_time >= '2026-06-01'
    AND lp.lead_id IS NULL
  GROUP BY fl.form_id, fl.adset_name, fl.campaign_name
  ORDER BY cnt DESC
`).then(r => {
  console.log('48 ta Bitrix24da yoq lead - formalar kesimida:\n');
  r.rows.forEach(x => {
    console.log('Form ID:   ' + (x.form_id || 'YOQ'));
    console.log('Kampaniya: ' + x.campaign_name);
    console.log('Ad set:    ' + x.adset_name);
    console.log('Soni:      ' + x.cnt);
    console.log('---');
  });
  pool.end();
}).catch(e => { console.error(e.message); pool.end(); });

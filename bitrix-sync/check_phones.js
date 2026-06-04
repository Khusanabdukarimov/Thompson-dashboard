require('dotenv').config();
const pool = require('./src/db/pool');
const { bitrixCall } = require('./src/services/bitrix');

const fbPhones = [
  '+998770841767','+998998799497','880530324','+998996353233',
  '+998976122777','+998907166566','+998993225007','933217755',
  '+998950878315','+998770420666','+998904004807','+998949953121',
  '+998974647104','+998903004955','+998913338888','+998978611007',
  '993653779','+998901556656','+998902661116','913630030',
  '+998900798777','+998945952515','+998911188212','+998903115149',
  '+998938770166','+998912150846','+998932047277','+998507440500',
  '+998901819495','+998907797172','997692266','+998955203666',
  '+998888180733','+998903344051','979221501','+998914062442',
  '943610604','+998903061559','+998905327808','+998934459195',
  '977472038','+998948208829','777760996','770747887',
  '+998979897767','+998996267337'
];

async function run() {
  const missingFromDb = [];
  const notInBitrix   = [];

  for (const phone of fbPhones) {
    const bx     = await bitrixCall('crm.lead.list', { filter: { PHONE: phone }, select: ['ID','NAME','STATUS_ID'] });
    const bxLead = bx.result && bx.result[0];

    const norm   = phone.replace(/[^0-9]/g, '').slice(-9);
    const dbRes  = await pool.query(
      "SELECT l.id FROM lead_phones lp JOIN leads l ON l.id=lp.lead_id WHERE RIGHT(REGEXP_REPLACE(lp.phone,'[^0-9]','','g'),9)=$1 LIMIT 1",
      [norm]
    );
    const dbLead = dbRes.rows[0];

    if (bxLead && !dbLead) {
      missingFromDb.push({ phone, id: bxLead.ID, name: bxLead.NAME, status: bxLead.STATUS_ID });
    } else if (!bxLead) {
      notInBitrix.push(phone);
    }
  }

  console.log('=== In Bitrix24 but MISSING from our DB === ' + missingFromDb.length);
  missingFromDb.forEach(x => console.log('  ' + x.phone + ' | lead ' + x.id + ' | ' + x.name + ' | ' + x.status));
  console.log('\n=== Not found in Bitrix24 at all === ' + notInBitrix.length);
  notInBitrix.forEach(p => console.log('  ' + p));
  pool.end();
}

run().catch(e => { console.error(e.message); pool.end(); });

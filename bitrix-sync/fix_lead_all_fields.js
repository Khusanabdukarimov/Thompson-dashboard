require('dotenv').config();
const pool = require('./src/db/pool');
const { bitrixCall } = require('./src/services/bitrix');

const leadPhoneMap = {
  31206: '977472038',      31208: '+998934459195', 31210: '+998905327808',
  31212: '+998903061559',  31214: '+998914062442', 31216: '979221501',
  31218: '+998903344051',  31220: '+998888180733', 31222: '+998955203666',
  31224: '997692266',      31226: '+998907797172', 31228: '+998901819495',
  31230: '+998507440500',  31232: '+998932047277', 31234: '+998912150846',
  31236: '+998903115149',  31238: '+998911188212', 31240: '+998945952515',
};

const norms = Object.values(leadPhoneMap).map(p => p.replace(/[^0-9]/g,'').slice(-9));

async function main() {
  // Get field_data from facebook_leads
  const { rows } = await pool.query(`
    SELECT phone, field_data
    FROM facebook_leads
    WHERE RIGHT(REGEXP_REPLACE(COALESCE(phone,''),'[^0-9]','','g'),9) = ANY($1)
      AND created_time >= '2026-06-01'
  `, [norms]);

  const fdMap = {};
  for (const r of rows) {
    const norm = r.phone.replace(/[^0-9]/g,'').slice(-9);
    fdMap[norm] = r.field_data || {};
  }

  for (const [leadIdStr, phone] of Object.entries(leadPhoneMap)) {
    const leadId = parseInt(leadIdStr);
    const norm = phone.replace(/[^0-9]/g,'').slice(-9);
    const fd = fdMap[norm] || {};

    const brend   = fd["brendingiz_yoki_biznesingiz_nomi:"] || '';
    const xizmat  = fd["qaysi_xizmatimizdan_foydalanmoqchisiz?"] || '';
    const faoliyat = fd["biznesingiz_yo'nalishi:"] || '';
    const hudud   = fd.city || '';

    const res = await bitrixCall('crm.lead.update', {
      id: leadId,
      fields: {
        PHONE: [{ VALUE: phone, VALUE_TYPE: 'MOBILE' }],
        UF_CRM_1778261403182: phone,
        UF_CRM_1775824743431: brend,
        UF_CRM_1775826286306: xizmat,
        UF_CRM_1778491100516: faoliyat,
        UF_CRM_1778491392559: hudud,
      }
    });

    console.log(`#${leadId} ${fd["ismingiz:"] || phone} | ${xizmat} | ${brend} →`, res.result ? '✓' : '✗');
  }

  await pool.end();
}

main().catch(e => { console.error(e.message); process.exit(1); });

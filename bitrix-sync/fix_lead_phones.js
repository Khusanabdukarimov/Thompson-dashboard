require('dotenv').config();
const { bitrixCall } = require('./src/services/bitrix');

const leads = [
  { id: 31206, phone: '977472038' },
  { id: 31208, phone: '+998934459195' },
  { id: 31210, phone: '+998905327808' },
  { id: 31212, phone: '+998903061559' },
  { id: 31214, phone: '+998914062442' },
  { id: 31216, phone: '979221501' },
  { id: 31218, phone: '+998903344051' },
  { id: 31220, phone: '+998888180733' },
  { id: 31222, phone: '+998955203666' },
  { id: 31224, phone: '997692266' },
  { id: 31226, phone: '+998907797172' },
  { id: 31228, phone: '+998901819495' },
  { id: 31230, phone: '+998507440500' },
  { id: 31232, phone: '+998932047277' },
  { id: 31234, phone: '+998912150846' },
  { id: 31236, phone: '+998903115149' },
  { id: 31238, phone: '+998911188212' },
  { id: 31240, phone: '+998945952515' },
];

async function main() {
  for (const { id, phone } of leads) {
    const res = await bitrixCall('crm.lead.update', {
      id,
      fields: { PHONE: [{ VALUE: phone, VALUE_TYPE: 'MOBILE' }] }
    });
    console.log(`lead #${id} ${phone}:`, res.result ? '✓' : '✗');
  }
  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });

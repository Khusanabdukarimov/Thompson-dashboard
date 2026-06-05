require('dotenv').config();
const { bitrixCall } = require('./src/services/bitrix');

const leadIds = [31206,31208,31210,31212,31214,31216,31218,31220,31222,31224,31226,31228,31230,31232,31234,31236,31238,31240];
const TITLE = 'DU - Mountain - 15.10.25';

async function main() {
  for (const id of leadIds) {
    const res = await bitrixCall('crm.lead.update', { id, fields: { TITLE } });
    console.log(`lead #${id}:`, res.result ? '✓' : '✗');
  }
  console.log('Done');
  process.exit(0);
}

main().catch(e => { console.error(e.message); process.exit(1); });

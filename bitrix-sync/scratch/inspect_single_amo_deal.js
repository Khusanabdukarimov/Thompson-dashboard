require('dotenv').config();
const { fetchAll } = require('../src/services/bitrix');

async function main() {
  console.log('Fetching an amoCRM deal from Bitrix...');
  const deals = await fetchAll('crm.deal.list', { SOURCE_ID: 'UC_1WUFJB' });
  if (deals.length === 0) {
    console.log('No amoCRM deals found.');
    return;
  }
  const sample = deals[0];
  console.log('Sample Deal ID:', sample.ID);
  console.log('Keys on this deal:', Object.keys(sample));
  console.log('Sample Deal Data:', JSON.stringify(sample, null, 2));
}

main().catch(console.error);

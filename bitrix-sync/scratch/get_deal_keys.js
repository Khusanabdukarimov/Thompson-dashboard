require('dotenv').config();
const { fetchAll } = require('../src/services/bitrix');

async function main() {
  console.log('Fetching top 10 deals from Bitrix...');
  const deals = await fetchAll('crm.deal.list', {}, ['ID', 'LEAD_ID', 'SOURCE_ID']);
  console.log('Deals sample:', JSON.stringify(deals.slice(0, 10), null, 2));
}

main().catch(console.error);

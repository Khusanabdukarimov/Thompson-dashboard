require('dotenv').config();
const { fetchOne } = require('../src/services/bitrix');

async function main() {
  console.log('Fetching deal 1970 from Bitrix...');
  const deal = await fetchOne('crm.deal.get', 1970);
  console.log('Deal 1970 raw details:', JSON.stringify(deal, null, 2));
}

main().catch(console.error);

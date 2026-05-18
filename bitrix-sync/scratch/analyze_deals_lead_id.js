require('dotenv').config();
const { fetchAll } = require('../src/services/bitrix');

async function main() {
  console.log('Fetching all deals from Bitrix...');
  const deals = await fetchAll('crm.deal.list', {}, ['ID', 'LEAD_ID', 'SOURCE_ID']);
  
  let total = deals.length;
  let hasLeadId = 0;
  let isAmo = 0;
  let isAmoWithLeadId = 0;
  
  for (const d of deals) {
    const lid = d.LEAD_ID;
    const src = d.SOURCE_ID;
    if (lid && lid !== '0') hasLeadId++;
    if (src === 'UC_1WUFJB') {
      isAmo++;
      if (lid && lid !== '0') isAmoWithLeadId++;
    }
  }
  
  console.log(`=== Analysis Results ===`);
  console.log(`Total Deals: ${total}`);
  console.log(`Deals with non-null LEAD_ID: ${hasLeadId}`);
  console.log(`amoCRM Deals (SOURCE_ID = UC_1WUFJB): ${isAmo}`);
  console.log(`amoCRM Deals with LEAD_ID: ${isAmoWithLeadId}`);
}

main().catch(console.error);

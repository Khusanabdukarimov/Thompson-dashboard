require('dotenv').config();
const { fetchAll } = require('../src/services/bitrix');

async function main() {
  console.log('Searching all deals for non-empty UF_CRM_69EBC105EAA93...');
  const deals = await fetchAll('crm.deal.list', {}, ['ID', 'TITLE', 'STAGE_ID', 'CATEGORY_ID', 'UF_CRM_69EBC105EAA93']);
  console.log(`Fetched ${deals.length} deals total.`);
  
  const withReason = deals.filter(d => d.UF_CRM_69EBC105EAA93 && d.UF_CRM_69EBC105EAA93 !== '');
  console.log(`Found ${withReason.length} deals with a cancel reason.`);
  
  if (withReason.length > 0) {
    console.log('Sample matching deals:');
    console.log(JSON.stringify(withReason.slice(0, 10), null, 2));
  } else {
    console.log('No deals found with non-empty cancel reason.');
  }
}

main().catch(console.error);

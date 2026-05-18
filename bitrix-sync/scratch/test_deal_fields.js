require('dotenv').config();
const { fetchAll } = require('../src/services/bitrix');

async function main() {
  console.log('Fetching deals from Category 1 (Sdelkalar funnel) from Bitrix...');
  const deals = await fetchAll('crm.deal.list', { CATEGORY_ID: '1' }, ['ID', 'TITLE', 'STAGE_ID', 'CATEGORY_ID', 'UF_CRM_69EBC105EAA93']);

  console.log(`Fetched ${deals.length} deals from Category 1.`);
  
  // Group by STAGE_ID to see what stages they are in
  const stageCounts = {};
  deals.forEach(d => {
    stageCounts[d.STAGE_ID] = (stageCounts[d.STAGE_ID] || 0) + 1;
  });
  console.log('Stage counts in Category 1:', stageCounts);

  // Let's find deals that have UF_CRM_69EBC105EAA93 populated
  const withReason = deals.filter(d => d.UF_CRM_69EBC105EAA93 && d.UF_CRM_69EBC105EAA93 !== '');
  console.log(`Found ${withReason.length} deals in Category 1 with a cancel reason populated.`);
  
  if (withReason.length > 0) {
    console.log('Sample deals with cancel reason:');
    console.log(JSON.stringify(withReason.slice(0, 5), null, 2));
  } else {
    console.log('No deals found with cancel reason populated. Printing first 5 deals:');
    console.log(JSON.stringify(deals.slice(0, 5), null, 2));
  }
}

main().catch(console.error);

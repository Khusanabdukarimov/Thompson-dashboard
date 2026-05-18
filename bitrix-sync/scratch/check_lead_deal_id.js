require('dotenv').config();
const { fetchAll } = require('../src/services/bitrix');

async function main() {
  console.log('Fetching leads from Bitrix to check for DEAL_ID...');
  const leads = await fetchAll('crm.lead.list', {}, ['ID', 'DEAL_ID', 'STATUS_ID']);
  
  let total = leads.length;
  let hasDealId = 0;
  
  for (const l of leads) {
    if (l.DEAL_ID && l.DEAL_ID !== '0') {
      hasDealId++;
      if (hasDealId <= 10) {
        console.log(`Lead ID: ${l.ID}, Status: ${l.STATUS_ID}, DEAL_ID: ${l.DEAL_ID}`);
      }
    }
  }
  
  console.log(`Total Leads: ${total}`);
  console.log(`Leads with DEAL_ID: ${hasDealId}`);
}

main().catch(console.error);

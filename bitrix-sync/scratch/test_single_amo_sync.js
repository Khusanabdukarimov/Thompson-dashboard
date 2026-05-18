require('dotenv').config();
const pool = require('../src/db/pool');
const { fetchOne, fetchAll } = require('../src/services/bitrix');
const { upsertLead } = require('../src/services/upsertLead');
const { loadAll: loadStages } = require('../src/services/stageResolver');

async function main() {
  console.log('=== Swapped Mapping Fast Verification ===');
  await loadStages();
  
  // Get a single amoCRM lead ID
  const leadsList = await fetchAll('crm.lead.list', { SOURCE_ID: 'UC_1WUFJB' }, ['ID']);
  if (leadsList.length === 0) {
    console.log('No amoCRM leads found.');
    return;
  }
  
  const leadId = leadsList[0].ID;
  console.log(`Fetching lead ID: ${leadId} with all custom fields...`);
  const details = await fetchOne('crm.lead.get', leadId);
  
  console.log('Bitrix raw fields:');
  console.log(`- SOURCE_ID: ${details.SOURCE_ID}`);
  console.log(`- UF_CRM_1778260858916 (Enum Channel ID): ${details.UF_CRM_1778260858916}`);
  console.log(`- UF_CRM_1778261535982 (String Sub-Source): ${details.UF_CRM_1778261535982}`);
  
  console.log('Upserting to Postgres database...');
  await upsertLead(details);
  
  const { rows } = await pool.query(
    'SELECT id, source_id, uf_segment, uf_filial FROM leads WHERE id = $1',
    [parseInt(leadId)]
  );
  
  console.log('Postgres columns after upsert:');
  console.log(JSON.stringify(rows[0], null, 2));
  
  await pool.end();
}

main().catch(console.error);

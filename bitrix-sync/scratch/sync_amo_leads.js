require('dotenv').config();
const pool = require('../src/db/pool');
const { fetchAll } = require('../src/services/bitrix');
const { upsertLead } = require('../src/services/upsertLead');
const { loadAll: loadStages } = require('../src/services/stageResolver');

async function main() {
  console.log('=== Bitrix24 amoCRM Lead Backfill Sync ===');
  await loadStages();
  console.log('Fetching all amoCRM leads from Bitrix...');
  const SELECT_FIELDS = [
    'ID', 'ASSIGNED_BY_ID', 'STATUS_ID', 'OPPORTUNITY', 'SOURCE_ID',
    'UTM_SOURCE', 'UTM_MEDIUM', 'UTM_CAMPAIGN', 'UTM_CONTENT', 'UTM_TERM',
    'DATE_CREATE', 'DATE_MODIFY',
    'UF_CRM_1775825731211', 'UF_CRM_1778260858916', 'UF_CRM_1777030859057', 'UF_CRM_1778261535982',
    'UF_CRM_1775824803703', 'UF_CRM_1775825155935', 'UF_CRM_1770281264686',
  ];
  
  const leads = await fetchAll('crm.lead.list', { SOURCE_ID: 'UC_1WUFJB' }, SELECT_FIELDS);
  console.log(`Fetched ${leads.length} amoCRM leads. Upserting to database...`);
  
  let count = 0;
  for (const r of leads) {
    await upsertLead(r);
    count++;
    if (count % 500 === 0) {
      console.log(`Leads progress: ${count}/${leads.length}`);
    }
  }
  console.log(`Successfully backfilled ${leads.length} amoCRM leads.`);
  await pool.end();
}

main().catch(console.error);

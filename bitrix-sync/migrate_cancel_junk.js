require('dotenv').config();
const { fetchAll } = require('./src/services/bitrix');
const { upsertLead } = require('./src/services/upsertLead');

const LEAD_SELECT = [
  'ID', 'ASSIGNED_BY_ID', 'STATUS_ID', 'OPPORTUNITY', 'SOURCE_ID',
  'UTM_SOURCE', 'UTM_MEDIUM', 'UTM_CAMPAIGN', 'UTM_CONTENT', 'UTM_TERM',
  'DATE_CREATE', 'DATE_MODIFY', 'NAME', 'LAST_NAME', 'TITLE',
  'UF_CRM_1775825731211', 'UF_CRM_1777030859057',
  'UF_CRM_1775824803703', 'UF_CRM_1775825155935', 'UF_CRM_1770281264686',
  'UF_CRM_1770976355232', 'UF_CRM_1770282341169',
];

async function migrate() {
  const stages = [
    { id: 'UC_NAZK5J', label: "Bekor bo'ldi" },
    { id: 'UC_F8K4GI', label: 'Sifatsiz' },
  ];

  for (const stage of stages) {
    console.log(`\n[migrate] Fetching ${stage.label} (${stage.id})...`);
    const leads = await fetchAll('crm.lead.list', { STATUS_ID: stage.id }, LEAD_SELECT);
    console.log(`[migrate] Found ${leads.length} leads`);

    let ok = 0, err = 0;
    for (const lead of leads) {
      try {
        await upsertLead(lead);
        ok++;
        if (ok % 50 === 0) console.log(`[migrate]   ${ok}/${leads.length}...`);
      } catch (e) {
        err++;
        console.error(`[migrate] Lead ${lead.ID}: ${e.message}`);
      }
    }
    console.log(`[migrate] ${stage.label}: ${ok} ok, ${err} errors`);
  }

  console.log('\n[migrate] Done.');
}

migrate().catch(console.error).finally(() => process.exit(0));

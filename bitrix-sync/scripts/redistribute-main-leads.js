/**
 * One-time script: distribute all NEW leads assigned to the main responsible.
 * Run on server: node scripts/redistribute-main-leads.js
 */
require('dotenv').config();

const { fetchAll } = require('../src/services/bitrix');
const { upsertLead } = require('../src/services/upsertLead');
const { distributeLead } = require('../src/services/distributor');
const pool = require('../src/db/pool');

const MAIN_ID = parseInt(process.env.MAIN_RESPONSIBLE_ID || '1', 10);

const SELECT = [
  'ID', 'ASSIGNED_BY_ID', 'STATUS_ID', 'OPPORTUNITY', 'SOURCE_ID',
  'UTM_SOURCE', 'UTM_MEDIUM', 'UTM_CAMPAIGN', 'UTM_CONTENT', 'UTM_TERM',
  'DATE_CREATE', 'DATE_MODIFY', 'NAME', 'LAST_NAME', 'TITLE', 'WEB_FORM_ID',
  'UF_CRM_1775825731211', 'UF_CRM_1778260858916', 'UF_CRM_1777030859057', 'UF_CRM_1778261535982',
  'UF_CRM_1775824803703', 'UF_CRM_1775825155935', 'UF_CRM_1770281264686',
  'UF_CRM_1770976355232', 'UF_CRM_1770282341169', 'UF_CRM_1770693781846',
];

async function run() {
  console.log(`[redistribute] Fetching NEW leads assigned to responsible id=${MAIN_ID}...`);

  const leads = await fetchAll(
    'crm.lead.list',
    { ASSIGNED_BY_ID: String(MAIN_ID), STATUS_ID: 'NEW' },
    SELECT
  );

  console.log(`[redistribute] Found ${leads.length} leads`);
  if (leads.length === 0) {
    console.log('[redistribute] Nothing to do.');
    return;
  }

  let distributed = 0;
  let failed = 0;

  for (const raw of leads) {
    const leadId = parseInt(raw.ID);
    try {
      await upsertLead(raw);
      const assignedTo = await distributeLead(leadId);
      if (assignedTo) {
        distributed++;
        console.log(`[redistribute] Lead ${leadId} → responsible ${assignedTo} (${distributed}/${leads.length})`);
      } else {
        console.warn(`[redistribute] Lead ${leadId} — distributeLead returned null`);
        failed++;
      }
    } catch (err) {
      console.error(`[redistribute] Lead ${leadId} error: ${err.message}`);
      failed++;
    }
  }

  console.log(`\n[redistribute] Done — distributed: ${distributed}, failed: ${failed}, total: ${leads.length}`);
}

run()
  .catch(err => console.error('[redistribute] Fatal:', err.message))
  .finally(() => pool.end());

require('dotenv').config();
const https = require('https');
const http = require('http');
const pool = require('../src/db/pool');
const { upsertLead } = require('../src/services/upsertLead');
const { loadAll: loadStages } = require('../src/services/stageResolver');

const WEBHOOK_URL = process.env.BITRIX_WEBHOOK_URL;

function httpGet(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    lib.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

function buildUrl(method, params) {
  const base = `${WEBHOOK_URL}/${method}`;
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (typeof v === 'object' && v !== null) {
      for (const [fk, fv] of Object.entries(v)) {
        qs.append(`${k}[${fk}]`, fv);
      }
    } else {
      qs.append(k, v);
    }
  }
  return `${base}?${qs.toString()}`;
}

async function main() {
  console.log('=== Bitrix24 amoCRM Lead Fast Backfill ===');
  await loadStages();
  
  const selectFields = [
    'ID', 'ASSIGNED_BY_ID', 'STATUS_ID', 'OPPORTUNITY', 'SOURCE_ID',
    'UTM_SOURCE', 'UTM_MEDIUM', 'UTM_CAMPAIGN', 'UTM_CONTENT', 'UTM_TERM',
    'DATE_CREATE', 'DATE_MODIFY',
    'UF_CRM_1775825731211', 'UF_CRM_1778260858916', 'UF_CRM_1777030859057', 'UF_CRM_1778261535982',
    'UF_CRM_1775824803703', 'UF_CRM_1775825155935', 'UF_CRM_1770281264686',
  ];
  
  console.log('Fetching first page of amoCRM leads...');
  const url = buildUrl('crm.lead.list', {
    filter: { SOURCE_ID: 'UC_1WUFJB' },
    select: selectFields,
    limit: 50
  });
  
  const res = await httpGet(url);
  if (!res.result || res.result.length === 0) {
    console.log('No leads found.');
    return;
  }
  
  console.log(`Fetched ${res.result.length} leads. Syncing to database...`);
  for (const r of res.result) {
    await upsertLead(r);
  }
  
  console.log('Successfully completed fast sync!');
  await pool.end();
}

main().catch(console.error);

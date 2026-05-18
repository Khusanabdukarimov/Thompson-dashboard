require('dotenv').config();
const https = require('https');
const http = require('http');

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
  console.log('Fetching a single sample amoCRM lead from Bitrix...');
  const url = buildUrl('crm.lead.list', {
    filter: { SOURCE_ID: 'UC_1WUFJB' },
    select: ['ID', 'TITLE', 'SOURCE_ID'],
    limit: 1
  });
  
  const res = await httpGet(url);
  if (!res.result || res.result.length === 0) {
    console.log('No amoCRM leads found.');
    return;
  }
  
  const leadId = res.result[0].ID;
  console.log(`Getting full details for lead ID: ${leadId}`);
  const getUrl = buildUrl('crm.lead.get', { id: leadId });
  const detailsRes = await httpGet(getUrl);
  const details = detailsRes.result;
  
  // Print all UF_CRM_ fields that have values
  const ufFields = {};
  for (const [k, v] of Object.entries(details)) {
    if (k.startsWith('UF_CRM_') && v !== null && v !== '' && v !== false && v !== 'false') {
      ufFields[k] = v;
    }
  }
  console.log('Populated custom fields:', ufFields);
}

main().catch(console.error);

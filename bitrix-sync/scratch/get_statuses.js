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
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(`JSON parse: ${e.message}`));
        }
      });
    }).on('error', reject);
  });
}

async function main() {
  console.log('Fetching CRM status list from Bitrix...');
  const url = `${WEBHOOK_URL}/crm.status.list`;
  try {
    const res = await httpGet(url);
    if (!res.result) {
      console.log('No result:', res);
      return;
    }
    const dealStatuses = res.result.filter(s => s.ENTITY_ID.startsWith('DEAL_STAGE'));
    console.log('Deal Stages metadata count:', dealStatuses.length);
    console.log(JSON.stringify(dealStatuses, null, 2));
  } catch (err) {
    console.error('Error:', err.message);
  }
}

main();

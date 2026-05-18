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
  console.log('Fetching deal user fields from Bitrix...');
  const url = `${WEBHOOK_URL}/crm.deal.userfield.list`;
  try {
    const res = await httpGet(url);
    if (!res.result) {
      console.log('No result:', res);
      return;
    }
    const field = res.result.find(f => f.FIELD_NAME === 'UF_CRM_69EBC105EAA93');
    if (!field) {
      console.log('Field UF_CRM_69EBC105EAA93 not found in:', res.result.map(f => f.FIELD_NAME));
      return;
    }
    console.log('Field Metadata:', JSON.stringify(field, null, 2));
  } catch (err) {
    console.error('Error:', err.message);
  }
}

main();

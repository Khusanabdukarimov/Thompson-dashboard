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

async function main() {
  console.log('Counting contacts in Bitrix...');
  const url = `${WEBHOOK_URL}/crm.contact.list?select[]=ID&select[]=PHONE`;
  const res = await httpGet(url);
  console.log('Result:', {
    total: res.total,
    sample: res.result ? res.result.slice(0, 3) : []
  });
}

main().catch(console.error);

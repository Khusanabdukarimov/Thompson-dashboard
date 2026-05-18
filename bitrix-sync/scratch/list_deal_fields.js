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
  console.log('Fetching deal user fields from Bitrix...');
  const url = `${WEBHOOK_URL}/crm.deal.userfield.list`;
  const res = await httpGet(url);
  if (!res.result) {
    console.log('No result:', res);
    return;
  }
  for (const f of res.result) {
    console.log(`- ${f.FIELD_NAME}: ${f.EDIT_FORM_LABEL.ru || f.EDIT_FORM_LABEL.en || f.USER_TYPE_ID}`);
  }
}

main().catch(console.error);

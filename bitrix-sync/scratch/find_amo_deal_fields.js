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
    if (f.USER_TYPE_ID === 'enumeration' && f.LIST) {
      const hasInstagram = f.LIST.some(item => item.VALUE === 'Instagram');
      if (hasInstagram) {
        console.log('FOUND FIELD MAP FOR DEALS!');
        console.log(JSON.stringify(f, null, 2));
      }
    }
  }
  console.log('Scan complete.');
}

main().catch(console.error);

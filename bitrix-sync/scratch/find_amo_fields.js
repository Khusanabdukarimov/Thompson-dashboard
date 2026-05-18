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
  console.log('Fetching lead userfields from Bitrix...');
  const url = `${WEBHOOK_URL}/crm.lead.userfield.list`;
  const res = await httpGet(url);
  if (!res.result) {
    console.log('No fields found:', res);
    return;
  }
  
  // Find fields related to amoCRM
  const matches = res.result.filter(f => 
    f.FIELD_NAME.includes('177826') || 
    (f.EDIT_FORM_LABEL && (
      f.EDIT_FORM_LABEL.ru?.toLowerCase().includes('amo') ||
      f.EDIT_FORM_LABEL.ru?.toLowerCase().includes('амо') ||
      f.EDIT_FORM_LABEL.uz?.toLowerCase().includes('amo') ||
      f.LIST_COLUMN_LABEL?.ru?.toLowerCase().includes('amo') ||
      f.LIST_COLUMN_LABEL?.ru?.toLowerCase().includes('амо')
    ))
  );
  
  console.log(`Found ${matches.length} matching custom fields:`);
  console.log(JSON.stringify(matches, null, 2));
}

main().catch(console.error);

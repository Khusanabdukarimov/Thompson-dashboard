#!/usr/bin/env node
/*
Fetch Lead Ad Instant Forms (leadgen_forms) from a Facebook Page and save results.
Reads credentials from .env using dotenv.

Usage: node scripts/fetch_leadgen_forms.js
*/

const fs = require('fs');
const path = require('path');
const axios = require('axios');
require('dotenv').config({ path: path.resolve(process.cwd(), '.env') });

const {
  FB_PAGE_ID,
  FB_ACCESS_TOKEN,
  FB_API_VERSION = 'v21.0',
} = process.env;

if (!FB_PAGE_ID) {
  console.error('Error: FB_PAGE_ID is not set in .env');
  process.exit(1);
}

if (!FB_ACCESS_TOKEN) {
  console.error('Error: FB_ACCESS_TOKEN is not set in .env');
  process.exit(1);
}

const GRAPH_BASE = `https://graph.facebook.com/${FB_API_VERSION}`;

async function getPageAccessToken(userToken) {
  // Exchange a user token for a page access token if needed
  try {
    const url = `${GRAPH_BASE}/${FB_PAGE_ID}?fields=access_token&access_token=${encodeURIComponent(userToken)}`;
    const res = await axios.get(url);
    if (res.data && res.data.access_token) return res.data.access_token;
    return null;
  } catch (err) {
    // propagate error
    throw err;
  }
}

async function fetchAllForms(accessToken) {
  const fields = 'id,name,status,created_time,leads_count';
  const limit = 100; // page size
  let url = `${GRAPH_BASE}/${FB_PAGE_ID}/leadgen_forms?fields=${fields}&access_token=${encodeURIComponent(accessToken)}&limit=${limit}`;

  const all = [];

  while (url) {
    try {
      const res = await axios.get(url, { timeout: 20000 });
      if (res.data && res.data.data) {
        all.push(...res.data.data);
      }

      if (res.data && res.data.paging && res.data.paging.next) {
        url = res.data.paging.next;
      } else {
        url = null;
      }
    } catch (err) {
      // Bubble up useful error info
      if (err.response && err.response.data) {
        const e = err.response.data;
        const msg = e.error && e.error.message ? e.error.message : JSON.stringify(e);
        throw new Error(`Facebook API error: ${msg}`);
      }
      throw err;
    }
  }

  return all;
}

function printTable(rows) {
  if (!rows || rows.length === 0) {
    console.log('No leadgen forms found.');
    return;
  }

  // Columns: Form ID, Form Name, Status, Created Date, Leads Count
  const cols = [ 'Form ID', 'Name', 'Status', 'Created', 'Leads' ];
  const data = rows.map(r => ({
    id: r.id || '',
    name: r.name || '',
    status: (r.status || '').toUpperCase(),
    created: r.created_time ? (new Date(r.created_time)).toISOString().slice(0,10) : '',
    leads: (typeof r.leads_count === 'number') ? r.leads_count : (r.leads_count ? r.leads_count : 0),
  }));

  // compute column widths
  const widths = cols.map((c, i) => {
    const key = ['id','name','status','created','leads'][i];
    const max = Math.max(c.length, ...data.map(d => String(d[key]).length));
    return Math.min(max, 60); // cap
  });

  function pad(s, n) { s = String(s); return s.length > n ? s.slice(0,n-3) + '...' : s + ' '.repeat(n - s.length); }

  // top border
  const top = '┌' + widths.map(w => '─'.repeat(w + 2)).join('┬') + '┐';
  const sep = '├' + widths.map(w => '─'.repeat(w + 2)).join('┼') + '┤';
  const bot = '└' + widths.map(w => '─'.repeat(w + 2)).join('┴') + '┘';

  console.log(top);
  // header
  console.log('│ ' + cols.map((c,i) => pad(c, widths[i])).join(' │ ') + ' │');
  console.log(sep);
  // rows
  for (const d of data) {
    const vals = [d.id, d.name, d.status, d.created, d.leads];
    console.log('│ ' + vals.map((v,i) => pad(v, widths[i])).join(' │ ') + ' │');
  }
  console.log(bot);
}

async function main() {
  let token = FB_ACCESS_TOKEN;

  // First try fetching with provided token.
  try {
    const forms = await fetchAllForms(token);
    // Save JSON
    fs.writeFileSync(path.resolve(process.cwd(), 'leadgen_forms.json'), JSON.stringify(forms, null, 2));
    printTable(forms);
    console.log(`Saved ${forms.length} forms to leadgen_forms.json`);
    return;
  } catch (err) {
    // If the error indicates a permission/token problem, try exchanging for a Page token
    const msg = err && err.message ? err.message : String(err);
    console.warn('Initial fetch failed:', msg);
    console.log('Attempting to exchange provided token for a Page Access Token and retry...');
  }

  // Try exchanging for page token
  try {
    const pageToken = await getPageAccessToken(token);
    if (!pageToken) throw new Error('Page access token not returned by Graph API');
    token = pageToken;
    const forms = await fetchAllForms(token);
    fs.writeFileSync(path.resolve(process.cwd(), 'leadgen_forms.json'), JSON.stringify(forms, null, 2));
    printTable(forms);
    console.log(`Saved ${forms.length} forms to leadgen_forms.json`);
    return;
  } catch (err) {
    console.error('Failed to fetch leadgen forms:', err.message || err);
    process.exit(2);
  }
}

main().catch(err => {
  console.error('Unexpected error:', err && err.stack ? err.stack : err);
  process.exit(1);
});

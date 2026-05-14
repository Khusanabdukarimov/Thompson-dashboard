#!/usr/bin/env node
/*
Fetch campaign insights for a given Ad Account and save results.
Reads credentials from .env using dotenv.

Usage:
  # from bitrix-sync folder
  node scripts/fetch_campaign_insights.js

Or pass env vars inline:
  FB_AD_ACCOUNT_ID=act_932239158316127 FB_ACCESS_TOKEN="..." node scripts/fetch_campaign_insights.js

The script will save `campaign_insights.json` in the working directory.
*/

const fs = require('fs');
const path = require('path');
const axios = require('axios');
require('dotenv').config({ path: path.resolve(process.cwd(), '.env') });

const {
  FB_AD_ACCOUNT_ID,
  FB_ACCESS_TOKEN,
  FB_API_VERSION = 'v21.0',
} = process.env;

if (!FB_AD_ACCOUNT_ID) {
  console.error('Error: FB_AD_ACCOUNT_ID is not set in .env or env');
  process.exit(1);
}
if (!FB_ACCESS_TOKEN) {
  console.error('Error: FB_ACCESS_TOKEN is not set in .env or env');
  process.exit(1);
}

const GRAPH_BASE = `https://graph.facebook.com/${FB_API_VERSION}`;

async function fetchAllInsights(adAccountId, accessToken, params = {}) {
  // Build initial URL
  const fields = [
    'campaign_name',
    'spend',
    'impressions',
    'clicks',
    'inline_link_clicks',
    'actions',
    'cpc',
    'ctr',
  ].join(',');

  const limit = params.limit || 100;
  let url = `${GRAPH_BASE}/${adAccountId}/insights?level=campaign&fields=${fields}&breakdowns=publisher_platform&limit=${limit}&access_token=${encodeURIComponent(accessToken)}`;

  // append date range if provided
  if (params.time_range) {
    const tr = encodeURIComponent(JSON.stringify(params.time_range));
    url += `&time_range=${tr}`;
  }

  const all = [];
  while (url) {
    try {
      const res = await axios.get(url, { timeout: 20000 });
      if (res.data && Array.isArray(res.data.data)) {
        all.push(...res.data.data);
      }
      if (res.data && res.data.paging && res.data.paging.next) {
        url = res.data.paging.next;
      } else {
        url = null;
      }
    } catch (err) {
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

function extractLeadCount(actions) {
  if (!Array.isArray(actions)) return 0;
  // actions is an array of { action_type, value }
  const leadEntry = actions.find(a => a.action_type === 'lead' || a.action_type === 'leadgen' || a.action_type === 'lead_gen');
  if (leadEntry) return Number(leadEntry.value) || 0;
  // Some reports may include 'action_type' variants; fallback to sum of any action with 'lead' in the type
  const fallback = actions.reduce((acc, a) => acc + ((String(a.action_type || '').toLowerCase().includes('lead')) ? Number(a.value || 0) : 0), 0);
  return fallback;
}

function printTable(rows) {
  if (!rows || rows.length === 0) {
    console.log('No insights rows returned.');
    return;
  }
  const cols = ['Campaign', 'Platform', 'Spend', 'Impr', 'Clicks', 'LinkClicks', 'Leads', 'CPC', 'CTR'];
  const data = rows.map(r => ({
    campaign: r.campaign_name || '(no name)',
    platform: r.publisher_platform || 'unknown',
    spend: r.spend || '0',
    impressions: r.impressions || '0',
    clicks: r.clicks || '0',
    link_clicks: r.inline_link_clicks || '0',
    leads: extractLeadCount(r.actions),
    cpc: r.cpc || '0',
    ctr: r.ctr || '0',
  }));

  // compute widths
  const widths = cols.map((c,i) => Math.min(50, Math.max(c.length, ...data.map(d => String(Object.values(d)[i]).length))));
  const pad = (s,n) => { s = String(s); return s.length > n ? s.slice(0,n-3)+'...' : s + ' '.repeat(n - s.length); };
  const top = '┌' + widths.map(w => '─'.repeat(w+2)).join('┬') + '┐';
  const sep = '├' + widths.map(w => '─'.repeat(w+2)).join('┼') + '┤';
  const bot = '└' + widths.map(w => '─'.repeat(w+2)).join('┴') + '┘';
  console.log(top);
  console.log('│ ' + cols.map((c,i)=>pad(c,widths[i])).join(' │ ') + ' │');
  console.log(sep);
  for (const d of data) {
    const vals = [d.campaign, d.platform, d.spend, d.impressions, d.clicks, d.link_clicks, d.leads, d.cpc, d.ctr];
    console.log('│ ' + vals.map((v,i)=>pad(v,widths[i])).join(' │ ') + ' │');
  }
  console.log(bot);
}

async function main() {
  try {
    const rows = await fetchAllInsights(FB_AD_ACCOUNT_ID, FB_ACCESS_TOKEN);
    // Save raw JSON
    const outPath = path.resolve(process.cwd(), 'campaign_insights.json');
    fs.writeFileSync(outPath, JSON.stringify(rows, null, 2));
    console.log(`Saved ${rows.length} insight rows to ${outPath}`);
    printTable(rows);
  } catch (err) {
    console.error('Error fetching campaign insights:', err.message || err);
    process.exit(2);
  }
}

main().catch(err => { console.error(err); process.exit(1); });

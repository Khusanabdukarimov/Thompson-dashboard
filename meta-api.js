// meta-api.js
// Fetches Meta Ads (Facebook + Instagram) campaign insights for a given month.
// Import this as an ES module. Credentials come from config.js (never committed).
//
// Usage:
//   import { fetchMetaAdsData } from './meta-api.js';
//   const data = await fetchMetaAdsData('aprel', 2026);
//   // data → { target: { budget: [...31], leads: [...31] },
//   //          instagram: { budget: [...31], leads: [...31] } }

import { META_CONFIG } from './config.js';

// ── Constants ──────────────────────────────────────────────────
const GRAPH = `https://graph.facebook.com/${META_CONFIG.API_VERSION}`;

const MONTH_NUMS = {
  yanvar: 1, fevral: 2,  mart: 3,   aprel: 4,
  may: 5,    iyun: 6,    iyul: 7,   avgust: 8,
  sentabr: 9, oktabr: 10, noyabr: 11, dekabr: 12,
};

// Lead action types recognised by Meta
const LEAD_ACTION_TYPES = new Set([
  'lead',
  'offsite_conversion.fb_pixel_lead',
  'onsite_conversion.lead_grouped',
]);

// ── Helpers ────────────────────────────────────────────────────
function pad2(n) { return String(n).padStart(2, '0'); }

function daysInMonth(year, monthNum) {
  // new Date(year, monthNum, 0) → last day of monthNum (1-based)
  return new Date(year, monthNum, 0).getDate();
}

function emptyArrays() {
  return { budget: Array(31).fill(0), leads: Array(31).fill(0) };
}

// Fetches all pages of a paginated Meta Graph API response.
// Returns the combined `data` array.
async function fetchAllPages(baseUrl, params) {
  const rows = [];
  let url = baseUrl + '?' + new URLSearchParams(params).toString();

  while (url) {
    const res = await fetch(url);

    // Network-level failure (no response)
    if (!res.ok && res.status === 0) {
      throw { kind: 'network_error', message: 'No response from graph.facebook.com' };
    }

    const json = await res.json();

    if (json.error) {
      const { code, message, type } = json.error;
      if (code === 190)                   throw { kind: 'token_expired',    code, message };
      if (code === 17 || code === 80000)  throw { kind: 'rate_limit',       code, message };
      if (code === 10 || code === 200 || code === 270)
                                          throw { kind: 'permission_denied', code, message };
      throw { kind: 'api_error', code, message, type };
    }

    rows.push(...(json.data || []));
    // Meta returns the full next URL (already includes token + params)
    url = json.paging?.next ?? null;
  }

  return rows;
}

// ── Main export ────────────────────────────────────────────────

/**
 * Fetch Meta Ads spend + leads for a full calendar month.
 *
 * @param {string} monthKey  Uzbek lowercase month key, e.g. 'aprel'
 * @param {number} year      Full year, e.g. 2026
 * @returns {{ target: { budget: number[], leads: number[] },
 *             instagram: { budget: number[], leads: number[] } }}
 *
 * Throws an object with a `kind` field on error:
 *   { kind: 'token_expired' | 'rate_limit' | 'permission_denied'
 *           | 'api_error' | 'network_error', message, code? }
 */
export async function fetchMetaAdsData(monthKey, year) {
  const monthNum = MONTH_NUMS[String(monthKey).toLowerCase()];
  if (!monthNum) throw { kind: 'bad_input', message: `Unknown month key: "${monthKey}"` };

  const days  = daysInMonth(year, monthNum);
  const since = `${year}-${pad2(monthNum)}-01`;
  const until = `${year}-${pad2(monthNum)}-${pad2(days)}`;

  const result = {
    target:    emptyArrays(),
    instagram: emptyArrays(),
    campaigns: [], // New: Store raw campaign rows for the detailed table
  };

  const params = {
    access_token:   META_CONFIG.ACCESS_TOKEN,
    fields:         'campaign_name,objective,spend,impressions,reach,clicks,frequency,actions,date_start',
    level:          'campaign',
    time_increment: 1,
    time_range:     JSON.stringify({ since, until }),
    breakdowns:     'publisher_platform',
    limit:          500,
  };

  const url = `${GRAPH}/${META_CONFIG.AD_ACCOUNT_ID}/insights`;
  const rows = await fetchAllPages(url, params);

  for (const row of rows) {
    const platform = row.publisher_platform;
    const src =
      platform === 'facebook'  ? 'target' :
      platform === 'instagram' ? 'instagram' : null;
    
    // Store in campaigns list regardless of platform (for the detailed view)
    result.campaigns.push({
      date:        row.date_start,
      name:        row.campaign_name,
      platform:    platform,
      objective:   row.objective,
      spend:       parseFloat(row.spend || 0),
      impressions: parseInt(row.impressions || 0, 10),
      reach:       parseInt(row.reach || 0, 10),
      clicks:      parseInt(row.clicks || 0, 10),
      frequency:   parseFloat(row.frequency || 0),
      leads:       0, // will calculate below
    });

    if (!src) continue;

    const day = parseInt((row.date_start || '').split('-')[2], 10);
    if (!day || day < 1 || day > 31) continue;
    const idx = day - 1;

    // Aggregated data for existing table
    const spendVal = parseFloat(row.spend || 0);
    result[src].budget[idx] += spendVal;

    // Extract leads
    let leadCount = 0;
    for (const action of (row.actions || [])) {
      if (LEAD_ACTION_TYPES.has(action.action_type)) {
        const v = parseInt(action.value || 0, 10);
        leadCount += v;
      }
    }
    result[src].leads[idx] += leadCount;

    // Add leadCount to the last added campaign row
    result.campaigns[result.campaigns.length - 1].leads = leadCount;
  }

  // Round budget to 2 decimal places
  for (const src of ['target', 'instagram']) {
    result[src].budget = result[src].budget.map(v => Math.round(v * 100) / 100);
  }

  return result;
}

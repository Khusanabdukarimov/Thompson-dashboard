'use strict';

const { Router } = require('express');
const axios = require('axios');
const pool = require('../db/pool');

const router = Router();

const API_VERSION = process.env.FB_API_VERSION || 'v21.0';
const BASE = `https://graph.facebook.com/${API_VERSION}`;

// Prefer META_ACCESS_TOKEN; fall back to legacy FB_ACCESS_TOKEN
function token() {
  return process.env.META_ACCESS_TOKEN || process.env.FB_ACCESS_TOKEN;
}

function accountId() {
  const id = process.env.META_AD_ACCOUNT_ID || process.env.FB_AD_ACCOUNT_ID || '';
  return id.startsWith('act_') ? id : `act_${id}`;
}

const MONTH_NUMS = {
  yanvar: 1, fevral: 2, mart: 3, aprel: 4,
  may: 5, iyun: 6, iyul: 7, avgust: 8,
  sentabr: 9, oktabr: 10, noyabr: 11, dekabr: 12,
};

function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

// ── Cache helpers ──────────────────────────────────────────────

// Create table on startup; log but don't crash if it already exists.
pool.query(`
  CREATE TABLE IF NOT EXISTS campaign_cache (
    id         SERIAL PRIMARY KEY,
    endpoint   VARCHAR(100) NOT NULL,
    month      INT NOT NULL,
    year       INT NOT NULL,
    data       JSONB NOT NULL,
    fetched_at TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE(endpoint, month, year)
  );
`).catch(err => console.error('[campaigns] cache table init:', err.message));

async function getCache(endpoint, month, year) {
  const { rows } = await pool.query(
    `SELECT data FROM campaign_cache
     WHERE endpoint = $1 AND month = $2 AND year = $3
       AND fetched_at > NOW() - INTERVAL '1 hour'`,
    [endpoint, month, year],
  );
  return rows[0]?.data ?? null;
}

async function setCache(endpoint, month, year, data) {
  await pool.query(
    `INSERT INTO campaign_cache (endpoint, month, year, data, fetched_at)
     VALUES ($1, $2, $3, $4::jsonb, NOW())
     ON CONFLICT (endpoint, month, year)
     DO UPDATE SET data = EXCLUDED.data, fetched_at = NOW()`,
    [endpoint, month, year, JSON.stringify(data)],
  );
}

// ── Meta Graph API helpers ─────────────────────────────────────

async function paginate(url, params) {
  const rows = [];
  let nextUrl = url;
  let nextParams = params;
  while (nextUrl) {
    const { data } = await axios.get(nextUrl, { params: nextParams, timeout: 30000 });
    if (data.error) throw new Error(`Meta API ${data.error.code}: ${data.error.message}`);
    rows.push(...(data.data || []));
    nextUrl = data.paging?.next || null;
    nextParams = null; // next URL already includes all params
  }
  return rows;
}

// ── Row aggregation (mirrors Python ads_to_table) ──────────────

const LEAD_TYPES = new Set([
  'lead',
  'offsite_conversion.fb_pixel_lead',
  'onsite_conversion.lead_grouped',
  'onsite_conversion.messaging_conversation_started_7d',
]);
const LPV_TYPES = new Set(['landing_page_view']);
const V3_TYPES  = new Set(['video_view', 'video_3sec_watched_actions']);

function actionVal(actions, types) {
  if (!actions) return 0;
  return actions.reduce(
    (s, a) => (types.has(a.action_type) ? s + parseInt(a.value || 0, 10) : s),
    0,
  );
}

function buildRows(rawRows) {
  const bucket = new Map();

  for (const r of rawRows) {
    if (!r || r.error) continue;
    const adId    = r.ad_id || r.ad_name || '';
    const platform =
      (r.publisher_platform || '').toLowerCase() === 'instagram' ? 'instagram' : 'facebook';
    const key = `${adId}|${platform}`;

    if (!bucket.has(key)) {
      bucket.set(key, {
        campaign_name: '', adset_name: '', ad_name: '', objective: '', platform,
        spend: 0, impressions: 0, reach: 0, freq_w: 0,
        clicks: 0, unique_clicks: 0, link_clicks: 0,
        leads: 0, lpv: 0, v3: 0,
      });
    }

    const b = bucket.get(key);
    b.campaign_name = r.campaign_name || b.campaign_name;
    b.adset_name    = r.adset_name    || b.adset_name;
    b.ad_name       = r.ad_name       || b.ad_name;
    b.objective     = r.objective     || b.objective;
    b.spend        += parseFloat(r.spend || 0);
    const impr      = parseInt(r.impressions || 0, 10);
    b.impressions  += impr;
    b.reach        += parseInt(r.reach || 0, 10);
    b.freq_w       += parseFloat(r.frequency || 0) * impr;
    b.clicks       += parseInt(r.clicks || 0, 10);
    b.unique_clicks += parseInt(r.unique_clicks || 0, 10);
    b.link_clicks  += parseInt(r.inline_link_clicks || 0, 10);
    b.leads        += actionVal(r.actions, LEAD_TYPES);
    b.lpv          += actionVal(r.actions, LPV_TYPES);
    b.v3           += actionVal(r.video_play_actions, V3_TYPES);
  }

  const out = [];
  for (const b of bucket.values()) {
    const { impressions: impr, clicks, link_clicks: link, leads, spend } = b;
    out.push({
      campaign_name:       b.campaign_name,
      adset_name:          b.adset_name,
      ad_name:             b.ad_name,
      objective:           b.objective,
      platform:            b.platform,
      spend:               round2(spend),
      impressions:         impr,
      reach:               b.reach,
      frequency:           impr  ? round2(b.freq_w / impr)   : 0,
      clicks,
      unique_clicks:       b.unique_clicks,
      link_clicks:         link,
      leads,
      landing_page_views:  b.lpv,
      cpm:                 impr   ? round2(spend / impr * 1000) : 0,
      cpc:                 clicks ? round2(spend / clicks)      : 0,
      cpl:                 leads  ? round2(spend / leads)       : 0,
      ctr:                 impr   ? round2(clicks / impr * 100) : 0,
      hook_rate:           impr   ? round2(b.v3  / impr * 100) : 0,
      visit_rate:          link   ? round2(b.lpv / link * 100) : 0,
      lid_rate:            link   ? round2(leads / link * 100) : 0,
    });
  }
  out.sort((a, b) => b.spend - a.spend);
  return out;
}

function round2(n) { return Math.round(n * 100) / 100; }

// ── Daily insights aggregation (mirrors Python insights_to_monthly) ────

function buildInsights(rawRows, monthKey, year) {
  const monthNum = MONTH_NUMS[monthKey.toLowerCase()];
  if (!monthNum) return {};
  const days = daysInMonth(year, monthNum);
  const empty = () => Array(days).fill(0);
  const result = {
    target:    { budget: empty(), leads: empty(), clicks: empty(), impressions: empty() },
    instagram: { budget: empty(), leads: empty(), clicks: empty(), impressions: empty() },
  };
  for (const row of rawRows) {
    if (row.error) continue;
    const parts = (row.date_start || '').split('-');
    const day = parseInt(parts[2] || '0', 10);
    if (day < 1 || day > days) continue;
    const idx = day - 1;
    const src = (row.publisher_platform || '').toLowerCase() === 'instagram' ? 'instagram' : 'target';
    result[src].budget[idx]      += round2(parseFloat(row.spend || 0));
    result[src].leads[idx]       += actionVal(row.actions, LEAD_TYPES);
    result[src].clicks[idx]      += parseInt(row.clicks || 0, 10);
    result[src].impressions[idx] += parseInt(row.impressions || 0, 10);
  }
  return result;
}

// ── Routes ─────────────────────────────────────────────────────

// GET /api/campaigns/rows?month=may&year=2026
router.get('/rows', async (req, res) => {
  const month    = (req.query.month || '').toLowerCase();
  const year     = parseInt(req.query.year || new Date().getFullYear(), 10);
  const monthNum = MONTH_NUMS[month];
  if (!monthNum) return res.status(400).json({ error: `Unknown month: ${month}` });

  try {
    const cached = await getCache('campaigns/rows', monthNum, year);
    if (cached) return res.json(cached);

    if (!token()) throw new Error('META_ACCESS_TOKEN or FB_ACCESS_TOKEN is not set');

    const days  = daysInMonth(year, monthNum);
    const since = `${year}-${pad(monthNum)}-01`;
    const until = `${year}-${pad(monthNum)}-${pad(days)}`;

    const fields = [
      'campaign_id', 'campaign_name', 'adset_id', 'adset_name', 'ad_id', 'ad_name',
      'objective', 'spend', 'impressions', 'reach', 'frequency',
      'clicks', 'unique_clicks', 'inline_link_clicks',
      'cpm', 'cpc', 'ctr', 'actions', 'video_play_actions',
    ].join(',');

    const rawRows = await paginate(`${BASE}/${accountId()}/insights`, {
      access_token:  token(),
      fields,
      level:         'ad',
      breakdowns:    'publisher_platform',
      time_range:    JSON.stringify({ since, until }),
      limit:         500,
    });

    const payload = { month, year, rows: buildRows(rawRows) };
    await setCache('campaigns/rows', monthNum, year, payload);
    res.json(payload);
  } catch (err) {
    const errorBody = err.response?.data || err.message;
    console.error('[campaigns/rows]', errorBody);
    res.status(500).json({ error: errorBody });
  }
});

// GET /api/campaigns/insights?month=may&year=2026
router.get('/insights', async (req, res) => {
  const month    = (req.query.month || '').toLowerCase();
  const year     = parseInt(req.query.year || new Date().getFullYear(), 10);
  const monthNum = MONTH_NUMS[month];
  if (!monthNum) return res.status(400).json({ error: `Unknown month: ${month}` });

  try {
    const cached = await getCache('campaigns/insights', monthNum, year);
    if (cached) return res.json(cached);

    if (!token()) throw new Error('META_ACCESS_TOKEN or FB_ACCESS_TOKEN is not set');

    const days  = daysInMonth(year, monthNum);
    const since = `${year}-${pad(monthNum)}-01`;
    const until = `${year}-${pad(monthNum)}-${pad(days)}`;

    const rawRows = await paginate(`${BASE}/${accountId()}/insights`, {
      access_token:  token(),
      fields:        'spend,actions,date_start,impressions,clicks',
      time_increment: 1,
      level:         'account',
      breakdowns:    'publisher_platform',
      time_range:    JSON.stringify({ since, until }),
      limit:         500,
    });

    const data    = buildInsights(rawRows, month, year);
    const payload = { month, year, data };
    await setCache('campaigns/insights', monthNum, year, payload);
    res.json(payload);
  } catch (err) {
    const errorBody = err.response?.data || err.message;
    console.error('[campaigns/insights]', errorBody);
    res.status(500).json({ error: errorBody });
  }
});

// Force-refresh: DELETE /api/campaigns/cache?month=may&year=2026
router.delete('/cache', async (req, res) => {
  const month    = (req.query.month || '').toLowerCase();
  const year     = parseInt(req.query.year || new Date().getFullYear(), 10);
  const monthNum = MONTH_NUMS[month];
  if (!monthNum) return res.status(400).json({ error: `Unknown month: ${month}` });
  try {
    await pool.query(
      'DELETE FROM campaign_cache WHERE month = $1 AND year = $2',
      [monthNum, year],
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function pad(n) { return String(n).padStart(2, '0'); }

// GET /api/campaigns/forms?month=may&year=2026
router.get('/forms', async (req, res) => {
  const month    = (req.query.month || '').toLowerCase();
  const year     = parseInt(req.query.year || new Date().getFullYear(), 10);
  // Default to current month when not provided
  const now      = new Date();
  const monthNum = MONTH_NUMS[month] || (now.getMonth() + 1);
  const yr       = isNaN(year) ? now.getFullYear() : year;

  try {
    const cached = await getCache('campaigns/forms', monthNum, yr);
    if (cached) return res.json(cached);

    if (!token()) throw new Error('META_ACCESS_TOKEN or FB_ACCESS_TOKEN is not set');

    // ── 1. Fetch all lead-gen ads ──────────────────────────────
    const ads = await paginate(`${BASE}/${accountId()}/ads`, {
      access_token: token(),
      fields: 'id,name,campaign{id,name,objective},adset{id,name},creative{id,object_story_spec}',
      limit: 200,
      filtering: JSON.stringify([{field:"campaign.objective",operator:"IN",value:["OUTCOME_LEADS","LEAD_GENERATION"]}]),
    });

    // ── 2. Build campaign map and ad→form mapping ──────────────
    const campaignMap = {};   // campId → { campaign_id, name, forms: { formId → adsetInfo } }
    const formIdsToFetch = new Set();

    for (const ad of ads) {
      const spec   = ad.creative?.object_story_spec || {};
      let formId   = null;
      for (const section of ['video_data', 'link_data']) {
        formId = spec[section]?.call_to_action?.value?.lead_gen_form_id || null;
        if (formId) break;
      }
      if (!formId) continue;

      const camp  = ad.campaign || {};
      const adset = ad.adset   || {};
      const cId   = camp.id;
      if (!cId) continue;

      if (!campaignMap[cId]) {
        campaignMap[cId] = { campaign_id: cId, campaign_name: camp.name || '', objective: camp.objective || '', forms: {} };
      }
      campaignMap[cId].forms[formId] = { form_id: formId, adset_id: adset.id || '', adset_name: adset.name || '' };
      formIdsToFetch.add(formId);
    }

    // ── 3. Fetch form details (name, status) ───────────────────
    const allFormIds = [...formIdsToFetch];
    const formDetails = {};
    for (let i = 0; i < allFormIds.length; i += 50) {
      const chunk = allFormIds.slice(i, i + 50);
      const { data } = await axios.get(BASE, {
        params: { access_token: token(), ids: chunk.join(','), fields: 'id,name,status,created_time' },
      });
      Object.assign(formDetails, data);
    }

    // ── 4. Query DB for per-campaign per-form lead counts in the requested month ──
    const days  = daysInMonth(yr, monthNum);
    const since = `${yr}-${pad(monthNum)}-01`;
    const until = `${yr}-${pad(monthNum)}-${pad(days)}`;

    const { rows: dbCounts } = await pool.query(
      `SELECT campaign_id, form_id, COUNT(*)::int AS count
       FROM facebook_leads
       WHERE created_time >= $1::date AND created_time <= $2::date
       GROUP BY campaign_id, form_id`,
      [since, until],
    );
    // key: "campaign_id|form_id"
    const dbFormLeads = {};
    for (const row of dbCounts) {
      dbFormLeads[`${row.campaign_id}|${row.form_id}`] = row.count;
    }

    // ── 5. Build result ────────────────────────────────────────
    const result = [];
    for (const camp of Object.values(campaignMap)) {
      const formsList = [];
      for (const [fid, adsetInfo] of Object.entries(camp.forms)) {
        const fd = formDetails[fid] || {};
        if (fd.status !== 'ACTIVE') continue;

        const leadsCount = dbFormLeads[`${camp.campaign_id}|${fid}`] || 0;

        formsList.push({
          form_id:      fid,
          form_name:    fd.name || fid,
          status:       fd.status || '',
          leads_count:  leadsCount,   // per-campaign, per-month count from insights
          created_time: fd.created_time || '',
          adset_id:     adsetInfo.adset_id,
          adset_name:   adsetInfo.adset_name,
        });
      }
      if (formsList.length === 0) continue;
      formsList.sort((a, b) => b.leads_count - a.leads_count);
      result.push({
        campaign_id:   camp.campaign_id,
        campaign_name: camp.campaign_name,
        objective:     camp.objective,
        forms:         formsList,
      });
    }
    result.sort((a, b) => {
      const aLeads = a.forms.reduce((s, f) => s + f.leads_count, 0);
      const bLeads = b.forms.reduce((s, f) => s + f.leads_count, 0);
      return bLeads - aLeads;
    });

    const payload = { count: result.length, campaigns: result };
    await setCache('campaigns/forms', monthNum, yr, payload);
    return res.json(payload);
  } catch (err) {
    console.error('[campaigns/forms]', err.response?.data || err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/campaigns/leads?form_id=123&campaign_id=456
router.get('/leads', async (req, res) => {
  const { form_id, campaign_id } = req.query;
  if (!form_id) return res.status(400).json({ error: 'form_id is required' });

  try {
    const { rows } = await pool.query(`
      SELECT
        id, full_name, phone, email,
        ad_name, adset_name, campaign_name,
        created_time, field_data, platform, is_organic
      FROM facebook_leads
      WHERE form_id = $1
        AND ($2::text IS NULL OR campaign_id = $2)
      ORDER BY created_time DESC
      LIMIT 1000
    `, [form_id, campaign_id || null]);

    const leads = rows.map(r => {
      // Use platform from DB, normalize instagram to ig
      const platform = (r.platform || 'facebook').toLowerCase();
      const utm_source = platform === 'instagram' ? 'ig' : platform;
      
      // Medium logic: organic vs paid
      const utm_medium = r.is_organic ? 'organic' : 'paid';
      
      return {
        id: r.id,
        name: r.full_name || 'No Name',
        phone: r.phone || '',
        email: r.email || '',
        created_at: r.created_time,
        // Synthesized UTMs matching user logic
        utm_source,
        utm_medium,
        utm_campaign: r.campaign_name || '',
        utm_content: r.adset_name || '',
        utm_term: r.ad_name || '',
        field_data: r.field_data || {}
      };
    });

    res.json({ count: leads.length, leads });
  } catch (err) {
    console.error('[campaigns/leads]', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

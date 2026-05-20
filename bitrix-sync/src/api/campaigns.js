'use strict';

const { Router } = require('express');
const axios = require('axios');
const pool = require('../db/pool');
const { extractFields } = require('../services/facebook');

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
  const now      = new Date();
  const monthNum = MONTH_NUMS[month] || (now.getMonth() + 1);
  const yr       = isNaN(year) ? now.getFullYear() : year;

  try {
    const cached = await getCache('campaigns/forms', monthNum, yr);
    if (cached) return res.json(cached);

    const days  = daysInMonth(yr, monthNum);
    const since = `${yr}-${pad(monthNum)}-01`;
    const until = `${yr}-${pad(monthNum)}-${pad(days)}`;

    // ── 1. Build campaign→form structure from DB (always works) ──
    const { rows: dbRows } = await pool.query(
      `SELECT campaign_id, campaign_name,
              form_id,
              adset_id, adset_name,
              COUNT(*) FILTER (WHERE created_time >= $1::date AND created_time <= $2::date)::int AS month_leads,
              COUNT(*)::int AS total_leads
       FROM facebook_leads
       WHERE campaign_id IS NOT NULL AND form_id IS NOT NULL
       GROUP BY campaign_id, campaign_name, form_id, adset_id, adset_name`,
      [since, until],
    );

    const campaignMap = {};
    for (const r of dbRows) {
      if (!campaignMap[r.campaign_id]) {
        campaignMap[r.campaign_id] = {
          campaign_id: r.campaign_id,
          campaign_name: r.campaign_name || r.campaign_id,
          objective: 'OUTCOME_LEADS',
          forms: {},
        };
      }
      // Keep latest adset info (last writer wins; all rows for same campaign/form are same adset)
      campaignMap[r.campaign_id].forms[r.form_id] = {
        form_id:     r.form_id,
        adset_id:    r.adset_id || '',
        adset_name:  r.adset_name || '',
        month_leads: r.month_leads,
      };
    }

    // ── 2. Enrich with Meta API form names/status (optional, skip if rate-limited) ──
    const formDetails = {};
    const allFormIds = [...new Set(dbRows.map(r => r.form_id))];
    try {
      for (let i = 0; i < allFormIds.length; i += 50) {
        const chunk = allFormIds.slice(i, i + 50);
        const { data } = await axios.get(BASE, {
          params: { access_token: token(), ids: chunk.join(','), fields: 'id,name,status,created_time' },
          timeout: 10000,
        });
        Object.assign(formDetails, data);
      }
    } catch (metaErr) {
      const code = metaErr.response?.data?.error?.code;
      console.warn(`[campaigns/forms] Meta API unavailable (code ${code}), using DB data only`);
    }

    // ── 3. Build result ────────────────────────────────────────
    const result = [];
    for (const camp of Object.values(campaignMap)) {
      const formsList = [];
      for (const [fid, info] of Object.entries(camp.forms)) {
        const fd = formDetails[fid] || {};
        formsList.push({
          form_id:      fid,
          form_name:    fd.name || fid,
          status:       fd.status || 'ACTIVE',
          leads_count:  info.month_leads,
          created_time: fd.created_time || '',
          adset_id:     info.adset_id,
          adset_name:   info.adset_name,
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
    // Only cache for 1 hour if Meta enrichment succeeded; cache 5 min otherwise
    const hasMeta = Object.keys(formDetails).length > 0;
    if (hasMeta) await setCache('campaigns/forms', monthNum, yr, payload);
    return res.json(payload);
  } catch (err) {
    console.error('[campaigns/forms]', err.response?.data || err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Lead sync from Meta Leadgen API ───────────────────────────

let syncRunning = false;

async function upsertLead(lead, formId, pageId) {
  const fields = extractFields(lead.field_data || []);
  await pool.query(
    `INSERT INTO facebook_leads (
       id, form_id, ad_id, ad_name, adset_id, adset_name,
       campaign_id, campaign_name, page_id,
       full_name, phone, email, field_data, created_time, platform, is_organic
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
     ON CONFLICT (id) DO UPDATE SET
       ad_id = EXCLUDED.ad_id, ad_name = EXCLUDED.ad_name,
       adset_id = EXCLUDED.adset_id, adset_name = EXCLUDED.adset_name,
       campaign_id = EXCLUDED.campaign_id, campaign_name = EXCLUDED.campaign_name,
       full_name = EXCLUDED.full_name, phone = EXCLUDED.phone,
       email = EXCLUDED.email, field_data = EXCLUDED.field_data,
       platform = EXCLUDED.platform, is_organic = EXCLUDED.is_organic`,
    [
      lead.id, formId,
      lead.ad_id || null, lead.ad_name || null,
      lead.adset_id || null, lead.adset_name || null,
      lead.campaign_id || null, lead.campaign_name || null,
      pageId || null,
      fields.full_name || fields.name || fields['ismingiz:'] || fields['ismingiz?'] || fields['ismingiz'] || null,
      fields.phone_number || fields.phone || fields['telefon_raqamingiz:'] || fields['telefon_raqamingiz'] || null,
      fields.email || null,
      JSON.stringify(fields),
      lead.created_time ? new Date(lead.created_time) : new Date(),
      lead.platform || 'facebook',
      !!lead.is_organic,
    ],
  );
}

async function syncAllLeads() {
  if (syncRunning) return { skipped: true, reason: 'Already running' };
  syncRunning = true;
  const pageId = process.env.FB_PAGE_ID;

  console.log('[sync-leads] Starting full sync...');
  let totalUpserted = 0;
  const formIds = new Set();

  try {
    // 1. Collect form IDs from DB (already-known forms)
    const { rows: dbForms } = await pool.query('SELECT DISTINCT form_id FROM facebook_leads WHERE form_id IS NOT NULL');
    for (const r of dbForms) formIds.add(r.form_id);

    // 2. Collect form IDs from Meta Ads API (active lead-gen ads)
    try {
      const ads = await paginate(`${BASE}/${accountId()}/ads`, {
        access_token: token(),
        fields: 'creative{object_story_spec}',
        limit: 200,
        filtering: JSON.stringify([{ field: 'campaign.objective', operator: 'IN', value: ['OUTCOME_LEADS', 'LEAD_GENERATION'] }]),
      });
      for (const ad of ads) {
        const spec = ad.creative?.object_story_spec || {};
        for (const section of ['video_data', 'link_data']) {
          const fid = spec[section]?.call_to_action?.value?.lead_gen_form_id;
          if (fid) formIds.add(fid);
        }
      }
    } catch (err) {
      console.warn('[sync-leads] Could not fetch ads for form IDs:', err.message);
    }

    console.log(`[sync-leads] Syncing ${formIds.size} forms...`);

    // 3. For each form, fetch all leads from Meta and upsert
    for (const formId of formIds) {
      try {
        const leads = await paginate(`${BASE}/${formId}/leads`, {
          access_token: token(),
          fields: 'id,created_time,ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,field_data,platform,is_organic',
          limit: 100,
        });
        for (const lead of leads) {
          await upsertLead(lead, formId, pageId);
          totalUpserted++;
        }
        console.log(`[sync-leads] Form ${formId}: ${leads.length} leads upserted`);
      } catch (err) {
        console.error(`[sync-leads] Form ${formId} error:`, err.message);
      }
    }
  } finally {
    syncRunning = false;
  }

  console.log(`[sync-leads] Done. Forms: ${formIds.size}, leads upserted: ${totalUpserted}`);
  return { formsSynced: formIds.size, totalUpserted };
}

// POST /api/campaigns/sync-leads  — trigger a full Meta → DB lead sync
router.post('/sync-leads', async (_req, res) => {
  if (syncRunning) return res.json({ ok: false, message: 'Sync already running' });
  res.json({ ok: true, message: 'Sync started' });
  syncAllLeads().catch(err => console.error('[sync-leads] Fatal:', err.message));
});

// GET /api/campaigns/sync-leads  — check sync status
router.get('/sync-leads', (_req, res) => {
  res.json({ running: syncRunning });
});

// GET /api/campaigns/leads?form_id=123&campaign_id=456&from=2026-05-01&to=2026-05-31
router.get('/leads', async (req, res) => {
  const { form_id, campaign_id, from, to } = req.query;
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
        AND ($3::date IS NULL OR created_time >= $3::date)
        AND ($4::date IS NULL OR created_time <= $4::date)
      ORDER BY created_time DESC
      LIMIT 1000
    `, [form_id, campaign_id || null, from || null, to || null]);

    const leads = rows.map(r => {
      // Use platform from DB, normalize instagram to ig
      const platform = (r.platform || 'facebook').toLowerCase();
      const utm_source = platform === 'instagram' ? 'ig' : platform;
      
      // Medium logic: organic vs paid
      const utm_medium = r.is_organic ? 'organic' : 'paid';
      
      const fd = r.field_data || {};
      const resolvedName = r.full_name
        || fd['ismingiz:'] || fd['ismingiz?'] || fd['ismingiz']
        || fd.full_name || fd.name || null;
      const resolvedPhone = r.phone
        || fd['telefon_raqamingiz:'] || fd['telefon_raqamingiz']
        || fd.phone_number || fd.phone || null;

      return {
        id: r.id,
        name: resolvedName || 'No Name',
        phone: resolvedPhone || '',
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

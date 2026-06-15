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

// Returns all configured ad account IDs (primary + optional secondary)
function allAccountIds() {
  const accounts = [accountId()];
  const id2 = process.env.META_AD_ACCOUNT_ID_2 || '';
  if (id2) accounts.push(id2.startsWith('act_') ? id2 : `act_${id2}`);
  return accounts;
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

// Create tables on startup
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

pool.query(`
  CREATE TABLE IF NOT EXISTS meta_creative_cache (
    ad_id            TEXT        PRIMARY KEY,
    creative_id      TEXT,
    creative_name    TEXT,
    video_id         TEXT,
    video_title      TEXT,
    post_url         TEXT,
    ads_manager_url  TEXT,
    synced_at        TIMESTAMPTZ DEFAULT NOW()
  );
`).catch(err => console.error('[campaigns] meta_creative_cache init:', err.message));

pool.query(`
  CREATE TABLE IF NOT EXISTS meta_ad_daily (
    date          DATE        NOT NULL,
    adset_id      TEXT        NOT NULL,
    adset_name    TEXT,
    campaign_id   TEXT,
    campaign_name TEXT,
    platform      TEXT        NOT NULL,
    objective     TEXT,
    spend         NUMERIC     DEFAULT 0,
    impressions   INTEGER     DEFAULT 0,
    clicks        INTEGER     DEFAULT 0,
    leads         INTEGER     DEFAULT 0,
    link_clicks   INTEGER     DEFAULT 0,
    updated_at    TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (date, adset_id, platform)
  );
  CREATE INDEX IF NOT EXISTS idx_mad_date     ON meta_ad_daily(date);
  CREATE INDEX IF NOT EXISTS idx_mad_campaign ON meta_ad_daily(campaign_name);
`).catch(err => console.error('[campaigns] meta_ad_daily init:', err.message));

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

  const LEADS_OBJECTIVES = new Set(['OUTCOME_LEADS', 'LEAD_GENERATION']);
  const out = [];
  for (const b of bucket.values()) {
    if (!LEADS_OBJECTIVES.has(b.objective)) continue;
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

// GET /api/campaigns/rows?month=may&year=2026[&from=2026-06-01&to=2026-06-11]
router.get('/rows', async (req, res) => {
  const month    = (req.query.month || '').toLowerCase();
  const year     = parseInt(req.query.year || new Date().getFullYear(), 10);
  const fromDate = req.query.from;
  const toDate   = req.query.to;
  const force    = req.query.force === 'true' || req.query.force === '1';
  const monthNum = MONTH_NUMS[month];
  if (!monthNum) return res.status(400).json({ error: `Unknown month: ${month}` });

  // ── If from/to provided, query meta_ad_daily directly ──────────
  if (fromDate && toDate) {
    try {
      const { rows: dRows } = await pool.query(`
        SELECT
          campaign_name, adset_name, platform, objective,
          SUM(spend)::numeric       AS spend,
          SUM(impressions)::int     AS impressions,
          SUM(clicks)::int          AS clicks,
          SUM(leads)::int           AS leads,
          SUM(link_clicks)::int     AS link_clicks
        FROM meta_ad_daily
        WHERE date >= $1::date AND date <= $2::date
          AND objective IN ('OUTCOME_LEADS','LEAD_GENERATION')
        GROUP BY campaign_name, adset_name, platform, objective
        ORDER BY SUM(spend) DESC
      `, [fromDate, toDate]);

      const result = dRows.map(r => {
        const spend  = parseFloat(r.spend) || 0;
        const impr   = r.impressions || 0;
        const clicks = r.clicks || 0;
        const leads  = r.leads  || 0;
        const link   = r.link_clicks || 0;
        return {
          campaign_name: r.campaign_name, adset_name: r.adset_name,
          ad_name: '', objective: r.objective, platform: r.platform,
          spend: round2(spend), impressions: impr,
          reach: 0, frequency: 0, clicks, unique_clicks: 0, link_clicks: link,
          leads, landing_page_views: 0,
          cpm:      impr   ? round2(spend / impr * 1000) : 0,
          cpc:      clicks ? round2(spend / clicks)      : 0,
          cpl:      leads  ? round2(spend / leads)       : 0,
          ctr:      impr   ? round2(clicks / impr * 100) : 0,
          hook_rate: 0, visit_rate: 0,
          lid_rate: link ? round2(leads / link * 100) : 0,
        };
      });
      return res.json({ month, year, rows: result, from: fromDate, to: toDate });
    } catch (err) {
      console.error('[campaigns/rows] daily query:', err.message);
      // fall through to monthly cache
    }
  }

  try {
    if (!force) {
      const cached = await getCache('campaigns/rows', monthNum, year);
      if (cached) return res.json(cached);
    }

    if (!token()) throw new Error('META_ACCESS_TOKEN or FB_ACCESS_TOKEN is not set');

    const days  = daysInMonth(year, monthNum);
    const since = `${year}-${pad(monthNum)}-01`;
    const until = `${year}-${pad(monthNum)}-${pad(days)}`;

    const sinceTs = Math.floor(new Date(since).getTime() / 1000);
    const insightFields = [
      'campaign_id', 'campaign_name', 'adset_id', 'adset_name', 'ad_id', 'ad_name',
      'objective', 'spend', 'impressions', 'reach', 'frequency',
      'clicks', 'unique_clicks', 'inline_link_clicks',
      'cpm', 'cpc', 'ctr', 'actions', 'video_play_actions',
    ].join(',');

    // Fetch from all configured ad accounts independently — one failure doesn't block others
    const allRaw = [];
    for (const acct of allAccountIds()) {
      try {
        const campRes = await paginate(`${BASE}/${acct}/campaigns`, {
          access_token: token(), fields: 'id,name,objective,created_time', limit: 200,
        });
        const campIds = new Set(
          campRes
            .filter(c => Math.floor(new Date(c.created_time).getTime() / 1000) >= sinceTs)
            .map(c => c.id)
        );
        console.log(`[campaigns/rows] acct=${acct} total=${campRes.length} thisMonth=${campIds.size}`);

        const acctRows = await paginate(`${BASE}/${acct}/insights`, {
          access_token:  token(),
          fields:        insightFields,
          level:         'ad',
          breakdowns:    'publisher_platform',
          time_range:    JSON.stringify({ since, until }),
          filtering:     JSON.stringify([{ field: 'campaign.objective', operator: 'IN', value: ['OUTCOME_LEADS', 'LEAD_GENERATION'] }]),
          limit:         500,
        });

        const filtered = campIds.size > 0 ? acctRows.filter(r => campIds.has(r.campaign_id)) : acctRows;
        allRaw.push(...filtered);
      } catch (acctErr) {
        console.warn(`[campaigns/rows] acct=${acct} failed (skipping):`, acctErr.message);
      }
    }

    const payload = { month, year, rows: buildRows(allRaw) };
    if (payload.rows.length > 0) await setCache('campaigns/rows', monthNum, year, payload);
    res.json(payload);
  } catch (err) {
    const errorBody = err.response?.data || err.message;
    console.error('[campaigns/rows]', errorBody);
    res.status(500).json({ error: errorBody });
  }
});

// GET /api/campaigns/insights?month=may&year=2026[&from=2026-06-01&to=2026-06-11]
router.get('/insights', async (req, res) => {
  const month    = (req.query.month || '').toLowerCase();
  const year     = parseInt(req.query.year || new Date().getFullYear(), 10);
  const fromDate = req.query.from;
  const toDate   = req.query.to;
  const force    = req.query.force === 'true' || req.query.force === '1';
  const monthNum = MONTH_NUMS[month];
  if (!monthNum) return res.status(400).json({ error: `Unknown month: ${month}` });

  // ── If from/to provided, query meta_ad_daily ──────────────────
  if (fromDate && toDate) {
    try {
      const { rows: dRows } = await pool.query(`
        SELECT
          date::text,
          platform,
          SUM(spend)::numeric   AS spend,
          SUM(leads)::int       AS leads,
          SUM(clicks)::int      AS clicks,
          SUM(impressions)::int AS impressions
        FROM meta_ad_daily
        WHERE date >= $1::date AND date <= $2::date
        GROUP BY date, platform
        ORDER BY date
      `, [fromDate, toDate]);

      const dateSet = new Set(dRows.map(r => r.date));
      const dates   = [...dateSet].sort();
      const target    = { budget: [], leads: [], clicks: [], impressions: [] };
      const instagram = { budget: [], leads: [], clicks: [], impressions: [] };

      for (const d of dates) {
        const fb = dRows.find(r => r.date === d && r.platform === 'facebook') || {};
        const ig = dRows.find(r => r.date === d && r.platform === 'instagram') || {};
        target.budget.push(parseFloat(fb.spend || 0));
        target.leads.push(fb.leads || 0);
        target.clicks.push(fb.clicks || 0);
        target.impressions.push(fb.impressions || 0);
        instagram.budget.push(parseFloat(ig.spend || 0));
        instagram.leads.push(ig.leads || 0);
        instagram.clicks.push(ig.clicks || 0);
        instagram.impressions.push(ig.impressions || 0);
      }

      return res.json({ month, year, data: { target, instagram }, from: fromDate, to: toDate, dates });
    } catch (err) {
      console.error('[campaigns/insights] daily query:', err.message);
    }
  }

  try {
    if (!force) {
      const cached = await getCache('campaigns/insights', monthNum, year);
      if (cached) return res.json(cached);
    }

    if (!token()) throw new Error('META_ACCESS_TOKEN or FB_ACCESS_TOKEN is not set');

    const days  = daysInMonth(year, monthNum);
    const since = `${year}-${pad(monthNum)}-01`;
    const until = `${year}-${pad(monthNum)}-${pad(days)}`;

    // Fetch from all configured ad accounts independently — one failure doesn't block others
    const allRaw = [];
    for (const acct of allAccountIds()) {
      try {
        const acctRows = await paginate(`${BASE}/${acct}/insights`, {
          access_token:  token(),
          fields:        'spend,actions,date_start,impressions,clicks',
          time_increment: 1,
          level:         'campaign',
          breakdowns:    'publisher_platform',
          time_range:    JSON.stringify({ since, until }),
          limit:         500,
        });
        allRaw.push(...acctRows);
      } catch (acctErr) {
        console.warn(`[campaigns/insights] acct=${acct} failed (skipping):`, acctErr.message);
      }
    }

    const data    = buildInsights(allRaw, month, year);
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

// GET /api/campaigns/forms?month=may&year=2026[&from=2026-06-01&to=2026-06-11]
router.get('/forms', async (req, res) => {
  const month    = (req.query.month || '').toLowerCase();
  const year     = parseInt(req.query.year || new Date().getFullYear(), 10);
  const now      = new Date();
  const monthNum = MONTH_NUMS[month] || (now.getMonth() + 1);
  const yr       = isNaN(year) ? now.getFullYear() : year;
  const fromDate = req.query.from;
  const toDate   = req.query.to;

  try {
    // Skip cache when date range is specified (non-standard range)
    if (!fromDate && !toDate) {
      const cached = await getCache('campaigns/forms', monthNum, yr);
      if (cached) return res.json(cached);
    }

    const days  = daysInMonth(yr, monthNum);
    const since = fromDate || `${yr}-${pad(monthNum)}-01`;
    const until = toDate   || `${yr}-${pad(monthNum)}-${pad(days)}`;

    // ── 1. Build campaign→form structure from DB (always works) ──
    const { rows: dbRows } = await pool.query(
      `SELECT campaign_id, campaign_name,
              form_id,
              adset_id, adset_name,
              COUNT(*) FILTER (WHERE created_time >= $1::date AND created_time < ($2::date + INTERVAL '1 day'))::int AS month_leads,
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

    // ── 2b. Sifatli lid count per form ──
    // Sifatli = O'ylab ko'radi / Konsultatsiya belgilandi / O'tkazilmadi / Bekor bo'ldi / Konsultatsiyadan o'tkazildi
    const SIFATLI_STAGES = [
      'UC_KXC3ZW','THINKING','3','UC_QLQ3P5',   // O'ylab ko'radi
      'UC_L28G68','CONSULTATION',                 // Konsultatsiya belgilandi
      'UC_5G8244','NOT_TRANSFERRED',              // O'tkazilmadi
      'UC_NAZK5J','RECYCLED',                     // Bekor bo'ldi
      'CONVERTED','CONVERTED_CONSULT',            // Konsultatsiyadan o'tkazildi
    ];
    const { rows: sifatliRows } = await pool.query(`
      SELECT
        fl.form_id,
        COUNT(DISTINCT CASE WHEN s.bitrix_id = ANY($3::text[])
          THEN fl.id END)::int AS sifatli_lid
      FROM facebook_leads fl
      LEFT JOIN lead_phones lp
        ON RIGHT(REGEXP_REPLACE(lp.phone, '[^0-9]', '', 'g'), 9)
         = RIGHT(REGEXP_REPLACE(fl.phone,  '[^0-9]', '', 'g'), 9)
      LEFT JOIN leads  l ON l.id = lp.lead_id
      LEFT JOIN stages s ON s.id = l.stage_id
      WHERE fl.form_id IS NOT NULL
        AND fl.created_time >= $1::date
        AND fl.created_time <  ($2::date + INTERVAL '1 day')
      GROUP BY fl.form_id
    `, [since, until, SIFATLI_STAGES]);
    const sifatliMap = {};
    for (const r of sifatliRows) sifatliMap[r.form_id] = r.sifatli_lid;

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
          sifatli_lid:  sifatliMap[fid] ?? 0,
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
    // Only cache for standard month ranges (not custom from/to)
    const hasMeta = Object.keys(formDetails).length > 0;
    if (hasMeta && !fromDate && !toDate) await setCache('campaigns/forms', monthNum, yr, payload);
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
      fields.full_name || fields.name
        || fields['ismingizni_qoldiring!'] || fields['ismingiz:'] || fields['ismingiz?'] || fields['ismingiz']
        || null,
      fields.phone_number || fields.phone
        || fields['telefon_raqamingizni_qoldiring!'] || fields['номер_телефона']
        || fields['telefon_raqamingiz:'] || fields['telefon_raqamingiz']
        || null,
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

    // 2. Collect form IDs from Meta Ads API (all configured ad accounts)
    for (const acct of allAccountIds()) {
      try {
        const ads = await paginate(`${BASE}/${acct}/ads`, {
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
        console.log(`[sync-leads] Account ${acct}: ads fetched`);
      } catch (err) {
        console.warn(`[sync-leads] Could not fetch ads from ${acct}:`, err.message);
      }
    }

    // 2.5. Collect form IDs from Page (Page Token) — catches standalone forms like "Filtr - RM"
    const pageToken = process.env.FB_PAGE_TOKEN;
    if (pageToken && pageId) {
      try {
        const pr = await fetch(
          `${BASE}/${pageId}/leadgen_forms?access_token=${encodeURIComponent(pageToken)}&fields=id,name,status&limit=100`,
        );
        const pj = await pr.json();
        for (const f of pj.data || []) {
          if (f.id) formIds.add(f.id);
        }
        console.log(`[sync-leads] Page forms added, total formIds now: ${formIds.size}`);
      } catch (err) {
        console.warn('[sync-leads] Could not fetch page forms:', err.message);
      }
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
        fl.id, fl.full_name, fl.phone, fl.email,
        fl.ad_name, fl.adset_name, fl.campaign_name,
        fl.created_time, fl.field_data, fl.platform, fl.is_organic,
        l.id AS bitrix_lead_id,
        s.name AS stage_name,
        s.bitrix_id AS stage_code
      FROM facebook_leads fl
      LEFT JOIN lead_phones lp
        ON RIGHT(REGEXP_REPLACE(lp.phone, '[^0-9]', '', 'g'), 9)
         = RIGHT(REGEXP_REPLACE(fl.phone,  '[^0-9]', '', 'g'), 9)
      LEFT JOIN leads  l ON l.id = lp.lead_id
      LEFT JOIN stages s ON s.id = l.stage_id
      WHERE fl.form_id = $1
        AND ($2::text IS NULL OR fl.campaign_id = $2)
        AND ($3::date IS NULL OR fl.created_time >= $3::date)
        AND ($4::date IS NULL OR fl.created_time < ($4::date + INTERVAL '1 day'))
      ORDER BY fl.created_time DESC, l.id DESC
      LIMIT 1000
    `, [form_id, campaign_id || null, from || null, to || null]);

    // Deduplicate by fl.id (multiple lead_phones rows may join to same facebook_lead)
    const seen = new Map();
    for (const r of rows) {
      if (!seen.has(r.id)) seen.set(r.id, r);
    }

    const leads = [...seen.values()].map(r => {
      const platform = (r.platform || 'facebook').toLowerCase();
      const utm_source = platform === 'instagram' ? 'ig' : platform;
      const utm_medium = r.is_organic ? 'organic' : 'paid';
      const fd = r.field_data || {};
      const resolvedName = r.full_name
        || fd['ismingiz:'] || fd['ismingiz?'] || fd['ismingiz']
        || fd.full_name || fd.name || null;
      const resolvedPhone = r.phone
        || fd['telefon_raqamingiz:'] || fd['telefon_raqamingiz']
        || fd.phone_number || fd.phone || null;

      return {
        id:           r.id,
        name:         resolvedName || 'No Name',
        phone:        resolvedPhone || '',
        email:        r.email || '',
        created_at:   r.created_time,
        bitrix_id:    r.bitrix_lead_id || null,
        stage_name:   r.stage_name || null,
        stage_code:   r.stage_code || null,
        utm_source,
        utm_medium,
        utm_campaign: r.campaign_name || '',
        utm_content:  r.adset_name || '',
        utm_term:     r.ad_name || '',
        field_data:   r.field_data || {},
      };
    });

    res.json({ count: leads.length, leads });
  } catch (err) {
    console.error('[campaigns/leads]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── /creatives — per-adset creative performance + Bitrix24 sifat stats ────────
router.get('/creatives', async (req, res) => {
  const now = new Date();
  const monthParam = req.query.month;
  const yearParam  = parseInt(req.query.year)  || now.getFullYear();
  const monthNum   = monthParam
    ? ['yanvar','fevral','mart','aprel','may','iyun','iyul','avgust','sentabr','oktabr','noyabr','dekabr'].indexOf(monthParam) + 1
    : now.getMonth() + 1;

  const localPad = n => String(n).padStart(2, '0');
  const days = new Date(yearParam, monthNum, 0).getDate();
  const since = req.query.from || `${yearParam}-${localPad(monthNum)}-01`;
  const until = req.query.to   || `${yearParam}-${localPad(monthNum)}-${localPad(days)}`;

  try {
    // 1. Lead quality stats — match facebook_leads → Bitrix24 leads by phone (last 9 digits)
    const { rows: qualRows } = await pool.query(`
      SELECT
        COALESCE(fl.adset_name, 'N/A')    AS adset_name,
        COALESCE(fl.campaign_name, 'N/A') AS campaign_name,
        MAX(fl.ad_id)                     AS ad_id,
        MAX(fl.ad_name)                   AS ad_name,
        COUNT(DISTINCT fl.id)::int        AS meta_leads,
        COUNT(DISTINCT CASE WHEN lp.lead_id IS NOT NULL                                       THEN fl.id END)::int AS in_bitrix,
        COUNT(DISTINCT CASE WHEN lp.lead_id IS NULL                                           THEN fl.id END)::int AS not_in_bitrix,
        COUNT(DISTINCT CASE WHEN s.bitrix_id = ANY(ARRAY[
          'UC_KXC3ZW','THINKING','3','UC_QLQ3P5',
          'UC_L28G68','CONSULTATION',
          'UC_5G8244','NOT_TRANSFERRED',
          'UC_NAZK5J','RECYCLED',
          'CONVERTED','CONVERTED_CONSULT'
        ])                                                                                     THEN fl.id END)::int AS sifatli,
        COUNT(DISTINCT CASE WHEN s.bitrix_id = 'UC_F8K4GI'                                   THEN fl.id END)::int AS sifatsiz,
        COUNT(DISTINCT CASE WHEN s.bitrix_id = 'UC_NAZK5J'                                   THEN fl.id END)::int AS bekor_boldi,
        COUNT(DISTINCT CASE WHEN s.bitrix_id = 'CONVERTED'                                   THEN fl.id END)::int AS konsultatsiya_otdi,
        COUNT(DISTINCT CASE WHEN ds.bitrix_id = ANY(ARRAY['UC_NV0Y4F','WON','C1:WON']) THEN fl.id END)::int AS sotuv_boldi,
        COUNT(DISTINCT CASE WHEN lp.lead_id IS NOT NULL AND s.id IS NULL               THEN fl.id END)::int AS stage_unknown
      FROM facebook_leads fl
      LEFT JOIN lead_phones lp
        ON RIGHT(REGEXP_REPLACE(lp.phone, '[^0-9]', '', 'g'), 9)
         = RIGHT(REGEXP_REPLACE(fl.phone,  '[^0-9]', '', 'g'), 9)
      LEFT JOIN leads  l ON l.id = lp.lead_id
      LEFT JOIN stages s ON s.id = l.stage_id
      LEFT JOIN deal_phones dp
        ON RIGHT(REGEXP_REPLACE(dp.phone, '[^0-9]', '', 'g'), 9)
         = RIGHT(REGEXP_REPLACE(fl.phone,  '[^0-9]', '', 'g'), 9)
      LEFT JOIN deals  d  ON d.id = dp.deal_id
      LEFT JOIN stages ds ON ds.id = d.stage_id
      WHERE fl.created_time >= $1::date
        AND fl.created_time <  ($2::date + INTERVAL '1 day')
      GROUP BY fl.adset_name, fl.campaign_name
      ORDER BY meta_leads DESC
    `, [since, until]);

    // 2. Spend per adset from meta_ad_daily (date range aware)
    const { rows: cacheRows } = await pool.query(`
      SELECT adset_name, SUM(spend)::numeric AS spend
      FROM meta_ad_daily
      WHERE date >= $1::date AND date <= $2::date
        AND adset_name IS NOT NULL
      GROUP BY adset_name
    `, [since, until]);

    const spendMap = {};
    for (const r of cacheRows) spendMap[r.adset_name] = parseFloat(r.spend) || 0;

    // 3. Creative name cache
    const adIds = qualRows.map(r => r.ad_id).filter(Boolean);
    const creativeMap = {};
    if (adIds.length) {
      const { rows: crRows } = await pool.query(
        `SELECT ad_id, creative_name, video_title, post_url, ads_manager_url FROM meta_creative_cache WHERE ad_id = ANY($1)`,
        [adIds]
      );
      for (const cr of crRows) creativeMap[cr.ad_id] = cr;
    }

    const result = qualRows.map(r => {
      const cr = creativeMap[r.ad_id] || {};
      const displayName = cr.video_title || cr.creative_name || r.ad_name || null;
      return {
      adset_name:    r.adset_name,
      campaign_name: r.campaign_name,
      ad_id:         r.ad_id || null,
      ad_name:       displayName,
      post_url:      cr.ads_manager_url || cr.post_url || null,
      spend:         spendMap[r.adset_name] ?? 0,
      meta_leads:    r.meta_leads,
      in_bitrix:     r.in_bitrix,
      not_in_bitrix: r.not_in_bitrix,
      sifatli:            r.sifatli,
      sifatsiz:           r.sifatsiz,
      bekor_boldi:        r.bekor_boldi,
      konsultatsiya_otdi: r.konsultatsiya_otdi,
      sotuv_boldi:        r.sotuv_boldi,
      sifat_rate:    r.in_bitrix > 0
        ? Math.round((r.sifatli / r.in_bitrix) * 100)
        : 0,
      };
    });

    res.json({ month: monthParam, year: yearParam, creatives: result });
  } catch (err) {
    console.error('[campaigns/creatives]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── /creative-deals — won deals for a specific adset (for sotuv_boldi drill-down) ─
router.get('/creative-deals', async (req, res) => {
  const { adset_name, campaign_name, month, year } = req.query;
  if (!adset_name && !campaign_name) return res.status(400).json({ error: 'adset_name or campaign_name required' });

  const now = new Date();
  const monthNum = month
    ? ['yanvar','fevral','mart','aprel','may','iyun','iyul','avgust','sentabr','oktabr','noyabr','dekabr'].indexOf(month) + 1
    : now.getMonth() + 1;
  const yearNum  = parseInt(year) || now.getFullYear();
  const pad = n => String(n).padStart(2, '0');
  const days = new Date(yearNum, monthNum, 0).getDate();
  const since = req.query.from || `${yearNum}-${pad(monthNum)}-01`;
  const until = req.query.to   || `${yearNum}-${pad(monthNum)}-${pad(days)}`;

  try {
    const { rows } = await pool.query(`
      SELECT DISTINCT ON (d.id)
        d.id,
        fl.phone,
        r.name || ' ' || COALESCE(r.last_name, '') AS responsible,
        d.opportunity,
        d.currency_id,
        d.date_create,
        s.name AS stage_name
      FROM facebook_leads fl
      JOIN deal_phones dp
        ON RIGHT(REGEXP_REPLACE(dp.phone, '[^0-9]', '', 'g'), 9)
         = RIGHT(REGEXP_REPLACE(fl.phone, '[^0-9]', '', 'g'), 9)
      JOIN deals  d  ON d.id = dp.deal_id
      JOIN stages ds ON ds.id = d.stage_id AND ds.bitrix_id = ANY(ARRAY['UC_NV0Y4F','WON','C1:WON'])
      LEFT JOIN stages s ON s.id = d.stage_id
      LEFT JOIN responsibles r ON r.id = d.responsible_id
      WHERE fl.created_time >= $1::date
        AND fl.created_time <  ($2::date + INTERVAL '1 day')
        ${adset_name    ? "AND fl.adset_name    = $3" : "AND fl.campaign_name = $3"}
      ORDER BY d.id, d.date_create DESC
    `, [since, until, adset_name || campaign_name]);

    res.json({
      deals: rows.map(r => ({
        id:          r.id,
        phone:       r.phone || '—',
        responsible: r.responsible?.trim() || '—',
        opportunity: parseFloat(r.opportunity) || 0,
        currency:    r.currency_id || 'USD',
        date:        r.date_create ? String(r.date_create).slice(0, 10) : null,
        stage:       r.stage_name || '—',
      }))
    });
  } catch (err) {
    console.error('[campaigns/creative-deals]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── /creative-leads — individual leads for a specific adset ──────────────────
router.get('/creative-leads', async (req, res) => {
  const { adset_name, month, year } = req.query;
  if (!adset_name) return res.status(400).json({ error: 'adset_name required' });

  const now = new Date();
  const yr  = parseInt(year) || now.getFullYear();
  const monthList = ['yanvar','fevral','mart','aprel','may','iyun','iyul','avgust','sentabr','oktabr','noyabr','dekabr'];
  const mo  = month ? monthList.indexOf(month) + 1 : now.getMonth() + 1;
  const localPad2 = n => String(n).padStart(2, '0');
  const days = new Date(yr, mo, 0).getDate();
  const since = req.query.from || `${yr}-${localPad2(mo)}-01`;
  const until = req.query.to   || `${yr}-${localPad2(mo)}-${localPad2(days)}`;

  try {
    const { rows } = await pool.query(`
      WITH dup_phones AS (
        SELECT RIGHT(REGEXP_REPLACE(phone, '[^0-9]', '', 'g'), 9) AS last9
        FROM facebook_leads
        WHERE phone IS NOT NULL
          AND created_time >= $2::date
          AND created_time <  ($3::date + INTERVAL '1 day')
        GROUP BY last9
        HAVING COUNT(*) > 1
      )
      SELECT
        fl.id           AS fb_id,
        fl.full_name,
        fl.phone,
        fl.created_time,
        fl.platform,
        fl.campaign_name,
        l.id            AS bitrix_id,
        s.name          AS stage_name,
        s.bitrix_id     AS stage_code,
        (dp.last9 IS NOT NULL) AS is_duplicate,
        MIN(d.id)       AS deal_id,
        (SELECT name FROM stages WHERE id = (SELECT stage_id FROM deals WHERE id = MIN(d.id))) AS deal_stage_name
      FROM facebook_leads fl
      LEFT JOIN dup_phones dp
        ON RIGHT(REGEXP_REPLACE(fl.phone, '[^0-9]', '', 'g'), 9) = dp.last9
      LEFT JOIN lead_phones lp
        ON RIGHT(REGEXP_REPLACE(lp.phone, '[^0-9]', '', 'g'), 9)
         = RIGHT(REGEXP_REPLACE(fl.phone, '[^0-9]', '', 'g'), 9)
      LEFT JOIN leads  l ON l.id = lp.lead_id
      LEFT JOIN stages s ON s.id = l.stage_id
      LEFT JOIN deal_phones dp2
        ON RIGHT(REGEXP_REPLACE(dp2.phone, '[^0-9]', '', 'g'), 9)
         = RIGHT(REGEXP_REPLACE(fl.phone, '[^0-9]', '', 'g'), 9)
      LEFT JOIN deals d ON d.id = dp2.deal_id
      WHERE fl.adset_name = $1
        AND fl.created_time >= $2::date
        AND fl.created_time <  ($3::date + INTERVAL '1 day')
      GROUP BY fl.id, fl.full_name, fl.phone, fl.created_time, fl.platform, fl.campaign_name,
               l.id, s.name, s.bitrix_id, dp.last9
      ORDER BY fl.created_time DESC
    `, [adset_name, since, until]);

    // Deduplicate: one facebook lead may match multiple phone entries
    const seen = new Set();
    const leads = [];
    for (const r of rows) {
      if (seen.has(r.fb_id)) continue;
      seen.add(r.fb_id);
      leads.push({
        fb_id:          r.fb_id,
        full_name:      r.full_name || '—',
        phone:          r.phone    || '—',
        created_time:   r.created_time,
        platform:       r.platform,
        campaign_name:  r.campaign_name,
        bitrix_id:      r.bitrix_id || null,
        stage_name:     r.stage_name || null,
        stage_code:     r.stage_code || null,
        is_duplicate:   r.is_duplicate || false,
        deal_id:        r.deal_id ? parseInt(r.deal_id) : null,
        deal_stage_name: r.deal_stage_name || null,
      });
    }

    res.json({ adset_name, leads });
  } catch (err) {
    console.error('[campaigns/creative-leads]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Bitrix24 health check — ping server.time before a sync
const BX_WEBHOOK = process.env.BITRIX_WEBHOOK_URL;
async function isBitrixReachable() {
  if (!BX_WEBHOOK) return true; // no Bitrix config, skip check
  try {
    const res = await axios.get(`${BX_WEBHOOK}/server.time`, { timeout: 8000 });
    return !!res.data?.result;
  } catch {
    return false;
  }
}

// Auto-sync leads every 5 minutes
const SYNC_INTERVAL_MS = 5 * 60 * 1000;
async function scheduledSync() {
  const reachable = await isBitrixReachable();
  if (!reachable) {
    console.warn('[sync-leads] Bitrix24 unreachable — skipping this sync cycle');
    return;
  }
  syncAllLeads()
    .then(r => { if (!r.skipped) console.log(`[sync-leads] Auto-sync done: ${r.totalUpserted} upserted`); })
    .catch(err => console.error('[sync-leads] Auto-sync error:', err.message));
}
setTimeout(scheduledSync, 30_000); // first run 30s after startup
setInterval(scheduledSync, SYNC_INTERVAL_MS);
console.log(`[sync-leads] Auto-sync scheduled every ${SYNC_INTERVAL_MS / 60000} minutes`);

// ── meta_ad_daily sync — store per-day adset data from Meta API ──────────────

let dailySyncRunning = false;

async function syncMetaAdDaily(sinceStr, untilStr) {
  if (dailySyncRunning) return;
  dailySyncRunning = true;
  try {
    for (const acct of allAccountIds()) {
      try {
        const rows = await paginate(`${BASE}/${acct}/insights`, {
          access_token:   token(),
          fields:         'campaign_id,campaign_name,adset_id,adset_name,objective,spend,impressions,clicks,inline_link_clicks,actions',
          time_increment: 1,
          level:          'adset',
          breakdowns:     'publisher_platform',
          time_range:     JSON.stringify({ since: sinceStr, until: untilStr }),
          filtering:      JSON.stringify([{ field: 'campaign.objective', operator: 'IN', value: ['OUTCOME_LEADS', 'LEAD_GENERATION'] }]),
          limit:          500,
        });

        for (const r of rows) {
          const platform = (r.publisher_platform || '').toLowerCase() === 'instagram' ? 'instagram' : 'facebook';
          await pool.query(`
            INSERT INTO meta_ad_daily
              (date, adset_id, adset_name, campaign_id, campaign_name, platform, objective,
               spend, impressions, clicks, leads, link_clicks)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
            ON CONFLICT (date, adset_id, platform) DO UPDATE SET
              adset_name    = EXCLUDED.adset_name,
              campaign_id   = EXCLUDED.campaign_id,
              campaign_name = EXCLUDED.campaign_name,
              objective     = EXCLUDED.objective,
              spend         = EXCLUDED.spend,
              impressions   = EXCLUDED.impressions,
              clicks        = EXCLUDED.clicks,
              leads         = EXCLUDED.leads,
              link_clicks   = EXCLUDED.link_clicks,
              updated_at    = NOW()
          `, [
            r.date_start,
            r.adset_id,    r.adset_name,
            r.campaign_id, r.campaign_name,
            platform, r.objective,
            parseFloat(r.spend || 0),
            parseInt(r.impressions || 0, 10),
            parseInt(r.clicks || 0, 10),
            actionVal(r.actions, LEAD_TYPES),
            parseInt(r.inline_link_clicks || 0, 10),
          ]);
        }
        console.log(`[meta_ad_daily] acct=${acct} synced ${rows.length} rows (${sinceStr} → ${untilStr})`);
      } catch (acctErr) {
        console.warn(`[meta_ad_daily] acct=${acct} failed:`, acctErr.message);
      }
    }
  } finally {
    dailySyncRunning = false;
  }
}

function todayStr() { return new Date().toISOString().slice(0, 10); }
function daysAgoStr(n) {
  const d = new Date(); d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

// Every 1 minute: sync only today's data (cheap — 1 day, adset level)
setInterval(() => {
  const today = todayStr();
  syncMetaAdDaily(today, today).catch(e => console.error('[meta_ad_daily] 1-min sync error:', e.message));
}, 60_000);

// Every 30 minutes: sync last 30 days (full refresh)
setInterval(() => {
  syncMetaAdDaily(daysAgoStr(30), todayStr()).catch(e => console.error('[meta_ad_daily] 30-min sync error:', e.message));
}, 30 * 60_000);

// On startup: sync last 30 days after 10s delay
setTimeout(() => {
  syncMetaAdDaily(daysAgoStr(30), todayStr()).catch(e => console.error('[meta_ad_daily] startup sync error:', e.message));
}, 10_000);

// ── Meta creative name cache sync ─────────────────────────────────────────────
async function syncCreativeNames() {
  try {
    const { rows: adRows } = await pool.query(`
      SELECT DISTINCT ad_id FROM facebook_leads
      WHERE ad_id IS NOT NULL AND ad_id != ''
        AND ad_id NOT IN (SELECT ad_id FROM meta_creative_cache WHERE synced_at > NOW() - INTERVAL '1 hour')
      LIMIT 30
    `);
    if (!adRows.length) return;

    const tok = token();
    for (const { ad_id } of adRows) {
      try {
        const adRes = await axios.get(`${BASE}/${ad_id}`, {
          params: { fields: 'adcreatives,account_id', access_token: tok }, timeout: 8000
        });
        const accountId = adRes.data?.account_id || null;
        const crIds = (adRes.data?.adcreatives?.data || []).map(c => c.id);
        if (!crIds.length) continue;

        const crRes = await axios.get(`${BASE}/${crIds[0]}`, {
          params: { fields: 'name,object_story_id,effective_object_story_id,video_id', access_token: tok }, timeout: 8000
        });
        const cr = crRes.data;

        const storyId = cr.object_story_id || cr.effective_object_story_id || '';
        let postUrl = null;
        if (storyId && storyId.includes('_')) {
          const parts = storyId.split('_');
          const pageId = parts[0];
          const pid    = parts.slice(1).join('_');
          postUrl = `https://www.facebook.com/permalink.php?story_fbid=${pid}&id=${pageId}`;
        }

        let videoTitle = null;
        if (cr.video_id) {
          try {
            const vidRes = await axios.get(`${BASE}/${cr.video_id}`, {
              params: { fields: 'title,permalink_url', access_token: tok }, timeout: 8000
            });
            videoTitle = vidRes.data?.title || null;
            if (!postUrl && vidRes.data?.permalink_url) {
              postUrl = 'https://www.facebook.com' + vidRes.data.permalink_url;
            }
          } catch (_) {}
        }

        const adsManagerUrl = accountId
          ? `https://adsmanager.facebook.com/adsmanager/manage/ads?act=${accountId}&selected_ad_ids=${ad_id}`
          : null;

        await pool.query(`
          INSERT INTO meta_creative_cache (ad_id, creative_id, creative_name, video_id, video_title, post_url, ads_manager_url, synced_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
          ON CONFLICT (ad_id) DO UPDATE SET
            creative_id=EXCLUDED.creative_id, creative_name=EXCLUDED.creative_name,
            video_id=EXCLUDED.video_id, video_title=EXCLUDED.video_title,
            post_url=EXCLUDED.post_url, ads_manager_url=EXCLUDED.ads_manager_url, synced_at=NOW()
        `, [ad_id, crIds[0], cr.name || null, cr.video_id || null, videoTitle, postUrl, adsManagerUrl]);
      } catch (e) {
        // mark as attempted so we don't retry immediately
        await pool.query(`
          INSERT INTO meta_creative_cache (ad_id, synced_at) VALUES ($1, NOW())
          ON CONFLICT (ad_id) DO UPDATE SET synced_at=NOW()
        `, [ad_id]).catch(() => {});
      }
    }
    console.log(`[creative-cache] synced ${adRows.length} ad creatives`);
  } catch (e) {
    console.error('[creative-cache] sync error:', e.message);
  }
}

// Sync creative names: on startup after 15s, then every 15 minutes
setTimeout(() => syncCreativeNames().catch(() => {}), 15_000);
setInterval(() => syncCreativeNames().catch(() => {}), 15 * 60_000);

console.log('[meta_ad_daily] 1-min (today) + 30-min (30 days) sync scheduled');

module.exports = router;

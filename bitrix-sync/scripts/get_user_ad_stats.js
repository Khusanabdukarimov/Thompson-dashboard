#!/usr/bin/env node
/**
 * get_user_ad_stats.js
 *
 * Usage:
 *   node scripts/get_user_ad_stats.js
 *   node scripts/get_user_ad_stats.js --since 2026-06-01 --until 2026-06-17
 *
 * Output: formatted table in terminal + user_ad_stats.json
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const axios = require('axios');
const fs    = require('fs');
const path  = require('path');

// ── Config ────────────────────────────────────────────────────────
const TOKEN       = process.env.META_ACCESS_TOKEN || process.env.FB_ACCESS_TOKEN;
const API_VERSION = process.env.FB_API_VERSION || 'v21.0';
const BASE        = `https://graph.facebook.com/${API_VERSION}`;
const BIZ_ID      = '1422632324967850';
const AD_ACCOUNTS = [
  process.env.FB_AD_ACCOUNT_ID  || 'act_1744394453029483',
  process.env.META_AD_ACCOUNT_ID || 'act_932239158316127',
];

// ── Fallback: known BM users (from Meta Business Suite People page) ──
// KEY = campaign name prefix (initials used when creating campaigns)
const CAMPAIGN_PREFIX_MAP = {
  'DU':  { name: 'Dilmurod Usarov',        email: 'dilmurod.usarov555@gmail.com' },
  'YO':  { name: 'Abdujabbor',             email: 'abdu8229@icloud.com' },
  'YU':  { name: 'Abdujabbor',             email: 'abdu8229@icloud.com' },
  'IL':  { name: 'Islomiddin Abdultojiyev',email: 'abdultojiyev@gmail.com' },
  'MR':  { name: 'Muslimbek Rakhmonov',    email: 'muslimshopify@gmail.com' },
  'BE':  { name: 'Behzod Esonov',          email: 'behzodesonov.ph@gmail.com' },
};

// Exact or substring campaign name → user  (for campaigns without clear initials prefix)
const CAMPAIGN_KEYWORD_MAP = [
  // "Lead & N" and "Lead & N2 & Y20" — Islomiddin's Nishonchi campaigns
  { keyword: 'LEAD & N',   name: 'Islomiddin Abdultojiyev', email: 'abdultojiyev@gmail.com',       key: 'IL' },
  { keyword: 'RE-TARGET',  name: 'Islomiddin Abdultojiyev', email: 'abdultojiyev@gmail.com',       key: 'IL' },
  { keyword: 'RETARGET',   name: 'Islomiddin Abdultojiyev', email: 'abdultojiyev@gmail.com',       key: 'IL' },
];

function guessUserFromCampaignName(campaignName) {
  if (!campaignName) return null;
  const upper = campaignName.toUpperCase().trim();

  // 1. Prefix match (DU -, YO' |, IL -, etc.)
  for (const [prefix, user] of Object.entries(CAMPAIGN_PREFIX_MAP)) {
    if (upper.startsWith(prefix + ' ') || upper.startsWith(prefix + '-') ||
        upper.startsWith(prefix + '_') || upper.startsWith(prefix + "'") ||
        upper.startsWith('[' + prefix + ']')) {
      return { actor_id: 'local_' + prefix, ...user };
    }
  }

  // 2. Keyword/substring match for campaigns without initials
  for (const rule of CAMPAIGN_KEYWORD_MAP) {
    if (upper.includes(rule.keyword)) {
      return { actor_id: 'local_' + rule.key, name: rule.name, email: rule.email };
    }
  }

  return null;
}

if (!TOKEN) { console.error('❌  META_ACCESS_TOKEN not set in .env'); process.exit(1); }

// ── CLI args ──────────────────────────────────────────────────────
const args  = process.argv.slice(2);
const get   = (flag) => { const i = args.indexOf(flag); return i !== -1 ? args[i + 1] : null; };
const now   = new Date();
const since = get('--since') || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2,'0')}-01`;
const until = get('--until') || now.toISOString().split('T')[0];

console.log(`\n📅  Date range: ${since} → ${until}`);
console.log(`📦  Accounts: ${AD_ACCOUNTS.join(', ')}\n`);

// ── Helpers ───────────────────────────────────────────────────────
async function paginate(url, params) {
  const rows = [];
  let nextUrl    = url;
  let nextParams = params;
  while (nextUrl) {
    const { data } = await axios.get(nextUrl, { params: nextParams, timeout: 30000 });
    if (data.error) throw new Error(`Meta API ${data.error.code}: ${data.error.message}`);
    rows.push(...(data.data || []));
    nextUrl    = data.paging?.next || null;
    nextParams = null;
  }
  return rows;
}

// Only count 'lead' — the canonical Lead Ads form submission action.
// onsite_conversion.lead_grouped and offsite_conversion.fb_pixel_lead
// are the same submission seen from a different attribution window — counting
// them together causes double/triple counting.
function leadCount(actions) {
  if (!actions) return 0;
  const a = actions.find(a => a.action_type === 'lead');
  return a ? parseInt(a.value || 0, 10) : 0;
}

function pad(s, n, right = false) {
  const str = String(s ?? '');
  return right ? str.padStart(n) : str.padEnd(n);
}

// ── Step 1: Business Manager users ───────────────────────────────
async function getBusinessUsers() {
  console.log('🔍  Step 1: Fetching Business Manager users…');

  // Try official BM endpoint (requires business_management permission)
  try {
    const users = await paginate(`${BASE}/${BIZ_ID}/business_users`, {
      access_token: TOKEN,
      fields: 'id,name,email,role,business',
      limit: 200,
    });
    console.log(`    Found ${users.length} BM user(s) via API`);
    return users;
  } catch (e) {
    const errMsg = e.response?.data?.error?.message || e.message;
    console.warn(`    ⚠️  BM users API unavailable (needs business_management permission): ${errMsg}`);
    console.warn(`    ℹ️  Using fallback: CAMPAIGN_PREFIX_MAP in script header + /me`);
  }

  // Fallback: at least get the token owner's identity
  const fallback = [];
  try {
    const { data } = await axios.get(`${BASE}/me`, {
      params: { fields: 'id,name,email', access_token: TOKEN },
      timeout: 10000,
    });
    if (data.id) {
      fallback.push({ id: data.id, name: data.name, email: data.email || '—', role: 'token_owner' });
      console.log(`    Token owner: ${data.name} (${data.email || data.id})`);
    }
  } catch (e2) {
    console.warn(`    ⚠️  /me fetch also failed: ${e2.message}`);
  }

  // Merge all unique known users from CAMPAIGN_PREFIX_MAP
  const seen = new Set(fallback.map(f => f.email));
  for (const [prefix, u] of Object.entries(CAMPAIGN_PREFIX_MAP)) {
    if (!seen.has(u.email)) {
      fallback.push({ id: 'local_' + prefix, name: u.name, email: u.email, role: 'known_user' });
      seen.add(u.email);
    }
  }
  console.log(`    Loaded ${fallback.length} user(s) from fallback map`);
  return fallback;
}

// ── Step 2: Business Activity Log ────────────────────────────────
const AD_EVENTS = new Set([
  'create_campaign','update_campaign',
  'create_adset','update_adset',
  'create_ad','update_ad',
]);

async function getActivityLog() {
  console.log('🔍  Step 2: Fetching Business Activity Log…');
  // campaign_id → { actor_id, actor_name }
  const campaignOwner = {};
  try {
    const events = await paginate(`${BASE}/${BIZ_ID}/business_activities`, {
      access_token: TOKEN,
      fields: 'event_type,event_time,actor_id,actor_name,object_id,object_name,extra_data',
      limit: 200,
    });
    for (const e of events) {
      if (!AD_EVENTS.has(e.event_type)) continue;
      if (!e.object_id) continue;
      // Only record on create events; don't overwrite creator with updater
      if (e.event_type.startsWith('create_') || !campaignOwner[e.object_id]) {
        campaignOwner[e.object_id] = { actor_id: e.actor_id, actor_name: e.actor_name };
      }
    }
    console.log(`    Mapped ${Object.keys(campaignOwner).length} object(s) to creators`);
  } catch (e) {
    console.warn(`    ⚠️  Activity log fetch failed (needs Business_Management permission): ${e.message}`);
  }
  return campaignOwner;
}

// ── Step 3: Campaign insights per account ────────────────────────
async function getCampaignInsights() {
  console.log('🔍  Step 3: Fetching campaign insights…');
  const allRows = [];
  for (const acct of AD_ACCOUNTS) {
    try {
      const rows = await paginate(`${BASE}/${acct}/insights`, {
        access_token:    TOKEN,
        fields:          'campaign_id,campaign_name,spend,impressions,clicks,actions,date_start,date_stop',
        level:           'campaign',
        time_increment:  1,
        time_range:      JSON.stringify({ since, until }),
        limit:           500,
      });
      console.log(`    ${acct}: ${rows.length} row(s)`);
      rows.forEach(r => { r._account = acct; allRows.push(r); });
    } catch (e) {
      console.warn(`    ⚠️  ${acct} insights failed: ${e.message}`);
    }
  }
  return allRows;
}

// ── Step 3b: Ad-level insights to get form attribution ───────────
async function getAdInsightsWithForms() {
  console.log('🔍  Step 3b: Fetching ad-level insights (form attribution)…');
  // form_id → { name, spend, leads, impressions, clicks }
  const byForm = {};
  for (const acct of AD_ACCOUNTS) {
    try {
      const rows = await paginate(`${BASE}/${acct}/insights`, {
        access_token:   TOKEN,
        fields:         'ad_id,ad_name,campaign_id,campaign_name,spend,impressions,clicks,actions',
        level:          'ad',
        time_range:     JSON.stringify({ since, until }),
        limit:          500,
      });

      // For each ad, look up its lead form
      const adIds = [...new Set(rows.map(r => r.ad_id))];
      const formMap = {}; // ad_id → { form_id, form_name }
      await Promise.all(adIds.map(async (adId) => {
        try {
          const { data } = await axios.get(`${BASE}/${adId}`, {
            params: {
              access_token: TOKEN,
              fields: 'id,name,creative{object_story_spec}',
            },
            timeout: 15000,
          });
          const spec = data?.creative?.object_story_spec;
          const formId   = spec?.link_data?.call_to_action?.value?.lead_gen_form_id
                        || spec?.video_data?.call_to_action?.value?.lead_gen_form_id
                        || spec?.template_data?.call_to_action?.value?.lead_gen_form_id;
          if (formId) formMap[adId] = { form_id: formId, form_name: null };
        } catch {}
      }));

      // Batch fetch form names
      const formIds = [...new Set(Object.values(formMap).map(f => f.form_id))];
      await Promise.all(formIds.map(async (fid) => {
        try {
          const { data } = await axios.get(`${BASE}/${fid}`, {
            params: { access_token: TOKEN, fields: 'id,name' },
            timeout: 10000,
          });
          for (const m of Object.values(formMap)) {
            if (m.form_id === fid) m.form_name = data.name;
          }
        } catch {}
      }));

      // Build campaign → dominant form fallback (for video ads where creative has no form_id)
      const campaignFormFallback = {}; // campaign_id → { form_id, form_name, count }
      for (const row of rows) {
        const fm = formMap[row.ad_id];
        if (fm?.form_id && row.campaign_id) {
          if (!campaignFormFallback[row.campaign_id]) {
            campaignFormFallback[row.campaign_id] = { form_id: fm.form_id, form_name: fm.form_name, count: 0 };
          }
          campaignFormFallback[row.campaign_id].count++;
        }
      }

      for (const row of rows) {
        const fm    = formMap[row.ad_id]
                   || campaignFormFallback[row.campaign_id];  // fallback: campaign's dominant form
        const key   = fm?.form_id || '__no_form__';
        const label = fm?.form_name || row.ad_name || 'No form';
        // Derive user from campaign name
        const owner = guessUserFromCampaignName(row.campaign_name);
        if (!byForm[key]) {
          byForm[key] = {
            form_id: key, form_name: label,
            spend: 0, leads: 0, impressions: 0, clicks: 0,
            users: {},        // user_name → { spend, leads }
            campaigns: {},    // campaign_name → true
          };
        }
        byForm[key].spend       += parseFloat(row.spend || 0);
        byForm[key].leads       += leadCount(row.actions);
        byForm[key].impressions += parseInt(row.impressions || 0, 10);
        byForm[key].clicks      += parseInt(row.clicks || 0, 10);
        byForm[key].campaigns[row.campaign_name] = true;
        const uname = owner?.name || 'Unknown';
        if (!byForm[key].users[uname]) byForm[key].users[uname] = { spend: 0, leads: 0, email: owner?.email || '—' };
        byForm[key].users[uname].spend += parseFloat(row.spend || 0);
        byForm[key].users[uname].leads += leadCount(row.actions);
      }
      console.log(`    ${acct}: ${rows.length} ad rows, ${Object.keys(formMap).length} form mappings`);
    } catch (e) {
      console.warn(`    ⚠️  ${acct} ad insights failed: ${e.message}`);
    }
  }
  return Object.values(byForm).sort((a, b) => b.leads - a.leads);
}

// ── Step 3c: Page lead forms (total leads, not date-filtered) ─────
async function getPageForms() {
  console.log('🔍  Step 3c: Fetching Page lead forms…');
  const PAGE_ID = process.env.FB_PAGE_ID || '200590006478145';
  try {
    const forms = await paginate(`${BASE}/${PAGE_ID}/leadgen_forms`, {
      access_token: TOKEN,
      fields: 'id,name,status,leads_count,created_time',
      limit: 100,
    });
    console.log(`    Found ${forms.length} lead form(s)`);
    return forms;
  } catch (e) {
    console.warn(`    ⚠️  Page forms fetch failed: ${e.message}`);
    return [];
  }
}

// ── Step 4: Join + aggregate ──────────────────────────────────────
function buildStats(users, campaignOwner, insights) {
  console.log('🔍  Step 4: Joining data…');

  // user map by id
  const userMap = {};
  for (const u of users) userMap[u.id] = u;

  // aggregate per user
  const byUser = {};

  function getOrCreate(actorId, actorName) {
    if (!byUser[actorId]) {
      const u = userMap[actorId] || {};
      byUser[actorId] = {
        actor_id:   actorId,
        actor_name: actorName || u.name || `User ${actorId}`,
        email:      u.email || '—',
        role:       u.role  || '—',
        spend:      0,
        leads:      0,
        impressions: 0,
        clicks:     0,
        campaigns:  {},  // campaign_id → name
        daily:      {},  // date → { spend, leads }
      };
    }
    return byUser[actorId];
  }

  const UNKNOWN = '__unknown__';
  getOrCreate(UNKNOWN, 'Unknown / Not in activity log');

  for (const row of insights) {
    const owner  = campaignOwner[row.campaign_id]
                || guessUserFromCampaignName(row.campaign_name);
    const uid    = owner?.actor_id   || UNKNOWN;
    const uname  = owner?.actor_name || owner?.name || null;
    const entry  = getOrCreate(uid, uname);
    if (owner?.email && !entry.email_set) {
      entry.email     = owner.email;
      entry.email_set = true;
    }

    const spend  = parseFloat(row.spend || 0);
    const leads  = leadCount(row.actions);
    const impr   = parseInt(row.impressions || 0, 10);
    const clicks = parseInt(row.clicks || 0, 10);
    const date   = row.date_start;

    entry.spend        += spend;
    entry.leads        += leads;
    entry.impressions  += impr;
    entry.clicks       += clicks;
    entry.campaigns[row.campaign_id] = row.campaign_name;

    if (!entry.daily[date]) entry.daily[date] = { spend: 0, leads: 0 };
    entry.daily[date].spend  += spend;
    entry.daily[date].leads  += leads;
  }

  // Remove empty unknown bucket
  if (byUser[UNKNOWN] && byUser[UNKNOWN].spend === 0 && byUser[UNKNOWN].leads === 0) {
    delete byUser[UNKNOWN];
  }

  return Object.values(byUser).sort((a, b) => b.spend - a.spend);
}

// ── Output ────────────────────────────────────────────────────────
function printTable(stats) {
  console.log('\n' + '═'.repeat(90));
  console.log('  USER AD STATS  |  ' + since + ' → ' + until);
  console.log('═'.repeat(90));

  if (stats.length === 0) {
    console.log('  No data found.');
    return;
  }

  const hdr = `  ${'Name'.padEnd(24)} ${'Email'.padEnd(28)} ${'Spend ($)'.padStart(10)} ${'Leads'.padStart(7)} ${'Campaigns'.padStart(10)}`;
  console.log(hdr);
  console.log('  ' + '─'.repeat(86));

  for (const u of stats) {
    const campCount = Object.keys(u.campaigns).length;
    console.log(
      `  ${pad(u.actor_name, 24)} ${pad(u.email, 28)} ${pad(u.spend.toFixed(2), 10, true)} ${pad(u.leads, 7, true)} ${pad(campCount, 10, true)}`
    );

    // Daily breakdown (non-zero days only)
    const days = Object.entries(u.daily)
      .filter(([, d]) => d.spend > 0 || d.leads > 0)
      .sort(([a], [b]) => a.localeCompare(b));

    if (days.length > 0) {
      for (const [date, d] of days) {
        console.log(`    ${date}  spend: $${d.spend.toFixed(2).padStart(8)}   leads: ${String(d.leads).padStart(4)}`);
      }
    }

    if (campCount > 0) {
      console.log(`    Campaigns: ${Object.values(u.campaigns).join(', ')}`);
    }
    console.log('  ' + '─'.repeat(86));
  }

  const totSpend = stats.reduce((s, u) => s + u.spend, 0);
  const totLeads = stats.reduce((s, u) => s + u.leads, 0);
  console.log(`  ${'TOTAL'.padEnd(24)} ${' '.padEnd(28)} ${totSpend.toFixed(2).padStart(10)} ${String(totLeads).padStart(7)}`);
  console.log('═'.repeat(90) + '\n');
}

function printFormsTable(pageForms, adFormStats) {
  console.log('\n' + '═'.repeat(100));
  console.log('  LEAD FORMS BY USER  |  ' + since + ' → ' + until);
  console.log('═'.repeat(100));

  // Merge page forms metadata with ad-level data
  const pageById = {};
  for (const f of pageForms) {
    pageById[f.id] = { total_leads: parseInt(f.leads_count || 0, 10), created: (f.created_time || '').split('T')[0] };
  }

  const rows = adFormStats.filter(a => a.form_id !== '__no_form__');
  if (rows.length === 0) { console.log('  No forms found.'); return; }

  // Sort by leads desc
  rows.sort((a, b) => b.leads - a.leads);

  for (const f of rows) {
    const meta = pageById[f.form_id] || {};
    // Header row: form name + totals
    console.log(`\n  📋 ${f.form_name}`);
    console.log(`     Leads: ${f.leads}   Spend: $${f.spend.toFixed(2)}   Impressions: ${f.impressions.toLocaleString()}   Clicks: ${f.clicks}`);
    if (meta.total_leads) console.log(`     All-time leads (Meta): ${meta.total_leads}`);

    // User breakdown
    const userRows = Object.entries(f.users).sort(([, a], [, b]) => b.leads - a.leads);
    if (userRows.length > 0) {
      console.log(`     ${'Targetolog'.padEnd(30)} ${'Email'.padEnd(30)} ${'Leads'.padStart(7)} ${'Spend'.padStart(10)}`);
      console.log(`     ${'─'.repeat(78)}`);
      for (const [uname, ud] of userRows) {
        console.log(`     ${pad(uname, 30)} ${pad(ud.email, 30)} ${pad(ud.leads, 7, true)} ${pad('$' + ud.spend.toFixed(2), 10, true)}`);
      }
    }

    // Campaign list
    const camps = Object.keys(f.campaigns);
    if (camps.length) console.log(`     Campaigns: ${camps.join(' | ')}`);
    console.log('  ' + '─'.repeat(96));
  }

  console.log('═'.repeat(100) + '\n');
}

function saveJson(users, campaignOwner, stats) {
  const out = {
    generated_at: new Date().toISOString(),
    since,
    until,
    accounts: AD_ACCOUNTS,
    bm_users: users,
    campaign_owners: campaignOwner,
    user_stats: stats.map(u => ({
      actor_id:    u.actor_id,
      actor_name:  u.actor_name,
      email:       u.email,
      role:        u.role,
      spend:       parseFloat(u.spend.toFixed(2)),
      leads:       u.leads,
      impressions: u.impressions,
      clicks:      u.clicks,
      campaigns:   u.campaigns,
      daily:       Object.fromEntries(
        Object.entries(u.daily).map(([d, v]) => [d, { spend: parseFloat(v.spend.toFixed(2)), leads: v.leads }])
      ),
    })),
  };
  const outPath = path.join(__dirname, '../user_ad_stats.json');
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(`💾  Saved to ${outPath}`);
}

// ── Main ──────────────────────────────────────────────────────────
(async () => {
  try {
    const [users, campaignOwner, insights, adFormStats, pageForms] = await Promise.all([
      getBusinessUsers(),
      getActivityLog(),
      getCampaignInsights(),
      getAdInsightsWithForms(),
      getPageForms(),
    ]);

    const stats = buildStats(users, campaignOwner, insights);
    printTable(stats);
    printFormsTable(pageForms, adFormStats);
    saveJson(users, campaignOwner, stats);
  } catch (e) {
    console.error('❌  Fatal:', e.message);
    process.exit(1);
  }
})();

#!/usr/bin/env node
/*
Simple scheduler: runs fetch scripts and stores results in Postgres every 2 hours.
Writes into a `reports` table (created if missing) with columns: name, data (jsonb), updated_at.

Usage: node scripts/scheduler.js
*/

const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.resolve(process.cwd(), '.env') });
const { Pool } = require('pg');

const SCRIPTS_DIR = path.resolve(process.cwd(), 'scripts');
const LEADGEN_FILE = path.resolve(process.cwd(), 'leadgen_forms.json');
const CAMPAIGN_FILE = path.resolve(process.cwd(), 'campaign_insights.json');

const DATABASE_URL = process.env.DATABASE_URL || process.env.DATABASE || '';

if (!DATABASE_URL) {
  console.warn('WARNING: DATABASE_URL is not set in environment; scheduler will still run fetch scripts but cannot write to DB.');
}

const pool = DATABASE_URL ? new Pool({ connectionString: DATABASE_URL }) : null;

function runCommand(cmd, opts = {}) {
  return new Promise((resolve, reject) => {
    exec(cmd, { ...opts, maxBuffer: 1024 * 1024 * 10 }, (err, stdout, stderr) => {
      if (err) return reject({ err, stdout, stderr });
      resolve({ stdout, stderr });
    });
  });
}

async function ensureTables() {
  if (!pool) return;
  const client = await pool.connect();
  try {
    // Leadgen forms table
    await client.query(`
      CREATE TABLE IF NOT EXISTS leadgen_forms (
        form_id TEXT PRIMARY KEY,
        form_name TEXT,
        status TEXT,
        leads_count INTEGER,
        created_time TIMESTAMPTZ,
        adset_id TEXT,
        adset_name TEXT,
        raw JSONB,
        updated_at TIMESTAMPTZ DEFAULT now()
      )
    `);

    // Campaign insights raw table (one row per fetched insight entry)
    await client.query(`
      CREATE TABLE IF NOT EXISTS campaign_insights (
        id TEXT PRIMARY KEY,
        campaign_name TEXT,
        publisher_platform TEXT,
        date_start DATE,
        spend NUMERIC,
        impressions INTEGER,
        clicks INTEGER,
        actions JSONB,
        raw JSONB,
        updated_at TIMESTAMPTZ DEFAULT now()
      )
    `);
  } finally {
    client.release();
  }
}

async function upsertLeadForms(forms) {
  if (!pool) return;
  const client = await pool.connect();
  try {
    const text = `
      INSERT INTO leadgen_forms (form_id, form_name, status, leads_count, created_time, adset_id, adset_name, raw, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now())
      ON CONFLICT (form_id) DO UPDATE SET
        form_name = EXCLUDED.form_name,
        status = EXCLUDED.status,
        leads_count = EXCLUDED.leads_count,
        created_time = EXCLUDED.created_time,
        adset_id = EXCLUDED.adset_id,
        adset_name = EXCLUDED.adset_name,
        raw = EXCLUDED.raw,
        updated_at = now()
    `;
    for (const f of forms) {
      await client.query(text, [
        f.form_id || f.id,
        f.form_name || f.name || null,
        f.status || null,
        f.leads_count != null ? Number(f.leads_count) : null,
        f.created_time ? new Date(f.created_time) : null,
        f.adset_id || null,
        f.adset_name || null,
        f,
      ]);
    }
  } finally {
    client.release();
  }
}

async function upsertCampaignInsights(rows) {
  if (!pool) return;
  const client = await pool.connect();
  try {
    const text = `
      INSERT INTO campaign_insights (id, campaign_name, publisher_platform, date_start, spend, impressions, clicks, actions, raw, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,now())
      ON CONFLICT (id) DO UPDATE SET
        campaign_name = EXCLUDED.campaign_name,
        publisher_platform = EXCLUDED.publisher_platform,
        date_start = EXCLUDED.date_start,
        spend = EXCLUDED.spend,
        impressions = EXCLUDED.impressions,
        clicks = EXCLUDED.clicks,
        actions = EXCLUDED.actions,
        raw = EXCLUDED.raw,
        updated_at = now()
    `;
    for (const r of rows) {
      // build an id for deduplication: campaign_id|ad_id|date_start|publisher_platform or fallback to row.id
      const id = r.id || [r.campaign_id, r.ad_id, r.date_start, r.publisher_platform].filter(Boolean).join('|');
      await client.query(text, [
        id,
        r.campaign_name || null,
        r.publisher_platform || null,
        r.date_start ? new Date(r.date_start) : null,
        r.spend != null ? Number(r.spend) : null,
        r.impressions != null ? Number(r.impressions) : null,
        r.clicks != null ? Number(r.clicks) : null,
        r.actions ? r.actions : null,
        r,
      ]);
    }
  } finally {
    client.release();
  }
}

async function runFetchAndStore() {
  console.log(new Date().toISOString(), 'Starting fetch cycle');

  // Run the existing fetch scripts
  try {
    console.log('Running leadgen fetch...');
    await runCommand(`node ${path.join(SCRIPTS_DIR, 'fetch_leadgen_forms.js')}`);
    console.log('Leadgen fetch done.');
  } catch (e) {
    console.error('Leadgen fetch failed:', e.stderr || e.err || e);
  }

  try {
    console.log('Running campaign insights fetch...');
    await runCommand(`node ${path.join(SCRIPTS_DIR, 'fetch_campaign_insights.js')}`);
    console.log('Campaign fetch done.');
  } catch (e) {
    console.error('Campaign fetch failed:', e.stderr || e.err || e);
  }

  // Read files and upsert into DB
  if (pool) {
    try {
      await ensureTables();

      if (fs.existsSync(LEADGEN_FILE)) {
        const leadjson = JSON.parse(fs.readFileSync(LEADGEN_FILE, 'utf8'));
        await upsertLeadForms(leadjson);
        console.log('Upserted leadgen_forms into DB.');
      } else {
        console.log('No leadgen_forms.json found; skipping DB upsert for leadgen_forms.');
      }

      if (fs.existsSync(CAMPAIGN_FILE)) {
        const campjson = JSON.parse(fs.readFileSync(CAMPAIGN_FILE, 'utf8'));
        await upsertCampaignInsights(campjson);
        console.log('Upserted campaign_insights into DB.');
      } else {
        console.log('No campaign_insights.json found; skipping DB upsert for campaign_insights.');
      }
    } catch (err) {
      console.error('Error upserting reports into DB:', err.message || err);
    }
  }

  console.log(new Date().toISOString(), 'Fetch cycle finished');
}

async function main() {
  // Run immediately
  await runFetchAndStore();

  // Then schedule every 2 hours
  const twoHours = 2 * 60 * 60 * 1000;
  setInterval(() => {
    runFetchAndStore().catch(err => console.error('Scheduled run failed:', err));
  }, twoHours);

  console.log('Scheduler started. Runs every 2 hours.');
}

main().catch(err => { console.error('Scheduler fatal error:', err); process.exit(1); });

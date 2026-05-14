'use strict';
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const pool = require('../src/db/pool');
const { fetchLead, extractFields } = require('../src/services/facebook');
const axios = require('axios');

const API_VERSION = process.env.FB_API_VERSION || 'v21.0';
const BASE = `https://graph.facebook.com/${API_VERSION}`;
const token = process.env.FB_ACCESS_TOKEN || process.env.META_ACCESS_TOKEN;

async function run() {
  const accountId = process.env.META_AD_ACCOUNT_ID || process.env.FB_AD_ACCOUNT_ID;
  const actId = accountId.startsWith('act_') ? accountId : `act_${accountId}`;
  
  console.log(`Fetching forms for ${actId}...`);
  const { data: { data: forms } } = await axios.get(`${BASE}/${actId}/leadgen_forms`, {
    params: { access_token: token, fields: 'id,name', limit: 100 }
  });
  
  console.log(`Found ${forms.length} forms. Fetching leads...`);
  
  for (const form of forms) {
    try {
      console.log(`  Fetching leads for form ${form.name} (${form.id})...`);
      const { data: { data: leads } } = await axios.get(`${BASE}/${form.id}/leads`, {
        params: { access_token: token, fields: 'id,created_time,ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,form_id,field_data', limit: 20 }
      });
      
      console.log(`    Got ${leads.length} leads.`);
      for (const raw of leads) {
        const fields = {};
        for (const f of raw.field_data || []) {
          fields[f.name] = Array.isArray(f.values) ? (f.values[0] ?? null) : null;
        }
        
        await pool.query(
          `INSERT INTO facebook_leads (
             id, form_id, ad_id, ad_name, adset_id, adset_name,
             campaign_id, campaign_name, full_name, phone, email, field_data, created_time
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
           ON CONFLICT (id) DO UPDATE SET 
             ad_name = EXCLUDED.ad_name,
             adset_name = EXCLUDED.adset_name,
             campaign_name = EXCLUDED.campaign_name`,
          [
            raw.id,
            raw.form_id,
            raw.ad_id,
            raw.ad_name,
            raw.adset_id,
            raw.adset_name,
            raw.campaign_id,
            raw.campaign_name,
            fields.full_name || fields.name || null,
            fields.phone_number || fields.phone || null,
            fields.email || null,
            JSON.stringify(fields),
            new Date(raw.created_time)
          ]
        );
      }
    } catch (err) {
      console.error(`    Error fetching leads for form ${form.id}:`, err.response?.data || err.message);
    }
  }
  
  console.log('Done!');
  process.exit();
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});

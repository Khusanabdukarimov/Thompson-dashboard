'use strict';
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const pool = require('../src/db/pool');
const axios = require('axios');

const API_VERSION = process.env.FB_API_VERSION || 'v21.0';
const BASE = `https://graph.facebook.com/${API_VERSION}`;
const token = process.env.META_ACCESS_TOKEN || process.env.FB_ACCESS_TOKEN;

async function run() {
  const accountId = process.env.META_AD_ACCOUNT_ID || process.env.FB_AD_ACCOUNT_ID;
  const actId = accountId.startsWith('act_') ? accountId : `act_${accountId}`;
  
  console.log(`Fetching all ads for ${actId} to find forms...`);
  let ads = [];
  let adsUrl = `${BASE}/${actId}/ads`;
  let adsParams = { 
    access_token: token, 
    fields: 'id,name,campaign{id,name},adset{id,name},creative{object_story_spec}',
    limit: 500 
  };

  while (adsUrl) {
    const { data: resp } = await axios.get(adsUrl, { params: adsUrl.includes('?') ? {} : adsParams });
    ads = ads.concat(resp.data);
    adsUrl = resp.paging?.next;
    adsParams = {}; // Clear params for next pages
  }
  
  const formMap = new Map();
  for (const ad of ads) {
    const formId = ad.creative?.object_story_spec?.link_data?.call_to_action?.value?.lead_gen_form_id;
    if (formId) {
      if (!formMap.has(formId)) {
        formMap.set(formId, {
          ad_id: ad.id,
          ad_name: ad.name,
          adset_id: ad.adset?.id,
          adset_name: ad.adset?.name,
          campaign_id: ad.campaign?.id,
          campaign_name: ad.campaign?.name
        });
      }
    }
  }
  
  console.log(`Found ${formMap.size} unique forms in ads. Fetching leads...`);
  
  for (const [formId, info] of formMap.entries()) {
    try {
      console.log(`  Fetching leads for form ${formId}...`);
      let leadsUrl = `${BASE}/${formId}/leads`;
      let leadsParams = { 
        access_token: token, 
        fields: 'id,created_time,ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,field_data', 
        limit: 500 
      };

      let totalLeads = 0;
      while (leadsUrl) {
        const { data: resp } = await axios.get(leadsUrl, { params: leadsUrl.includes('?') ? {} : leadsParams });
        const leads = resp.data;
        totalLeads += leads.length;

        for (const raw of leads) {
          const fields = {};
          for (const f of raw.field_data || []) {
            fields[f.name] = Array.isArray(f.values) ? (f.values[0] ?? null) : null;
          }
          
          const ad_name = raw.ad_name || info.ad_name;
          const adset_name = raw.adset_name || info.adset_name;
          const campaign_name = raw.campaign_name || info.campaign_name;

          const name = fields.full_name || fields.name || fields['ismingiz:'] || fields['Ismingiz:'] || fields['Ismingiz'] || null;
          const phone = fields.phone_number || fields.phone || fields['tel:'] || fields['Telefon raqamingiz:'] || fields['Telefon raqami'] || null;

          await pool.query(
            `INSERT INTO facebook_leads (
               id, form_id, ad_id, ad_name, adset_id, adset_name,
               campaign_id, campaign_name, full_name, phone, email, field_data, created_time
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
             ON CONFLICT (id) DO UPDATE SET 
               full_name = EXCLUDED.full_name,
               phone = EXCLUDED.phone,
               field_data = EXCLUDED.field_data`,
            [
              raw.id,
              formId,
              raw.ad_id || info.ad_id,
              ad_name,
              raw.adset_id || info.adset_id,
              adset_name,
              raw.campaign_id || info.campaign_id,
              campaign_name,
              name,
              phone,
              fields.email || null,
              JSON.stringify(fields),
              new Date(raw.created_time)
            ]
          );
        }

        leadsUrl = resp.paging?.next;
        leadsParams = {};
        if (totalLeads > 5000) break; // Safety limit
      }
      console.log(`    Finished form ${formId}: ${totalLeads} leads processed.`);
    } catch (err) {
      console.error(`    Error fetching leads for form ${formId}:`, err.message);
    }
  }
  
  console.log('Done!');
  process.exit();
}

run().catch(err => {
  console.dir(err.response?.data || err.message, { depth: null });
  process.exit(1);
});

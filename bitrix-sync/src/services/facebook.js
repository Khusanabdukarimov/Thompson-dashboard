require('dotenv').config();
const https = require('https');

const API_VERSION = process.env.FB_API_VERSION || 'v21.0';
const BASE = `https://graph.facebook.com/${API_VERSION}`;

function httpGet(url, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) {
            reject(new Error(`FB API error ${parsed.error.code}: ${parsed.error.message}`));
          } else {
            resolve(parsed);
          }
        } catch (e) {
          reject(new Error(`JSON parse error: ${e.message}`));
        }
      });
      res.on('error', reject);
    });
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`Request timed out after ${timeoutMs}ms`));
    });
    req.on('error', reject);
  });
}

/**
 * Fetch a single leadgen submission from Facebook Graph API.
 * Returns the raw lead object with field_data array.
 */
async function fetchLead(leadgenId) {
  const token = process.env.FB_ACCESS_TOKEN;
  if (!token) throw new Error('FB_ACCESS_TOKEN is not set');

  const fields = 'id,created_time,ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,form_id,field_data';
  const url = `${BASE}/${leadgenId}?fields=${fields}&access_token=${token}`;
  return httpGet(url);
}

/**
 * Extract named fields from field_data array into a plain object.
 * e.g. [{name:"full_name", values:["Ali"]}] → {full_name:"Ali"}
 */
function extractFields(fieldData = []) {
  const out = {};
  for (const f of fieldData) {
    out[f.name] = Array.isArray(f.values) ? (f.values[0] ?? null) : null;
  }
  return out;
}

module.exports = { fetchLead, extractFields };

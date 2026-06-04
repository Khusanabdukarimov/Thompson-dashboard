'use strict';
/**
 * metaConversions.js
 *
 * Meta (Facebook) Conversions API orqali sifatli lid signalini yuboradi.
 * Bu keyingi keluvchi lidlarning sifatini yaxshilaydi (Meta algoritmi uchun).
 *
 * Docs: https://developers.facebook.com/docs/marketing-api/conversions-api
 *
 * ENV:
 *   META_PIXEL_ID          — Facebook Events Manager → Data Sources → Pixel ID
 *   META_CONVERSIONS_TOKEN — Events Manager → Pixel → Settings → Conversions API Token
 *   META_ACCESS_TOKEN      — Fallback (system user token)
 *   FB_API_VERSION         — default: v21.0
 */

const https   = require('https');
const crypto  = require('crypto');

const API_VERSION = process.env.FB_API_VERSION || 'v21.0';
const BASE        = `https://graph.facebook.com/${API_VERSION}`;

function sha256(str) {
  if (!str) return null;
  return crypto.createHash('sha256')
    .update(String(str).toLowerCase().trim())
    .digest('hex');
}

/** Telefon raqamni normallashtirish (faqat raqamlar) */
function normalizePhone(phone) {
  if (!phone) return null;
  const digits = String(phone).replace(/\D/g, '');
  // 998 bilan boshlasa shu holda, aks holda +998 qo'shilishi kerak emas — rawni hash qilamiz
  return digits || null;
}

function httpPost(url, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req  = https.request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
    }, (res) => {
      let buf = '';
      res.on('data', c => (buf += c));
      res.on('end', () => {
        try { resolve(JSON.parse(buf)); }
        catch { reject(new Error('JSON parse error')); }
      });
      res.on('error', reject);
    });
    req.setTimeout(15000, () => req.destroy(new Error('Timeout')));
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

/**
 * Meta Conversions API ga "sifatli lid" eventini yuboradi.
 *
 * @param {object} opts
 * @param {string}  opts.leadgenId   — Facebook leadgen ID (facebook_leads.id)
 * @param {string}  [opts.phone]     — telefon raqami (hash qilinadi)
 * @param {string}  [opts.email]     — email (hash qilinadi)
 * @param {number}  [opts.eventTime] — unix timestamp (default: hozir)
 * @param {string}  [opts.eventName] — default: 'Lead' (sifatli signal uchun)
 * @param {object}  [opts.customData]
 * @returns {Promise<object>} Meta API javobi
 */
async function sendQualifiedLead({
  leadgenId,
  phone,
  email,
  eventTime,
  eventName = 'Lead',
  customData = {},
} = {}) {
  const pixelId = process.env.META_PIXEL_ID;
  const token   = process.env.META_CONVERSIONS_TOKEN || process.env.META_ACCESS_TOKEN;

  if (!pixelId) throw new Error('META_PIXEL_ID env not set');
  if (!token)   throw new Error('META_CONVERSIONS_TOKEN or META_ACCESS_TOKEN env not set');

  const userData = {};
  if (leadgenId) userData.lead_id = String(leadgenId);   // FB lead bilan to'g'ridan moslashtirish

  const phoneNorm = normalizePhone(phone);
  if (phoneNorm) userData.ph = [sha256(phoneNorm)];

  if (email) userData.em = [sha256(email)];

  const payload = {
    data: [{
      event_name:    eventName,
      event_time:    eventTime || Math.floor(Date.now() / 1000),
      action_source: 'crm',               // CRM dan kelayotgani
      user_data:     userData,
      custom_data:   {
        lead_event_source: 'Bitrix24 CRM',
        ...customData,
      },
    }],
    // Test mode uchun: test_event_code: 'TEST12345'
  };

  const url = `${BASE}/${pixelId}/events?access_token=${encodeURIComponent(token)}`;
  return httpPost(url, payload);
}

module.exports = { sendQualifiedLead };

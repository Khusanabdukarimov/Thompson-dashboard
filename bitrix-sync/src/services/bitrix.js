require('dotenv').config();
const https = require('https');
const http = require('http');

const WEBHOOK_URL = process.env.BITRIX_WEBHOOK_URL;
const PAGE_DELAY_MS = 600; // 600ms between pages ≈ 1.67 req/s (safe under 2 req/s limit)

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function httpGet(url, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
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

function buildUrl(method, params) {
  const base = `${WEBHOOK_URL}/${method}`;
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (Array.isArray(v)) {
      v.forEach((item, i) => qs.append(`${k}[${i}]`, item));
    } else if (typeof v === 'object' && v !== null) {
      for (const [fk, fv] of Object.entries(v)) {
        qs.append(`${k}[${fk}]`, fv);
      }
    } else {
      qs.append(k, v);
    }
  }
  return `${base}?${qs.toString()}`;
}

/**
 * Fetch all pages of a Bitrix24 list method sequentially.
 * @param {string} method  e.g. "crm.lead.list"
 * @param {object} filter  Bitrix filter object
 * @param {string[]} select  Fields to select
 * @returns {Promise<object[]>} All records across all pages
 */
async function fetchAll(method, filter = {}, select = []) {
  const params = { start: 0 };
  if (Object.keys(filter).length) params.filter = filter;
  if (select.length) params.select = select;

  const firstUrl = buildUrl(method, params);
  const firstPage = await httpGet(firstUrl);

  if (!firstPage.result) {
    console.error(`[bitrix] ${method} returned no result:`, firstPage);
    return [];
  }

  const all = [...firstPage.result];
  const total = firstPage.total || 0;

  if (total <= 50) return all;

  const offsets = [];
  for (let start = 50; start < total; start += 50) {
    offsets.push(start);
  }

  console.log(`[bitrix] ${method}: total=${total}, pages=${offsets.length + 1}`);

  for (const start of offsets) {
    await sleep(PAGE_DELAY_MS);
    const url = buildUrl(method, { ...params, start });
    let retries = 3;
    while (retries-- > 0) {
      try {
        const page = await httpGet(url);
        if (page.result) {
          all.push(...page.result);
          break;
        }
        // rate limit or error — back off
        await sleep(3000);
      } catch (err) {
        console.warn(`[bitrix] page start=${start} error: ${err.message}`);
        await sleep(3000);
      }
    }
  }

  console.log(`[bitrix] ${method}: fetched ${all.length}/${total}`);
  return all;
}

/**
 * Fetch a single Bitrix24 entity by ID.
 */
async function fetchOne(method, id) {
  const url = buildUrl(method, { id });
  const res = await httpGet(url);
  return res.result || null;
}

/**
 * Call a single Bitrix24 method with arbitrary params (GET-style).
 */
async function bitrixCall(method, params = {}) {
  const url = buildUrl(method, params);
  return httpGet(url);
}

module.exports = { fetchAll, fetchOne, bitrixCall };

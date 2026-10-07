const https = require('https');

const DOMAIN = process.env.MOIZVONKI_DOMAIN || '';
const USERNAME = process.env.MOIZVONKI_USERNAME || '';
const API_KEY = process.env.MOIZVONKI_API_KEY || '';

function configured() {
  return Boolean(DOMAIN && USERNAME && API_KEY);
}

function request(body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = https.request({
      hostname: DOMAIN,
      path: '/api/v1',
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
    }, (res) => {
      let text = '';
      res.on('data', (chunk) => { text += chunk; });
      res.on('end', () => {
        let json;
        try { json = JSON.parse(text); } catch { json = null; }
        if (res.statusCode !== 200 || !json) return reject(new Error(`moizvonki HTTP ${res.statusCode}: ${text.slice(0, 160)}`));
        if (json.error || json.status === 0 || json.authorized === false) {
          return reject(new Error(`moizvonki API: ${json.error || json.comment || 'Not authorized'}`));
        }
        resolve(json);
      });
      res.on('error', reject);
    });
    req.setTimeout(30000, () => req.destroy(new Error('moizvonki request timed out')));
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

async function listCalls(fromUnix, toUnix, fromOffset = 0) {
  if (!configured()) throw new Error('MOIZVONKI_DOMAIN / MOIZVONKI_USERNAME / MOIZVONKI_API_KEY not set');
  return request({ user_name: USERNAME, api_key: API_KEY, action: 'calls.list', from_date: fromUnix, to_date: toUnix, from_offset: fromOffset, max_results: 100, supervised: 1 });
}

module.exports = { DOMAIN, USERNAME, configured, listCalls };

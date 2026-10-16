/**
 * Self-healing for lead webhooks.
 *
 * Leads arrive only by webhook, and a webhook that fails (the Bitrix API or a DB
 * connection timing out under load) used to stay in webhook_logs with
 * processed = FALSE forever: on 2026-10-15, 27 lead webhooks failed and 3 leads
 * never reached the dashboard. Two safety nets close that gap:
 *
 *  - retryFailedLeadWebhooks (hourly): re-fetch the leads whose ADD/UPDATE webhook
 *    failed or got stuck in the last few days, upsert them, mark them done.
 *  - repullRecentLeads (nightly): list the leads Bitrix says changed in the last
 *    two days and upsert them, which also covers events Bitrix never delivered.
 *
 * Both only write our database. Distribution, phone backfill and Meta signals
 * stay in the live webhook handlers: a retry hours later must not reassign a
 * lead someone has already taken, or push anything back to Bitrix.
 *
 * Bitrix budget: the portal allows ~2 REST requests/s, and going over gets
 * requests refused (QUERY_LIMIT_EXCEEDED) for every integration on the portal.
 * The retry costs one request per run (up to 50 leads by ID in one list call);
 * the nightly re-pull pages at 1 request/s. Both stop at the first limit error.
 */
const pool = require('../db/pool');
const { bitrixCall, bitrixPost } = require('./bitrix');
const { upsertLead } = require('./upsertLead');

const LEAD_EVENTS = ['ONCRMLEAD_ADD', 'ONCRMLEAD_UPDATE'];
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/** A Bitrix error response becomes an exception; the limit error stops the whole run. */
function checkBitrix(res) {
  if (!res?.error) return res;
  const err = new Error(`${res.error} ${res.error_description || ''}`.trim());
  err.limit = res.error === 'QUERY_LIMIT_EXCEEDED' || res.error === 'OVERLOAD_LIMIT';
  throw err;
}

/** Upsert one lead from Bitrix and record a stage change, as the update webhook does. */
async function refreshLead(raw) {
  const id = parseInt(raw.ID, 10);
  const before = await pool.query('SELECT stage_id FROM leads WHERE id = $1', [id]);
  await upsertLead(raw);
  const after = await pool.query('SELECT stage_id FROM leads WHERE id = $1', [id]);
  const prev = before.rows[0]?.stage_id ?? null, next = after.rows[0]?.stage_id ?? null;
  if (next && next !== prev) {
    await pool.query('INSERT INTO lead_stage_history (lead_id, stage_id) VALUES ($1, $2)', [id, next]);
  }
}

let retrying = false;
/**
 * Re-process lead webhooks that failed, or are still unprocessed after 10 minutes
 * (the live handler retries for ~65 s, so anything older is not in flight).
 * One Bitrix request per run: up to 50 leads fetched by ID in a single list call.
 */
async function retryFailedLeadWebhooks({ days = 3, limit = 50 } = {}) {
  if (retrying) return { skipped: true };
  retrying = true;
  let ok = 0, failed = 0, gone = 0;
  try {
    const { rows } = await pool.query(
      `SELECT DISTINCT entity_id FROM webhook_logs
       WHERE event = ANY($1) AND processed = FALSE
         AND received_at > NOW() - make_interval(days => $2)
         AND (error IS NOT NULL OR received_at < NOW() - INTERVAL '10 minutes')
       ORDER BY entity_id LIMIT $3`,
      [LEAD_EVENTS, days, limit]
    );
    if (!rows.length) return { candidates: 0 };
    const ids = rows.map(r => Number(r.entity_id));
    const res = checkBitrix(await bitrixPost('crm.lead.list', { filter: { ID: ids }, select: SELECT, start: -1 }));
    const byId = new Map((res.result || []).map(r => [Number(r.ID), r]));
    for (const id of ids) {
      const raw = byId.get(id);
      try {
        if (raw) { await refreshLead(raw); ok++; } else gone++;
        await pool.query(
          `UPDATE webhook_logs SET processed = TRUE, error = $3
           WHERE event = ANY($1) AND entity_id = $2 AND processed = FALSE`,
          [LEAD_EVENTS, id, raw ? null : 'lead not found in Bitrix (deleted?)']
        );
      } catch (err) {
        failed++;
        await pool.query(
          `UPDATE webhook_logs SET error = $3
           WHERE event = ANY($1) AND entity_id = $2 AND processed = FALSE`,
          [LEAD_EVENTS, id, `retry: ${err.message}`]
        ).catch(() => {});
      }
    }
    console.log(`[leadRecovery] retried ${ids.length} failed lead webhooks in 1 Bitrix request: ${ok} ok, ${gone} gone, ${failed} still failing`);
    return { candidates: ids.length, ok, gone, failed };
  } finally {
    retrying = false;
  }
}

// Same field list as the webhooks and initialSync: Proekt, Filial etc. are UF_* fields.
const SELECT = [
  'ID', 'ASSIGNED_BY_ID', 'STATUS_ID', 'OPPORTUNITY', 'SOURCE_ID',
  'UTM_SOURCE', 'UTM_MEDIUM', 'UTM_CAMPAIGN', 'UTM_CONTENT', 'UTM_TERM',
  'DATE_CREATE', 'DATE_MODIFY', 'NAME', 'LAST_NAME', 'TITLE', 'COMMENTS', 'PHONE', 'WEB_FORM_ID',
  'UF_*',
];

let repulling = false;
/**
 * Upsert every lead Bitrix reports as changed in the window (default: the last
 * 48 hours). Pages on the ID cursor, not the offset, so nothing is skipped when
 * leads change mid-run.
 */
async function repullRecentLeads({ hours = 48, sinceIso } = {}) {
  if (repulling) return { skipped: true };
  repulling = true;
  const since = sinceIso || new Date(Date.now() - hours * 3600 * 1000).toISOString();
  let lastId = 0, fetched = 0, ok = 0, failed = 0;
  try {
    for (;;) {
      const res = checkBitrix(await bitrixCall('crm.lead.list', {
        filter: { '>=DATE_MODIFY': since, '>ID': lastId },
        order: { ID: 'ASC' },
        select: SELECT,
        start: -1,
      }));
      const batch = res?.result || [];
      if (!batch.length) break;
      for (const r of batch) {
        fetched++;
        try { await refreshLead(r); ok++; } catch (err) {
          failed++;
          if (failed <= 5) console.warn(`[leadRecovery] re-pull lead ${r.ID}: ${err.message}`);
        }
        lastId = Math.max(lastId, parseInt(r.ID, 10));
      }
      await sleep(1000); // 1 request/s, half the portal limit
    }
    console.log(`[leadRecovery] re-pulled leads changed since ${since}: ${fetched} fetched, ${ok} upserted, ${failed} failed`);
    return { since, fetched, ok, failed };
  } finally {
    repulling = false;
  }
}

/** Hourly: retry failed webhooks (1 request). Nightly at 03:00 Tashkent: 48 h re-pull. */
function startLeadRecovery() {
  const retry = () => retryFailedLeadWebhooks().catch(e => console.warn('[leadRecovery] retry failed:', e.message));
  setTimeout(retry, 5 * 60 * 1000);
  setInterval(retry, 60 * 60 * 1000);

  const DAY = 24 * 3600 * 1000;
  const nightly = () => repullRecentLeads().catch(e => console.warn('[leadRecovery] re-pull failed:', e.message));
  // 03:00 Asia/Tashkent (UTC+5, no DST) = 22:00 UTC.
  const now = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 22, 0, 0));
  if (next <= now) next.setTime(next.getTime() + DAY);
  setTimeout(() => { nightly(); setInterval(nightly, DAY); }, next - now);
  console.log(`[leadRecovery] retry hourly; nightly re-pull at ${next.toISOString()}`);
}

module.exports = { retryFailedLeadWebhooks, repullRecentLeads, startLeadRecovery };

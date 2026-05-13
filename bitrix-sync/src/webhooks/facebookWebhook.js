const pool = require('../db/pool');
const { fetchLead, extractFields } = require('../services/facebook');

/**
 * GET /webhook/facebook
 * Facebook calls this once when you register the webhook.
 * Must echo back hub.challenge if hub.verify_token matches.
 */
function verifyWebhook(req, res) {
  const mode      = req.query['hub.mode'];
  const token     = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.FB_WEBHOOK_VERIFY_TOKEN) {
    console.log('[facebook] Webhook verified successfully');
    return res.status(200).send(challenge);
  }

  console.warn('[facebook] Webhook verification failed — token mismatch');
  res.sendStatus(403);
}

/**
 * POST /webhook/facebook
 * Receives leadgen change events from Facebook.
 * Responds 200 immediately, processes async.
 */
async function receiveWebhook(req, res) {
  res.sendStatus(200);

  const body = req.body;

  // Facebook sends object:"page" for lead ad events
  if (body?.object !== 'page') return;

  for (const entry of body.entry || []) {
    for (const change of entry.changes || []) {
      if (change.field !== 'leadgen') continue;

      const value     = change.value || {};
      const leadgenId = value.leadgen_id;
      const pageId    = value.page_id;

      if (!leadgenId) continue;

      try {
        // Log raw event first
        await pool.query(
          `INSERT INTO webhook_logs (event, payload)
           VALUES ('FB_LEADGEN', $1)`,
          [JSON.stringify({ leadgen_id: leadgenId, page_id: pageId, ...value })]
        );

        // Fetch full lead data from Graph API
        const raw    = await fetchLead(leadgenId);
        const fields = extractFields(raw.field_data);

        await pool.query(
          `INSERT INTO facebook_leads (
             id, form_id, ad_id, ad_name, adset_id, adset_name,
             campaign_id, campaign_name, page_id,
             full_name, phone, email, field_data, created_time
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
           ON CONFLICT (id) DO NOTHING`,
          [
            leadgenId,
            raw.form_id     || null,
            raw.ad_id       || null,
            raw.ad_name     || null,
            raw.adset_id    || null,
            raw.adset_name  || null,
            raw.campaign_id || null,
            raw.campaign_name || null,
            pageId          || null,
            fields.full_name || fields.name || null,
            fields.phone_number || fields.phone || null,
            fields.email    || null,
            JSON.stringify(fields),
            raw.created_time ? new Date(raw.created_time) : new Date(),
          ]
        );

        await pool.query(
          `UPDATE webhook_logs SET processed = TRUE
           WHERE event = 'FB_LEADGEN'
             AND payload->>'leadgen_id' = $1
             AND processed = FALSE`,
          [String(leadgenId)]
        );

        console.log(`[facebook] Lead saved: ${leadgenId}`);
      } catch (err) {
        console.error(`[facebook] Error processing leadgen ${leadgenId}:`, err.message);
        await pool.query(
          `UPDATE webhook_logs SET error = $1
           WHERE event = 'FB_LEADGEN'
             AND payload->>'leadgen_id' = $2
             AND processed = FALSE`,
          [err.message, String(leadgenId)]
        ).catch(() => {});
      }
    }
  }
}

module.exports = { verifyWebhook, receiveWebhook };

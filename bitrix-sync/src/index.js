require('dotenv').config();
const express = require('express');
const pool = require('./db/pool');

const leadCreated = require('./webhooks/leadCreated');
const leadUpdated = require('./webhooks/leadUpdated');
const leadDeleted = require('./webhooks/leadDeleted');
const dealCreated = require('./webhooks/dealCreated');
const dealUpdated = require('./webhooks/dealUpdated');
const dealDeleted = require('./webhooks/dealDeleted');
const { verifyWebhook: fbVerify, receiveWebhook: fbReceive } = require('./webhooks/facebookWebhook');
const taskCreated  = require('./webhooks/taskCreated');
const taskUpdated  = require('./webhooks/taskUpdated');
const taskDeleted  = require('./webhooks/taskDeleted');
const dashboardRouter                    = require('./api/dashboard');
const { startCallsAutoSync }             = require('./api/dashboard');
const campaignsRouter  = require('./api/campaigns');
const { router: rejaRouter, ensureSchema: rejaEnsureSchema } = require('./api/reja');
const marketingRouter  = require('./api/marketing');
const tolovRouter      = require('./api/tolov');

const app = express();
const PORT = process.env.PORT || 3001;

// Bitrix24 webhooks come as application/x-www-form-urlencoded
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// ── Webhook routes ────────────────────────────────────────────
app.post('/webhook/lead/created', leadCreated);
app.post('/webhook/lead/updated', leadUpdated);
app.post('/webhook/lead/deleted', leadDeleted);
app.post('/webhook/deal/created', dealCreated);
app.post('/webhook/deal/updated', dealUpdated);
app.post('/webhook/deal/deleted', dealDeleted);

// ── Task webhooks ─────────────────────────────────────────────
app.post('/webhook/task/created', taskCreated);
app.post('/webhook/task/updated', taskUpdated);
app.post('/webhook/task/deleted', taskDeleted);

// ── Facebook Lead Ads webhooks ────────────────────────────────
app.get('/webhook/facebook', fbVerify);
app.post('/webhook/facebook', fbReceive);

// ── Dashboard API ─────────────────────────────────────────────
app.use('/api/dashboard', dashboardRouter);

// ── Campaigns API (Meta Ads, cached) ──────────────────────────
app.use('/api/campaigns', campaignsRouter);
app.use('/api/reja',      rejaRouter);
app.use('/api/marketing', marketingRouter);
app.use('/tolov',        tolovRouter);
app.use('/api/tolov',    tolovRouter);

// ── Health check ──────────────────────────────────────────────
app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', db: 'connected' });
  } catch (err) {
    res.status(503).json({ status: 'error', db: err.message });
  }
});

// Run all migrations before accepting connections
Promise.all([
  pool.query(`
    ALTER TABLE leads ADD COLUMN IF NOT EXISTS uf_amo_date TIMESTAMPTZ;
    CREATE INDEX IF NOT EXISTS leads_uf_amo_date_idx ON leads(uf_amo_date);
    ALTER TABLE deals ADD COLUMN IF NOT EXISTS date_modify   TIMESTAMPTZ;
    ALTER TABLE deals ADD COLUMN IF NOT EXISTS uf_sale_date  TIMESTAMPTZ;
    ALTER TABLE deals ADD COLUMN IF NOT EXISTS begindate     TIMESTAMPTZ;
    CREATE INDEX IF NOT EXISTS deals_date_modify_idx  ON deals(date_modify);
    CREATE INDEX IF NOT EXISTS deals_uf_sale_date_idx ON deals(uf_sale_date);
    CREATE INDEX IF NOT EXISTS deals_begindate_idx    ON deals(begindate);
  `).catch(err => console.error('[startup] leads/deals migration failed:', err.message)),
  pool.query(`
    UPDATE stages SET is_won = TRUE, is_final = TRUE
      WHERE entity = 'deal' AND (
        bitrix_id = 'WON' OR bitrix_id LIKE '%:WON'
        OR bitrix_id = 'UC_NV0Y4F' OR bitrix_id LIKE '%:UC_NV0Y4F'
      );
    UPDATE stages SET is_final = TRUE
      WHERE entity = 'deal' AND (bitrix_id = 'LOSE' OR bitrix_id LIKE '%:LOSE');
  `).catch(err => console.error('[startup] stages restore migration failed:', err.message)),
  rejaEnsureSchema().catch(err => console.error('[startup] reja migration failed:', err.message)),
]).then(() => {
  app.listen(PORT, () => {
    startCallsAutoSync();
    console.log(`[bitrix-sync] Server running on port ${PORT}`);
  console.log(`  POST /webhook/lead/created`);
  console.log(`  POST /webhook/lead/updated`);
  console.log(`  POST /webhook/lead/deleted`);
  console.log(`  POST /webhook/deal/created`);
  console.log(`  POST /webhook/deal/updated`);
  console.log(`  POST /webhook/deal/deleted`);
  console.log(`  GET  /api/dashboard/stats`);
  console.log(`  GET  /api/dashboard/responsibles`);
  console.log(`  GET  /api/dashboard/funnel`);
  console.log(`  GET  /api/dashboard/leads`);
  console.log(`  GET  /api/dashboard/tasks-summary`);
  console.log(`  POST /webhook/task/created`);
  console.log(`  POST /webhook/task/updated`);
  console.log(`  POST /webhook/task/deleted`);
  console.log(`  GET  /webhook/facebook  (FB verification)`);
  console.log(`  POST /webhook/facebook  (FB leadgen events)`);
  console.log(`  GET  /api/campaigns/rows`);
  console.log(`  GET  /api/campaigns/insights`);
  console.log(`  GET  /api/reja/plans`);
  console.log(`  POST /api/reja/plans`);
  console.log(`  GET  /api/reja/plans/:id/distribution`);
  console.log(`  POST /api/reja/plans/:id/distribution`);
  console.log(`  GET  /api/reja/plans/:id/progress`);
  });
});

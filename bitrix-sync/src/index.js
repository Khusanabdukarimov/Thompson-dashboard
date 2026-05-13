require('dotenv').config();
const express = require('express');
const pool = require('./db/pool');

const leadCreated = require('./webhooks/leadCreated');
const leadUpdated = require('./webhooks/leadUpdated');
const leadDeleted = require('./webhooks/leadDeleted');
const dealCreated = require('./webhooks/dealCreated');
const dealUpdated = require('./webhooks/dealUpdated');
const dealDeleted = require('./webhooks/dealDeleted');
const dashboardRouter = require('./api/dashboard');

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

// ── Dashboard API ─────────────────────────────────────────────
app.use('/api/dashboard', dashboardRouter);

// ── Health check ──────────────────────────────────────────────
app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', db: 'connected' });
  } catch (err) {
    res.status(503).json({ status: 'error', db: err.message });
  }
});

app.listen(PORT, () => {
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
});

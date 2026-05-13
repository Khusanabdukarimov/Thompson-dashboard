-- Run once on production:
--   psql $DATABASE_URL -f src/db/migrate_facebook.sql

CREATE TABLE IF NOT EXISTS facebook_leads (
  id            TEXT PRIMARY KEY,
  form_id       TEXT,
  ad_id         TEXT,
  ad_name       TEXT,
  adset_id      TEXT,
  adset_name    TEXT,
  campaign_id   TEXT,
  campaign_name TEXT,
  page_id       TEXT,
  full_name     TEXT,
  phone         TEXT,
  email         TEXT,
  field_data    JSONB,
  created_time  TIMESTAMPTZ,
  synced_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS fb_leads_campaign_idx ON facebook_leads(campaign_id);
CREATE INDEX IF NOT EXISTS fb_leads_created_idx  ON facebook_leads(created_time);
CREATE INDEX IF NOT EXISTS fb_leads_form_idx     ON facebook_leads(form_id);

-- Allow webhook_logs to work without entity_id for FB events
ALTER TABLE webhook_logs ALTER COLUMN entity_id DROP NOT NULL;

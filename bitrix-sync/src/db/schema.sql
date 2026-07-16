-- ============================================================
-- Bitrix24 mirror schema
-- ============================================================

-- Responsible users (Bitrix24 agents)
CREATE TABLE IF NOT EXISTS responsibles (
  id            INTEGER PRIMARY KEY,
  name          TEXT,
  last_name     TEXT,
  email         TEXT,
  work_position TEXT,
  active        BOOLEAN DEFAULT TRUE,
  synced_at     TIMESTAMPTZ DEFAULT NOW()
);

-- Lead/Deal pipeline stages
CREATE TABLE IF NOT EXISTS stages (
  id          SERIAL PRIMARY KEY,
  entity      TEXT NOT NULL CHECK (entity IN ('lead', 'deal')),
  bitrix_id   TEXT NOT NULL,          -- e.g. "NEW", "IN_PROCESS", "C1:NEW"
  name        TEXT NOT NULL,
  sort_order  INTEGER DEFAULT 0,
  is_final    BOOLEAN DEFAULT FALSE,  -- won/lost stages
  is_won      BOOLEAN DEFAULT FALSE,
  name_uz     TEXT,
  UNIQUE (entity, bitrix_id)
);

-- Leads
CREATE TABLE IF NOT EXISTS leads (
  id              INTEGER PRIMARY KEY,
  responsible_id  INTEGER REFERENCES responsibles(id),
  stage_id        INTEGER REFERENCES stages(id),
  opportunity     NUMERIC(15,2) DEFAULT 0,
  source_id       TEXT,
  utm_source      TEXT,
  utm_medium      TEXT,
  utm_campaign    TEXT,
  utm_content     TEXT,
  utm_term        TEXT,
  uf_segment      TEXT,
  uf_filial       TEXT,
  uf_service      TEXT,
  uf_activity     TEXT,
  uf_with_whom    TEXT,
  uf_tashrif_sanasi TEXT,
  uf_amo_date     TIMESTAMPTZ,
  name            TEXT,
  last_name       TEXT,
  title           TEXT,
  date_create     TIMESTAMPTZ,
  date_modify     TIMESTAMPTZ,
  synced_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS leads_responsible_idx ON leads(responsible_id);
CREATE INDEX IF NOT EXISTS leads_stage_idx ON leads(stage_id);
CREATE INDEX IF NOT EXISTS leads_date_create_idx ON leads(date_create);
CREATE INDEX IF NOT EXISTS leads_source_idx ON leads(source_id);
CREATE INDEX IF NOT EXISTS leads_uf_amo_date_idx ON leads(uf_amo_date);

-- Lead phone numbers
CREATE TABLE IF NOT EXISTS lead_phones (
  id       SERIAL PRIMARY KEY,
  lead_id  INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  phone    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS lead_phones_lead_idx ON lead_phones(lead_id);

-- Deals
CREATE TABLE IF NOT EXISTS deals (
  id              INTEGER PRIMARY KEY,
  responsible_id  INTEGER REFERENCES responsibles(id),
  stage_id        INTEGER REFERENCES stages(id),
  opportunity     NUMERIC(15,2) DEFAULT 0,
  currency_id     TEXT,
  source_id       TEXT,
  utm_source      TEXT,
  title           TEXT,
  date_create     TIMESTAMPTZ,
  date_modify     TIMESTAMPTZ,
  closedate       TIMESTAMPTZ,
  uf_cancel_reason TEXT,
  contact_id      INTEGER,
  synced_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS contact_phones (
  contact_id INTEGER NOT NULL,
  phone TEXT NOT NULL,
  PRIMARY KEY (contact_id, phone)
);

CREATE INDEX IF NOT EXISTS deals_responsible_idx ON deals(responsible_id);
CREATE INDEX IF NOT EXISTS deals_stage_idx ON deals(stage_id);
CREATE INDEX IF NOT EXISTS deals_date_create_idx ON deals(date_create);

-- Deal phone numbers
CREATE TABLE IF NOT EXISTS deal_phones (
  id       SERIAL PRIMARY KEY,
  deal_id  INTEGER NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  phone    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS deal_phones_deal_idx ON deal_phones(deal_id);

-- Lead stage history
CREATE TABLE IF NOT EXISTS lead_stage_history (
  id          SERIAL PRIMARY KEY,
  lead_id     INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  stage_id    INTEGER REFERENCES stages(id),
  changed_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS lsh_lead_idx ON lead_stage_history(lead_id);
CREATE INDEX IF NOT EXISTS lsh_changed_at_idx ON lead_stage_history(changed_at);

-- Deal stage history
CREATE TABLE IF NOT EXISTS deal_stage_history (
  id          SERIAL PRIMARY KEY,
  deal_id     INTEGER NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  stage_id    INTEGER REFERENCES stages(id),
  changed_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS dsh_deal_idx ON deal_stage_history(deal_id);
CREATE INDEX IF NOT EXISTS dsh_changed_at_idx ON deal_stage_history(changed_at);

-- Webhook event audit log
CREATE TABLE IF NOT EXISTS webhook_logs (
  id          SERIAL PRIMARY KEY,
  event       TEXT NOT NULL,
  entity_id   INTEGER,
  payload     JSONB,
  processed   BOOLEAN DEFAULT FALSE,
  error       TEXT,
  received_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS wl_event_idx ON webhook_logs(event);
CREATE INDEX IF NOT EXISTS wl_received_at_idx ON webhook_logs(received_at);

-- Facebook Lead Ads submissions
CREATE TABLE IF NOT EXISTS facebook_leads (
  id            TEXT PRIMARY KEY,          -- Facebook leadgen_id
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
  field_data    JSONB,                     -- all raw form fields
  created_time  TIMESTAMPTZ,
  synced_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS fb_leads_campaign_idx  ON facebook_leads(campaign_id);
CREATE INDEX IF NOT EXISTS fb_leads_created_idx   ON facebook_leads(created_time);
CREATE INDEX IF NOT EXISTS fb_leads_form_idx      ON facebook_leads(form_id);

-- Sync state tracker
CREATE TABLE IF NOT EXISTS sync_state (
  entity      TEXT PRIMARY KEY,
  last_sync   TIMESTAMPTZ DEFAULT NOW(),
  total_rows  INTEGER DEFAULT 0
);

-- Meta Ads API response cache (1-hour TTL)
CREATE TABLE IF NOT EXISTS campaign_cache (
  id         SERIAL PRIMARY KEY,
  endpoint   VARCHAR(100) NOT NULL,
  month      INT NOT NULL,
  year       INT NOT NULL,
  data       JSONB NOT NULL,
  fetched_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE(endpoint, month, year)
);

-- ============================================================
-- Seed lead stages (Bitrix24 default lead statuses)
-- ============================================================
INSERT INTO stages (entity, bitrix_id, name, sort_order, is_final, is_won) VALUES
  ('lead', 'NEW',         'Yangi lid',        10, FALSE, FALSE),
  ('lead', 'IN_PROCESS',  'Ishlash jarayoni', 20, FALSE, FALSE),
  ('lead', 'PROCESSED',   'Ishlandi',         30, FALSE, FALSE),
  ('lead', '1',           'Javob bermadi',     40, FALSE, FALSE),
  ('lead', '2',           'Qayta aloqa',       50, FALSE, FALSE),
  ('lead', '3',           'O''ylab ko''radi',  60, FALSE, FALSE),
  ('lead', 'JUNK',        'Keraksiz',          70, TRUE,  FALSE),
  ('lead', 'CONVERTED',   'Aylantrildi',       80, TRUE,  TRUE)
ON CONFLICT (entity, bitrix_id) DO NOTHING;

-- ============================================================
-- Seed deal stages (typical Bitrix24 pipeline)
-- ============================================================
INSERT INTO stages (entity, bitrix_id, name, sort_order, is_final, is_won) VALUES
  ('deal', 'C1:NEW',          'Yangi',           10, FALSE, FALSE),
  ('deal', 'C1:PREPARATION',  'Tayyorlash',      20, FALSE, FALSE),
  ('deal', 'C1:EXECUTING',    'Bajarilmoqda',    30, FALSE, FALSE),
  ('deal', 'C1:FINAL_INVOICE','Yakuniy hisob',   40, FALSE, FALSE),
  ('deal', 'C1:WON',          'Yutildi',         50, TRUE,  TRUE),
  ('deal', 'C1:LOSE',         'Yutqizildi',      60, TRUE,  FALSE)
ON CONFLICT (entity, bitrix_id) DO NOTHING;

-- ============================================================
-- Generic lead custom-field (UF_CRM*) storage
--   lead_uf_fields — registry of every UF field
--   lead_uf_enums  — options of enumeration ("list") fields
--   lead_uf_values — per-lead values (enum values stored as option ID;
--                    multi-value fields stored as a JSON array string)
-- ============================================================
CREATE TABLE IF NOT EXISTS lead_uf_fields (
  field_code  TEXT PRIMARY KEY,
  label       TEXT,
  field_type  TEXT,
  is_multiple BOOLEAN DEFAULT FALSE,
  synced_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS lead_uf_enums (
  field_code TEXT NOT NULL,
  enum_id    TEXT NOT NULL,
  value      TEXT,
  PRIMARY KEY (field_code, enum_id)
);

CREATE TABLE IF NOT EXISTS lead_uf_values (
  lead_id    INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  field_code TEXT NOT NULL,
  value      TEXT,
  PRIMARY KEY (lead_id, field_code)
);
CREATE INDEX IF NOT EXISTS lead_uf_values_field_idx ON lead_uf_values(field_code, value);

-- ============================================================
-- OnlinePBX telephony (applied at boot by sync/syncCalls.js ensureSchema)
-- ============================================================

-- PBX extensions (from user/get.json). Distinct from Bitrix `responsibles` —
-- an operator is a Bitrix user AND a PBX extension, matched by name where needed.
CREATE TABLE IF NOT EXISTS pbx_users (
  ext        TEXT PRIMARY KEY,   -- extension number, e.g. "101"
  name       TEXT,               -- "Operator 101"
  enabled    BOOLEAN DEFAULT TRUE,
  synced_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Which Bitrix user answers this extension (matched by display name at PBX
-- user sync — see sync/syncCalls.js). NULL when no Bitrix user has that name.
ALTER TABLE pbx_users ADD COLUMN IF NOT EXISTS responsible_id INTEGER;

-- One row per call, keyed on the PBX uuid so re-syncing an overlapping window is
-- idempotent. Derived columns (direction, operator_ext, customer_number,
-- answered) are computed at ingest by src/config/calls.js; the untouched record
-- is kept in `raw` for auditing.
CREATE TABLE IF NOT EXISTS pbx_calls (
  uuid              TEXT PRIMARY KEY,
  direction         TEXT,          -- inbound | outbound | local (accountcode)
  caller_number     TEXT,
  caller_name       TEXT,
  destination_number TEXT,
  operator_ext      TEXT REFERENCES pbx_users(ext),
  customer_number   TEXT,          -- the external party, whichever side it is
  customer_norm     TEXT,          -- last 9 digits, for matching lead phones
  start_stamp       TIMESTAMPTZ,
  end_stamp         TIMESTAMPTZ,
  duration          INTEGER DEFAULT 0,   -- total call seconds
  talk_time         INTEGER DEFAULT 0,   -- user_talk_time — live conversation seconds
  answered          BOOLEAN DEFAULT FALSE,
  contacted         BOOLEAN,             -- inbound only; NULL for outbound/local
  hangup_cause      TEXT,
  gateway           TEXT,
  quality_score     INTEGER,
  events            JSONB,
  raw               JSONB,
  synced_at         TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS pbx_calls_start_idx     ON pbx_calls(start_stamp);
CREATE INDEX IF NOT EXISTS pbx_calls_operator_idx  ON pbx_calls(operator_ext, start_stamp);
CREATE INDEX IF NOT EXISTS pbx_calls_direction_idx ON pbx_calls(direction, start_stamp);
CREATE INDEX IF NOT EXISTS pbx_calls_customer_idx  ON pbx_calls(customer_norm);

-- Normalised phone lookup used by /call-list to attach a lead to each call.
CREATE INDEX IF NOT EXISTS lead_phones_norm_idx
  ON lead_phones (RIGHT(regexp_replace(phone, '\D', '', 'g'), 9));

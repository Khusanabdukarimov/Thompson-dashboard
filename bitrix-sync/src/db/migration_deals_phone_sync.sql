-- 1. Add contact_id column to deals
ALTER TABLE deals ADD COLUMN IF NOT EXISTS contact_id INTEGER;

-- 2. Create contact_phones mapping helper
CREATE TABLE IF NOT EXISTS contact_phones (
  contact_id INTEGER NOT NULL,
  phone TEXT NOT NULL,
  PRIMARY KEY (contact_id, phone)
);

-- 3. Create high-performance lookup indexes
CREATE INDEX IF NOT EXISTS lead_phones_phone_idx ON lead_phones(phone);
CREATE INDEX IF NOT EXISTS deal_phones_phone_idx ON deal_phones(phone);

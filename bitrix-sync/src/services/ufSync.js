const pool = require('../db/pool');
const { bitrixCall } = require('./bitrix');

/**
 * Generic sync of ALL lead UF_CRM* custom fields.
 *
 * Tables:
 *   lead_uf_fields  — registry of every UF field (code, label, type, multiple)
 *   lead_uf_enums   — options of enumeration ("list") fields, one row per option
 *   lead_uf_values  — per-lead values for every non-empty UF field
 *
 * Enumeration values are stored as the Bitrix option ID; resolve the label by
 * joining lead_uf_enums on (field_code, enum_id). Multi-value fields are
 * stored as a JSON array string.
 */

async function ensureSchema() {
  await pool.query(`
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
  `);
}

/** Fetch crm.lead.fields and upsert the field registry + enum option lists. */
async function syncLeadUfMeta() {
  const res = await bitrixCall('crm.lead.fields', {});
  const fields = res && res.result;
  if (!fields) throw new Error(`crm.lead.fields failed: ${res && res.error_description || 'no result'}`);

  let fieldCount = 0, enumCount = 0;
  for (const [code, f] of Object.entries(fields)) {
    if (!code.startsWith('UF_CRM')) continue;
    const label = f.formLabel || f.listLabel || f.title || code;
    await pool.query(
      `INSERT INTO lead_uf_fields (field_code, label, field_type, is_multiple, synced_at)
       VALUES ($1,$2,$3,$4,NOW())
       ON CONFLICT (field_code) DO UPDATE SET
         label = EXCLUDED.label, field_type = EXCLUDED.field_type,
         is_multiple = EXCLUDED.is_multiple, synced_at = NOW()`,
      [code, label, f.type || null, !!f.isMultiple]
    );
    fieldCount++;

    for (const item of f.items || []) {
      await pool.query(
        `INSERT INTO lead_uf_enums (field_code, enum_id, value)
         VALUES ($1,$2,$3)
         ON CONFLICT (field_code, enum_id) DO UPDATE SET value = EXCLUDED.value`,
        [code, String(item.ID), item.VALUE == null ? null : String(item.VALUE)]
      );
      enumCount++;
    }
  }
  console.log(`[ufSync] Lead UF meta synced: ${fieldCount} fields, ${enumCount} enum options`);
}

function normalizeUfValue(raw) {
  if (raw == null || raw === '' || raw === false) return null;
  if (Array.isArray(raw)) {
    const arr = raw.filter(v => v != null && v !== '').map(String);
    return arr.length ? JSON.stringify(arr) : null;
  }
  if (typeof raw === 'object') return JSON.stringify(raw);
  return String(raw);
}

/** Replace all UF values of one lead with the current non-empty set. */
async function upsertLeadUfValues(r, client) {
  const db = client || pool;
  const leadId = parseInt(r.ID);
  if (!leadId) return;

  const entries = [];
  for (const [key, raw] of Object.entries(r)) {
    if (!key.startsWith('UF_CRM')) continue;
    const val = normalizeUfValue(raw);
    if (val != null) entries.push([key, val]);
  }

  await db.query(`DELETE FROM lead_uf_values WHERE lead_id = $1`, [leadId]);
  for (const [code, val] of entries) {
    await db.query(
      `INSERT INTO lead_uf_values (lead_id, field_code, value) VALUES ($1,$2,$3)
       ON CONFLICT (lead_id, field_code) DO UPDATE SET value = EXCLUDED.value`,
      [leadId, code, val]
    );
  }
}

module.exports = { ensureSchema, syncLeadUfMeta, upsertLeadUfValues };

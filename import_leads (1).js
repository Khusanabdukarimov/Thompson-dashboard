/**
 * import_leads.js
 *
 * One-shot script: imports leads_import.csv into the PostgreSQL database.
 * Run from the bitrix-sync project root:
 *
 *   node import_leads.js
 *
 * Requirements:
 *   - .env file with DATABASE_URL set
 *   - leads_import.csv in the same directory as this file
 *   - The schema (schema.sql) already applied to the database
 *   - npm packages: pg, dotenv  (already in package.json)
 */

require('dotenv').config();
const fs   = require('fs');
const path = require('path');
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const CSV  = path.join(__dirname, 'leads_import.csv');

// ─────────────────────────────────────────────
// Stage name (Uzbek, from Bitrix export) → stages.bitrix_id
// If your Bitrix has different stage IDs, adjust the right-hand values.
// ─────────────────────────────────────────────
const STAGE_MAP = {
  "Yangi lid":                'NEW',
  "Javob bermadi":            'NO_ANSWER',
  "Qayta aloqa":              'CALLBACK',
  "O'ylab ko'radi":           'THINKING',
  "Konsultatsiya belgilandi": 'CONSULTATION',
  "Konsultatsiya o'tkazildi": 'CONSULTATION',   // alias
  "O'tkazilmadi":             'NOT_TRANSFERRED',
  "Sandiq":                   'ARCHIVE',
  "Sifatsiz":                 'JUNK',
  "Bekor bo'ldi":             'RECYCLED',
  "Propushenniy":             'NO_ANSWER',       // alias
  "Qo'ng'iroqlar":            'NEW',             // alias
};

// ─────────────────────────────────────────────
// Responsible name → synthetic Bitrix-style id
// IDs start at 90001 so they won't collide with real Bitrix user IDs
// (which are typically < 1000). Once you run the real Bitrix initial sync
// (npm run sync), the ensureResponsible() function will upsert the correct
// IDs, and these placeholder rows will be overwritten by name match.
// ─────────────────────────────────────────────
const RESPONSIBLE_MAP = {
  "Shahzod Yormamatov":     90001,
  "Temurmalik Xoshimjonov": 90002,
  "Bekzod Ergashev":        90003,
  "Davlatyor":              90004,
  "Samandar Samadov":       90005,
  "Muhriddin Atoullayev":   90006,
  "Behzod Esonov":          90007,
  "Sardor Jumayev":         90008,
  "Abror":                  90009,
  "Nematilla":              90010,
  "Main (asosiy)":          90011,
};

// ─────────────────────────────────────────────
// Minimal CSV parser (no external deps)
// Handles quoted fields and embedded commas.
// ─────────────────────────────────────────────
function parseCSV(filePath) {
  const lines = fs.readFileSync(filePath, 'utf8').split('\n');
  const header = splitCSVLine(lines[0]);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const vals = splitCSVLine(line);
    const obj = {};
    header.forEach((h, j) => { obj[h] = vals[j] ?? ''; });
    rows.push(obj);
  }
  return rows;
}

function splitCSVLine(line) {
  const result = [];
  let cur = '', inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (c === ',' && !inQuotes) {
      result.push(cur); cur = '';
    } else {
      cur += c;
    }
  }
  result.push(cur);
  return result;
}

// ─────────────────────────────────────────────
// Parse a date string like "13.05.2026 09:52:50"
// ─────────────────────────────────────────────
function parseDate(s) {
  if (!s || s === 'NaT') return null;
  // Try DD.MM.YYYY HH:MM:SS
  const m = s.match(/^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}:\d{2}:\d{2})$/);
  if (m) return new Date(`${m[3]}-${m[2]}-${m[1]}T${m[4]}`);
  // Fallback
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

// ─────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────
async function main() {
  const client = await pool.connect();
  try {
    console.log('Reading CSV…');
    const rows = parseCSV(CSV);
    console.log(`  ${rows.length} rows loaded`);

    // ── 1. Ensure stages exist ──────────────────
    console.log('\nUpserting stages…');
    const stageIds = {}; // bitrix_id → stages.id
    for (const [uzName, bitrixId] of Object.entries(STAGE_MAP)) {
      // Ensure stage row exists
      await client.query(
        `INSERT INTO stages (bitrix_id, name, name_uz, entity_type, sort_order)
         VALUES ($1, $1, $2, 'lead', 0)
         ON CONFLICT (bitrix_id) DO UPDATE SET name_uz = EXCLUDED.name_uz`,
        [bitrixId, uzName]
      );
    }
    // Load all lead stage ids into memory
    const { rows: stageRows } = await client.query(
      "SELECT id, bitrix_id FROM stages WHERE entity_type = 'lead'"
    );
    stageRows.forEach(r => { stageIds[r.bitrix_id] = r.id; });
    console.log(`  ${stageRows.length} stages ready`);

    // ── 2. Ensure responsibles exist ───────────
    console.log('\nUpserting responsibles…');
    for (const [name, id] of Object.entries(RESPONSIBLE_MAP)) {
      const parts = name.split(' ');
      const firstName = parts[0] || name;
      const lastName  = parts.slice(1).join(' ') || null;
      await client.query(
        `INSERT INTO responsibles (id, name, last_name, is_active)
         VALUES ($1, $2, $3, TRUE)
         ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, last_name = EXCLUDED.last_name`,
        [id, firstName, lastName]
      );
    }
    console.log(`  ${Object.keys(RESPONSIBLE_MAP).length} responsibles ready`);

    // ── 3. Bulk insert leads in batches of 500 ─
    console.log('\nImporting leads…');
    const BATCH = 500;
    let inserted = 0, skipped = 0, duplicates = 0;

    await client.query('BEGIN');

    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH);

      for (const r of batch) {
        const id = parseInt(r.id, 10);
        if (isNaN(id)) { skipped++; continue; }

        const stageBitrixId  = STAGE_MAP[r.stage_name] ?? 'NEW';
        const stageId        = stageIds[stageBitrixId] ?? null;
        const responsibleId  = RESPONSIBLE_MAP[r.responsible_name] ?? null;
        const opportunity    = parseFloat(r.opportunity) || 0;
        const currency       = r.currency?.includes('Доллар') ? 'USD'
                             : r.currency?.includes('Сум')    ? 'UZS'
                             : (r.currency || 'USD');
        const dateCreated    = parseDate(r.date_created);
        const dateModified   = parseDate(r.date_modified);

        const isFailed = ['JUNK', 'RECYCLED'].includes(stageBitrixId);
        const isWon    = stageBitrixId === 'WON';
        const isProcessed = r.is_processed === '1' || r.is_processed === 'true';

        // Phone: prefer work, fallback to mobile
        const phone = r.phone_work || r.phone_mobile || null;

        try {
          const result = await client.query(
            `INSERT INTO leads (
               id, title, name, last_name,
               responsible_id, stage_id,
               opportunity, currency,
               source_id, utm_source, utm_medium, utm_campaign, utm_content,
               is_won, is_failed, is_processed,
               date_created, date_modified,
               raw_data
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
             ON CONFLICT (id) DO NOTHING`,
            [
              id,
              r.title    || null,
              r.name     || null,
              r.last_name || null,
              responsibleId,
              stageId,
              opportunity,
              currency,
              r.source_id    || null,
              r.utm_source   || null,
              r.utm_medium   || null,
              r.utm_campaign || null,
              r.utm_content  || null,
              isWon,
              isFailed,
              isProcessed,
              dateCreated,
              dateModified,
              JSON.stringify({ source: 'xls_import', stage_name: r.stage_name }),
            ]
          );

          // Insert phone
          if (phone) {
            await client.query(
              `INSERT INTO lead_phones (lead_id, phone, phone_type, is_primary)
               VALUES ($1, $2, $3, TRUE)
               ON CONFLICT DO NOTHING`,
              [id, phone, r.phone_work ? 'WORK' : 'MOBILE']
            );
          }

          // Also insert mobile if different from work
          if (r.phone_mobile && r.phone_mobile !== r.phone_work) {
            await client.query(
              `INSERT INTO lead_phones (lead_id, phone, phone_type, is_primary)
               VALUES ($1, $2, 'MOBILE', FALSE)
               ON CONFLICT DO NOTHING`,
              [id, r.phone_mobile]
            );
          }

          if (result.rowCount === 0) { duplicates++; } else { inserted++; }
        } catch (err) {
          skipped++;
          console.warn(`  Row ${id} error: ${err.message}`);
        }
      }

      // Commit every batch and report progress
      await client.query('COMMIT');
      await client.query('BEGIN');
      process.stdout.write(`  ${inserted} inserted, ${skipped} skipped\r`);
    }

    await client.query('COMMIT');
    console.log(`\n\n✓ Done. ${inserted} new, ${duplicates} duplicates skipped, ${skipped} errors`);

    // ── 4. Seed stage history from current stage ──
    // Adds one history row per lead (as if it arrived at its current stage)
    // so your stage history queries aren't empty.
    console.log('\nSeeding stage history…');
    const { rowCount } = await client.query(`
      INSERT INTO lead_stage_history (lead_id, from_stage_id, to_stage_id, responsible_id, changed_at)
      SELECT l.id, NULL, l.stage_id, l.responsible_id, COALESCE(l.date_created, NOW())
      FROM leads l
      WHERE l.stage_id IS NOT NULL
      ON CONFLICT DO NOTHING
    `);
    console.log(`  ${rowCount} stage history rows seeded`);

    // ── 5. Quick sanity check ───────────────────
    const { rows: stats } = await client.query(`
      SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE is_failed)    AS failed,
        COUNT(*) FILTER (WHERE is_processed) AS converted,
        ROUND(SUM(opportunity)::NUMERIC,0)   AS total_opp
      FROM leads
    `);
    console.log('\nDatabase summary:');
    console.log(`  Total leads   : ${stats[0].total}`);
    console.log(`  Failed        : ${stats[0].failed}`);
    console.log(`  Converted     : ${stats[0].converted}`);
    console.log(`  Total opp ($) : ${stats[0].total_opp}`);

  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('\nFatal error:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();

/**
 * import_deals.js
 *
 * One-shot script: imports deals_import.csv into PostgreSQL.
 * Skips duplicates (ON CONFLICT DO NOTHING).
 *
 * Run from bitrix-sync project root:
 *   node import_deals.js
 *
 * Requirements:
 *   - .env with DATABASE_URL
 *   - deals_import.csv in the same directory
 *   - schema already applied (deals, stages, responsibles tables exist)
 */

require('dotenv').config();
const fs   = require('fs');
const path = require('path');
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const CSV  = path.join(__dirname, 'deals_import.csv');

// ─────────────────────────────────────────────
// Stage name → stages.bitrix_id
// ─────────────────────────────────────────────
const STAGE_MAP = {
  "Sotuv bo'ldi":          'C1:WON',
  "Konsultatsiyadan o'tdi":'C1:CONSULTATION_DONE',
  "Kelishuv bo'ldi":       'C1:AGREEMENT',
  "Taqdimot qilindi":      'C1:PRESENTATION',
  "Bekor bo'ldi":          'C1:LOSE',
};

// ─────────────────────────────────────────────
// Responsible name → synthetic id (same as leads)
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
// Minimal CSV parser
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

function parseDate(s) {
  if (!s || s === 'NaT') return null;
  const m = s.match(/^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}:\d{2}:\d{2})$/);
  if (m) return new Date(`${m[3]}-${m[2]}-${m[1]}T${m[4]}`);
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

async function main() {
  const client = await pool.connect();
  try {
    console.log('Reading CSV...');
    const rows = parseCSV(CSV);
    console.log(`  ${rows.length} rows loaded`);

    // ── 1. Upsert deal stages ───────────────
    console.log('\nUpserting deal stages...');
    const stageIds = {};
    for (const [stageName, bitrixId] of Object.entries(STAGE_MAP)) {
      await client.query(
        `INSERT INTO stages (bitrix_id, name, name_uz, entity_type, sort_order,
           is_final_success, is_final_fail)
         VALUES ($1, $2, $3, 'deal', 0, $4, $5)
         ON CONFLICT (bitrix_id) DO UPDATE SET name_uz = EXCLUDED.name_uz`,
        [
          bitrixId, stageName, stageName,
          bitrixId.endsWith(':WON'),
          bitrixId.endsWith(':LOSE'),
        ]
      );
    }
    const { rows: stageRows } = await client.query(
      "SELECT id, bitrix_id FROM stages WHERE entity_type = 'deal'"
    );
    stageRows.forEach(r => { stageIds[r.bitrix_id] = r.id; });
    console.log(`  ${stageRows.length} deal stages ready`);

    // ── 2. Ensure responsibles exist ────────
    console.log('\nUpserting responsibles...');
    for (const [name, id] of Object.entries(RESPONSIBLE_MAP)) {
      const parts = name.split(' ');
      await client.query(
        `INSERT INTO responsibles (id, name, last_name, is_active)
         VALUES ($1, $2, $3, TRUE)
         ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name`,
        [id, parts[0], parts.slice(1).join(' ') || null]
      );
    }

    // ── 3. Bulk insert deals ─────────────────
    console.log('\nImporting deals...');
    const BATCH = 500;
    let inserted = 0, duplicates = 0, skipped = 0;

    await client.query('BEGIN');

    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH);

      for (const r of batch) {
        const id = parseInt(r.id, 10);
        if (isNaN(id)) { skipped++; continue; }

        const stageBitrixId = STAGE_MAP[r.stage_name] ?? 'C1:WON';
        const stageId       = stageIds[stageBitrixId] ?? null;
        const responsibleId = RESPONSIBLE_MAP[r.responsible_name] ?? null;
        const opportunity   = parseFloat(r.opportunity) || 0;
        const currency      = r.currency?.includes('Доллар') ? 'USD'
                            : r.currency?.includes('Сум')    ? 'UZS'
                            : (r.currency || 'USD');
        const isWon    = parseInt(r.is_won)    === 1;
        const isFailed = parseInt(r.is_failed) === 1;
        const dateCreated  = parseDate(r.date_created);
        const dateModified = parseDate(r.date_modified);

        try {
          const result = await client.query(
            `INSERT INTO deals (
               id, title, responsible_id, stage_id,
               opportunity, currency, source_id,
               utm_source, utm_medium, utm_campaign, utm_content,
               is_won, is_failed,
               date_created, date_modified,
               raw_data
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
             ON CONFLICT (id) DO NOTHING`,
            [
              id,
              r.title        || null,
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
              dateCreated,
              dateModified,
              JSON.stringify({ source: 'csv_import', stage_name: r.stage_name, pipeline: r.pipeline_name }),
            ]
          );

          if (result.rowCount === 0) {
            duplicates++;
          } else {
            inserted++;
            // Seed stage history
            if (stageId) {
              await client.query(
                `INSERT INTO deal_stage_history
                   (deal_id, from_stage_id, to_stage_id, responsible_id, changed_at)
                 VALUES ($1, NULL, $2, $3, $4)
                 ON CONFLICT DO NOTHING`,
                [id, stageId, responsibleId, dateCreated || new Date()]
              );
            }
          }
        } catch (err) {
          skipped++;
          console.warn(`  Row ${id} error: ${err.message}`);
        }
      }

      await client.query('COMMIT');
      await client.query('BEGIN');
      process.stdout.write(`  ${inserted} new, ${duplicates} duplicates, ${skipped} errors\r`);
    }

    await client.query('COMMIT');
    console.log(`\n\n✓ Done. ${inserted} new deals, ${duplicates} duplicates skipped, ${skipped} errors`);

    // ── 4. Sanity check ──────────────────────
    const { rows: stats } = await client.query(`
      SELECT
        COUNT(*)                                    AS total,
        COUNT(*) FILTER (WHERE is_won)              AS won,
        COUNT(*) FILTER (WHERE is_failed)           AS failed,
        ROUND(SUM(opportunity)::NUMERIC, 0)         AS total_opp
      FROM deals
    `);
    console.log('\nDatabase summary:');
    console.log(`  Total deals : ${stats[0].total}`);
    console.log(`  Won         : ${stats[0].won}`);
    console.log(`  Failed      : ${stats[0].failed}`);
    console.log(`  Total opp $ : ${stats[0].total_opp}`);

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

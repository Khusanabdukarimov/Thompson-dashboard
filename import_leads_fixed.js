require('dotenv').config();
const fs   = require('fs');
const path = require('path');
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const CSV  = path.join(__dirname, 'leads_import.csv');

const STAGE_MAP = {
  "Yangi lid":                'NEW',
  "Javob bermadi":            'NO_ANSWER',
  "Qayta aloqa":              'CALLBACK',
  "O'ylab ko'radi":           'THINKING',
  "Konsultatsiya belgilandi": 'CONSULTATION',
  "Konsultatsiya o'tkazildi": 'CONVERTED',
  "O'tkazilmadi":             'NOT_TRANSFERRED',
  "Sandiq":                   'ARCHIVE',
  "Sifatsiz":                 'JUNK',
  "Bekor bo'ldi":             'RECYCLED',
  "Propushenniy":             'NO_ANSWER',
  "Qo'ng'iroqlar":            'NEW',
};

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
    console.log('Reading CSV…');
    const rows = parseCSV(CSV);
    console.log(`  ${rows.length} rows loaded`);

    // 1. Ensure stages exist
    console.log('\nUpserting stages…');
    const stageIds = {};
    for (const [, bitrixId] of Object.entries(STAGE_MAP)) {
      await client.query(
        `INSERT INTO stages (entity, bitrix_id, name, sort_order)
         VALUES ('lead', $1, $1, 0)
         ON CONFLICT (entity, bitrix_id) DO NOTHING`,
        [bitrixId]
      );
    }
    const { rows: stageRows } = await client.query(
      "SELECT id, bitrix_id FROM stages WHERE entity = 'lead'"
    );
    stageRows.forEach(r => { stageIds[r.bitrix_id] = r.id; });
    console.log(`  ${stageRows.length} stages ready`);

    // 2. Ensure responsibles exist
    console.log('\nUpserting responsibles…');
    for (const [name, id] of Object.entries(RESPONSIBLE_MAP)) {
      const parts = name.split(' ');
      const firstName = parts[0] || name;
      const lastName  = parts.slice(1).join(' ') || null;
      await client.query(
        `INSERT INTO responsibles (id, name, last_name, active)
         VALUES ($1, $2, $3, TRUE)
         ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, last_name = EXCLUDED.last_name`,
        [id, firstName, lastName]
      );
    }
    console.log(`  ${Object.keys(RESPONSIBLE_MAP).length} responsibles ready`);

    // 3. Bulk insert leads
    console.log('\nImporting leads…');
    let inserted = 0, skipped = 0, duplicates = 0;
    const BATCH = 500;

    await client.query('BEGIN');

    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH);

      for (const r of batch) {
        const id = parseInt(r.id, 10);
        if (isNaN(id)) { skipped++; continue; }

        const stageBitrixId = STAGE_MAP[r.stage_name] ?? 'NEW';
        const stageId       = stageIds[stageBitrixId] ?? null;
        const responsibleId = RESPONSIBLE_MAP[r.responsible_name] ?? null;
        const opportunity   = parseFloat(r.opportunity) || 0;
        const dateCreate    = parseDate(r.date_created);
        const dateModify    = parseDate(r.date_modified);

        try {
          const result = await client.query(
            `INSERT INTO leads (
               id, responsible_id, stage_id, opportunity,
               source_id, utm_source, utm_medium, utm_campaign, utm_content,
               date_create, date_modify
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
             ON CONFLICT (id) DO NOTHING`,
            [
              id, responsibleId, stageId, opportunity,
              r.source_id    || null,
              r.utm_source   || null,
              r.utm_medium   || null,
              r.utm_campaign || null,
              r.utm_content  || null,
              dateCreate, dateModify,
            ]
          );

          // Insert phone (skip duplicates)
          const phone = r.phone_work || r.phone_mobile || null;
          if (phone) {
            await client.query(
              `INSERT INTO lead_phones (lead_id, phone)
               SELECT $1, $2 WHERE NOT EXISTS (
                 SELECT 1 FROM lead_phones WHERE lead_id=$1 AND phone=$2
               )`,
              [id, phone]
            );
          }
          if (r.phone_mobile && r.phone_mobile !== r.phone_work) {
            await client.query(
              `INSERT INTO lead_phones (lead_id, phone)
               SELECT $1, $2 WHERE NOT EXISTS (
                 SELECT 1 FROM lead_phones WHERE lead_id=$1 AND phone=$2
               )`,
              [id, r.phone_mobile]
            );
          }

          if (result.rowCount === 0) { duplicates++; } else { inserted++; }
        } catch (err) {
          skipped++;
          console.warn(`  Row ${id} error: ${err.message}`);
        }
      }

      await client.query('COMMIT');
      await client.query('BEGIN');
      process.stdout.write(`  ${inserted} inserted, ${skipped} skipped\r`);
    }

    await client.query('COMMIT');
    console.log(`\n\n✓ Done. ${inserted} new, ${duplicates} duplicates skipped, ${skipped} errors`);

    // 4. Seed stage history
    console.log('\nSeeding stage history…');
    const { rowCount } = await client.query(`
      INSERT INTO lead_stage_history (lead_id, stage_id, changed_at)
      SELECT l.id, l.stage_id, COALESCE(l.date_create, NOW())
      FROM leads l
      WHERE l.stage_id IS NOT NULL
      ON CONFLICT DO NOTHING
    `);
    console.log(`  ${rowCount} stage history rows seeded`);

    // 5. Sanity check
    const { rows: stats } = await client.query(`
      SELECT
        COUNT(*)                                    AS total,
        COUNT(*) FILTER (WHERE s.is_final AND NOT s.is_won) AS failed,
        COUNT(*) FILTER (WHERE s.is_final AND s.is_won)     AS converted,
        ROUND(SUM(l.opportunity)::NUMERIC, 0)       AS total_opp
      FROM leads l
      LEFT JOIN stages s ON s.id = l.stage_id
    `);
    console.log('\nDatabase summary:');
    console.log(`  Total leads   : ${stats[0].total}`);
    console.log(`  Failed        : ${stats[0].failed}`);
    console.log(`  Converted     : ${stats[0].converted}`);
    console.log(`  Total opp     : ${stats[0].total_opp}`);

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

/**
 * import_tasks.js
 *
 * Creates the tasks table and imports tasks_import.csv.
 * Links tasks to responsibles (executor) and leads (by title match).
 * Skips duplicates (ON CONFLICT DO NOTHING).
 *
 * Run: node import_tasks.js
 */

require('dotenv').config();
const fs   = require('fs');
const path = require('path');
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const CSV  = path.join(__dirname, 'tasks_import.csv');

const STATUS_MAP = {
  'Ждёт выполнения': 'pending',
  'Завершена':       'completed',
  'Ждёт контроля':   'review',
  'Выполняется':     'in_progress',
  'Просрочена':      'overdue',
  'Отклонена':       'rejected',
};

const RESPONSIBLE_MAP = {
  "Shahzod Yormamatov":     22,
  "Temurmalik Xoshimjonov": 32,
  "Bekzod Ergashev":        14,
  "Davlatyor":              16,
  "Samandar Samadov":       18,
  "Muhriddin Atoullayev":   12,
  "Behzod Esonov":          26,
  "Sardor Jumayev":         20,
  "Abror":                  30,
  "Nematilla":              34,
  "Main (asosiy)":           1,
  "Data365":                90012,
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
  if (!s || s === 'NaT' || s === '') return null;
  const m = s.match(/^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}:\d{2}:\d{2})$/);
  if (m) return new Date(`${m[3]}-${m[2]}-${m[1]}T${m[4]}`);
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

async function main() {
  const client = await pool.connect();
  try {
    // ── 1. Create tasks table ─────────────────
    console.log('Creating tasks table...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS tasks (
        id              INT          PRIMARY KEY,
        title           VARCHAR(500) NOT NULL,
        status          VARCHAR(50)  NOT NULL DEFAULT 'pending',
        creator_id      INT          REFERENCES responsibles(id) ON DELETE SET NULL,
        executor_id     INT          REFERENCES responsibles(id) ON DELETE SET NULL,
        lead_id         INT          REFERENCES leads(id) ON DELETE SET NULL,
        deal_id         INT          REFERENCES deals(id) ON DELETE SET NULL,
        lead_title      VARCHAR(500),
        deadline        TIMESTAMP,
        date_created    TIMESTAMP,
        date_modified   TIMESTAMP,
        date_closed     TIMESTAMP,
        raw_data        JSONB,
        created_at      TIMESTAMP    NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMP    NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_tasks_executor   ON tasks(executor_id);
      CREATE INDEX IF NOT EXISTS idx_tasks_creator    ON tasks(creator_id);
      CREATE INDEX IF NOT EXISTS idx_tasks_lead       ON tasks(lead_id);
      CREATE INDEX IF NOT EXISTS idx_tasks_deal       ON tasks(deal_id);
      CREATE INDEX IF NOT EXISTS idx_tasks_status     ON tasks(status);
      CREATE INDEX IF NOT EXISTS idx_tasks_deadline   ON tasks(deadline);
      CREATE INDEX IF NOT EXISTS idx_tasks_created    ON tasks(date_created DESC);

      -- Auto-update trigger
      DROP TRIGGER IF EXISTS trg_tasks_updated_at ON tasks;
      CREATE TRIGGER trg_tasks_updated_at
        BEFORE UPDATE ON tasks FOR EACH ROW EXECUTE FUNCTION set_updated_at();
    `);
    console.log('  ✓ tasks table ready');

    // ── 2. Ensure Data365 responsible exists ──
    await client.query(
      `INSERT INTO responsibles (id, name, active) VALUES (90012, 'Data365', TRUE)
       ON CONFLICT (id) DO NOTHING`
    );

    // ── 3. Build lead title → id lookup ───────
    console.log('\nBuilding lead title lookup...');
    const { rows: leadRows } = await client.query(
      'SELECT id, title FROM leads WHERE title IS NOT NULL'
    );
    const leadByTitle = new Map();
    leadRows.forEach(r => { if (r.title) leadByTitle.set(r.title.trim().toLowerCase(), r.id); });
    console.log(`  ${leadByTitle.size} lead titles indexed`);

    // ── 4. Import tasks ──────────────────────
    console.log('\nImporting tasks...');
    const rows = parseCSV(CSV);
    let inserted = 0, duplicates = 0, skipped = 0, linked = 0;

    await client.query('BEGIN');

    for (const r of rows) {
      const id = parseInt(r.id, 10);
      if (isNaN(id)) { skipped++; continue; }

      const status     = STATUS_MAP[r.status] || 'pending';
      const creatorId  = RESPONSIBLE_MAP[r.creator_name] || null;
      const executorId = RESPONSIBLE_MAP[r.executor_name] || null;
      const deadline   = parseDate(r.deadline);
      const dateCreated  = parseDate(r.date_created);
      const dateModified = parseDate(r.date_modified);
      const dateClosed   = parseDate(r.date_closed);

      // Try to match lead by title
      let leadId = null;
      if (r.lead_title) {
        const key = r.lead_title.trim().toLowerCase();
        leadId = leadByTitle.get(key) || null;

        // Try partial match: "Лид #2480" → search for lead with id
        if (!leadId) {
          const idMatch = r.lead_title.match(/#(\d+)/);
          if (idMatch) {
            const potentialId = parseInt(idMatch[1], 10);
            const { rows: check } = await client.query(
              'SELECT id FROM leads WHERE id = $1', [potentialId]
            );
            if (check.length > 0) leadId = potentialId;
          }
        }
        if (leadId) linked++;
      }

      try {
        const result = await client.query(
          `INSERT INTO tasks (
             id, title, status, creator_id, executor_id,
             lead_id, lead_title, deadline,
             date_created, date_modified, date_closed,
             raw_data
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
           ON CONFLICT (id) DO NOTHING`,
          [
            id, r.title || '', status, creatorId, executorId,
            leadId, r.lead_title || null, deadline,
            dateCreated, dateModified, dateClosed,
            JSON.stringify({ source: 'xls_import', original_status: r.status }),
          ]
        );
        if (result.rowCount === 0) duplicates++;
        else inserted++;
      } catch (err) {
        skipped++;
        console.warn(`  Task ${id} error: ${err.message}`);
      }
    }

    await client.query('COMMIT');
    console.log(`\n✓ Done. ${inserted} new, ${duplicates} duplicates, ${skipped} errors`);
    console.log(`  ${linked} tasks linked to leads`);

    // ── 5. Sanity check ──────────────────────
    const { rows: stats } = await client.query(`
      SELECT
        COUNT(*)                                    AS total,
        COUNT(*) FILTER (WHERE status = 'pending')  AS pending,
        COUNT(*) FILTER (WHERE status = 'completed') AS completed,
        COUNT(*) FILTER (WHERE lead_id IS NOT NULL)  AS linked_to_lead
      FROM tasks
    `);
    console.log('\nDatabase summary:');
    console.log(`  Total tasks      : ${stats[0].total}`);
    console.log(`  Pending          : ${stats[0].pending}`);
    console.log(`  Completed        : ${stats[0].completed}`);
    console.log(`  Linked to leads  : ${stats[0].linked_to_lead}`);

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

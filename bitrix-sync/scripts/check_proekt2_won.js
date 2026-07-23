#!/usr/bin/env node
/**
 * Check whether the "Успешный лид" (won / CONVERTED) leads have Proekt2 set in the DB.
 *
 * Run ON the server where the synced DB lives:
 *   cd /var/www/thompson/bitrix-sync && node scripts/check_proekt2_won.js
 *
 * Optional date window (Asia/Tashkent, by date_create):
 *   node scripts/check_proekt2_won.js 2026-07-01 2026-07-23
 */
const pool = require('../src/db/pool');

const [from = null, to = null] = process.argv.slice(2);

// Proekt2 enum labels seen in Bitrix (used only to auto-detect the field code).
const PROEKT2_HINTS = ['HR', 'Студент', 'Жалоба'];

async function detectProekt2FieldCode() {
  // 1. Prefer an exact/near label match.
  const byLabel = await pool.query(
    `SELECT field_code, label, is_multiple FROM lead_uf_fields
     WHERE label ILIKE '%proekt2%' OR label ILIKE '%проект2%'`
  );
  if (byLabel.rows.length === 1) return byLabel.rows[0];

  // 2. Otherwise match the field whose enum options include the known values.
  const byEnum = await pool.query(
    `SELECT field_code, COUNT(*)::int AS hits
     FROM lead_uf_enums
     WHERE value = ANY($1)
     GROUP BY field_code
     ORDER BY hits DESC`,
    [PROEKT2_HINTS]
  );
  if (byLabel.rows.length > 1) {
    console.log('Multiple label matches for Proekt2:');
    console.table(byLabel.rows);
  }
  console.log('Fields whose enums contain HR/Студент/Жалоба:');
  console.table(byEnum.rows);
  // Pick the best enum match that is NOT the primary Proekt field.
  const best = byEnum.rows.find(r => r.field_code !== 'UF_CRM_1781879563298') || byEnum.rows[0];
  if (!best) return null;
  const meta = await pool.query(
    `SELECT field_code, label, is_multiple FROM lead_uf_fields WHERE field_code = $1`,
    [best.field_code]
  );
  return meta.rows[0] || { field_code: best.field_code, label: '(unknown)', is_multiple: null };
}

async function main() {
  const field = await detectProekt2FieldCode();
  if (!field) {
    console.error('Could not detect the Proekt2 field code. Run syncLeadUfMeta first, or set it manually.');
    process.exit(1);
  }
  console.log(`\nProekt2 field: ${field.field_code}  label="${field.label}"  multiple=${field.is_multiple}\n`);

  // enum_id -> label map for this field
  const enums = await pool.query(
    `SELECT enum_id, value FROM lead_uf_enums WHERE field_code = $1`, [field.field_code]);
  const enumMap = new Map(enums.rows.map(r => [String(r.enum_id), r.value]));

  const dateCond = `($2::date IS NULL OR (l.date_create AT TIME ZONE 'Asia/Tashkent')::date >= $2::date)
                AND ($3::date IS NULL OR (l.date_create AT TIME ZONE 'Asia/Tashkent')::date <= $3::date)`;

  const rows = (await pool.query(
    `SELECT l.id, l.title, l.date_create, v.value AS proekt2_raw
       FROM leads l
       JOIN stages s ON s.id = l.stage_id
       LEFT JOIN lead_uf_values v ON v.lead_id = l.id AND v.field_code = $1
      WHERE s.entity = 'lead' AND s.bitrix_id = 'CONVERTED'
        AND ${dateCond}
      ORDER BY l.date_create DESC`,
    [field.field_code, from, to]
  )).rows;

  const resolve = (raw) => {
    if (raw == null) return null;
    let ids;
    try { ids = JSON.parse(raw); } catch { ids = [raw]; }
    if (!Array.isArray(ids)) ids = [ids];
    return ids.map(id => enumMap.get(String(id)) || `#${id}`).join(', ');
  };

  const withVal = rows.filter(r => r.proekt2_raw != null);
  const without = rows.filter(r => r.proekt2_raw == null);

  console.log(`Успешный лид (CONVERTED) total: ${rows.length}${from || to ? `  [${from || '…'} → ${to || '…'}]` : ''}`);
  console.log(`  with Proekt2 set:    ${withVal.length}`);
  console.log(`  MISSING Proekt2:     ${without.length}\n`);

  console.log('Per-lead:');
  console.table(rows.map(r => ({
    id: r.id,
    title: (r.title || '').slice(0, 40),
    created: r.date_create ? new Date(r.date_create).toISOString().slice(0, 10) : '',
    proekt2: resolve(r.proekt2_raw) || '— none —',
  })));

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });

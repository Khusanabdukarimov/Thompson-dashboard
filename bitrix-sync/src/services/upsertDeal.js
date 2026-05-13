const pool = require('../db/pool');
const stageResolver = require('./stageResolver');

function parseDate(s) {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Upsert a single deal from Bitrix24 raw data.
 * Returns the deals.id.
 */
async function upsertDeal(r, client) {
  const db = client || pool;

  const stageId = await stageResolver.resolve('deal', r.STAGE_ID);
  const responsibleId = r.ASSIGNED_BY_ID ? parseInt(r.ASSIGNED_BY_ID) : null;

  const { rows } = await db.query(
    `INSERT INTO deals (
       id, responsible_id, stage_id, opportunity, currency_id,
        source_id, utm_source, title, date_create, closedate, synced_at
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW()
      )
     ON CONFLICT (id) DO UPDATE SET
       responsible_id = EXCLUDED.responsible_id,
       stage_id       = EXCLUDED.stage_id,
       opportunity    = EXCLUDED.opportunity,
       currency_id    = EXCLUDED.currency_id,
       source_id      = EXCLUDED.source_id,
        utm_source     = EXCLUDED.utm_source,
        title          = EXCLUDED.title,
        closedate      = EXCLUDED.closedate,
       synced_at      = NOW()
     RETURNING id`,
    [
      parseInt(r.ID),
      responsibleId,
      stageId,
      parseFloat(r.OPPORTUNITY || 0),
      r.CURRENCY_ID || null,
      r.SOURCE_ID || null,
      r.UTM_SOURCE || null,
      r.TITLE || null,
      parseDate(r.DATE_CREATE),
      parseDate(r.CLOSEDATE),
    ]
  );

  return rows[0].id;
}

module.exports = { upsertDeal };

const pool = require('../db/pool');
const stageResolver = require('./stageResolver');

function ufVal(raw) {
  if (raw == null) return null;
  if (Array.isArray(raw)) return raw.length ? String(raw[0]) : null;
  return String(raw);
}

function parseDate(s) {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Upsert a single lead from Bitrix24 raw data.
 * Returns the leads.id.
 */
async function upsertLead(r, client) {
  const db = client || pool;

  const stageId = await stageResolver.resolve('lead', r.STATUS_ID);
  const responsibleId = r.ASSIGNED_BY_ID ? parseInt(r.ASSIGNED_BY_ID) : null;

  const { rows } = await db.query(
    `INSERT INTO leads (
       id, responsible_id, stage_id, opportunity, source_id,
       utm_source, utm_medium, utm_campaign, utm_content, utm_term,
       uf_segment, uf_filial, uf_service, uf_activity, uf_with_whom,
       date_create, date_modify, synced_at
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,NOW()
     )
     ON CONFLICT (id) DO UPDATE SET
       responsible_id = EXCLUDED.responsible_id,
       stage_id       = EXCLUDED.stage_id,
       opportunity    = EXCLUDED.opportunity,
       source_id      = EXCLUDED.source_id,
       utm_source     = EXCLUDED.utm_source,
       utm_medium     = EXCLUDED.utm_medium,
       utm_campaign   = EXCLUDED.utm_campaign,
       utm_content    = EXCLUDED.utm_content,
       utm_term       = EXCLUDED.utm_term,
       uf_segment     = EXCLUDED.uf_segment,
       uf_filial      = EXCLUDED.uf_filial,
       uf_service     = EXCLUDED.uf_service,
       uf_activity    = EXCLUDED.uf_activity,
       uf_with_whom   = EXCLUDED.uf_with_whom,
       date_modify    = EXCLUDED.date_modify,
       synced_at      = NOW()
     RETURNING id`,
    [
      parseInt(r.ID),
      responsibleId,
      stageId,
      parseFloat(r.OPPORTUNITY || 0),
      r.SOURCE_ID || null,
      r.UTM_SOURCE || null,
      r.UTM_MEDIUM || null,
      r.UTM_CAMPAIGN || null,
      r.UTM_CONTENT || null,
      r.UTM_TERM || null,
      ufVal(r.UF_CRM_1775825731211),
      ufVal(r.UF_CRM_1777030859057),
      ufVal(r.UF_CRM_1775824803703),
      ufVal(r.UF_CRM_1775825155935),
      ufVal(r.UF_CRM_1770281264686),
      parseDate(r.DATE_CREATE),
      parseDate(r.DATE_MODIFY),
    ]
  );

  return rows[0].id;
}

module.exports = { upsertLead };

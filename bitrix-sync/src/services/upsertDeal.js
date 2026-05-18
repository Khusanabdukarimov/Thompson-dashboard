const pool = require('../db/pool');
const stageResolver = require('./stageResolver');

const DEAL_CANCEL_REASON_MAP = {
  '1286': "Qimmatlik qildi",
  '1292': "Boshqalardan sotib oldi",
  '1526': "Biznes egasi emas",
  '1528': "Maqul kelmadi",
  '1530': "Nomi patentdan o'tmaydi",
  '1532': "Qadriyatimizga to'g'ri kelmadi",
  '1534': "Sheriklarga maqul kelmadi",
  '1536': "2 xafta ichida umuman javob berishmadi",
  '1538': "Hamkorlik bo'yicha ish boshlandi",
  '1540': "Faoliyat to'xtatildi",
  '1288': "Puli yo'q",
  '1542': "Kerak emas"
};

function ufVal(raw) {
  if (raw == null) return null;
  if (Array.isArray(raw)) return raw.length ? String(raw[0]) : null;
  return String(raw);
}

function ufEnum(raw, map) {
  const v = ufVal(raw);
  if (!v) return null;
  return map[v] || null;
}

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
       source_id, utm_source, date_create, closedate, uf_cancel_reason, synced_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())
     ON CONFLICT (id) DO UPDATE SET
       responsible_id   = EXCLUDED.responsible_id,
       stage_id         = EXCLUDED.stage_id,
       opportunity      = EXCLUDED.opportunity,
       currency_id      = EXCLUDED.currency_id,
       source_id        = EXCLUDED.source_id,
       utm_source       = EXCLUDED.utm_source,
       closedate        = EXCLUDED.closedate,
       uf_cancel_reason = EXCLUDED.uf_cancel_reason,
       synced_at        = NOW()
     RETURNING id`,
    [
      parseInt(r.ID),
      responsibleId,
      stageId,
      parseFloat(r.OPPORTUNITY || 0),
      r.CURRENCY_ID || null,
      r.SOURCE_ID || null,
      r.UTM_SOURCE || null,
      parseDate(r.DATE_CREATE),
      parseDate(r.CLOSEDATE),
      ufEnum(r.UF_CRM_69EBC105EAA93, DEAL_CANCEL_REASON_MAP),
    ]
  );

  return rows[0].id;
}

module.exports = { upsertDeal };

/**
 * Where Bitrix keeps WHY a lead is Bekor bo'ldi (Закрыт) or Sifatsiz (Горячие звонки (NO)).
 * Each project fills its own field, so one lead usually has a value in only one of them;
 * when several are filled, the first in the list wins (the project enum fields before the
 * older free-text field, where many leads only carry "—").
 * Field coverage on Oct 2026 leads: LC 3 051 / School 1 545 / Land 19 Sifatsiz; LC 987 /
 * School 323 Bekor; the text fields on almost all, a third of them "—".
 */
const REASON_FIELDS = {
  bekor: [
    'UF_CRM_1770976355232',              // Bekor bo'ldi sababini belgilang (LC)
    'UF_CRM_1784100333',                 // Bekor bo'lish sababi (School)
    'UF_CRM_BEKOR_BO_LDI_603C521DDE90',  // Bekor bo'ldi (text)
  ],
  sifatsiz: [
    'UF_CRM_1770282341169',              // Sifatsizlik sababini belgilang (LC)
    'UF_CRM_1784100252',                 // Sifatsizlik sababi belgilang (School)
    'UF_CRM_1784100426',                 // Sifatsizlik sababi belgilang (Land)
    'UF_CRM_SIFATSIZ_LID_0A5800E2C439',  // Sifatsiz lid (text)
  ],
};

/**
 * LEFT JOIN LATERAL giving `alias.reason`: the lead's one reason from `fields` (enum label or
 * text, first filled field wins, a bare dash counts as empty). `leadCol` is the lead id column.
 * One row per lead, so counting over it never counts a lead twice.
 */
function reasonPickJoin(fields, alias = 'rr', leadCol = 'l.id') {
  const list = fields.map((f) => `'${f}'`).join(', ');
  return `
  LEFT JOIN LATERAL (
    SELECT COALESCE(e.value, v.value) AS reason
    FROM lead_uf_values v
    LEFT JOIN lead_uf_enums e ON e.field_code = v.field_code AND e.enum_id = v.value
    WHERE v.lead_id = ${leadCol} AND v.field_code IN (${list})
      AND TRIM(COALESCE(e.value, v.value)) NOT IN ('', '—', '-', 'false')
    ORDER BY array_position(ARRAY[${list}]::text[], v.field_code)
    LIMIT 1
  ) ${alias} ON true`;
}

module.exports = { REASON_FIELDS, reasonPickJoin };

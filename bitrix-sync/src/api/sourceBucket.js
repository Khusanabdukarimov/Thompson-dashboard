/**
 * Sources Bitrix no longer lists (deleted from crm.status SOURCE, e.g. UC_HPU1RW,
 * "2", PARTNER — mostly from the 2023 migration) have no name anywhere, so they
 * are shown as one "O'chirilgan manba" bucket instead of a raw code each.
 * A source counts as deleted when it is a non-empty code missing from lead_sources.
 */
const DELETED = '__deleted__';
const DELETED_NAME = "O'chirilgan manba";
/** Bitrix's "не выбран": no source at all. Same key the Sdelkalar tables use for "Manbasiz". */
const EMPTY = '__none__';
const EMPTY_NAME = "Ko'rsatilmagan (не выбран)";

/** SQL grouping key: the code itself, or DELETED. `ls` is the lead_sources join alias. */
const sourceKey = (col, ls) =>
  `CASE WHEN NULLIF(${col}, '') IS NOT NULL AND ${ls}.source_id IS NULL THEN '${DELETED}' ELSE ${col} END`;

/** SQL: the comma-separated filter in `ph` asks for DELETED and `col` is a deleted code. */
const deletedMatch = (col, ph) =>
  `(position(',${DELETED},' in ',' || ${ph}::text || ',') > 0
    AND NULLIF(${col}, '') IS NOT NULL AND ${col} NOT IN (SELECT source_id FROM lead_sources))`;

/** SQL: true when `tbl` has at least one row with a deleted source (for filter options). */
const hasDeleted = (tbl, extra = '') =>
  `EXISTS (SELECT 1 FROM ${tbl} x WHERE NULLIF(x.source_id, '') IS NOT NULL
           AND x.source_id NOT IN (SELECT source_id FROM lead_sources) ${extra})`;

/** SQL: the comma-separated filter in `ph` asks for EMPTY and `col` has no source. */
const emptyMatch = (col, ph) =>
  `(position(',${EMPTY},' in ',' || ${ph}::text || ',') > 0 AND NULLIF(${col}, '') IS NULL)`;

/** Filter options: "не выбран" first (when used), every Bitrix source used in `tbl` by name, then the deleted bucket. */
const sourceOptionsSql = (tbl, extra = '') =>
  `SELECT source_id, name FROM (
     SELECT '${EMPTY}' AS source_id, '${EMPTY_NAME.replace(/'/g, "''")}' AS name, -1 AS o
      WHERE EXISTS (SELECT 1 FROM ${tbl} x WHERE NULLIF(x.source_id, '') IS NULL ${extra})
     UNION ALL
     SELECT ls.source_id, ls.name, 0 AS o FROM lead_sources ls
      WHERE EXISTS (SELECT 1 FROM ${tbl} x WHERE x.source_id = ls.source_id ${extra})
     UNION ALL
     SELECT '${DELETED}', '${DELETED_NAME.replace(/'/g, "''")}', 1 WHERE ${hasDeleted(tbl, extra)}
   ) o ORDER BY o, name`;

module.exports = { DELETED, DELETED_NAME, EMPTY, EMPTY_NAME, sourceKey, deletedMatch, emptyMatch, sourceOptionsSql };

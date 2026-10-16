/**
 * List filters shared by the Lidlar and Sdelkalar APIs. "?x=a,b" keeps rows
 * whose value is a or b; "?x=!a,b" is the picker's "Istisno" — everything
 * except a and b, rows with no value included.
 */
const isExcl = (ph) => `left(${ph}::text, 1) = '!'`;
const listOf = (ph) => `string_to_array(CASE WHEN ${isExcl(ph)} THEN substr(${ph}::text, 2) ELSE ${ph}::text END, ',')`;
const stripExcl = (ph) => `(CASE WHEN ${isExcl(ph)} THEN substr(${ph}::text, 2) ELSE ${ph}::text END)`;
const listCond = (col, ph) =>
  `(${ph}::text IS NULL OR CASE WHEN ${isExcl(ph)} THEN COALESCE(${col}, '') <> ALL(${listOf(ph)}) ELSE ${col} = ANY(${listOf(ph)}) END)`;

/** JS side: "!a,b" → { exclude: true, values: ['a', 'b'] }. */
function splitSel(raw) {
  const s = String(raw ?? '');
  const exclude = s.startsWith('!');
  return { exclude, values: (exclude ? s.slice(1) : s).split(',').map(v => v.trim()).filter(Boolean) };
}

module.exports = { isExcl, listOf, stripExcl, listCond, splitSel };

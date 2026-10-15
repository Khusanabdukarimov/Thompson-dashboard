/**
 * Tashkent calendar-day bounds for a timestamptz column, written so Postgres can
 * use the column's index.
 *
 *   (col AT TIME ZONE 'Asia/Tashkent')::date >= D   ⇔  col >= D 00:00 Tashkent
 *   (col AT TIME ZONE 'Asia/Tashkent')::date <= D   ⇔  col <  (D + 1) 00:00 Tashkent
 *
 * The left forms convert every row before comparing, so each query read the
 * whole table (454 ms vs 6 ms for a month of leads). `d` is a SQL expression —
 * a placeholder like `$1` or an already-validated quoted literal.
 */
const TZ = 'Asia/Tashkent';

const dayStart = (d) => `(${d}::date::timestamp AT TIME ZONE '${TZ}')`;
const nextDayStart = (d) => `((${d}::date + 1)::timestamp AT TIME ZONE '${TZ}')`;

/** col on or after day d (Tashkent). */
const tzFrom = (col, d) => `${col} >= ${dayStart(d)}`;
/** col on or before day d (Tashkent). */
const tzTo = (col, d) => `${col} < ${nextDayStart(d)}`;

/** Same, but a NULL parameter means "no bound" — for `$n` placeholders. */
const tzFromOpt = (col, p) => `(${p}::date IS NULL OR ${tzFrom(col, p)})`;
const tzToOpt = (col, p) => `(${p}::date IS NULL OR ${tzTo(col, p)})`;

module.exports = { tzFrom, tzTo, tzFromOpt, tzToOpt };

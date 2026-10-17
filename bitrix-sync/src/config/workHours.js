/**
 * Working hours of the call-centre teams, for the "Reaksiya vaqti" figure: how long a
 * customer waited for a callback counts only the time somebody was at work to make it.
 * A miss at 22:00 called back at 09:05 next morning waited 5 minutes, not 11 hours.
 *
 * The team tag is the one in the PBX extension's name ("Hosiyat | TLC"), see teamOf in
 * config/calls.js. Hours are Asia/Tashkent local time, start inclusive, end exclusive.
 *
 *   TLC  O'quv markaz   09:00 - 20:00
 *   TIS  Maktab         09:00 - 19:00
 *   TL   Bog'cha        08:00 - 18:00
 *
 * A miss whose team is unknown (a lead owned by someone without a call-centre extension,
 * "Boshqa" operators) is measured against the whole company's day: 08:00 - 20:00, i.e.
 * whenever any team is at work.
 */
const SCHEDULES = {
  TLC: [9, 20],
  TIS: [9, 19],
  TL: [8, 18],
};
const DEFAULT_SCHEDULE = [8, 20];

// Weekdays nobody works (0 = Sunday ... 6 = Saturday, Tashkent). None were given, so every
// day counts; add 0 here to make Sundays free.
const OFF_WEEKDAYS = [];

const HOUR_MS = 3600e3;
const DAY_MS = 24 * HOUR_MS;
const TZ_OFFSET_MS = 5 * HOUR_MS; // Asia/Tashkent, no DST

const scheduleOf = (team) => SCHEDULES[team] || DEFAULT_SCHEDULE;

/**
 * Seconds of [fromMs, toMs] that fall inside the schedule's working window, summed over
 * every day the range touches. 0 when the range is empty or entirely out of hours.
 */
function workSeconds(fromMs, toMs, [startHour, endHour] = DEFAULT_SCHEDULE) {
  if (!(toMs > fromMs)) return 0;
  let total = 0;
  const firstDay = Math.floor((fromMs + TZ_OFFSET_MS) / DAY_MS);
  const lastDay = Math.floor((toMs + TZ_OFFSET_MS) / DAY_MS);
  for (let day = firstDay; day <= lastDay; day++) {
    if (OFF_WEEKDAYS.includes((day + 4) % 7)) continue; // 1970-01-01 was a Thursday (4)
    const dayStart = day * DAY_MS - TZ_OFFSET_MS;       // that day's local midnight, in UTC ms
    const open = dayStart + startHour * HOUR_MS;
    const close = dayStart + endHour * HOUR_MS;
    total += Math.max(0, Math.min(toMs, close) - Math.max(fromMs, open));
  }
  return Math.round(total / 1000);
}

/** For the API/UI: "TLC 09:00-20:00 · TIS 09:00-19:00 · TL 08:00-18:00", plus the default. */
function describeSchedules() {
  const hh = (h) => `${String(h).padStart(2, '0')}:00`;
  const out = { default: DEFAULT_SCHEDULE.map(hh).join('-') };
  for (const [team, [s, e]] of Object.entries(SCHEDULES)) out[team] = `${hh(s)}-${hh(e)}`;
  return out;
}

module.exports = { SCHEDULES, DEFAULT_SCHEDULE, OFF_WEEKDAYS, scheduleOf, workSeconds, describeSchedules };

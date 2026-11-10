/** Seconds in words: 24 → "24 s", 474 → "7 daq 54 s", 2400 → "40 daq", 7600 → "2 soat 7 daq". */
export function fmtSecs(secs: number | null | undefined): string {
  if (secs == null) return "—";
  const v = Math.round(secs);
  if (v < 60) return `${v} s`;
  if (v < 600) return `${Math.floor(v / 60)} daq${v % 60 ? ` ${v % 60} s` : ""}`;
  if (v < 3600) return `${Math.round(v / 60)} daq`;
  const h = Math.floor(v / 3600), m = Math.round((v % 3600) / 60);
  return m ? `${h} soat ${m} daq` : `${h} soat`;
}

/**
 * A total of time, as a clock: 1:28:32 / 28:53 / 0:41 — for sums (Suhbat vaqti) and table cells.
 * Averages and waits use fmtSecs ("1 daq 37 s"). `zero` is what 0 shows ("0:00" by default).
 */
export function fmtClock(secs: number | null | undefined, zero = "0:00"): string {
  if (secs == null) return "—";
  const v = Math.round(secs);
  if (!v) return zero;
  const h = Math.floor(v / 3600), m = Math.floor((v % 3600) / 60), s = v % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

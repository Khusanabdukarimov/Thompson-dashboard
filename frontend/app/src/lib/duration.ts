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

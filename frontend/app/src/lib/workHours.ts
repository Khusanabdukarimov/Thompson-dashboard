/**
 * "TLC 09:00-20:00 · TIS 09:00-19:00 · TL 08:00-18:00 · boshqa 08:00-20:00": the working
 * hours the backend measured "Reaksiya vaqti" against (`work_hours` in its responses), so
 * the wording on screen can never drift from the numbers.
 */
export function describeWorkHours(wh?: Record<string, string> | null): string {
  if (!wh) return "";
  const teams = Object.entries(wh).filter(([k]) => k !== "default").map(([k, v]) => `${k} ${v}`);
  return [...teams, ...(wh.default ? [`boshqa ${wh.default}`] : [])].join(" · ");
}

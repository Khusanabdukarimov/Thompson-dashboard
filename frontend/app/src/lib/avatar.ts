/**
 * Deterministic avatar color from name.
 * Returns Tailwind-compatible classes for the bg + text color.
 */
const PALETTE: { bg: string; text: string }[] = [
  { bg: '#dbeafe', text: '#2266f5' }, // blue
  { bg: '#ccfbf1', text: '#0d9488' }, // teal
  { bg: '#ede9fe', text: '#7c3aed' }, // purple
  { bg: '#dcfce7', text: '#04966b' }, // green
  { bg: '#fef9c3', text: '#c97a07' }, // amber
  { bg: '#fff7ed', text: '#e26113' }, // orange
  { bg: '#fef2f2', text: '#d83a3a' }, // red
];

export function avatarColor(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(s => s[0]?.toUpperCase() ?? '')
    .join('') || '?';
}

import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function fmtNum(n: number | null | undefined) {
  if (n == null || Number.isNaN(n)) return '—';
  return new Intl.NumberFormat('ru-RU').format(n);
}

export function fmtMoney(n: number | null | undefined) {
  if (n == null || Number.isNaN(n)) return '—';
  if (Math.abs(n) >= 1_000_000) return '$' + (n / 1_000_000).toFixed(1) + 'M';
  return '$' + fmtNum(Math.round(n));
}

export function fmtPct(n: number | null | undefined, digits = 1) {
  if (n == null || Number.isNaN(n)) return '—';
  return n.toFixed(digits) + '%';
}

const UZ_MONTHS_SHORT = ['Yan', 'Fev', 'Mar', 'Apr', 'May', 'Iyn', 'Iyl', 'Avg', 'Sen', 'Okt', 'Noy', 'Dek'];
const UZ_MONTHS_LONG = ['Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'Iyun', 'Iyul', 'Avgust', 'Sentabr', 'Oktabr', 'Noyabr', 'Dekabr'];

/**
 * Format ISO date string. Modes:
 * - 'short':  "25 Apr"
 * - 'medium': "25 Apr 2026"  (default)
 * - 'long':   "25 Aprel 2026"
 * - 'numeric':"25.04.2026"
 */
export function fmtDate(iso?: string | null, mode: 'short' | 'medium' | 'long' | 'numeric' = 'medium'): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const day = d.getDate();
  const m = d.getMonth();
  const y = d.getFullYear();
  switch (mode) {
    case 'short':   return `${day} ${UZ_MONTHS_SHORT[m]}`;
    case 'long':    return `${day} ${UZ_MONTHS_LONG[m]} ${y}`;
    case 'numeric': return `${String(day).padStart(2, '0')}.${String(m + 1).padStart(2, '0')}.${y}`;
    default:        return `${day} ${UZ_MONTHS_SHORT[m]} ${y}`;
  }
}

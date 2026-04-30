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

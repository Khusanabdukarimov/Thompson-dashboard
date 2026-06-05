export function fmtUzs(n: number) {
  return new Intl.NumberFormat('uz-UZ').format(Math.round(n)) + ' so\'m';
}
export function fmtUsd(n: number) {
  return '$' + new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(n);
}
export function fmtNum(n: number) {
  return new Intl.NumberFormat('en-US').format(n);
}

const MONTHS_UZ = ['Yanvar','Fevral','Mart','Aprel','May','Iyun','Iyul','Avgust','Sentabr','Oktabr','Noyabr','Dekabr'];
export function monthLabel(month: number, year: number) {
  return `${MONTHS_UZ[month - 1]} ${year}`;
}

export function cn(...classes: (string | false | null | undefined)[]) {
  return classes.filter(Boolean).join(' ');
}

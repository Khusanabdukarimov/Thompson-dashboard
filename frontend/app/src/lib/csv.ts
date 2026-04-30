/**
 * Simple CSV export helper.
 *
 * downloadCsv(filename, rows, columns?)
 *   rows: array of plain objects
 *   columns: optional array of {key, label} — if omitted, uses all keys from first row
 */
export type CsvColumn = { key: string; label?: string };

function escapeCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (/[",\n\r;]/.test(s)) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

export function rowsToCsv(rows: Record<string, unknown>[], columns?: CsvColumn[]): string {
  if (rows.length === 0) return '';
  const cols = columns ?? Object.keys(rows[0]).map(k => ({ key: k, label: k }));
  const header = cols.map(c => escapeCell(c.label ?? c.key)).join(',');
  const lines = rows.map(r => cols.map(c => escapeCell(r[c.key])).join(','));
  return [header, ...lines].join('\n');
}

export function downloadCsv(filename: string, rows: Record<string, unknown>[], columns?: CsvColumn[]) {
  const csv = rowsToCsv(rows, columns);
  // BOM for Excel UTF-8 detection
  const blob = new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

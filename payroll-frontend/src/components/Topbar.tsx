import { Bell, Settings } from 'lucide-react';
import { monthLabel } from '../lib/utils';

type Props = {
  title: string;
  breadcrumb?: string;
  month?: number;
  year?: number;
  onMonthChange?: (m: number, y: number) => void;
};

const MONTHS = [
  'Yanvar','Fevral','Mart','Aprel','May','Iyun',
  'Iyul','Avgust','Sentabr','Oktabr','Noyabr','Dekabr',
];

export function Topbar({ title, breadcrumb, month, year, onMonthChange }: Props) {
  const now = new Date();
  const m = month ?? now.getMonth() + 1;
  const y = year ?? now.getFullYear();

  return (
    <header style={{
      height: 60, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '0 24px', background: 'var(--card-bg)', borderBottom: '1px solid var(--border)',
      position: 'sticky', top: 0, zIndex: 10,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <h1 style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)' }}>{title}</h1>
        {breadcrumb && <span style={{ color: 'var(--text-muted)', fontSize: 14 }}>/ {breadcrumb}</span>}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {onMonthChange && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <select
              value={m}
              onChange={e => onMonthChange(Number(e.target.value), y)}
              style={{ border: '1px solid var(--border)', borderRadius: 6, padding: '5px 10px', fontSize: 13, background: '#fff' }}
            >
              {MONTHS.map((mo, i) => <option key={i} value={i + 1}>{mo}</option>)}
            </select>
            <select
              value={y}
              onChange={e => onMonthChange(m, Number(e.target.value))}
              style={{ border: '1px solid var(--border)', borderRadius: 6, padding: '5px 10px', fontSize: 13, background: '#fff' }}
            >
              {[2024, 2025, 2026, 2027].map(yr => <option key={yr} value={yr}>{yr}</option>)}
            </select>
          </div>
        )}
        {month && !onMonthChange && (
          <span style={{
            display: 'flex', alignItems: 'center', gap: 6, padding: '5px 12px',
            border: '1px solid var(--accent)', borderRadius: 6, color: 'var(--accent)', fontSize: 13, fontWeight: 600,
          }}>
            {monthLabel(m, y)}
          </span>
        )}
        <button style={{ color: 'var(--text-muted)', padding: 6, borderRadius: 6 }}>
          <Bell size={18} />
        </button>
        <button style={{ color: 'var(--text-muted)', padding: 6, borderRadius: 6 }}>
          <Settings size={18} />
        </button>
      </div>
    </header>
  );
}

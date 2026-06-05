import type { ReactNode } from 'react';
import { Card } from './Card';

type Props = {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  icon?: ReactNode;
  color?: string;
};

export function MetricCard({ label, value, sub, icon, color }: Props) {
  return (
    <Card style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 8, position: 'relative', overflow: 'hidden' }}>
      {icon && (
        <div style={{
          position: 'absolute', right: 20, top: 20, opacity: 0.08, fontSize: 48, color: color || 'var(--accent)',
        }}>
          {icon}
        </div>
      )}
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        {label}
      </div>
      <div style={{ fontSize: 28, fontWeight: 700, color: color || 'var(--text)', lineHeight: 1 }}>
        {value}
      </div>
      {sub && (
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{sub}</div>
      )}
    </Card>
  );
}

import type { ReactNode, CSSProperties } from 'react';

type Props = { children: ReactNode; style?: CSSProperties; className?: string };

export function Card({ children, style, className }: Props) {
  return (
    <div
      className={className}
      style={{
        background: 'var(--card-bg)', borderRadius: 'var(--radius)',
        boxShadow: 'var(--shadow)', border: '1px solid var(--border)',
        ...style,
      }}
    >
      {children}
    </div>
  );
}

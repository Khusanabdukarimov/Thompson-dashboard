import type { ReactNode, ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'outline' | 'ghost' | 'danger';

const VARIANTS: Record<Variant, React.CSSProperties> = {
  primary: { background: 'var(--accent)', color: '#fff', border: 'none' },
  outline: { background: '#fff', color: 'var(--accent)', border: '1px solid var(--accent)' },
  ghost:   { background: 'transparent', color: 'var(--text-muted)', border: '1px solid var(--border)' },
  danger:  { background: '#fee2e2', color: 'var(--red)', border: 'none' },
};

type Props = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; children: ReactNode; small?: boolean };

export function Btn({ variant = 'primary', children, small, style, ...rest }: Props) {
  return (
    <button
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        padding: small ? '5px 12px' : '8px 16px',
        borderRadius: 8, fontSize: small ? 12 : 13, fontWeight: 600,
        cursor: rest.disabled ? 'not-allowed' : 'pointer',
        opacity: rest.disabled ? 0.6 : 1,
        transition: 'opacity .15s',
        ...VARIANTS[variant],
        ...style,
      }}
      {...rest}
    >
      {children}
    </button>
  );
}

type Tone = 'blue' | 'green' | 'red' | 'amber' | 'purple' | 'gray';

const TONES: Record<Tone, { bg: string; color: string }> = {
  blue:   { bg: '#dbeafe', color: '#1d4ed8' },
  green:  { bg: '#dcfce7', color: '#15803d' },
  red:    { bg: '#fee2e2', color: '#b91c1c' },
  amber:  { bg: '#fef3c7', color: '#92400e' },
  purple: { bg: '#ede9fe', color: '#6d28d9' },
  gray:   { bg: '#f1f5f9', color: '#475569' },
};

type Props = { label: string; tone?: Tone };

export function Badge({ label, tone = 'gray' }: Props) {
  const { bg, color } = TONES[tone];
  return (
    <span style={{
      display: 'inline-block', padding: '2px 8px', borderRadius: 4,
      fontSize: 12, fontWeight: 600, background: bg, color,
    }}>
      {label}
    </span>
  );
}

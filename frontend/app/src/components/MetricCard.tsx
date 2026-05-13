import { cn } from '@/lib/utils';

type Tone = 'default' | 'blue' | 'green' | 'amber' | 'red' | 'orange' | 'purple';
type Size = 'default' | 'lg' | 'sm';

const toneClass: Record<Tone, string> = {
  default: 'text-text',
  blue: 'text-blue',
  green: 'text-green',
  amber: 'text-amber',
  red: 'text-red',
  orange: 'text-orange',
  purple: 'text-purple',
};

const sizeClass: Record<Size, { wrap: string; label: string; value: string; hint: string }> = {
  default: {
    wrap: 'px-4 py-3.5',
    label: 'text-[11px] mb-2',
    value: 'text-[28px] leading-tight',
    hint: 'text-[11px] mt-1.5',
  },
  lg: {
    wrap: 'px-5 py-4',
    label: 'text-[11px] mb-2',
    value: 'text-[36px] leading-[1.1]',
    hint: 'text-[12px] mt-2',
  },
  sm: {
    wrap: 'px-3 py-2.5',
    label: 'text-[10px] mb-1',
    value: 'text-[20px] leading-tight',
    hint: 'text-[10px] mt-0.5',
  },
};

export function MetricCard({
  label, value, hint, tone = 'default', size = 'default',
}: { label: string; value: string; hint?: string; tone?: Tone; size?: Size }) {
  const s = sizeClass[size];
  return (
    <div className={cn('bg-bg2 border border-border rounded-lg shadow', s.wrap)}>
      <div className={cn('text-text3 uppercase tracking-wider font-medium', s.label)}>{label}</div>
      <div className={cn('display font-bold mono', s.value, toneClass[tone])}>{value}</div>
      {hint && <div className={cn('text-text3', s.hint)}>{hint}</div>}
    </div>
  );
}

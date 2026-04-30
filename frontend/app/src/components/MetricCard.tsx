import { cn } from '@/lib/utils';

type Tone = 'default' | 'blue' | 'green' | 'amber' | 'red' | 'orange';
const toneClass: Record<Tone, string> = {
  default: 'text-text',
  blue: 'text-blue',
  green: 'text-green',
  amber: 'text-amber',
  red: 'text-red',
  orange: 'text-orange',
};

export function MetricCard({
  label, value, hint, tone = 'default',
}: { label: string; value: string; hint?: string; tone?: Tone }) {
  return (
    <div className="bg-bg2 border border-border rounded-lg px-4 py-3.5 shadow">
      <div className="text-[11px] text-text3 uppercase tracking-wider mb-1.5 font-medium">{label}</div>
      <div className={cn('text-[22px] font-semibold mono', toneClass[tone])}>{value}</div>
      {hint && <div className="text-[11px] text-text3 mt-1">{hint}</div>}
    </div>
  );
}

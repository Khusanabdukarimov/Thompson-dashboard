import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

type Tone = 'green' | 'amber' | 'red' | 'blue' | 'orange' | 'purple' | 'gray';
const toneClass: Record<Tone, string> = {
  green:  'bg-green-bg  text-green  border-green-bd',
  amber:  'bg-amber-bg  text-amber  border-amber-bd',
  red:    'bg-red-bg    text-red    border-red-bd',
  blue:   'bg-blue-bg   text-blue   border-blue-bd',
  orange: 'bg-orange-bg text-orange border-orange-bd',
  purple: 'bg-purple-bg text-purple border-purple-bd',
  gray:   'bg-bg3       text-text2  border-border',
};

export function Badge({ tone = 'gray', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={cn(
      'inline-flex items-center px-2 py-px rounded-full text-[10.5px] font-semibold whitespace-nowrap border',
      toneClass[tone],
      className,
    )}>{children}</span>
  );
}

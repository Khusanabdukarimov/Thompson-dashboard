import { forwardRef } from 'react';
import type { ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

type Variant = 'default' | 'primary' | 'danger' | 'ghost';
type Size = 'default' | 'sm';

const variantClass: Record<Variant, string> = {
  default: 'bg-bg2 border-border2 text-text hover:bg-bg3 shadow',
  primary: 'bg-blue-2 border-blue-2 text-white shadow-[0_1px_3px_rgba(29,78,216,0.3)] hover:bg-[#1e40af]',
  danger:  'bg-red-bg border-red-bd text-red hover:bg-red-bg',
  ghost:   'bg-transparent border-transparent text-text2 hover:bg-bg3 hover:text-text',
};

const sizeClass: Record<Size, string> = {
  default: 'px-3.5 py-1.5 text-[12px]',
  sm:      'px-2.5 py-1   text-[11px]',
};

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size }>(
  function Button({ className, variant = 'default', size = 'default', ...props }, ref) {
    return (
      <button
        ref={ref}
        className={cn(
          'inline-flex items-center justify-center gap-1.5 rounded font-medium border transition-colors whitespace-nowrap cursor-pointer',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-blue/40',
          'disabled:opacity-50 disabled:cursor-not-allowed',
          variantClass[variant],
          sizeClass[size],
          className,
        )}
        {...props}
      />
    );
  },
);

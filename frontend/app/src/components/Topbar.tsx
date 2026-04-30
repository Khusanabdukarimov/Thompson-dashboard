import type { ReactNode } from 'react';

export function Topbar({ title, sub, actions }: { title: string; sub?: string; actions?: ReactNode }) {
  return (
    <div className="px-4 md:px-[22px] py-[13px] border-b border-border flex items-center justify-between gap-3 bg-bg2 shrink-0 shadow">
      {/* Title + sub. Padded on mobile to avoid overlap with burger button. */}
      <div className="min-w-0 pl-12 md:pl-0">
        <div className="text-[15px] md:text-[16px] font-semibold text-text truncate">{title}</div>
        {sub && <div className="text-[11px] text-text3 mt-px truncate">{sub}</div>}
      </div>
      {actions && (
        <div className="flex gap-1.5 items-center overflow-x-auto whitespace-nowrap scrollbar-hide">
          {actions}
        </div>
      )}
    </div>
  );
}

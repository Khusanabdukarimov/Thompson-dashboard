import type { ReactNode } from 'react';

export function Topbar({ title, sub, actions }: { title: string; sub?: string; actions?: ReactNode }) {
  return (
    <div className="px-[22px] py-[13px] border-b border-border flex items-center justify-between bg-bg2 shrink-0 shadow">
      <div>
        <div className="text-[16px] font-semibold text-text">{title}</div>
        {sub && <div className="text-[11px] text-text3 mt-px">{sub}</div>}
      </div>
      {actions && <div className="flex gap-1.5 items-center">{actions}</div>}
    </div>
  );
}

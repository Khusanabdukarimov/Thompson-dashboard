import type { ReactNode } from 'react';
import { Inbox } from 'lucide-react';

export function EmptyState({
  icon, title, hint, action,
}: { icon?: ReactNode; title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="text-center py-10 px-4">
      <div className="w-12 h-12 rounded-full bg-bg3 flex items-center justify-center mx-auto mb-3 text-text3">
        {icon ?? <Inbox className="w-5 h-5" />}
      </div>
      <div className="text-[13px] font-semibold text-text mb-1">{title}</div>
      {hint && <div className="text-[12px] text-text3 mb-3 max-w-md mx-auto">{hint}</div>}
      {action}
    </div>
  );
}

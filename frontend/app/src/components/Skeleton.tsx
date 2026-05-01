import { cn } from '@/lib/utils';

export function Skeleton({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return <div className={cn('skeleton', className)} style={style} />;
}

export function MetricCardSkeleton() {
  return (
    <div className="bg-bg2 border border-border rounded-lg px-4 py-3.5 shadow">
      <Skeleton className="h-2.5 w-20 mb-3" />
      <Skeleton className="h-7 w-32 mb-2" />
      <Skeleton className="h-2.5 w-16" />
    </div>
  );
}

export function MetricRowSkeleton({ count = 5 }: { count?: number }) {
  return (
    <div className={`grid gap-2.5 mb-4`} style={{ gridTemplateColumns: `repeat(${count}, 1fr)` }}>
      {Array.from({ length: count }).map((_, i) => <MetricCardSkeleton key={i} />)}
    </div>
  );
}

export function ChartCardSkeleton({ height = 240 }: { height?: number }) {
  return (
    <div className="bg-bg2 border border-border rounded-lg shadow overflow-hidden">
      <div className="px-4 py-3 border-b border-border flex items-center justify-between">
        <Skeleton className="h-3 w-32" />
        <Skeleton className="h-3 w-16" />
      </div>
      <div className="p-3 flex items-end gap-1.5" style={{ height }}>
        {Array.from({ length: 12 }).map((_, i) => (
          <Skeleton
            key={i}
            className="flex-1"
            style={{ height: `${30 + Math.abs(Math.sin(i * 1.7)) * 60}%` }}
          />
        ))}
      </div>
    </div>
  );
}

export function FunnelSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-2 px-1">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton className="h-3 w-32 shrink-0" />
          <Skeleton className="h-7 flex-1 rounded" style={{ opacity: 1 - i * 0.15 }} />
          <Skeleton className="h-3 w-12 shrink-0" />
        </div>
      ))}
    </div>
  );
}

export function DataTableSkeleton({ rows = 6, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div className="bg-bg2 border border-border rounded-lg overflow-hidden shadow">
      {/* header */}
      <div className="bg-bg3 border-b border-border px-4 py-2.5 flex gap-4">
        {Array.from({ length: cols }).map((_, i) => (
          <Skeleton key={i} className="h-2.5 flex-1" style={{ maxWidth: i === 0 ? 160 : 100 }} />
        ))}
      </div>
      {/* rows */}
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="border-b border-border last:border-0 px-4 py-3 flex items-center gap-4">
          {Array.from({ length: cols }).map((_, c) => (
            <div key={c} className="flex-1" style={{ maxWidth: c === 0 ? 160 : 100 }}>
              {c === 0 ? (
                <div className="flex items-center gap-2.5">
                  <Skeleton className="h-7 w-7 rounded-full shrink-0" />
                  <Skeleton className="h-3 flex-1" />
                </div>
              ) : (
                <Skeleton className="h-3" />
              )}
            </div>
          ))}
        </div>
      ))}
      {/* footer */}
      <div className="border-t border-border px-4 py-2.5 flex justify-between">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-3 w-32" />
      </div>
    </div>
  );
}

export function CardListSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="bg-bg2 border border-border rounded-lg shadow overflow-hidden">
      <div className="px-4 py-3 border-b border-border">
        <Skeleton className="h-3 w-32" />
      </div>
      <div className="p-3 space-y-2">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 py-1.5">
            <Skeleton className="h-3 flex-1" style={{ maxWidth: 140 + (i % 3) * 30 }} />
            <Skeleton className="h-1.5 w-24" />
            <Skeleton className="h-3 w-10" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function GridCardsSkeleton({ count = 6, cols = 3 }: { count?: number; cols?: number }) {
  return (
    <div className={`grid gap-2.5`} style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="bg-bg2 border border-border rounded-lg p-3 flex items-center gap-2.5 shadow">
          <Skeleton className="h-9 w-9 rounded-full shrink-0" />
          <div className="flex-1 min-w-0">
            <Skeleton className="h-3 w-3/4 mb-1.5" />
            <Skeleton className="h-2.5 w-1/2" />
          </div>
          <Skeleton className="h-5 w-16 rounded-full shrink-0" />
        </div>
      ))}
    </div>
  );
}

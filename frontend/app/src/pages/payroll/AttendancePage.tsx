import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Topbar } from '@/components/Topbar';
import { Button } from '@/components/Button';
import { Badge } from '@/components/Badge';
import { Avatar } from '@/components/Avatar';
import { MetricCard } from '@/components/MetricCard';
import { MetricRowSkeleton, GridCardsSkeleton } from '@/components/Skeleton';
import { listTimeman } from '@/lib/api/payroll';
import type { TimemanUser } from '@/lib/api/payroll';

type Bucket = 'opened' | 'paused' | 'closed' | 'unknown';

function classifyTimeman(u: TimemanUser): { bucket: Bucket; label: string; tone: 'green' | 'amber' | 'gray' | 'red' } {
  const t = u.timeman as unknown;
  let status: string | null | undefined = null;
  if (t && typeof t === 'object' && 'STATUS' in (t as object)) {
    status = (t as { STATUS?: string }).STATUS ?? null;
  } else if (typeof t === 'string') {
    status = t;
  }
  switch (status) {
    case 'OPENED': return { bucket: 'opened', label: 'Ishda',     tone: 'green' };
    case 'PAUSED': return { bucket: 'paused', label: 'Pauza',     tone: 'amber' };
    case 'CLOSED': return { bucket: 'closed', label: 'Yakunladi', tone: 'gray'  };
    default:       return { bucket: 'unknown', label: 'Belgilanmagan', tone: 'gray' };
  }
}

const TABS: { id: 'all' | Bucket; label: (n: Record<string, number>) => string }[] = [
  { id: 'all',     label: (n) => `Barchasi (${n.all ?? 0})` },
  { id: 'opened',  label: (n) => `Ishda (${n.opened ?? 0})` },
  { id: 'paused',  label: (n) => `Pauza (${n.paused ?? 0})` },
  { id: 'closed',  label: (n) => `Yakunladi (${n.closed ?? 0})` },
  { id: 'unknown', label: (n) => `Belgilanmagan (${n.unknown ?? 0})` },
];

export default function AttendancePage() {
  const [tab, setTab] = useState<'all' | Bucket>('all');

  const q = useQuery({
    queryKey: ['users/timeman'],
    queryFn: listTimeman,
    refetchInterval: 15_000,
    refetchIntervalInBackground: false,
  });

  const users = q.data?.users ?? [];

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: users.length, opened: 0, paused: 0, closed: 0, unknown: 0 };
    for (const u of users) c[classifyTimeman(u).bucket]++;
    return c;
  }, [users]);

  const filtered = useMemo(() => {
    if (tab === 'all') return users;
    return users.filter(u => classifyTimeman(u).bucket === tab);
  }, [users, tab]);

  const today = new Date().toLocaleDateString('uz-UZ', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  return (
    <>
      <Topbar
        title="Davomat"
        sub={`${today} · Bitrix24 timeman.status orqali realtime (15s da yangilanadi)`}
        actions={<Button onClick={() => q.refetch()}>{q.isFetching ? 'Yangilanmoqda…' : 'Yangilash'}</Button>}
      />
      <div className="flex-1 overflow-y-auto px-[22px] py-[18px] bg-bg">
        {q.isLoading && !q.data ? <MetricRowSkeleton count={5} /> : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5 mb-4">
            <MetricCard label="Jami xodim" value={String(counts.all)} tone="blue" />
            <MetricCard label="Ishda" value={String(counts.opened)} tone="green" />
            <MetricCard label="Pauza" value={String(counts.paused)} tone="amber" />
            <MetricCard label="Yakunladi" value={String(counts.closed)} tone="default" />
            <MetricCard label="Belgilanmagan" value={String(counts.unknown)} tone="default" />
          </div>
        )}

        <div className="flex flex-wrap gap-1.5 mb-3">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-3.5 py-1.5 rounded-full text-[11.5px] font-medium border transition-colors ${
                tab === t.id
                  ? 'bg-blue-bg text-blue border-blue-bd font-semibold'
                  : 'bg-bg2 text-text2 border-border hover:bg-bg3'
              }`}
            >{t.label(counts)}</button>
          ))}
        </div>

        {q.isLoading && !q.data ? <GridCardsSkeleton count={9} cols={3} /> : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
          {filtered.length === 0 && (
            <div className="col-span-3 text-center text-text3 text-[12.5px] py-12 bg-bg2 border border-border rounded-lg">
              Hech narsa topilmadi
            </div>
          )}
          {filtered.map(u => {
            const c = classifyTimeman(u);
            return (
              <div key={u.id} className="bg-bg2 border border-border rounded-lg p-3 flex items-center gap-2.5 shadow hover:shadow-md hover:border-blue-bd transition-all">
                <Avatar name={u.name || `User ${u.id}`} size={38} />
                <div className="flex-1 min-w-0">
                  <div className="text-[12.5px] font-semibold truncate">{u.name || `User ${u.id}`}</div>
                  <div className="text-[11px] text-text3 truncate">{u.work_position || '—'}</div>
                </div>
                <Badge tone={c.tone}>{c.label}</Badge>
              </div>
            );
          })}
        </div>
        )}

        {q.error && (
          <div className="mt-4 p-3 bg-red-bg border border-red-bd text-red rounded-lg text-[12.5px]">
            Xatolik: {(q.error as Error).message}
          </div>
        )}
      </div>
    </>
  );
}

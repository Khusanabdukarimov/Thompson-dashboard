import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Topbar } from '@/components/Topbar';
import { Button } from '@/components/Button';
import { Skeleton } from '@/components/Skeleton';
import { listTimeman } from '@/lib/api/payroll';
import type { TimemanUser } from '@/lib/api/payroll';

// Bitrix24 xodimlar — faqat shu xodimlar ko'rinadi
const TARGET_NAMES = [
  'davlatyor',
  'shaxzod', 'yormatov',
  'shaxod',  'turonov',
  'samandar', 'samadov',
  'temurmalik', 'xoshimjonov',
  'bekzod', 'ergashev',
  'muxriddin', 'atoullayev',
];

function matchesTarget(name: string): boolean {
  const lower = name.toLowerCase();
  return TARGET_NAMES.some(t => lower.includes(t));
}

function getTimemanStatus(u: TimemanUser): 'OPENED' | 'PAUSED' | 'CLOSED' | null {
  const t = u.timeman as unknown;
  if (t && typeof t === 'object' && 'STATUS' in (t as object)) {
    return (t as { STATUS?: string }).STATUS as 'OPENED' | 'PAUSED' | 'CLOSED' ?? null;
  }
  if (typeof t === 'string') return t as 'OPENED' | 'PAUSED' | 'CLOSED';
  return null;
}

function getCheckInTime(u: TimemanUser): string | null {
  const t = u.timeman as unknown;
  if (t && typeof t === 'object') {
    const obj = t as Record<string, unknown>;
    if (obj.TIME_START && typeof obj.TIME_START === 'string') {
      try {
        const d = new Date(obj.TIME_START);
        return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
      } catch { return null; }
    }
  }
  return null;
}

// Business days count from month start to today
function businessDaysThisMonth(): number {
  const now = new Date();
  let count = 0;
  const d = new Date(now.getFullYear(), now.getMonth(), 1);
  while (d <= now) {
    const day = d.getDay();
    if (day !== 0 && day !== 6) count++;
    d.setDate(d.getDate() + 1);
  }
  return count;
}

// Check if late (after 09:15)
function isLate(checkIn: string | null): boolean {
  if (!checkIn) return false;
  const [h, m] = checkIn.split(':').map(Number);
  return h > 9 || (h === 9 && m > 15);
}

function getLateMinutes(checkIn: string | null): number {
  if (!checkIn) return 0;
  const [h, m] = checkIn.split(':').map(Number);
  const totalMin = h * 60 + m;
  const scheduleMin = 9 * 60;
  return Math.max(0, totalMin - scheduleMin);
}

export default function AttendancePage() {
  const now = new Date();
  const monthLabel = now.toLocaleString('uz-UZ', { month: 'long', year: 'numeric' });
  const workDays = businessDaysThisMonth();

  const q = useQuery({
    queryKey: ['users/timeman'],
    queryFn: listTimeman,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });

  const allUsers = q.data?.users ?? [];

  // Filter to target employees only
  const users = useMemo(() =>
    allUsers.filter(u => matchesTarget(u.name || '')),
    [allUsers]
  );

  // Build row data
  type Row = {
    id: number;
    name: string;
    position: string;
    ishlagan: number;
    kechikishlar_soni: number;
    kechikishlar_daq: number;
    erta_ketish: number;
    jami_soat: number;
    status: 'tayyor' | 'toliq_emas';
    timeman: 'OPENED' | 'PAUSED' | 'CLOSED' | null;
  };

  const rows: Row[] = useMemo(() => users.map(u => {
    const tmStatus = getTimemanStatus(u);
    const checkIn = getCheckInTime(u);
    const late = isLate(checkIn);
    const lateMin = getLateMinutes(checkIn);
    const isClosed = tmStatus === 'CLOSED';
    const isOpen = tmStatus === 'OPENED';
    return {
      id: Number(u.id),
      name: u.name || `User ${u.id}`,
      position: u.work_position || '—',
      ishlagan: workDays,
      kechikishlar_soni: late ? 1 : 0,
      kechikishlar_daq: lateMin,
      erta_ketish: 0,
      jami_soat: workDays * 8,
      status: (isClosed || isOpen) && !late ? 'tayyor' : 'toliq_emas',
      timeman: tmStatus,
    };
  }), [users, workDays]);

  const tayyor = rows.filter(r => r.status === 'tayyor').length;
  const toliqEmas = rows.filter(r => r.status === 'toliq_emas').length;
  const avgPct = rows.length ? Math.round((tayyor / rows.length) * 100) : 0;

  return (
    <>
      <Topbar
        title={`${monthLabel} Davomat Hisoboti`}
        sub="Bitrix24 timeman orqali"
        actions={<Button onClick={() => q.refetch()}>{q.isFetching ? 'Yangilanmoqda…' : 'Yangilash'}</Button>}
      />
      <div className="flex-1 overflow-y-auto px-[22px] py-[18px] bg-bg">

        {/* Back + Title */}
        <div className="flex items-center gap-3 mb-5">
          <h2 className="text-[17px] font-bold text-text">Davomat Hisobotini Shakllantirish</h2>
        </div>

        {/* 4 Stat cards */}
        <div className="grid grid-cols-4 gap-4 mb-6">
          {[
            { label: 'Jami Xodimlar',           value: q.isLoading ? '—' : rows.length },
            { label: 'Jami Ish Kunlari',         value: workDays },
            { label: "O'rtacha Davomat (%)",     value: q.isLoading ? '—' : `${avgPct}%` },
            { label: 'Kutilayotgan Tuzatishlar', value: q.isLoading ? '—' : toliqEmas },
          ].map(c => (
            <div key={c.label} className="bg-bg2 border border-border rounded-xl p-4">
              <div className="text-[12px] text-text3 mb-2">{c.label}</div>
              {q.isLoading
                ? <Skeleton className="h-8 w-16" />
                : <div className="text-[28px] font-bold text-text">{c.value}</div>
              }
            </div>
          ))}
        </div>

        {/* Table */}
        <div className="bg-bg2 border border-border rounded-xl overflow-hidden mb-5">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="bg-bg3 border-b border-border">
                {['Xodim', 'Ishlagan kunlar', 'Kechikishlar (soni/daq)', 'Erta ketishlar', 'Jami soatlar', 'Status', ''].map(h => (
                  <th key={h} className="px-5 py-3 text-left text-[11px] font-semibold text-text2">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {q.isLoading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i} className="border-b border-border">
                    {Array.from({ length: 7 }).map((__, j) => (
                      <td key={j} className="px-5 py-3.5"><Skeleton className="h-4 w-16" /></td>
                    ))}
                  </tr>
                ))
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-5 py-12 text-center text-text3">
                    {allUsers.length === 0 ? 'Bitrix24 ma\'lumotlari yuklanmadi' : 'Belgilangan xodimlar topilmadi'}
                  </td>
                </tr>
              ) : rows.map(row => (
                <tr key={row.id} className="border-b border-border hover:bg-bg3 transition-colors">
                  <td className="px-5 py-3.5 font-medium text-text">{row.name}</td>
                  <td className="px-5 py-3.5 text-text2">{row.ishlagan}</td>
                  <td className="px-5 py-3.5 text-text2">
                    {row.kechikishlar_soni}/{row.kechikishlar_daq}
                  </td>
                  <td className="px-5 py-3.5 text-text2">{row.erta_ketish}</td>
                  <td className="px-5 py-3.5 text-text2">{row.jami_soat}</td>
                  <td className="px-5 py-3.5">
                    {row.status === 'tayyor' ? (
                      <span className="px-3 py-1 rounded-full text-[12px] font-semibold bg-blue text-white">Tayyor</span>
                    ) : (
                      <span className="px-3 py-1 rounded-full text-[12px] font-semibold bg-red text-white">To'liq emas</span>
                    )}
                  </td>
                  <td className="px-5 py-3.5">
                    <button className="px-3 py-1.5 rounded-lg border border-border text-[12px] font-medium text-text2 hover:bg-bg3 transition-colors">
                      Ko'rib chiqish
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Footer actions */}
        <div className="flex justify-end gap-3">
          <button className="px-5 py-2.5 rounded-lg border border-border bg-bg2 text-[13px] font-semibold text-text2 hover:bg-bg3 flex items-center gap-2 transition-colors">
            📄 Eksport
          </button>
          <button className="px-6 py-2.5 rounded-lg bg-blue text-white text-[13px] font-semibold hover:opacity-90 transition-opacity">
            Hisobotni Yakunlash va Tasdiqlash
          </button>
        </div>

        {q.error && (
          <div className="mt-4 p-3 bg-red-bg border border-red text-red rounded-lg text-[12.5px]">
            Xatolik: {(q.error as Error).message}
          </div>
        )}
      </div>
    </>
  );
}

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Topbar } from '@/components/Topbar';
import { Button } from '@/components/Button';
import { ChartCardSkeleton } from '@/components/Skeleton';
import { getMetaInsights, MONTH_KEYS, MONTH_LABELS } from '@/lib/api/meta';
import type { MonthKey } from '@/lib/api/meta';
import { fmtNum, fmtMoney, fmtPct, cn } from '@/lib/utils';
import { downloadCsv } from '@/lib/csv';

const now = new Date();
const DEFAULT_MONTH = MONTH_KEYS[now.getMonth()];
const DEFAULT_YEAR = now.getFullYear();
const TODAY_DAY = now.getDate();

type SourceKey = 'all' | 'target' | 'instagram';
type Period = 'all' | 'this_week' | 'last_week';

const SOURCE_TABS: { key: SourceKey; label: string }[] = [
  { key: 'all', label: 'Hammasi' },
  { key: 'target', label: 'Target reklama' },
  { key: 'instagram', label: 'Instagram' },
];

const PERIOD_TABS: { key: Period; label: string }[] = [
  { key: 'all', label: 'Barchasi' },
  { key: 'this_week', label: 'Bu hafta' },
  { key: 'last_week', label: "O'tgan hafta" },
];

// Metric rows — ordered by importance (most important on top per user feedback).
// `live: true` = wired to API. `live: false` = backend not yet exposing this field.
type MetricRow = {
  key: string;
  label: string;
  format: 'money' | 'num' | 'pct';
  important?: boolean;
  live: boolean;
};

const METRIC_ROWS: MetricRow[] = [
  { key: 'sales_sum',   label: "Sotuvlar summasi",  format: 'money', important: true, live: false },
  { key: 'roas',        label: 'ROAS',              format: 'pct',   important: true, live: false },
  { key: 'sales_count', label: "Sotuvlar soni",     format: 'num',   important: true, live: false },
  { key: 'budget',      label: 'Byudjet ($)',       format: 'money', important: true, live: true  },
  { key: 'leads',       label: 'Lidlar soni',       format: 'num',                    live: true  },
  { key: 'qual_leads',  label: 'Maqsadli lidlar',   format: 'num',                    live: false },
  { key: 'qual_pct',    label: "Lid→Maq.lid %",     format: 'pct',                    live: false },
  { key: 'meetings',    label: 'Uchrashuvlar',      format: 'num',                    live: false },
  { key: 'deals',       label: 'Kelishuvlar',       format: 'num',                    live: false },
];

const SECTION_META = {
  target:    { label: 'TARGET REKLAMA', color: 'var(--orange)' },
  instagram: { label: 'INSTAGRAM',      color: '#d63384'        },
} as const;

function daysInMonth(month: MonthKey, year: number): number {
  const idx = MONTH_KEYS.indexOf(month);
  return new Date(year, idx + 1, 0).getDate();
}

function isCurrentMonth(month: MonthKey, year: number) {
  return month === DEFAULT_MONTH && year === DEFAULT_YEAR;
}

function periodMask(month: MonthKey, year: number, period: Period): boolean[] {
  const days = daysInMonth(month, year);
  const mask = new Array<boolean>(days).fill(period === 'all');
  if (period === 'all') return mask;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const mondayOf = (d: Date) => {
    const x = new Date(d);
    const dow = (x.getDay() + 6) % 7; // Mon=0
    x.setDate(x.getDate() - dow);
    return x;
  };
  const start = mondayOf(today);
  if (period === 'last_week') start.setDate(start.getDate() - 7);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);

  for (let d = 1; d <= days; d++) {
    const day = new Date(year, MONTH_KEYS.indexOf(month), d);
    if (day >= start && day <= end) mask[d - 1] = true;
  }
  return mask;
}

function fmtVal(v: number | undefined | null, fmt: MetricRow['format']) {
  if (v == null || Number.isNaN(v)) return '';
  if (fmt === 'money') return fmtMoney(v);
  if (fmt === 'pct')   return fmtPct(v);
  return fmtNum(v);
}

export default function KunlikPage() {
  const [month, setMonth] = useState<MonthKey>(DEFAULT_MONTH);
  const [year, setYear] = useState<number>(DEFAULT_YEAR);
  const [source, setSource] = useState<SourceKey>('all');
  const [period, setPeriod] = useState<Period>('all');

  const q = useQuery({
    queryKey: ['meta/insights', month, year],
    queryFn: () => getMetaInsights(month, year),
  });

  const days = daysInMonth(month, year);
  const mask = useMemo(() => periodMask(month, year, period), [month, year, period]);

  const rowDataBySection = useMemo(() => {
    const m = q.data?.data;
    const empty = new Array(days).fill(undefined);
    const buildSection = (src: 'target' | 'instagram') => {
      const block = m?.[src];
      const budget = block?.budget ?? empty;
      const leads  = block?.leads  ?? empty;
      return {
        budget: budget as (number | undefined)[],
        leads:  leads  as (number | undefined)[],
      };
    };
    return {
      target:    buildSection('target'),
      instagram: buildSection('instagram'),
    };
  }, [q.data, days]);

  const sectionsToShow: ('target' | 'instagram')[] =
    source === 'all'    ? ['target', 'instagram']
    : source === 'target' ? ['target']
    : ['instagram'];

  function valueFor(src: 'target' | 'instagram', metric: MetricRow, dayIdx: number): number | undefined {
    const block = rowDataBySection[src];
    if (metric.key === 'budget') return block.budget[dayIdx];
    if (metric.key === 'leads')  return block.leads[dayIdx];
    return undefined;
  }

  function rowTotal(src: 'target' | 'instagram', metric: MetricRow): number | undefined {
    if (!metric.live) return undefined;
    let sum = 0;
    let any = false;
    for (let i = 0; i < days; i++) {
      if (!mask[i]) continue;
      const v = valueFor(src, metric, i);
      if (typeof v === 'number') { sum += v; any = true; }
    }
    return any ? sum : undefined;
  }

  function exportCsv() {
    const rows: Record<string, unknown>[] = [];
    for (const src of sectionsToShow) {
      for (const metric of METRIC_ROWS) {
        const row: Record<string, unknown> = {
          source: SECTION_META[src].label,
          metric: metric.label,
          oylik:  rowTotal(src, metric) ?? '',
        };
        for (let i = 0; i < days; i++) {
          if (!mask[i]) continue;
          row[`d${i + 1}`] = metric.live ? valueFor(src, metric, i) ?? '' : '';
        }
        rows.push(row);
      }
    }
    const cols = [
      { key: 'source', label: 'Manba' },
      { key: 'metric', label: "Ko'rsatkich" },
      { key: 'oylik',  label: 'Oylik' },
      ...Array.from({ length: days }, (_, i) => ({ key: `d${i + 1}`, label: String(i + 1) }))
              .filter((_, i) => mask[i]),
    ];
    downloadCsv(`kunlik-${month}-${year}.csv`, rows, cols);
  }

  const yearOptions = [DEFAULT_YEAR, DEFAULT_YEAR - 1, DEFAULT_YEAR - 2];

  return (
    <>
      <Topbar
        title="Kunlik hisobot"
        sub={`${MONTH_LABELS[month]} ${year} — kundalik ko'rsatkichlar jadvali`}
        actions={
          <>
            <select
              className="px-2.5 py-1.5 rounded border border-border2 bg-bg2 text-[12px] text-text shadow-xs"
              value={month}
              onChange={(e) => setMonth(e.target.value as MonthKey)}
            >
              {MONTH_KEYS.map(mm => <option key={mm} value={mm}>{MONTH_LABELS[mm]}</option>)}
            </select>
            <select
              className="px-2.5 py-1.5 rounded border border-border2 bg-bg2 text-[12px] text-text shadow-xs"
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
            >
              {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
            <Button onClick={() => q.refetch()}>Yangilash</Button>
          </>
        }
      />
      <div className="flex-1 overflow-y-auto px-[22px] py-[18px] bg-bg">
        {/* Tabs row */}
        <div className="flex items-center justify-between flex-wrap gap-3 mb-3">
          <div className="inline-flex items-center gap-1 bg-bg2 border border-border rounded-full p-1 shadow-xs">
            {SOURCE_TABS.map(t => (
              <button
                key={t.key}
                onClick={() => setSource(t.key)}
                className={cn(
                  'px-4 py-1.5 rounded-full text-[12.5px] font-medium transition-colors',
                  source === t.key ? 'bg-blue-bg text-blue' : 'text-text2 hover:text-text',
                )}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="inline-flex items-center gap-2">
            <span className="text-[12px] text-text3">Davr:</span>
            <div className="inline-flex items-center gap-1 bg-bg2 border border-border rounded-full p-1 shadow-xs">
              {PERIOD_TABS.map(t => (
                <button
                  key={t.key}
                  onClick={() => setPeriod(t.key)}
                  className={cn(
                    'px-3 py-1.5 rounded-full text-[12.5px] font-medium transition-colors',
                    period === t.key ? 'bg-blue text-white' : 'text-text2 hover:text-text',
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {q.isLoading && !q.data ? <ChartCardSkeleton height={520} /> : (
          <div className="bg-bg2 border border-border rounded-lg shadow overflow-hidden">
            <div className="px-4 py-3 border-b border-border flex items-center justify-between flex-wrap gap-2">
              <div>
                <div className="text-[14px] font-semibold">Kunlik ma'lumotlar jadvali</div>
                <div className="text-[11px] text-text3 mt-0.5">
                  Yashil — avtomatik · Sariq — qo'lda · Bo'sh — kiritilmagan · Bugun ustun ko'k bilan ajratilgan
                </div>
              </div>
              <div className="flex items-center gap-3">
                <button onClick={exportCsv} className="text-[12px] text-blue hover:underline">CSV export</button>
                <button onClick={exportCsv} className="text-[12px] text-blue hover:underline">Excel</button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[12px]">
                <thead>
                  <tr className="bg-bg3 text-text3 uppercase tracking-wider text-[10.5px] font-semibold">
                    <th className="text-left px-3 py-2 sticky left-0 bg-bg3 z-10 min-w-[180px] border-b border-border">
                      Manba / Ko'rsatkich
                    </th>
                    <th className="text-right px-3 py-2 min-w-[88px] border-b border-border">Oylik</th>
                    {Array.from({ length: days }, (_, i) => i + 1).map(d => {
                      const isToday = isCurrentMonth(month, year) && d === TODAY_DAY;
                      const dim = !mask[d - 1];
                      return (
                        <th
                          key={d}
                          className={cn(
                            'text-center px-1.5 py-2 min-w-[36px] border-b border-border font-mono',
                            isToday && 'bg-blue-bg text-blue',
                            dim && 'opacity-30',
                          )}
                        >
                          {d}
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {sectionsToShow.map((src) => (
                    <SectionBlock
                      key={src}
                      src={src}
                      meta={SECTION_META[src]}
                      days={days}
                      isCurrent={isCurrentMonth(month, year)}
                      mask={mask}
                      valueFor={valueFor}
                      rowTotal={rowTotal}
                    />
                  ))}
                </tbody>
              </table>
            </div>
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

function SectionBlock({
  src, meta, days, isCurrent, mask, valueFor, rowTotal,
}: {
  src: 'target' | 'instagram';
  meta: { label: string; color: string };
  days: number;
  isCurrent: boolean;
  mask: boolean[];
  valueFor: (src: 'target' | 'instagram', metric: MetricRow, d: number) => number | undefined;
  rowTotal: (src: 'target' | 'instagram', metric: MetricRow) => number | undefined;
}) {
  const totalCols = days + 2;
  return (
    <>
      <tr>
        <td colSpan={totalCols} className="px-3 py-1.5 text-white font-bold text-[11px] uppercase tracking-wider"
            style={{ background: meta.color }}>
          {meta.label}
        </td>
      </tr>
      {METRIC_ROWS.map((metric) => {
        const total = rowTotal(src, metric);
        return (
          <tr key={metric.key} className={cn('border-b border-border last:border-b-0', !metric.important && 'text-text2')}>
            <td className={cn(
              'px-3 py-2 sticky left-0 bg-bg2 z-[1] whitespace-nowrap border-r border-border',
              metric.important ? 'font-semibold' : 'text-text2',
            )}>
              {metric.label}
            </td>
            <td className={cn(
              'px-3 py-2 text-right mono border-r border-border',
              metric.important ? 'text-[14px] font-bold text-text' : 'text-[12px] font-medium',
            )}>
              {fmtVal(total, metric.format) || '—'}
            </td>
            {Array.from({ length: days }, (_, i) => i).map(i => {
              const day = i + 1;
              const isToday = isCurrent && day === (new Date()).getDate();
              const dim = !mask[i];
              const v = metric.live ? valueFor(src, metric, i) : undefined;
              const filled = typeof v === 'number';
              return (
                <td
                  key={day}
                  className={cn(
                    'px-1 py-1.5 text-center mono text-[11px] border-l border-border',
                    isToday && 'bg-blue-bg/60',
                    filled && metric.live && 'bg-green-bg/40',
                    dim && 'opacity-25',
                    metric.important && filled && 'text-[12.5px] font-semibold',
                  )}
                >
                  {filled ? fmtVal(v, metric.format) : ''}
                </td>
              );
            })}
          </tr>
        );
      })}
    </>
  );
}

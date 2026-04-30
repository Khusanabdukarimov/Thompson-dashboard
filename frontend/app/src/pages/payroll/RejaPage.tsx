import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as Dialog from '@radix-ui/react-dialog';
import type { ColumnDef } from '@tanstack/react-table';
import { Topbar } from '@/components/Topbar';
import { Button } from '@/components/Button';
import { Badge } from '@/components/Badge';
import { Avatar } from '@/components/Avatar';
import { DataTable } from '@/components/DataTable';
import { FilterBar } from '@/components/FilterBar';
import type { FilterField, FilterValues } from '@/components/FilterBar';
import { Skeleton, MetricRowSkeleton } from '@/components/Skeleton';
import { getMonthlyTarget, listEmployees } from '@/lib/api/payroll';
import { getDealsStats } from '@/lib/api/deals';
import { listLeadsRich, getLeadsStats } from '@/lib/api/leads';
import type { LeadRow, LeadsListFilter } from '@/lib/api/leads';
import { fmtMoney, fmtNum, fmtPct } from '@/lib/utils';
import { MONTH_KEYS, MONTH_LABELS } from '@/lib/api/meta';
import { apiGet } from '@/lib/api/client';

const now = new Date();
const DEFAULT_YEAR = now.getFullYear();
const DEFAULT_MONTH = now.getMonth() + 1;

// Status preset → status_id mapping
const STATUS_PRESETS: { id: string; label: string; status_id?: string; pinned?: boolean }[] = [
  { id: 'all',       label: 'Barcha leadlar',       pinned: true },
  { id: 'active',    label: 'Faol (jarayonda)',     status_id: 'IN_PROCESS', pinned: true },
  { id: 'consulted', label: 'Konsultatsiya o\'tkazildi', status_id: 'CONVERTED' },
  { id: 'sifatsiz',  label: 'Sifatsiz',             status_id: 'UC_F8K4GI' },
  { id: 'bekor',     label: 'Bekor bo\'ldi',        status_id: 'UC_NAZK5J' },
];

// Status_id → tone mapping for badges
function statusTone(sid: string | null): 'green' | 'amber' | 'red' | 'orange' | 'blue' | 'gray' {
  if (!sid) return 'gray';
  if (sid === 'CONVERTED') return 'green';
  if (sid === 'IN_PROCESS' || sid === 'NEW') return 'amber';
  if (sid === 'UC_F8K4GI' || sid === 'UC_NAZK5J' || sid === 'UC_5G8244') return 'red';
  if (sid === 'JUNK' || sid === 'PROCESSED') return 'gray';
  if (sid === 'UC_L28G68') return 'blue';
  if (sid.startsWith('UC_')) return 'orange';
  return 'gray';
}

function isoFirstOfMonth(year: number, month: number) { return `${year}-${String(month).padStart(2, '0')}-01`; }
function isoLastOfMonth(year: number, month: number) {
  const d = new Date(year, month, 0).getDate();
  return `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
function fmtShortDate(iso: string | null) {
  if (!iso) return '—';
  return iso.slice(0, 10);
}

export default function RejaPage() {
  const [year, setYear] = useState(DEFAULT_YEAR);
  const [month, setMonth] = useState(DEFAULT_MONTH);
  const [activePreset, setActivePreset] = useState<string | null>('all');
  const [search, setSearch] = useState('');
  const [filterValues, setFilterValues] = useState<FilterValues>({});
  const [editTarget, setEditTarget] = useState(false);

  const startDate = isoFirstOfMonth(year, month);
  const endDate = isoLastOfMonth(year, month);

  const targetQ = useQuery({ queryKey: ['payroll/target', year, month], queryFn: () => getMonthlyTarget(year, month) });
  const dealsQ = useQuery({
    queryKey: ['stats/deals', year, month],
    queryFn: () => getDealsStats({ start_date: startDate, end_date: endDate }),
  });
  const empQ = useQuery({ queryKey: ['payroll/employees'], queryFn: listEmployees });
  const statsQ = useQuery({
    queryKey: ['stats/leads', year, month],
    queryFn: () => getLeadsStats({ start_date: startDate, end_date: endDate }),
  });

  const presetStatusId = STATUS_PRESETS.find(p => p.id === activePreset)?.status_id;

  const apiFilter: LeadsListFilter = useMemo(() => ({
    start_date: startDate,
    end_date: endDate,
    status_id: presetStatusId,
    assigned_by: filterValues.assigned_by ? Number(filterValues.assigned_by) : undefined,
    source_id: filterValues.source_id,
    search: search.trim() || undefined,
    enrich: true,
  }), [startDate, endDate, presetStatusId, filterValues, search]);

  const leadsQ = useQuery({
    queryKey: ['leads/list', apiFilter],
    queryFn: () => listLeadsRich(apiFilter),
  });

  // ── Reja header data ──────────────────────────────────────────
  const target = targetQ.data?.target_usd ?? 0;
  const wonRev = dealsQ.data?.total_won_revenue ?? 0;
  const remaining = Math.max(0, target - wonRev);
  const progress = target ? (wonRev / target) * 100 : 0;
  const weeklyBreakdown = (targetQ.data?.weekly_breakdown && targetQ.data.weekly_breakdown.length > 0)
    ? targetQ.data.weekly_breakdown
    : [target / 4, target / 4, target / 4, target / 4];

  // Filter fields
  const filterFields: FilterField[] = useMemo(() => {
    const users = statsQ.data?.users ?? [];
    const sources = statsQ.data?.sources ?? [];
    return [
      { key: 'assigned_by', label: 'Mas\'ul', type: 'select', options: users.map(u => ({ value: u.id, label: u.name })) },
      { key: 'source_id',   label: 'Manba',   type: 'select', options: sources.map(s => ({ value: s.id, label: s.label })) },
    ];
  }, [statsQ.data]);

  // ── Lead table columns ────────────────────────────────────────
  const columns = useMemo<ColumnDef<LeadRow, unknown>[]>(() => [
    {
      header: 'Sana', accessorKey: 'DATE_CREATE',
      cell: (c) => <span className="mono text-[11.5px] text-text2">{fmtShortDate(c.getValue<string | null>())}</span>,
    },
    {
      header: 'Xodim', accessorKey: '_assigned_name',
      cell: (c) => {
        const name = c.getValue<string | undefined>() || `User ${c.row.original.ASSIGNED_BY_ID}`;
        return (
          <div className="flex items-center gap-2">
            <Avatar name={name} />
            <span className="font-medium">{name}</span>
          </div>
        );
      },
    },
    {
      header: 'Mijoz', accessorKey: 'TITLE',
      cell: (c) => {
        const r = c.row.original;
        const fullName = ((r.NAME ?? '') + ' ' + (r.LAST_NAME ?? '')).trim();
        return <span className="font-medium">{fullName || c.getValue<string | null>() || '—'}</span>;
      },
    },
    {
      header: 'Manba', accessorKey: '_source_name',
      cell: (c) => {
        const v = c.getValue<string | undefined>();
        return v ? <Badge tone="blue">{v}</Badge> : <span className="text-text3">—</span>;
      },
    },
    {
      header: 'Summa', accessorKey: 'OPPORTUNITY',
      cell: (c) => {
        const v = parseFloat(c.getValue<string | null>() ?? '0');
        return <span className="mono">{v ? fmtMoney(v) : '—'}</span>;
      },
    },
    {
      header: 'Status', accessorKey: 'STATUS_ID',
      cell: (c) => {
        const sid = c.getValue<string | null>();
        const name = c.row.original._status_name || sid || '—';
        return <Badge tone={statusTone(sid)}>{name}</Badge>;
      },
    },
  ], []);

  return (
    <>
      <Topbar
        title="Reja & Leadlar"
        sub={`Oylik maqsad, haftalik breakdown va lead jadvali · ${MONTH_LABELS[MONTH_KEYS[month - 1]]} ${year}`}
        actions={
          <>
            <select className="px-2.5 py-1.5 rounded border border-border2 bg-bg2 text-[12px] shadow-xs" value={month} onChange={(e) => setMonth(Number(e.target.value))}>
              {MONTH_KEYS.map((m, i) => <option key={m} value={i + 1}>{MONTH_LABELS[m]}</option>)}
            </select>
            <select className="px-2.5 py-1.5 rounded border border-border2 bg-bg2 text-[12px] shadow-xs" value={year} onChange={(e) => setYear(Number(e.target.value))}>
              {[DEFAULT_YEAR, DEFAULT_YEAR - 1, DEFAULT_YEAR - 2].map(y => <option key={y} value={y}>{y}</option>)}
            </select>
            <Button onClick={() => setEditTarget(true)}>Reja o'zgartirish</Button>
            <Button variant="primary" onClick={() => alert("Lead kiritish — Bitrix CRM'ga yo'naltiring")}>+ Lead kiritish</Button>
          </>
        }
      />

      <div className="flex-1 overflow-y-auto px-[22px] py-[18px] bg-bg">
        {/* ── REJA HEADER ────────────────────────────────────── */}
        {targetQ.isLoading && !targetQ.data ? (
          <div className="bg-bg2 border border-border rounded-lg p-4 mb-4 shadow">
            <Skeleton className="h-4 w-48 mb-2" />
            <Skeleton className="h-2.5 w-96 mb-3" />
            <Skeleton className="h-3 w-full mb-2" />
            <div className="grid grid-cols-4 gap-2 mt-4">
              {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 w-full rounded" />)}
            </div>
          </div>
        ) : (
          <RejaHeader
            year={year} month={month}
            target={target} wonRev={wonRev} remaining={remaining} progress={progress}
            weeklyBreakdown={weeklyBreakdown}
          />
        )}

        {/* ── METRICS ────────────────────────────────────────── */}
        {leadsQ.isLoading && !leadsQ.data ? <MetricRowSkeleton count={4} /> : (
          <div className="grid grid-cols-4 gap-2.5 mb-4">
            <div className="bg-bg2 border border-border rounded-lg px-4 py-3.5 shadow">
              <div className="text-[11px] text-text3 uppercase tracking-wider mb-1.5 font-medium">Davr lidlari</div>
              <div className="text-[22px] font-semibold mono text-blue">{fmtNum(leadsQ.data?.count ?? 0)}</div>
            </div>
            <div className="bg-bg2 border border-border rounded-lg px-4 py-3.5 shadow">
              <div className="text-[11px] text-text3 uppercase tracking-wider mb-1.5 font-medium">Konversiya</div>
              <div className="text-[22px] font-semibold mono text-green">{fmtNum(statsQ.data?.converted ?? 0)}</div>
              <div className="text-[11px] text-text3 mt-1">{fmtPct(statsQ.data?.conversion_rate ?? 0, 2)}</div>
            </div>
            <div className="bg-bg2 border border-border rounded-lg px-4 py-3.5 shadow">
              <div className="text-[11px] text-text3 uppercase tracking-wider mb-1.5 font-medium">Won daromad</div>
              <div className="text-[22px] font-semibold mono text-green">{fmtMoney(wonRev)}</div>
              <div className="text-[11px] text-text3 mt-1">{dealsQ.data?.won_count ?? 0} ta deal</div>
            </div>
            <div className="bg-bg2 border border-border rounded-lg px-4 py-3.5 shadow">
              <div className="text-[11px] text-text3 uppercase tracking-wider mb-1.5 font-medium">Faol xodimlar</div>
              <div className="text-[22px] font-semibold mono">{fmtNum(empQ.data?.count ?? 0)}</div>
            </div>
          </div>
        )}

        {/* ── LEAD JADVALI ───────────────────────────────────── */}
        <div className="bg-bg2 border border-border rounded-lg shadow mb-4">
          <div className="px-4 py-3 border-b border-border flex items-center gap-3 flex-wrap">
            <span className="text-[13px] font-semibold whitespace-nowrap">Lead jadvali</span>
            <span className="text-[11px] text-text3 whitespace-nowrap">{leadsQ.isFetching ? 'yuklanmoqda…' : `${leadsQ.data?.count ?? 0} ta`}</span>
            <div className="flex-1 flex justify-end min-w-[280px]">
              <FilterBar
                presets={STATUS_PRESETS}
                activePreset={activePreset}
                onPresetChange={setActivePreset}
                searchValue={search}
                onSearchChange={setSearch}
                fields={filterFields}
                values={filterValues}
                onChange={(k, v) => setFilterValues(s => ({ ...s, [k]: v }))}
                onClear={() => { setSearch(''); setFilterValues({}); setActivePreset('all'); }}
                onApply={() => leadsQ.refetch()}
                activeChipLabel={STATUS_PRESETS.find(p => p.id === activePreset)?.label}
                onActiveChipClear={() => setActivePreset('all')}
              />
            </div>
          </div>
          <DataTable<LeadRow>
            columns={columns}
            data={leadsQ.data?.leads ?? []}
            pageSize={10}
            loading={leadsQ.isLoading}
          />
        </div>

        {leadsQ.error && (
          <div className="mt-4 p-3 bg-red-bg border border-red-bd text-red rounded-lg text-[12.5px]">
            Xatolik: {(leadsQ.error as Error).message}
          </div>
        )}
      </div>

      {editTarget && (
        <TargetModal year={year} month={month} initial={targetQ.data} onClose={() => setEditTarget(false)} />
      )}
    </>
  );
}

// ────────────────────────────────────────────────────────────────
// Reja header card (monthly progress + weekly cards)
// ────────────────────────────────────────────────────────────────
function RejaHeader({
  year, month, target, wonRev, remaining, progress, weeklyBreakdown,
}: {
  year: number; month: number;
  target: number; wonRev: number; remaining: number; progress: number;
  weeklyBreakdown: number[];
}) {
  return (
    <div className="bg-bg2 border border-border rounded-lg p-4 mb-4 shadow">
      <div className="flex items-start justify-between mb-1">
        <div>
          <div className="text-[15px] font-semibold">{MONTH_LABELS[MONTH_KEYS[month - 1]]} {year} — Oylik reja</div>
          <div className="text-[11px] text-text3 mt-0.5">
            Maqsad: <strong className="text-text">{fmtMoney(target)}</strong> &middot;
            Bajarildi: <strong className="text-blue">{fmtMoney(wonRev)}</strong> &middot;
            Qoldi: <strong className="text-amber">{fmtMoney(remaining)}</strong>
          </div>
        </div>
        <Badge tone={progress >= 100 ? 'green' : progress >= 70 ? 'amber' : 'red'} className="text-[12px] px-3 py-1">
          {target ? `${fmtPct(progress, 1)} bajarildi` : 'maqsad belgilanmagan'}
        </Badge>
      </div>
      <div className="h-2.5 bg-bg4 rounded overflow-hidden mt-2">
        <div className="h-full rounded bg-gradient-to-r from-blue-2 to-cyan-400 transition-all" style={{ width: `${Math.min(100, progress)}%` }} />
      </div>
      <div className="flex justify-between text-[10px] text-text3 mt-1 mb-3">
        <span>$0</span>
        <span className="text-blue font-semibold mono">{fmtMoney(wonRev)}</span>
        <span>{fmtMoney(target)}</span>
      </div>

      <div className="grid grid-cols-4 gap-2.5">
        {weeklyBreakdown.slice(0, 4).map((w, i) => {
          // Simple visual: each week placeholder (without per-week actual data — backend agg required)
          const reja = Number(w) || 0;
          const tone = i === 0 ? 'green' : i === 1 ? 'amber' : 'gray';
          const toneClass = tone === 'green'
            ? 'bg-green-bg border-green-bd'
            : tone === 'amber'
            ? 'bg-amber-bg border-amber-bd'
            : 'bg-bg3 border-border';
          return (
            <div key={i} className={`border rounded-md p-3 ${toneClass}`}>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[11px] font-semibold">{i + 1}-hafta</span>
                <span className="mono text-[12px] font-bold text-text3">—</span>
              </div>
              <div className="text-[11px] text-text2 flex justify-between"><span>Reja</span><span className="mono">{fmtMoney(reja)}</span></div>
              <div className="text-[11px] text-text2 flex justify-between"><span>Fakt</span><span className="mono text-text3">—</span></div>
              <div className="h-1 bg-bg4 rounded overflow-hidden mt-1.5">
                <div className="h-full rounded bg-text3" style={{ width: '0%' }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
// Monthly target editor modal
// ────────────────────────────────────────────────────────────────
function TargetModal({
  year, month, initial, onClose,
}: { year: number; month: number; initial: { target_usd: number; weekly_breakdown: number[] } | undefined; onClose: () => void }) {
  const qc = useQueryClient();
  const [target, setTarget] = useState<number>(initial?.target_usd ?? 0);
  const [weekly, setWeekly] = useState<number[]>(
    (initial?.weekly_breakdown && initial.weekly_breakdown.length > 0)
      ? initial.weekly_breakdown
      : [0, 0, 0, 0],
  );
  const [saving, setSaving] = useState(false);

  function onTargetChange(v: number) {
    setTarget(v);
    // Auto-distribute equally
    setWeekly([v / 4, v / 4, v / 4, v / 4]);
  }

  async function save() {
    setSaving(true);
    try {
      const res = await fetch('/api/payroll/target', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ year, month, target_usd: target, weekly_breakdown: weekly }),
      });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      qc.invalidateQueries({ queryKey: ['payroll/target', year, month] });
      onClose();
    } catch (e) {
      alert(`Xato: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog.Root open onOpenChange={(o) => { if (!o) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40 backdrop-blur-[2px] z-[300]" />
        <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-bg2 border border-border rounded-xl p-6 w-[440px] max-h-[88vh] overflow-y-auto shadow-lg z-[301]">
          <Dialog.Title className="text-[15px] font-semibold mb-4">Oylik reja o'zgartirish</Dialog.Title>

          <div className="grid grid-cols-2 gap-3 mb-4">
            <div>
              <label className="block text-[10px] text-text3 mb-1 uppercase tracking-wider font-medium">Oy</label>
              <input className={fi} value={`${MONTH_LABELS[MONTH_KEYS[month - 1]]} ${year}`} disabled />
            </div>
            <div>
              <label className="block text-[10px] text-text3 mb-1 uppercase tracking-wider font-medium">Oylik maqsad ($)</label>
              <input className={fi} type="number" value={target} onChange={(e) => onTargetChange(Number(e.target.value))} />
            </div>
          </div>

          <div className="text-[11px] text-text3 mb-2">Haftalik rejalar avtomatik teng taqsimlanadi:</div>
          <div className="grid grid-cols-4 gap-2 mb-4">
            {weekly.slice(0, 4).map((w, i) => (
              <div key={i} className="bg-bg3 border border-border rounded-md p-2.5 text-center">
                <div className="text-[10px] text-text3 mb-1">{i + 1}-hafta</div>
                <input
                  className={`${fi} text-center`}
                  type="number"
                  value={w}
                  onChange={(e) => {
                    const nv = [...weekly]; nv[i] = Number(e.target.value); setWeekly(nv);
                  }}
                />
              </div>
            ))}
          </div>

          <div className="flex justify-end gap-2 mt-2 pt-3 border-t border-border">
            <Button onClick={onClose}>Bekor</Button>
            <Button variant="primary" disabled={saving} onClick={save}>{saving ? 'Saqlanmoqda…' : 'Saqlash'}</Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

const fi = 'w-full px-2.5 py-2 rounded-[7px] border border-border bg-bg text-text text-[12.5px] focus:outline-none focus:border-blue focus:bg-bg2 focus:shadow-[0_0_0_3px_rgba(34,102,245,0.1)] disabled:opacity-60';

// Suppress unused imports (apiGet imported for completeness)
void apiGet;

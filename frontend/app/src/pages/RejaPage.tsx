import { useState, useMemo, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Search, Plus, Trash2, ChevronDown, Scale, CheckCircle2, BarChart3, Settings2, X } from 'lucide-react';
import { Topbar } from '@/components/Topbar';
import {
  getRejaPlans, createRejaPlan, updateRejaPlan, deleteRejaPlan,
  getRejaDistribution, saveRejaDistribution, getRejaProgress,
  type RejaPlan, type PeriodType,
} from '@/lib/api/reja';

// ── Helpers ───────────────────────────────────────────────────────

const MONTH_NAMES = [
  'Yanvar','Fevral','Mart','Aprel','May','Iyun',
  'Iyul','Avgust','Sentabr','Oktabr','Noyabr','Dekabr',
];

const CURRENCY = 'USD';
const CURRENCY_SIGN = '$';

function fmtMoney(n: number): string {
  if (!n && n !== 0) return '0';
  return new Intl.NumberFormat('en-US').format(Math.round(n));
}
// keep old name as alias so all call-sites work without rename
const fmtUZS = fmtMoney;

function parseNum(s: string): number {
  const n = parseFloat(s.replace(/,/g, ''));
  return isNaN(n) ? 0 : Math.max(0, n);
}

function localISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function periodLabel(plan: RejaPlan): string {
  const d = new Date(plan.period_start);
  if (plan.period_type === 'monthly') return `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`;
  const q = Math.floor(d.getMonth() / 3) + 1;
  return `${d.getFullYear()} – ${q}-kvartal`;
}

function monthStartEnd(year: number, month: number) {
  return {
    start: localISO(new Date(year, month, 1)),
    end:   localISO(new Date(year, month + 1, 0)),
  };
}

function quarterStartEnd(year: number, quarter: number) {
  const m = (quarter - 1) * 3;
  return {
    start: localISO(new Date(year, m, 1)),
    end:   localISO(new Date(year, m + 3, 0)),
  };
}

const AVATAR_COLORS = [
  '#2196F3','#E91E63','#9C27B0','#00BCD4','#FF9800',
  '#4CAF50','#FF5722','#3F51B5','#009688','#795548',
];

function avatarColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffff;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

function initials(name: string): string {
  const p = name.trim().split(/\s+/).filter(Boolean);
  return p.length >= 2 ? (p[0][0] + p[1][0]).toUpperCase() : (p[0]?.[0] ?? '?').toUpperCase();
}

// ── Plan dropdown ──────────────────────────────────────────────────

function PlanDropdown({ plans, selected, onSelect, onCreateClick }: {
  plans: RejaPlan[];
  selected: RejaPlan | null;
  onSelect: (p: RejaPlan) => void;
  onCreateClick: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const fn = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', fn);
    return () => document.removeEventListener('mousedown', fn);
  }, []);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px',
          borderRadius: 8, border: `1px solid ${open ? '#2563eb' : 'var(--border)'}`,
          background: 'var(--bg)', color: 'var(--text)', fontSize: 13, fontWeight: 600,
          cursor: 'pointer', minWidth: 200,
        }}
      >
        <span style={{ flex: 1, textAlign: 'left' }}>{selected ? periodLabel(selected) : 'Reja tanlang…'}</span>
        <ChevronDown size={14} color="var(--text3)" />
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 200, minWidth: 240,
          background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 10,
          boxShadow: '0 8px 24px rgba(0,0,0,0.18)', overflow: 'hidden',
        }}>
          {plans.length === 0 && (
            <div style={{ padding: '12px 14px', color: 'var(--text3)', fontSize: 12 }}>Rejalar mavjud emas</div>
          )}
          {plans.map(p => (
            <div
              key={p.id}
              onClick={() => { onSelect(p); setOpen(false); }}
              style={{
                padding: '10px 14px', cursor: 'pointer', fontSize: 13, fontWeight: 500,
                background: selected?.id === p.id ? 'rgba(37,99,235,0.1)' : 'transparent',
                color: selected?.id === p.id ? '#2563eb' : 'var(--text)',
                borderBottom: '1px solid var(--border)',
              }}
            >
              <div>{periodLabel(p)}</div>
              <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>
                {CURRENCY_SIGN}{fmtUZS(p.total_target)} · {p.employee_count} xodim
              </div>
            </div>
          ))}
          <div
            onClick={() => { setOpen(false); onCreateClick(); }}
            style={{ padding: '10px 14px', cursor: 'pointer', fontSize: 13, fontWeight: 600, color: '#2563eb', display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <Plus size={14} /> Yangi reja
          </div>
        </div>
      )}
    </div>
  );
}

// ── Create plan modal ──────────────────────────────────────────────

function CreatePlanModal({ onClose, onCreated }: { onClose: () => void; onCreated: (p: RejaPlan) => void }) {
  const now = new Date();
  const [periodType, setPeriodType] = useState<PeriodType>('monthly');
  const [year,    setYear]    = useState(now.getFullYear());
  const [month,   setMonth]   = useState(now.getMonth());
  const [quarter, setQuarter] = useState(Math.floor(now.getMonth() / 3) + 1);
  const [totalTarget, setTotalTarget] = useState('');
  const [name, setName] = useState('');
  const qc = useQueryClient();

  const mutation = useMutation({
    mutationFn: createRejaPlan,
    onSuccess: (plan) => { qc.invalidateQueries({ queryKey: ['reja/plans'] }); onCreated(plan); },
  });

  function handleSubmit(e: { preventDefault(): void }) {
    e.preventDefault();
    const { start, end } = periodType === 'monthly'
      ? monthStartEnd(year, month)
      : quarterStartEnd(year, quarter);
    mutation.mutate({ name: name || undefined, period_type: periodType, period_start: start, period_end: end, total_target: parseNum(totalTarget) });
  }

  const inp: React.CSSProperties = { width: '100%', padding: '10px 12px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--bg3)', color: 'var(--text)', fontSize: 13, outline: 'none', boxSizing: 'border-box' };
  const lbl: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 5, display: 'block' };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 500, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <button onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.4)', border: 0, cursor: 'default' }} />
      <form onSubmit={handleSubmit} style={{ position: 'relative', background: 'var(--bg)', borderRadius: 14, padding: '28px', width: 420, boxShadow: '0 20px 48px rgba(0,0,0,0.3)', border: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>Yangi reja yaratish</div>
          <button type="button" onClick={onClose} style={{ border: 0, background: 'transparent', color: 'var(--text2)', cursor: 'pointer', padding: 4 }}><X size={18} /></button>
        </div>

        <div>
          <span style={lbl}>Davr turi</span>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {(['monthly', 'quarterly'] as PeriodType[]).map(t => (
              <button key={t} type="button" onClick={() => setPeriodType(t)} style={{ padding: '9px 0', borderRadius: 7, fontSize: 13, fontWeight: 600, cursor: 'pointer', border: `1px solid ${periodType === t ? '#2563eb' : 'var(--border)'}`, background: periodType === t ? 'rgba(37,99,235,0.1)' : 'var(--bg3)', color: periodType === t ? '#2563eb' : 'var(--text2)' }}>
                {t === 'monthly' ? 'Oylik' : 'Kvartal'}
              </button>
            ))}
          </div>
        </div>

        <div>
          <span style={lbl}>Yil</span>
          <select value={year} onChange={e => setYear(+e.target.value)} style={inp}>
            {[2023,2024,2025,2026,2027].map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>

        {periodType === 'monthly' ? (
          <div>
            <span style={lbl}>Oy</span>
            <select value={month} onChange={e => setMonth(+e.target.value)} style={inp}>
              {MONTH_NAMES.map((m, i) => <option key={i} value={i}>{m}</option>)}
            </select>
          </div>
        ) : (
          <div>
            <span style={lbl}>Kvartal</span>
            <select value={quarter} onChange={e => setQuarter(+e.target.value)} style={inp}>
              {[1,2,3,4].map(q => <option key={q} value={q}>{q}-kvartal</option>)}
            </select>
          </div>
        )}

        <div>
          <span style={lbl}>Umumiy maqsad ({CURRENCY})</span>
          <input style={inp} type="text" placeholder="500,000,000" value={totalTarget} onChange={e => setTotalTarget(e.target.value)} required />
        </div>

        <div>
          <span style={lbl}>Nom (ixtiyoriy)</span>
          <input style={inp} type="text" placeholder="Savdo rejasi…" value={name} onChange={e => setName(e.target.value)} />
        </div>

        {mutation.isError && (
          <div style={{ fontSize: 12, color: '#ef4444', background: '#ef444414', borderRadius: 6, padding: '8px 10px' }}>
            Xatolik: {(mutation.error as Error).message}
          </div>
        )}

        <div style={{ display: 'flex', gap: 10 }}>
          <button type="button" onClick={onClose} style={{ flex: 1, padding: '10px', border: '1px solid var(--border)', background: 'var(--bg2)', borderRadius: 8, color: 'var(--text2)', fontSize: 13, cursor: 'pointer' }}>Bekor</button>
          <button type="submit" disabled={mutation.isPending} style={{ flex: 2, padding: '10px', border: 0, background: '#1d4ed8', color: '#fff', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer', opacity: mutation.isPending ? 0.7 : 1 }}>
            {mutation.isPending ? 'Saqlanmoqda…' : 'Yaratish'}
          </button>
        </div>
      </form>
    </div>
  );
}

// ── Team progress donut ────────────────────────────────────────────

function TeamDonut({ pct, size = 140 }: { pct: number; size?: number }) {
  const r   = (size - 20) / 2;
  const cx  = size / 2;
  const circ = 2 * Math.PI * r;
  const dash = (pct / 100) * circ;
  return (
    <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
      <circle cx={cx} cy={cx} r={r} fill="none" stroke="var(--border)" strokeWidth={14} />
      <circle
        cx={cx} cy={cx} r={r} fill="none"
        stroke={pct >= 80 ? '#16a34a' : pct >= 50 ? '#2563eb' : '#ef4444'}
        strokeWidth={14} strokeLinecap="round"
        strokeDasharray={`${dash} ${circ}`}
        style={{ transition: 'stroke-dasharray 0.5s ease' }}
      />
    </svg>
  );
}

function BottomSections({ planId }: { planId: number }) {
  const [chartMode, setChartMode] = useState<'oy' | 'kvartal'>('oy');

  const { data, isLoading } = useQuery({
    queryKey: ['reja/progress', planId],
    queryFn:  () => getRejaProgress(planId),
  });

  if (isLoading) return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
      {[0,1,2].map(i => (
        <div key={i} style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 14, padding: '24px 20px', minHeight: 280, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ fontSize: 12, color: 'var(--text3)' }}>Yuklanmoqda…</div>
        </div>
      ))}
    </div>
  );

  if (!data || !data.employees.length) return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
      {[
        "Jamoa bo'yicha progress",
        "Top 5 xodimlar",
        "Rejani bajarilish dinamikasi",
      ].map(title => (
        <div key={title} style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 14, padding: '24px 20px', minHeight: 280, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>{title}</div>
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ fontSize: 12, color: 'var(--text3)', textAlign: 'center' }}>
              Maqsadlarni tayinlang va saqlang
            </div>
          </div>
        </div>
      ))}
    </div>
  );

  const { employees, subperiods, summary } = data;
  const avgPct = summary.total_target > 0
    ? Math.round(summary.total_actual / summary.total_target * 100)
    : 0;

  // Classify employees
  const ahead   = employees.filter(e => e.pct >  100);
  const onTrack = employees.filter(e => e.pct >= 70 && e.pct <= 100);
  const behind  = employees.filter(e => e.pct <  70);

  // Top 5 by actual amount
  const top5 = [...employees].sort((a, b) => b.total_actual - a.total_actual).slice(0, 5);
  const maxActual = Math.max(...top5.map(e => e.total_actual), 1);

  // Chart: cumulative actual vs cumulative target per sub-period
  const chartData = subperiods.map((sp, i) => {
    const periodActual = employees.reduce((s, e) => s + (e.subperiods[i]?.actual ?? 0), 0);
    const periodTarget = employees.reduce((s, e) => s + (e.subperiods[i]?.target ?? 0), 0);
    return { label: sp.label, actual: periodActual, target: periodTarget };
  });

  let cumA = 0, cumT = 0;
  const cumChart = chartData.map(d => {
    cumA += d.actual;
    cumT += d.target;
    return { label: d.label, actual: cumA, target: cumT };
  });

  const maxChartVal = Math.max(...cumChart.map(d => Math.max(d.actual, d.target)), 1);
  const W = 340, H = 140, PAD = { l: 44, r: 16, t: 12, b: 28 };
  const xStep = (W - PAD.l - PAD.r) / Math.max(cumChart.length - 1, 1);
  const yScale = (v: number) => PAD.t + (H - PAD.t - PAD.b) * (1 - v / maxChartVal);
  const pts = (key: 'actual' | 'target') =>
    cumChart.map((d, i) => `${PAD.l + i * xStep},${yScale(d[key])}`).join(' ');

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map(f => ({ v: Math.round(f * maxChartVal), y: yScale(f * maxChartVal) }));

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>

      {/* 1 — Team progress donut */}
      <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 14, padding: '24px 20px' }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', marginBottom: 20 }}>Jamoa bo'yicha progress</div>

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, marginBottom: 20 }}>
          <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
            <TeamDonut pct={avgPct} size={140} />
            <div style={{ position: 'absolute', textAlign: 'center' }}>
              <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--text)' }}>{avgPct}%</div>
              <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>O'rtacha</div>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {[
            { label: "Ma'lum darajada oldinda", count: ahead.length,   color: '#16a34a' },
            { label: 'Reja bo\'yicha',          count: onTrack.length, color: '#2563eb' },
            { label: 'Ortda qolmoqda',           count: behind.length,  color: '#ef4444' },
          ].map(row => (
            <div key={row.label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: row.color, flexShrink: 0 }} />
                <span style={{ color: 'var(--text2)' }}>{row.label}</span>
              </div>
              <span style={{ fontWeight: 700, color: 'var(--text)' }}>
                {row.count} xodim ({employees.length > 0 ? Math.round(row.count / employees.length * 100) : 0}%)
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* 2 — Top 5 employees */}
      <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 14, padding: '24px 20px' }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', marginBottom: 20 }}>
          Top 5 xodimlar <span style={{ fontSize: 12, color: 'var(--text3)', fontWeight: 400 }}>(Bajarilish bo'yicha)</span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {top5.map((emp) => {
            const barPct = maxActual > 0 ? (emp.total_actual / maxActual) * 100 : 0;
            const barColor = emp.pct >= 80 ? '#16a34a' : emp.pct >= 50 ? '#f59e0b' : '#ef4444';
            return (
              <div key={emp.responsible_id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 28, height: 28, borderRadius: '50%', flexShrink: 0, background: avatarColor(emp.full_name), display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, color: '#fff' }}>
                  {initials(emp.full_name)}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {emp.full_name}
                    </span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', whiteSpace: 'nowrap', marginLeft: 8 }}>
                      ${fmtUZS(emp.total_actual)}
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ flex: 1, height: 4, borderRadius: 2, background: 'var(--border)', overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${barPct}%`, background: barColor, borderRadius: 2 }} />
                    </div>
                    <span style={{ fontSize: 11, fontWeight: 700, color: barColor, width: 36, textAlign: 'right', flexShrink: 0 }}>
                      {emp.pct}%
                    </span>
                  </div>
                  <div style={{ fontSize: 10.5, color: 'var(--text3)', marginTop: 2 }}>
                    {fmtUZS(emp.target)} reja
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 3 — Dynamics SVG line chart */}
      <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 14, padding: '24px 20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>Rejani bajarilish dinamikasi</div>
          <div style={{ display: 'flex', background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden' }}>
            {(['oy', 'kvartal'] as const).map(m => (
              <button
                key={m}
                onClick={() => setChartMode(m)}
                style={{ padding: '4px 10px', border: 0, background: chartMode === m ? 'rgba(37,99,235,0.15)' : 'transparent', color: chartMode === m ? '#2563eb' : 'var(--text3)', fontSize: 11.5, fontWeight: 700, cursor: 'pointer', textTransform: 'capitalize' }}
              >
                {m === 'oy' ? 'Oy' : 'Kvartal'}
              </button>
            ))}
          </div>
        </div>

        {cumChart.length > 0 ? (
          <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ overflow: 'visible' }}>
            {/* Y grid lines + labels */}
            {yTicks.map(t => (
              <g key={t.v}>
                <line x1={PAD.l} y1={t.y} x2={W - PAD.r} y2={t.y} stroke="var(--border)" strokeWidth={0.5} strokeDasharray="3 3" />
                <text x={PAD.l - 4} y={t.y + 4} textAnchor="end" fontSize={9} fill="var(--text3)">
                  {t.v >= 1000000 ? `${(t.v/1000000).toFixed(0)}M` : t.v >= 1000 ? `${(t.v/1000).toFixed(0)}K` : t.v}
                </text>
              </g>
            ))}

            {/* X labels */}
            {cumChart.map((d, i) => (
              <text key={i} x={PAD.l + i * xStep} y={H - PAD.b + 14} textAnchor="middle" fontSize={9.5} fill="var(--text3)">
                {d.label}
              </text>
            ))}

            {/* Area under actual line */}
            <defs>
              <linearGradient id="actualGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#2563eb" stopOpacity="0.18" />
                <stop offset="100%" stopColor="#2563eb" stopOpacity="0.01" />
              </linearGradient>
            </defs>
            <polygon
              points={`${PAD.l},${H - PAD.b} ${pts('actual')} ${PAD.l + (cumChart.length - 1) * xStep},${H - PAD.b}`}
              fill="url(#actualGrad)"
            />

            {/* Target line (dashed) */}
            <polyline
              points={pts('target')}
              fill="none" stroke="var(--text3)" strokeWidth={1.5}
              strokeDasharray="5 3"
            />

            {/* Actual line */}
            <polyline
              points={pts('actual')}
              fill="none" stroke="#2563eb" strokeWidth={2}
            />

            {/* Dots on actual */}
            {cumChart.map((d, i) => (
              d.actual > 0 && (
                <circle key={i} cx={PAD.l + i * xStep} cy={yScale(d.actual)} r={3} fill="#2563eb" />
              )
            ))}
          </svg>
        ) : (
          <div style={{ height: 120, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text3)', fontSize: 12 }}>
            Ma'lumot yo'q
          </div>
        )}

        {/* Legend */}
        <div style={{ display: 'flex', gap: 16, marginTop: 8, justifyContent: 'center' }}>
          {[
            { label: 'Reja', color: 'var(--text3)', dashed: true },
            { label: 'Fakt', color: '#2563eb', dashed: false },
          ].map(l => (
            <div key={l.label} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11 }}>
              <svg width={22} height={8}>
                <line x1={0} y1={4} x2={22} y2={4} stroke={l.color} strokeWidth={2} strokeDasharray={l.dashed ? '4 2' : undefined} />
              </svg>
              <span style={{ color: 'var(--text3)' }}>{l.label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Distribution view ──────────────────────────────────────────────

function DistributionView({ planId, onDeleted }: { planId: number; onDeleted: () => void }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['reja/distribution', planId],
    queryFn:  () => getRejaDistribution(planId),
  });

  const plan      = data?.plan;
  const employees = data?.employees ?? [];

  const [targets,      setTargets]      = useState<Record<number, string>>({});
  const [search,       setSearch]       = useState('');
  const [dirty,        setDirty]        = useState(false);
  const [showAll,      setShowAll]      = useState(false);
  const [totalInput, setTotalInput] = useState('');
  const [editTotal,  setEditTotal]  = useState(false);

  useEffect(() => {
    if (!data) return;
    const map: Record<number, string> = {};
    for (const e of data.employees) map[e.responsible_id] = e.target > 0 ? String(Math.round(parseFloat(String(e.target)))) : '';
    setTargets(map);
    setTotalInput(String(Math.round(parseFloat(String(data.plan.total_target)))));
    setDirty(false);
  }, [data]);

  const totalTarget  = plan?.total_target ?? 0;
  const distributed  = useMemo(
    () => employees.reduce((s, e) => s + parseNum(targets[e.responsible_id] ?? ''), 0),
    [targets, employees],
  );
  const remaining = totalTarget - distributed;

  // Employees with a saved target (from DB) — shown by default
  const assignedEmployees = useMemo(
    () => employees.filter(e => parseFloat(String(e.target)) > 0),
    [employees],
  );
  const hasAnyTarget = assignedEmployees.length > 0;

  // When no targets saved yet → show all employees so user can assign
  // When targets exist → show only assigned by default; toggle shows all
  const filtered = useMemo(() => {
    const base = (!hasAnyTarget || showAll) ? employees : assignedEmployees;
    if (!search.trim()) return base;
    const q = search.toLowerCase();
    return base.filter(e => e.full_name.toLowerCase().includes(q) || (e.work_position ?? '').toLowerCase().includes(q));
  }, [employees, assignedEmployees, search, showAll, hasAnyTarget]);

  const saveMutation = useMutation({
    mutationFn: () => saveRejaDistribution(planId, employees.map(e => ({ responsible_id: e.responsible_id, target: parseNum(targets[e.responsible_id] ?? '') }))),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['reja/distribution', planId] });
      qc.invalidateQueries({ queryKey: ['reja/plans'] });
      qc.invalidateQueries({ queryKey: ['reja/progress', planId] });
      setDirty(false);
    },
  });

  const updateTotalMutation = useMutation({
    mutationFn: (v: number) => updateRejaPlan(planId, { total_target: v }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['reja/distribution', planId] }); qc.invalidateQueries({ queryKey: ['reja/plans'] }); setEditTotal(false); },
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteRejaPlan(planId),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['reja/plans'] }); onDeleted(); },
  });

  function distributeEqually() {
    const active = employees.filter(e => e.active);
    if (!active.length || !totalTarget) return;
    const share     = Math.floor(totalTarget / active.length);
    const remainder = totalTarget - share * active.length;
    const map: Record<number, string> = {};
    active.forEach((e, i) => { map[e.responsible_id] = String(i === 0 ? share + remainder : share); });
    setTargets(prev => ({ ...prev, ...map }));
    setDirty(true);
  }

  function setTarget(id: number, val: string) { setTargets(prev => ({ ...prev, [id]: val })); setDirty(true); }

  if (isLoading) return <div style={{ padding: 56, textAlign: 'center', color: 'var(--text3)' }}>Yuklanmoqda…</div>;

  const overflowed  = remaining < 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '20px 24px 96px' }}>

      {/* Top row: stats + quick action */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: 16, alignItems: 'stretch' }}>

        {/* Stats card */}
        <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 14, padding: '28px 32px' }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)', marginBottom: 28 }}>Maqsadlarni taqsimlash</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)' }}>
            {[
              { label: 'Umumiy maqsad', raw: totalTarget, editable: true },
              { label: 'Taqsimlangan',  raw: distributed,  color: distributed > 0 ? '#2563eb' : undefined },
              { label: 'Qoldiq',        raw: Math.abs(remaining), color: overflowed ? '#ef4444' : undefined },
            ].map((item, i) => (
              <div key={i} style={{ paddingLeft: i > 0 ? 24 : 0, borderLeft: i > 0 ? '1px solid var(--border)' : 'none' }}>
                <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 10 }}>{item.label}</div>

                {item.editable && editTotal ? (
                  <form onSubmit={e => { e.preventDefault(); updateTotalMutation.mutate(parseNum(totalInput)); }} style={{ display: 'flex', gap: 6 }}>
                    <input autoFocus value={totalInput} onChange={e => setTotalInput(e.target.value)}
                      style={{ width: 140, padding: '6px 8px', borderRadius: 6, border: '1px solid #2563eb', background: 'var(--bg2)', color: 'var(--text)', fontSize: 15, fontWeight: 700, outline: 'none' }} />
                    <button type="submit" style={{ padding: '6px 10px', borderRadius: 6, border: 0, background: '#2563eb', color: '#fff', fontSize: 12, cursor: 'pointer', fontWeight: 700 }}>✓</button>
                    <button type="button" onClick={() => setEditTotal(false)} style={{ padding: '6px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text3)', fontSize: 12, cursor: 'pointer' }}>✕</button>
                  </form>
                ) : (
                  <div
                    onClick={() => item.editable && setEditTotal(true)}
                    style={{ cursor: item.editable ? 'pointer' : 'default' }}
                  >
                    <span style={{ fontSize: 22, fontWeight: 700, color: item.color ?? 'var(--text)' }}>
                      {CURRENCY_SIGN}{fmtUZS(item.raw)}
                    </span>
                    <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text3)', marginTop: 2 }}>{CURRENCY}</div>
                    {overflowed && item.label === 'Qoldiq' && (
                      <div style={{ fontSize: 11, color: '#ef4444', marginTop: 2 }}>Ortiqcha: {CURRENCY_SIGN}{fmtUZS(-remaining)}</div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Tezkor taqsimot */}
        <div style={{ background: 'linear-gradient(135deg, #1d3a8a 0%, #1d4ed8 100%)', borderRadius: 14, padding: '28px 24px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ fontSize: 26 }}>✨</div>
          <div style={{ fontSize: 16, fontWeight: 800, color: '#fff' }}>Tezkor Taqsimot</div>
          <div style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.72)', lineHeight: 1.6 }}>
            Barcha faol xodimlar orasida maqsadni teng miqdorda taqsimlang.
          </div>
          <button
            type="button"
            onClick={distributeEqually}
            style={{ marginTop: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '12px 16px', borderRadius: 9, border: 0, background: '#fff', color: '#1d3a8a', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
          >
            <Scale size={15} /> Teng taqsimlash
          </button>
        </div>
      </div>

      {/* Employee table */}
      <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 16, overflow: 'hidden' }}>

        {/* Toolbar */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>
              {showAll ? 'Barcha xodimlar' : `Tayinlangan xodimlar (${assignedEmployees.length})`}
            </div>
            <button
              onClick={() => setShowAll(v => !v)}
              style={{ fontSize: 12, fontWeight: 600, padding: '5px 14px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg2)', color: 'var(--text2)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}
            >
              <Plus size={12} /> {showAll ? 'Tayinlangan' : "Xodim qo'shish"}
            </button>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ position: 'relative' }}>
              <Search size={13} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text3)', pointerEvents: 'none' }} />
              <input
                placeholder="Qidiruv…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                style={{ paddingLeft: 30, paddingRight: 12, height: 34, border: '1px solid var(--border)', borderRadius: 8, background: 'var(--bg2)', color: 'var(--text)', fontSize: 12.5, outline: 'none', width: 180 }}
              />
            </div>
            <button
              onClick={() => { if (confirm("Rejani o'chirishni tasdiqlaysizmi?")) deleteMutation.mutate(); }}
              style={{ width: 34, height: 34, borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: '#ef4444', cursor: 'pointer', display: 'grid', placeItems: 'center' }}
            >
              <Trash2 size={14} />
            </button>
          </div>
        </div>

        {/* Column headers */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 130px 160px 170px 130px 100px', padding: '10px 24px', borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)' }}>
          {[
            { label: 'XODIM ISMI',             color: 'var(--text3)' },
            { label: 'ROLI',                    color: 'var(--text3)' },
            { label: `REJA (${CURRENCY})`,      color: '#2563eb'      },
            { label: `FAKTIK SOTUV (${CURRENCY})`, color: '#16a34a'  },
            { label: 'QOLDI',                   color: 'var(--text3)' },
            { label: 'STATUS',                  color: 'var(--text3)' },
          ].map(h => (
            <div key={h.label} style={{ fontSize: 10, fontWeight: 700, color: h.color, letterSpacing: '0.07em', textTransform: 'uppercase' }}>{h.label}</div>
          ))}
        </div>

        {/* Rows */}
        {filtered.map((emp, i) => {
          const target      = parseNum(targets[emp.responsible_id] ?? '');
          const actual      = emp.actual_sales ?? 0;
          const qoldi       = target - actual;
          const pct         = totalTarget > 0 ? (target / totalTarget) * 100 : 0;
          const achievedPct = target > 0 ? Math.min(Math.round(actual / target * 100), 999) : 0;
          const isLast      = i === filtered.length - 1;

          return (
            <div
              key={emp.responsible_id}
              style={{
                display: 'grid', gridTemplateColumns: '1fr 130px 160px 170px 130px 100px',
                padding: '18px 24px', alignItems: 'center',
                borderBottom: isLast ? 'none' : '1px solid var(--border)',
              }}
            >
              {/* Avatar + name + deal count */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, minWidth: 0 }}>
                <div style={{
                  width: 46, height: 46, borderRadius: 10, flexShrink: 0,
                  background: avatarColor(emp.full_name),
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 14, fontWeight: 800, color: '#fff', letterSpacing: '0.03em',
                }}>
                  {initials(emp.full_name)}
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {emp.full_name}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>
                    {emp.deal_count > 0
                      ? <span style={{ color: '#16a34a' }}>{emp.deal_count} ta sotuv</span>
                      : '0 ta sotuv'}
                  </div>
                </div>
              </div>

              {/* Role */}
              <div style={{ fontSize: 13, color: 'var(--text2)' }}>
                {emp.work_position || '—'}
              </div>

              {/* Reja — editable in showAll mode, display otherwise */}
              <div>
                {showAll ? (
                  <div style={{ position: 'relative' }}>
                    <input
                      type="number" min={0} step={1000}
                      value={targets[emp.responsible_id] ?? ''}
                      onChange={e => setTarget(emp.responsible_id, e.target.value)}
                      placeholder="0"
                      style={{ width: '100%', padding: '8px 22px 8px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg2)', color: 'var(--text)', fontSize: 13, outline: 'none', boxSizing: 'border-box', WebkitAppearance: 'none' }}
                    />
                    <span style={{ position: 'absolute', right: 7, top: '50%', transform: 'translateY(-50%)', fontSize: 11, color: 'var(--text3)', pointerEvents: 'none' }}>{CURRENCY_SIGN}</span>
                  </div>
                ) : (
                  <>
                    <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>
                      {target > 0 ? `${CURRENCY_SIGN}${fmtUZS(target)}` : '—'}
                    </div>
                    {pct > 0 && (
                      <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>{pct.toFixed(1)}% of total</div>
                    )}
                  </>
                )}
              </div>

              {/* Faktik sotuv */}
              <div>
                <div style={{ fontSize: 15, fontWeight: 700, color: actual > 0 ? '#16a34a' : 'var(--text3)' }}>
                  {actual > 0 ? `${CURRENCY_SIGN}${fmtUZS(actual)}` : '—'}
                </div>
                {actual > 0 && target > 0 && (
                  <div style={{ marginTop: 5, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.08)', overflow: 'hidden', width: 80 }}>
                    <div style={{ height: '100%', width: `${Math.min(achievedPct, 100)}%`, background: achievedPct >= 100 ? '#16a34a' : achievedPct >= 60 ? '#f59e0b' : '#ef4444', borderRadius: 2 }} />
                  </div>
                )}
              </div>

              {/* Qoldi */}
              <div>
                {target > 0 ? (
                  <div style={{ fontSize: 14, fontWeight: 600, color: qoldi <= 0 ? '#16a34a' : 'var(--text)' }}>
                    {qoldi <= 0 ? `+${CURRENCY_SIGN}${fmtUZS(-qoldi)}` : `${CURRENCY_SIGN}${fmtUZS(qoldi)}`}
                  </div>
                ) : (
                  <span style={{ fontSize: 13, color: 'var(--text3)' }}>—</span>
                )}
              </div>

              {/* Status — dot + text + remove */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: emp.active ? '#16a34a' : '#d97706', flexShrink: 0 }} />
                <span style={{ fontSize: 13, fontWeight: 500, color: emp.active ? '#16a34a' : '#d97706', flex: 1 }}>
                  {emp.active ? 'Active' : 'On leave'}
                </span>
                {!showAll && (
                  <button
                    type="button"
                    title="Olib tashlash"
                    onClick={() => { setTarget(emp.responsible_id, ''); }}
                    style={{ width: 26, height: 26, borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', color: '#ef4444', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.7, flexShrink: 0 }}
                  >
                    <Trash2 size={12} />
                  </button>
                )}
              </div>
            </div>
          );
        })}

        {filtered.length === 0 && (
          <div style={{ padding: 48, textAlign: 'center' }}>
            {!hasAnyTarget ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
                <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text2)' }}>Hech kim tayinlanmagan</div>
                <div style={{ fontSize: 13, color: 'var(--text3)' }}>
                  "Teng taqsimlash" yoki "+ Xodim qo'shish" tugmasini bosing
                </div>
              </div>
            ) : (
              <div style={{ fontSize: 13, color: 'var(--text3)' }}>Xodim topilmadi</div>
            )}
          </div>
        )}

        {/* Footer */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px', borderTop: '1px solid var(--border)', background: 'var(--bg2)' }}>
          {/* Avatar stack + count */}
          <div style={{ display: 'flex', alignItems: 'center' }}>
            {assignedEmployees.slice(0, 4).map((e, i) => (
              <div key={e.responsible_id} style={{ width: 28, height: 28, borderRadius: '50%', marginLeft: i > 0 ? -8 : 0, background: avatarColor(e.full_name), border: '2px solid var(--bg2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, color: '#fff', position: 'relative', zIndex: 4 - i }}>
                {initials(e.full_name)}
              </div>
            ))}
            {assignedEmployees.length > 4 && (
              <div style={{ width: 28, height: 28, borderRadius: '50%', marginLeft: -8, background: 'var(--bg3)', border: '2px solid var(--bg2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, color: 'var(--text2)' }}>
                +{assignedEmployees.length - 4}
              </div>
            )}
            <span style={{ marginLeft: 14, fontSize: 13, color: 'var(--text2)' }}>
              <strong>{assignedEmployees.length}</strong> ta xodimga maqsad tayinlangan
            </span>
          </div>

          {/* Save button */}
          <button
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending || !dirty}
            style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 24px', borderRadius: 9, border: 0, fontSize: 13, fontWeight: 700, cursor: dirty ? 'pointer' : 'default', transition: 'all 0.15s', background: dirty ? '#1d4ed8' : 'var(--bg3)', color: dirty ? '#fff' : 'var(--text3)' }}
          >
            <CheckCircle2 size={15} />
            {saveMutation.isPending ? 'Saqlanmoqda…' : 'Maqsadlarni tasdiqlash'}
          </button>
        </div>
      </div>

      <BottomSections planId={planId} />
    </div>
  );
}

// ── Progress view ──────────────────────────────────────────────────

function ProgressView({ planId }: { planId: number }) {
  const { data, isLoading } = useQuery({
    queryKey: ['reja/progress', planId],
    queryFn:  () => getRejaProgress(planId),
  });

  if (isLoading) return <div style={{ padding: 56, textAlign: 'center', color: 'var(--text3)' }}>Yuklanmoqda…</div>;
  if (!data) return null;

  const { plan, subperiods, employees, summary } = data;
  if (!employees.length) return <div style={{ padding: 56, textAlign: 'center', color: 'var(--text3)', fontSize: 14 }}>Avval maqsadlarni taqsimlang</div>;

  const maxTarget = Math.max(...employees.map(e => e.target), 1);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '20px 24px 96px' }}>

      {/* Summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12 }}>
        {[
          { label: 'Jami reja',  value: summary.total_target, color: '#2563eb' },
          { label: 'Bajarildi', value: summary.total_actual,  color: '#16a34a' },
          { label: 'Qoldi',     value: Math.max(0, summary.total_target - summary.total_actual), color: 'var(--text)' },
        ].map(c => (
          <div key={c.label} style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 12, padding: '20px 24px' }}>
            <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 8 }}>{c.label}</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: c.color }}>
              {CURRENCY_SIGN}{fmtUZS(c.value)} <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text3)' }}>{CURRENCY}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Overall progress bar */}
      <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 12, padding: '16px 24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{periodLabel(plan)} – umumiy bajarilish</div>
          <div style={{ fontSize: 15, fontWeight: 700, color: summary.pct >= 100 ? '#16a34a' : summary.pct >= 70 ? '#d97706' : '#ef4444' }}>{summary.pct}%</div>
        </div>
        <div style={{ height: 8, borderRadius: 4, background: 'var(--border)', overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${Math.min(summary.pct, 100)}%`, borderRadius: 4, transition: 'width 0.3s', background: summary.pct >= 100 ? '#16a34a' : summary.pct >= 70 ? '#f59e0b' : '#2563eb' }} />
        </div>
      </div>

      {/* Per-employee table with sub-periods */}
      <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 14, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 700 }}>
            <thead>
              <tr style={{ background: 'var(--bg2)' }}>
                <th style={{ padding: '11px 14px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid var(--border)', position: 'sticky', left: 0, background: 'var(--bg2)', zIndex: 2, minWidth: 180 }}>Xodim</th>
                <th style={{ padding: '11px 14px', textAlign: 'right', fontSize: 11, fontWeight: 700, color: '#2563eb', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid var(--border)', minWidth: 130 }}>Reja</th>
                {subperiods.map(sp => (
                  <th key={sp.index} style={{ padding: '11px 14px', textAlign: 'center', fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid var(--border)', minWidth: 110 }}>{sp.label}</th>
                ))}
                <th style={{ padding: '11px 14px', textAlign: 'right', fontSize: 11, fontWeight: 700, color: '#16a34a', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid var(--border)', minWidth: 130 }}>Bajarildi</th>
                <th style={{ padding: '11px 14px', textAlign: 'center', fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid var(--border)', minWidth: 70 }}>%</th>
              </tr>
            </thead>
            <tbody>
              {employees.map((emp, i) => (
                <tr key={emp.responsible_id} style={{ background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.012)' }}>
                  {/* Name */}
                  <td style={{ padding: '12px 14px', borderBottom: '1px solid var(--border)', position: 'sticky', left: 0, background: 'var(--bg)', zIndex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ width: 30, height: 30, borderRadius: '50%', background: avatarColor(emp.full_name), display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: '#fff', flexShrink: 0 }}>
                        {initials(emp.full_name)}
                      </div>
                      <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{emp.full_name}</span>
                    </div>
                  </td>

                  {/* Total target + bar */}
                  <td style={{ padding: '12px 14px', textAlign: 'right', borderBottom: '1px solid var(--border)' }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{CURRENCY_SIGN}{fmtUZS(emp.target)}</div>
                    <div style={{ height: 3, marginTop: 4, borderRadius: 2, background: 'var(--border)', overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${Math.min((emp.target / maxTarget) * 100, 100)}%`, background: '#2563eb', borderRadius: 2 }} />
                    </div>
                  </td>

                  {/* Sub-period columns */}
                  {emp.subperiods.map(sp => {
                    const met      = sp.actual >= sp.target * 0.9;
                    const exceeded = sp.actual > sp.target;
                    const barColor = sp.isPast
                      ? exceeded ? '#16a34a' : met ? '#f59e0b' : '#ef4444'
                      : '#2563eb';
                    const barW = sp.target > 0 ? Math.min((sp.actual / sp.target) * 100, 100) : 0;

                    return (
                      <td key={sp.index} style={{
                        padding: '10px 14px', textAlign: 'center',
                        borderBottom: '1px solid var(--border)',
                        borderLeft: sp.isCurrent ? '2px solid rgba(37,99,235,0.35)' : '1px solid var(--border)',
                        borderRight: sp.isCurrent ? '2px solid rgba(37,99,235,0.35)' : 'none',
                        background: sp.isCurrent ? 'rgba(37,99,235,0.04)' : 'transparent',
                      }}>
                        {/* Recalculated target (small, grey) */}
                        <div style={{ fontSize: 10.5, color: 'var(--text3)', marginBottom: 3 }}>{CURRENCY_SIGN}{fmtUZS(sp.target)}</div>
                        {/* Actual (bold, coloured for past) */}
                        <div style={{ fontSize: 13, fontWeight: 700, color: sp.isPast ? (exceeded ? '#16a34a' : met ? '#d97706' : '#ef4444') : sp.actual > 0 ? '#2563eb' : 'var(--text3)' }}>
                          {sp.actual > 0 ? `${CURRENCY_SIGN}${fmtUZS(sp.actual)}` : '—'}
                        </div>
                        {/* Mini bar */}
                        <div style={{ height: 3, marginTop: 4, borderRadius: 2, background: 'var(--border)', overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: `${barW}%`, background: barColor, borderRadius: 2 }} />
                        </div>
                      </td>
                    );
                  })}

                  {/* Total actual */}
                  <td style={{ padding: '12px 14px', textAlign: 'right', borderBottom: '1px solid var(--border)' }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: emp.total_actual > 0 ? '#16a34a' : 'var(--text3)' }}>
                      {CURRENCY_SIGN}{fmtUZS(emp.total_actual)}
                    </div>
                  </td>

                  {/* % badge */}
                  <td style={{ padding: '12px 14px', textAlign: 'center', borderBottom: '1px solid var(--border)' }}>
                    <span style={{ fontSize: 11.5, fontWeight: 700, padding: '3px 8px', borderRadius: 5, background: emp.pct >= 100 ? '#dcfce7' : emp.pct >= 70 ? '#fef9c3' : 'rgba(239,68,68,0.1)', color: emp.pct >= 100 ? '#166534' : emp.pct >= 70 ? '#854d0e' : '#ef4444' }}>
                      {emp.pct}%
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div style={{ fontSize: 11.5, color: 'var(--text3)', lineHeight: 1.6 }}>
        * Har bir tugallangan davr uchun asl natija hisobga olinadi. Qolgan davrlar uchun maqsad = (jami reja − o'tgan davrlar summasi) / qolgan davrlar soni.
      </div>
    </div>
  );
}

// ── Page root ──────────────────────────────────────────────────────

export default function RejaPage() {
  const [selectedPlan, setSelectedPlan] = useState<RejaPlan | null>(null);
  const [showCreate,   setShowCreate]   = useState(false);
  const [view, setView]                 = useState<'distribution' | 'progress'>('distribution');

  const plansQ = useQuery({ queryKey: ['reja/plans'], queryFn: getRejaPlans });
  const plans  = plansQ.data ?? [];

  useEffect(() => {
    if (!selectedPlan && plans.length > 0) setSelectedPlan(plans[0]);
  }, [plans, selectedPlan]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, overflow: 'hidden', background: 'var(--bg2)' }}>
      <Topbar
        title="Savdo Boshqaruvi"
        actions={
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <PlanDropdown
              plans={plans}
              selected={selectedPlan}
              onSelect={p => { setSelectedPlan(p); setView('distribution'); }}
              onCreateClick={() => setShowCreate(true)}
            />

            {selectedPlan && (
              <div style={{ display: 'flex', background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
                {([
                  { id: 'distribution', icon: Settings2, label: 'Taqsimlash' },
                  { id: 'progress',     icon: BarChart3,  label: 'Progress'   },
                ] as const).map((tab, i) => (
                  <button
                    key={tab.id}
                    onClick={() => setView(tab.id)}
                    style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', border: 0, borderRight: i === 0 ? '1px solid var(--border)' : 'none', background: view === tab.id ? 'rgba(37,99,235,0.12)' : 'transparent', color: view === tab.id ? '#2563eb' : 'var(--text2)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}
                  >
                    <tab.icon size={13} /> {tab.label}
                  </button>
                ))}
              </div>
            )}

            <button onClick={() => setShowCreate(true)} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 8, border: 0, background: '#1d4ed8', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
              <Plus size={14} /> Yangi reja
            </button>
          </div>
        }
      />

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', overscrollBehavior: 'contain' }}>
        {!selectedPlan ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '60%', gap: 16, color: 'var(--text3)' }}>
            <BarChart3 size={48} strokeWidth={1} />
            <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text2)' }}>Hali reja yaratilmagan</div>
            <button onClick={() => setShowCreate(true)} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 22px', borderRadius: 9, border: 0, background: '#1d4ed8', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
              <Plus size={15} /> Birinchi rejani yarating
            </button>
          </div>
        ) : view === 'distribution' ? (
          <DistributionView planId={selectedPlan.id} onDeleted={() => setSelectedPlan(null)} />
        ) : (
          <ProgressView planId={selectedPlan.id} />
        )}
      </div>

      {showCreate && (
        <CreatePlanModal
          onClose={() => setShowCreate(false)}
          onCreated={plan => { setSelectedPlan(plan); setView('distribution'); setShowCreate(false); }}
        />
      )}
    </div>
  );
}

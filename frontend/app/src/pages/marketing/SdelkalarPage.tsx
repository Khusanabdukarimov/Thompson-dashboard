import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { useDarkMode } from "@/hooks/useDarkMode";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import {
  RefreshCw, Search,
  TrendingUp, DollarSign, CheckCircle, Percent, ShoppingCart,
  ChevronDown, Users, BarChart2,
} from "lucide-react";
import { Topbar } from "@/components/Topbar";
import { Button } from "@/components/Button";
import {
  getDealKpiStats, getDealsList, getDealFilterOptions,
  getDealsConversion, getDealsResponsibles, getDealSourceStats,
} from "@/lib/api/deals";
import { getDealCancelReasons } from "@/lib/api/leads";
import { fmtNum } from "@/lib/utils";

// ── Helpers ──────────────────────────────────────────────────────
const localISO = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const todayISO = () => localISO(new Date());
const daysAgoISO = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return localISO(d); };

function fmtMoney(v: number) {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(0)}K`;
  return `$${fmtNum(Math.round(v))}`;
}


// ── KPI card ─────────────────────────────────────────────────────
function KpiCard({ label, value, sub, gradient, lightGradient, icon }: {
  label: string; value: string; sub?: string;
  gradient: string; lightGradient: string; icon: React.ReactNode;
}) {
  const { theme } = useDarkMode();
  const isDark = theme === 'dark';
  return (
    <div style={{
      borderRadius: 12, padding: "16px 18px", background: isDark ? gradient : lightGradient,
      border: isDark ? "none" : "1px solid var(--border)",
      display: "flex", flexDirection: "column", gap: 6, minWidth: 0
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: 11, color: isDark ? "rgba(255,255,255,.7)" : "var(--text3)", fontWeight: 500 }}>{label}</span>
        <span style={{ opacity: .6, color: isDark ? "#fff" : "var(--text2)" }}>{icon}</span>
      </div>
      <div style={{ fontSize: 24, fontWeight: 700, color: isDark ? "#fff" : "var(--text)", lineHeight: 1.2 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: isDark ? "rgba(255,255,255,.55)" : "var(--text3)" }}>{sub}</div>}
    </div>
  );
}

// ── Colored TH for analytics tables (LidlarPage style) ───────────
const THc = (color: string, minW = 120): React.CSSProperties => ({
  padding: "11px 14px", textAlign: "left", fontSize: 12, fontWeight: 700,
  color, textTransform: "uppercase", letterSpacing: "0.04em",
  background: "var(--bg2)", borderBottom: "1px solid var(--border)",
  whiteSpace: "nowrap", minWidth: minW,
});
const TDa: React.CSSProperties = {
  padding: "10px 14px", verticalAlign: "middle",
  borderBottom: "1px solid var(--border)",
};

// ── AvatarCircle ─────────────────────────────────────────────────
const AVATAR_COLORS = [
  "#2196F3", "#E91E63", "#9C27B0", "#00BCD4", "#FF9800",
  "#4CAF50", "#FF5722", "#3F51B5", "#009688", "#795548",
];
function AvatarCircle({ name, size = 34 }: { name: string; size?: number }) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const initials = parts.length >= 2
    ? (parts[0][0] + parts[1][0]).toUpperCase()
    : (parts[0]?.[0] ?? "?").toUpperCase();
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) & 0xffffffff;
  const bg = AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
  return (
    <div style={{
      width: size, height: size, borderRadius: "50%", background: bg, flexShrink: 0,
      display: "flex", alignItems: "center", justifyContent: "center",
      color: "#fff", fontSize: size * 0.36, fontWeight: 700, userSelect: "none",
    }}>{initials}</div>
  );
}

// ── MiniBar ───────────────────────────────────────────────────────
function MiniBar({ value, max, color, height = 3 }: { value: number; max: number; color: string; height?: number }) {
  const w = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div style={{ height, borderRadius: 2, background: "var(--bg4)", marginTop: 5, overflow: "hidden" }}>
      <div style={{ height: "100%", width: `${w}%`, background: color, borderRadius: 2, transition: "width 0.3s" }} />
    </div>
  );
}

// ── ConversionDonut ───────────────────────────────────────────────
function ConversionDonut({ pct, size = 38 }: { pct: number; size?: number }) {
  const sw = 3;
  const r = (size - sw * 2) / 2;
  const circ = 2 * Math.PI * r;
  const fill = circ - (Math.min(100, pct) / 100) * circ;
  if (pct <= 0) {
    return (
      <div style={{ width: size, height: size, position: "relative", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <svg width={size} height={size} style={{ position: "absolute" }}>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--border)" strokeWidth={sw} />
        </svg>
        <span style={{ fontSize: 10, color: "#555", zIndex: 1 }}>—</span>
      </div>
    );
  }
  const label = pct < 10 ? `${pct.toFixed(1)}%` : `${Math.round(pct)}%`;
  return (
    <div style={{ width: size, height: size, position: "relative", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <svg width={size} height={size} style={{ position: "absolute", transform: "rotate(-90deg)" }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--border)" strokeWidth={sw} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#4CAF50" strokeWidth={sw}
          strokeDasharray={circ} strokeDashoffset={fill} strokeLinecap="round" />
      </svg>
      <span style={{ fontSize: 9, color: "#4CAF50", fontWeight: 700, zIndex: 1 }}>{label}</span>
    </div>
  );
}

// ── MultiSelect for Sdelkalar ─────────────────────────────────────
function SdelkaMultiSelect({ label, options, values, onChange, loading }: {
  label: string;
  options: { value: string; label: string }[];
  values: string[];
  onChange: (v: string[]) => void;
  loading?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);

  const toggle = (v: string) => onChange(values.includes(v) ? values.filter(x => x !== v) : [...values, v]);

  const displayLabel = values.length === 0
    ? "Barchasi"
    : values.length === 1 ? (options.find(o => o.value === values[0])?.label ?? values[0]).slice(0, 20) : `${values.length} ta tanlangan`;

  return (
    <div ref={ref} style={{ flex: 1, minWidth: 140, position: "relative" }}>
      <div style={{ fontSize: 11, color: "var(--text3)", marginBottom: 4 }}>{label}</div>
      <button type="button" onClick={() => setOpen(o => !o)}
        style={{
          width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "7px 10px", fontSize: 12, background: "var(--bg3)",
          border: `1px solid ${values.length > 0 ? "rgba(59,130,246,0.5)" : "var(--border)"}`,
          color: values.length > 0 ? "#3b82f6" : "var(--text3)", borderRadius: 8, cursor: "pointer", boxSizing: "border-box",
        }}>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {loading ? "Yuklanmoqda…" : displayLabel}
        </span>
        <ChevronDown size={12} style={{ flexShrink: 0, marginLeft: 4, transform: open ? "rotate(180deg)" : "none" }} />
      </button>
      {open && (
        <div style={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 300, background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 8, boxShadow: "0 4px 20px rgba(0,0,0,0.5)", maxHeight: 220, overflowY: "auto", marginTop: 4 }}>
          {values.length > 0 && (
            <div style={{ padding: "6px 12px", borderBottom: "1px solid var(--border)" }}>
              <button type="button" onClick={() => onChange([])} style={{ fontSize: 11, color: "#9E9E9E", background: "none", border: "none", cursor: "pointer", padding: 0 }}>Hammasini olib tashlash</button>
            </div>
          )}
          {options.map(o => {
            const checked = values.includes(o.value);
            return (
              <label key={o.value} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 12px", cursor: "pointer", background: checked ? "rgba(59,130,246,0.08)" : "transparent" }}>
                <input type="checkbox" checked={checked} onChange={() => toggle(o.value)} style={{ accentColor: "#3b82f6", flexShrink: 0 }} />
                <span style={{ fontSize: 12, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{o.label}</span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Deal stage columns for "mas'ullar kesimida" table ─────────────
const DEAL_STAGE_COLS = [
  { key: "konsultatsiya", label: "Konsultatsiyadan o'tdi", color: "#2196F3" },
  { key: "jarayonda",     label: "Jarayonda",              color: "#FF9800" },
  { key: "taklif",        label: "Taklif tayyorlash",      color: "#00BCD4" },
  { key: "taqdimot",      label: "Taqdimot qilindi",       color: "#9C27B0" },
  { key: "manzur",        label: "Mijozga manzur bo'ldi",  color: "#E91E63" },
  { key: "shartnoma",     label: "Shartnoma yuborildi",    color: "#009688" },
  { key: "kelishuv",      label: "Kelishuv bo'ldi",        color: "#4CAF50" },
  { key: "tolov",         label: "To'lov qisman",          color: "#FFC107" },
  { key: "ish_boshlandi", label: "Ish boshlandi",          color: "#3F51B5" },
  { key: "sotuv_boldi",   label: "Sotuv bo'ldi",           color: "#00E676" },
  { key: "bekor_boldi",   label: "Bekor bo'ldi",           color: "#F44336" },
] as const;

// ── Page ─────────────────────────────────────────────────────────
export default function SdelkalarPage() {
  const [filterOpen, setFilterOpen] = useState(false);
  const [mode, setMode] = useState<'default' | 'amocrm' | 'bitrix24'>('default');

  const [filter, setFilter] = useState({
    from: daysAgoISO(365), to: todayISO(),
    responsible_ids: [] as string[],
    stage_ids: [] as string[],
    sources: [] as string[],
  });

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"" | "won" | "lost" | "active">("");
  const [page, setPage] = useState(1);
  const LIMIT = 20;

  const filterQ = useQuery({
    queryKey: ["deal-filter-options", mode],
    queryFn: () => getDealFilterOptions({ mode }),
    staleTime: 5 * 60_000,
  });

  const kpiQ = useQuery({
    queryKey: ["deals-kpi", filter, mode],
    queryFn: () => getDealKpiStats({
      from: filter.from, to: filter.to,
      responsible_id: filter.responsible_ids.join(',') || undefined,
      stage_id: filter.stage_ids.join(',') || undefined,
      source: filter.sources.join(',') || undefined,
      mode,
    }),
  });

  const listQ = useQuery({
    queryKey: ["deals-list", filter, search, status, page, mode],
    queryFn: () => getDealsList({
      from: filter.from, to: filter.to,
      responsible_id: filter.responsible_ids.join(',') || undefined,
      stage_id: filter.stage_ids.join(',') || undefined,
      source: filter.sources.join(',') || undefined,
      search: search || undefined,
      status: status || undefined,
      page, limit: LIMIT,
      mode,
    }),
    placeholderData: keepPreviousData,
  });

  const convQ = useQuery({
    queryKey: ["deals-conversion", filter.from, filter.to, mode],
    queryFn: () => getDealsConversion({ from: filter.from || undefined, to: filter.to || undefined, mode }),
    staleTime: 60_000,
  });

  const respQ = useQuery({
    queryKey: ["deals-responsibles", filter.from, filter.to, mode],
    queryFn: () => getDealsResponsibles({ from: filter.from || undefined, to: filter.to || undefined, mode }),
    staleTime: 60_000,
  });

  const cancelQ = useQuery({
    queryKey: ["stats/deal-cancel-reasons", filter],
    queryFn: () => getDealCancelReasons({
      start_date: filter.from || undefined,
      end_date: filter.to || undefined,
      responsible_ids: filter.responsible_ids.map(Number),
    }),
    staleTime: 60_000,
  });

  const sourceStatsQ = useQuery({
    queryKey: ["deals-source-stats", filter.from, filter.to, mode],
    queryFn: () => getDealSourceStats({ from: filter.from || undefined, to: filter.to || undefined, mode }),
    staleTime: 60_000,
  });

  const clearFilter = useCallback(() => {
    setFilter({ from: daysAgoISO(365), to: todayISO(), responsible_ids: [], stage_ids: [], sources: [] });
    setSearch("");
    setStatus("");
    setPage(1);
  }, []);

  const refresh = useCallback(() => {
    kpiQ.refetch();
    listQ.refetch();
    convQ.refetch();
    respQ.refetch();
    sourceStatsQ.refetch();
  }, [kpiQ, listQ, convQ, respQ, sourceStatsQ]);

  const kpi = kpiQ.data;

  const activeFilterCount = [
    filter.responsible_ids.length > 0,
    filter.stage_ids.length > 0,
    filter.sources.length > 0,
    filter.from !== daysAgoISO(365) || filter.to !== todayISO(),
  ].filter(Boolean).length;

  const respOptions = useMemo(() => (filterQ.data?.responsibles ?? []).map(r => ({ value: String(r.id), label: r.full_name })), [filterQ.data]);
  const stageOptions = useMemo(() => (filterQ.data?.stages ?? []).map(s => ({ value: String(s.id), label: s.name })), [filterQ.data]);
  const srcOptions = useMemo(() => (filterQ.data?.sources ?? []).map(s => ({ value: s.id, label: s.name })), [filterQ.data]);

  const PRESETS = [
    { label: "Bugun", f: todayISO(), t: todayISO() },
    { label: "7 kun", f: daysAgoISO(7), t: todayISO() },
    { label: "30 kun", f: daysAgoISO(30), t: todayISO() },
    { label: "90 kun", f: daysAgoISO(90), t: todayISO() },
    { label: "Barchasi", f: daysAgoISO(365), t: todayISO() },
  ];

  // ── Conversion table derived data ────────────────────────────────
  const convRows = convQ.data ?? [];
  const convMax = useMemo(() => ({
    total: Math.max(1, ...convRows.map(r => r.total)),
    jarayonda: Math.max(1, ...convRows.map(r => r.jarayonda)),
    sotuv_boldi: Math.max(1, ...convRows.map(r => r.sotuv_boldi)),
    bekor_boldi: Math.max(1, ...convRows.map(r => r.bekor_boldi)),
    jami_sotuv: Math.max(1, ...convRows.map(r => r.jami_sotuv)),
  }), [convRows]);
  const convTotals = useMemo(() => convRows.reduce(
    (acc, r) => ({
      total: acc.total + r.total,
      jarayonda: acc.jarayonda + r.jarayonda,
      sotuv_boldi: acc.sotuv_boldi + r.sotuv_boldi,
      bekor_boldi: acc.bekor_boldi + r.bekor_boldi,
      jami_sotuv: acc.jami_sotuv + Number(r.jami_sotuv),
    }),
    { total: 0, jarayonda: 0, sotuv_boldi: 0, bekor_boldi: 0, jami_sotuv: 0 }
  ), [convRows]);

  // ── Source stats derived data ────────────────────────────────────
  const srcStatRows = sourceStatsQ.data ?? [];
  const srcStatMax = useMemo(() => ({
    umumiy:     Math.max(1, ...srcStatRows.map(r => r.umumiy)),
    jarayonda:  Math.max(1, ...srcStatRows.map(r => r.jarayonda)),
    bekor_boldi: Math.max(1, ...srcStatRows.map(r => r.bekor_boldi)),
    sotuv_boldi: Math.max(1, ...srcStatRows.map(r => r.sotuv_boldi)),
  }), [srcStatRows]);
  const srcStatTotals = useMemo(() => srcStatRows.reduce(
    (acc, r) => ({
      umumiy:     acc.umumiy     + r.umumiy,
      jarayonda:  acc.jarayonda  + r.jarayonda,
      bekor_boldi: acc.bekor_boldi + r.bekor_boldi,
      sotuv_boldi: acc.sotuv_boldi + r.sotuv_boldi,
    }),
    { umumiy: 0, jarayonda: 0, bekor_boldi: 0, sotuv_boldi: 0 }
  ), [srcStatRows]);

  // ── Responsibles table derived data ──────────────────────────────
  const dealRespRows = respQ.data ?? [];
  const dealRespMax = useMemo(() => {
    const m: Record<string, number> = { total: 1 };
    for (const col of DEAL_STAGE_COLS)
      m[col.key] = Math.max(1, ...dealRespRows.map(r => (r as unknown as Record<string, number>)[col.key] ?? 0));
    return m;
  }, [dealRespRows]);
  const dealRespTotals = useMemo(() => {
    const t: Record<string, number> = { total: 0 };
    for (const col of DEAL_STAGE_COLS) t[col.key] = 0;
    for (const r of dealRespRows) {
      t.total += r.total;
      for (const col of DEAL_STAGE_COLS)
        t[col.key] += (r as unknown as Record<string, number>)[col.key] ?? 0;
    }
    return t;
  }, [dealRespRows]);

  return (
    <>
      <Topbar
        title="Sdelkalar"
        sub={`${filter.from} → ${filter.to}`}
        actions={
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {/* Mode Switcher */}
            <div style={{
              display: "flex", background: "var(--bg3)", border: "1px solid var(--border)",
              borderRadius: 8, padding: 3, gap: 2
            }}>
              <button
                onClick={() => { clearFilter(); setMode('default'); }}
                style={{
                  border: "none", borderRadius: 6, fontSize: 11.5, fontWeight: 600,
                  padding: "5px 12px", cursor: "pointer",
                  background: mode === 'default' ? "#3b82f6" : "transparent",
                  color: mode === 'default' ? "#fff" : "var(--text2)",
                  transition: "all 0.2s"
                }}
              >
                Barcha sdelkalar
              </button>
              <button
                onClick={() => { clearFilter(); setMode('bitrix24'); }}
                style={{
                  border: "none", borderRadius: 6, fontSize: 11.5, fontWeight: 600,
                  padding: "5px 12px", cursor: "pointer",
                  background: mode === 'bitrix24' ? "#22c55e" : "transparent",
                  color: mode === 'bitrix24' ? "#fff" : "var(--text2)",
                  transition: "all 0.2s"
                }}
              >
                Bitrix24
              </button>
              <button
                onClick={() => { clearFilter(); setMode('amocrm'); }}
                style={{
                  border: "none", borderRadius: 6, fontSize: 11.5, fontWeight: 600,
                  padding: "5px 12px", cursor: "pointer",
                  background: mode === 'amocrm' ? "#D97706" : "transparent",
                  color: mode === 'amocrm' ? "#fff" : "var(--text2)",
                  transition: "all 0.2s"
                }}
              >
                AmoCRM
              </button>
            </div>

            <Button onClick={refresh}><RefreshCw className="w-3.5 h-3.5" /> Yangilash</Button>
          </div>
        }
      />

      <div style={{ flex: 1, overflowY: "auto", padding: "18px 22px", background: "var(--bg)" }}>

        {/* ── Filter panel ── */}
        <div style={{
          background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 10,
          marginBottom: 16, overflow: "hidden",
          position: "sticky", top: 0, zIndex: 10,
        }}>
          <div
            style={{ padding: "10px 16px", display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}
            onClick={() => setFilterOpen(o => !o)}
          >
            <Search size={14} style={{ color: "var(--text3)" }} />
            <span style={{ fontSize: 12.5, color: "var(--text3)", flex: 1 }}>
              {`Filtr: ${filter.from} → ${filter.to}${activeFilterCount > 0 ? ` · ${activeFilterCount} ta qo'shimcha` : ""}`}
            </span>
            {mode === 'bitrix24' && (
              <span style={{ background: "rgba(34,197,94,0.15)", color: "#22c55e", border: "1px solid rgba(34,197,94,0.4)", borderRadius: 10, padding: "1px 8px", fontSize: 11, fontWeight: 700, marginRight: 6 }}>Bitrix24</span>
            )}
            {mode === 'amocrm' && (
              <span style={{ background: "rgba(217,119,6,0.15)", color: "#D97706", border: "1px solid rgba(217,119,6,0.4)", borderRadius: 10, padding: "1px 8px", fontSize: 11, fontWeight: 700, marginRight: 6 }}>AmoCRM</span>
            )}
            {activeFilterCount > 0 && (
              <span style={{ fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 20, background: "#3b82f6", color: "#fff" }}>{activeFilterCount} filtr</span>
            )}
            <ChevronDown size={14} style={{ color: "var(--text3)", transform: filterOpen ? "rotate(180deg)" : "none", transition: "transform .2s" }} />
          </div>

          {filterOpen && (
            <div style={{ borderTop: "1px solid var(--border)", padding: "16px 20px" }}>
              {/* Quick date presets */}
              <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
                {PRESETS.map(p => {
                  const active = filter.from === p.f && filter.to === p.t;
                  return (
                    <button key={p.label} onClick={() => setFilter(s => ({ ...s, from: p.f, to: p.t }))}
                      style={{
                        padding: "5px 14px", borderRadius: 20, fontSize: 12, cursor: "pointer",
                        background: active ? "#3b82f6" : "var(--bg3)",
                        border: `1px solid ${active ? "#3b82f6" : "var(--border)"}`,
                        color: active ? "#fff" : "var(--text2)", fontWeight: active ? 600 : 400,
                      }}>
                      {p.label}
                    </button>
                  );
                })}
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
                <div>
                  <div style={{ fontSize: 11, color: "var(--text3)", marginBottom: 4 }}>Dan (boshlanish)</div>
                  <input type="date" value={filter.from}
                    onChange={e => setFilter(s => ({ ...s, from: e.target.value }))}
                    style={{ width: "100%", padding: "8px 10px", fontSize: 12, background: "var(--bg3)", border: "1px solid var(--border)", color: "var(--text)", borderRadius: 8 }} />
                </div>
                <div>
                  <div style={{ fontSize: 11, color: "var(--text3)", marginBottom: 4 }}>Gacha (tugash)</div>
                  <input type="date" value={filter.to}
                    onChange={e => setFilter(s => ({ ...s, to: e.target.value }))}
                    style={{ width: "100%", padding: "8px 10px", fontSize: 12, background: "var(--bg3)", border: "1px solid var(--border)", color: "var(--text)", borderRadius: 8 }} />
                </div>
              </div>

              <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
                <SdelkaMultiSelect label="Mas'ul xodim" options={respOptions} values={filter.responsible_ids}
                  onChange={v => setFilter(s => ({ ...s, responsible_ids: v }))} loading={filterQ.isLoading} />
                <SdelkaMultiSelect label="Bosqich" options={stageOptions} values={filter.stage_ids}
                  onChange={v => setFilter(s => ({ ...s, stage_ids: v }))} loading={filterQ.isLoading} />
                <SdelkaMultiSelect label="Manba" options={srcOptions} values={filter.sources}
                  onChange={v => setFilter(s => ({ ...s, sources: v }))} loading={filterQ.isLoading} />
              </div>

              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingTop: 10, borderTop: "1px solid var(--border)" }}>
                <div style={{ display: "flex", gap: 6 }}>
                  <button onClick={() => { clearFilter(); setMode('default'); }}
                    style={{ background: mode === 'default' ? "rgba(59,130,246,0.1)" : "transparent", border: `1px solid ${mode === 'default' ? "rgba(59,130,246,0.4)" : "var(--border)"}`, color: mode === 'default' ? "#3b82f6" : "var(--text3)", borderRadius: 8, padding: "6px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                    Barcha sdelkalar
                  </button>
                  <button onClick={() => { clearFilter(); setMode('bitrix24'); }}
                    style={{ background: mode === 'bitrix24' ? "rgba(34,197,94,0.1)" : "transparent", border: `1px solid ${mode === 'bitrix24' ? "rgba(34,197,94,0.4)" : "var(--border)"}`, color: mode === 'bitrix24' ? "#22c55e" : "var(--text3)", borderRadius: 8, padding: "6px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                    Bitrix24
                  </button>
                  <button onClick={() => { clearFilter(); setMode('amocrm'); }}
                    style={{ background: mode === 'amocrm' ? "rgba(217,119,6,0.1)" : "transparent", border: `1px solid ${mode === 'amocrm' ? "rgba(217,119,6,0.4)" : "var(--border)"}`, color: mode === 'amocrm' ? "#D97706" : "var(--text3)", borderRadius: 8, padding: "6px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                    AmoCRM
                  </button>
                </div>
                {activeFilterCount > 0 && (
                  <button onClick={clearFilter} style={{ background: "none", border: "none", color: "#9E9E9E", fontSize: 12, cursor: "pointer", padding: "6px 10px" }}>Tozalash</button>
                )}
              </div>
            </div>
          )}
        </div>

        {/* ── KPI Cards ── */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(6,1fr)", gap: 12, marginBottom: 20 }}>
          <KpiCard label="Jami Sdelkalar" value={fmtNum(kpi?.total ?? 0)}
            sub="Barcha kelishuvlar" gradient="linear-gradient(135deg,#0d1b4a,#1a3a7a)"
            lightGradient="linear-gradient(135deg,rgba(33,150,243,0.07),rgba(59,130,246,0.12))"
            icon={<BarChart2 size={16} />} />
          <KpiCard label="Yangi Sdelkalar" value={fmtNum(kpi?.yangi ?? 0)}
            sub="Jarayondagi" gradient="linear-gradient(135deg,#1d4ed8,#3b82f6)"
            lightGradient="linear-gradient(135deg,rgba(59,130,246,0.07),rgba(99,157,246,0.12))"
            icon={<TrendingUp size={16} />} />
          <KpiCard label="Sotuv bo'ldi" value={fmtNum(kpi?.sotuv_boldi ?? 0)}
            sub="Muvaffaqiyatli" gradient="linear-gradient(135deg,#065f46,#10b981)"
            lightGradient="linear-gradient(135deg,rgba(4,150,107,0.07),rgba(16,185,129,0.12))"
            icon={<CheckCircle size={16} />} />
          <KpiCard label="Jami Sotuv" value={fmtMoney(kpi?.jami_sotuv ?? 0)}
            sub="Won sdelkalar daromadi" gradient="linear-gradient(135deg,#047857,#34d399)"
            lightGradient="linear-gradient(135deg,rgba(4,120,87,0.07),rgba(52,211,153,0.12))"
            icon={<DollarSign size={16} />} />
          <KpiCard label="O'rtacha Chek" value={fmtMoney(kpi?.ortacha_chek ?? 0)}
            sub="Won bo'yicha o'rtacha" gradient="linear-gradient(135deg,#92400e,#f59e0b)"
            lightGradient="linear-gradient(135deg,rgba(146,64,14,0.07),rgba(245,158,11,0.12))"
            icon={<ShoppingCart size={16} />} />
          <KpiCard label="Konversiya" value={`${kpi?.konversiya ?? 0}%`}
            sub="Won / Jami" gradient="linear-gradient(135deg,#5b21b6,#8b5cf6)"
            lightGradient="linear-gradient(135deg,rgba(91,33,182,0.07),rgba(139,92,246,0.12))"
            icon={<Percent size={16} />} />
        </div>

        {/* ══════════════════════════════════════════════════════════
            Sdelka va Konversiya table
        ══════════════════════════════════════════════════════════ */}
        <div style={{ background: "var(--bg2)", borderRadius: 12, overflow: "hidden", marginBottom: 16 }}>
          <div style={{ padding: "16px 20px 12px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 10 }}>
            <CheckCircle size={16} style={{ color: "#4CAF50" }} />
            <span style={{ fontSize: 18, fontWeight: 700, color: "var(--text)" }}>Sdelka va Konversiya</span>
            <span style={{ fontSize: 12, color: "var(--text3)" }}>{convRows.length} ta menejer</span>
          </div>

          {convQ.isLoading ? (
            <div style={{ padding: 24, color: "#666", fontSize: 13 }}>Yuklanmoqda…</div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
                <colgroup>
                  <col style={{ width: 44 }} />
                  <col style={{ width: 200 }} />
                  <col />
                  <col />
                  <col />
                  <col />
                  <col />
                  <col style={{ width: 84 }} />
                </colgroup>
                <thead>
                  <tr>
                    <th style={THc("#555", 44)}>#</th>
                    <th style={THc("#9E9E9E", 200)}>Menejer</th>
                    <th style={THc("#2196F3")}>Jami Sdelka</th>
                    <th style={THc("#FF9800")}>Jarayonda</th>
                    <th style={THc("#4CAF50")}>Sotuv bo'ldi</th>
                    <th style={THc("#F44336")}>Bekor bo'ldi</th>
                    <th style={THc("#00BCD4")}>Jami Sotuv ($)</th>
                    <th style={{ ...THc("#4CAF50", 84), textAlign: "center" }}>Konversiya</th>
                  </tr>
                </thead>
                <tbody>
                  {convRows.map((r, i) => {
                    const konv = r.total > 0 ? (r.sotuv_boldi / r.total) * 100 : 0;
                    return (
                      <tr key={r.responsible_id}
                        style={{ background: i % 2 === 0 ? "transparent" : "var(--bg)" }}
                        onMouseEnter={e => (e.currentTarget.style.background = "var(--bg3)")}
                        onMouseLeave={e => (e.currentTarget.style.background = i % 2 === 0 ? "transparent" : "var(--bg)")}>
                        <td style={{ ...TDa, color: "#555", fontSize: 13, fontWeight: 600 }}>
                          {String(i + 1).padStart(2, "0")}
                        </td>
                        <td style={TDa}>
                          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                            <AvatarCircle name={r.full_name || "?"} size={34} />
                            <span style={{ fontSize: 13, color: "var(--text)", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {r.full_name}
                            </span>
                          </div>
                        </td>
                        <td style={TDa}>
                          <span style={{ fontSize: 15, fontWeight: 600, color: "var(--text)" }}>{fmtNum(r.total)}</span>
                          <MiniBar value={r.total} max={convMax.total} color="#2196F3" />
                        </td>
                        <td style={TDa}>
                          <span style={{ fontSize: 15, fontWeight: 600, color: "var(--text)" }}>{fmtNum(r.jarayonda)}</span>
                          <MiniBar value={r.jarayonda} max={convMax.jarayonda} color="#FF9800" />
                        </td>
                        <td style={TDa}>
                          <span style={{ fontSize: 15, fontWeight: 600, color: "var(--text)" }}>{fmtNum(r.sotuv_boldi)}</span>
                          <MiniBar value={r.sotuv_boldi} max={convMax.sotuv_boldi} color="#4CAF50" />
                        </td>
                        <td style={TDa}>
                          <span style={{ fontSize: 15, fontWeight: 600, color: "var(--text)" }}>{fmtNum(r.bekor_boldi)}</span>
                          <MiniBar value={r.bekor_boldi} max={convMax.bekor_boldi} color="#F44336" />
                        </td>
                        <td style={TDa}>
                          <span style={{ fontSize: 14, fontWeight: 600, color: "#00BCD4" }}>{fmtMoney(Number(r.jami_sotuv))}</span>
                          <MiniBar value={Number(r.jami_sotuv)} max={convMax.jami_sotuv} color="#00BCD4" />
                        </td>
                        <td style={{ ...TDa, textAlign: "center" }}>
                          <ConversionDonut pct={konv} size={38} />
                        </td>
                      </tr>
                    );
                  })}

                  {/* JAMI row */}
                  <tr style={{ background: "var(--bg3)", borderTop: "1px solid var(--border2)" }}>
                    <td style={{ ...TDa, color: "#666" }} />
                    <td style={{ ...TDa, fontSize: 13, fontWeight: 700, color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                      JAMI
                    </td>
                    <td style={TDa}>
                      <span style={{ fontSize: 16, fontWeight: 700, color: "var(--text)" }}>{fmtNum(convTotals.total)}</span>
                      <MiniBar value={1} max={1} color="#2196F3" />
                    </td>
                    <td style={TDa}>
                      <span style={{ fontSize: 16, fontWeight: 700, color: "var(--text)" }}>{fmtNum(convTotals.jarayonda)}</span>
                      <MiniBar value={1} max={1} color="#FF9800" />
                    </td>
                    <td style={TDa}>
                      <span style={{ fontSize: 16, fontWeight: 700, color: "var(--text)" }}>{fmtNum(convTotals.sotuv_boldi)}</span>
                      <MiniBar value={1} max={1} color="#4CAF50" />
                    </td>
                    <td style={TDa}>
                      <span style={{ fontSize: 16, fontWeight: 700, color: "var(--text)" }}>{fmtNum(convTotals.bekor_boldi)}</span>
                      <MiniBar value={1} max={1} color="#F44336" />
                    </td>
                    <td style={TDa}>
                      <span style={{ fontSize: 15, fontWeight: 700, color: "#00BCD4" }}>{fmtMoney(convTotals.jami_sotuv)}</span>
                      <MiniBar value={1} max={1} color="#00BCD4" />
                    </td>
                    <td style={{ ...TDa, textAlign: "center" }}>
                      <ConversionDonut pct={convTotals.total > 0 ? (convTotals.sotuv_boldi / convTotals.total) * 100 : 0} size={38} />
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ══════════════════════════════════════════════════════════
            Sdelka mas'ullar kesimida table
        ══════════════════════════════════════════════════════════ */}
        <div style={{ background: "var(--bg2)", borderRadius: 12, overflow: "hidden", marginBottom: 24 }}>
          <div style={{ padding: "16px 20px 12px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 10 }}>
            <Users size={16} style={{ color: "var(--text3)" }} />
            <span style={{ fontSize: 18, fontWeight: 700, color: "var(--text)" }}>Sdelka mas'ullar kesimida</span>
            <span style={{ fontSize: 12, color: "var(--text3)" }}>{dealRespRows.length} ta xodim</span>
          </div>

          {respQ.isLoading ? (
            <div style={{ padding: 24, color: "#666", fontSize: 13 }}>Yuklanmoqda…</div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "auto" }}>
                <thead>
                  <tr>
                    <th style={{ ...THc("#555", 44), position: "sticky", left: 0, zIndex: 6 }}>#</th>
                    <th style={{ ...THc("#9E9E9E", 180), position: "sticky", left: 44, zIndex: 6 }}>Mas'ul</th>
                    {DEAL_STAGE_COLS.map(col => (
                      <th key={col.key} style={THc(col.color)}>{col.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {dealRespRows.map((u, i) => (
                    <tr key={u.responsible_id}
                      style={{ background: i % 2 === 0 ? "transparent" : "var(--bg)" }}
                      onMouseEnter={e => (e.currentTarget.style.background = "var(--bg3)")}
                      onMouseLeave={e => (e.currentTarget.style.background = i % 2 === 0 ? "transparent" : "var(--bg)")}>
                      <td style={{ ...TDa, color: "#555", fontSize: 13, fontWeight: 600, width: 44, position: "sticky", left: 0, background: "var(--bg2)" }}>
                        {String(i + 1).padStart(2, "0")}
                      </td>
                      <td style={{ ...TDa, width: 180, position: "sticky", left: 44, background: "var(--bg2)", zIndex: 2 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <AvatarCircle name={u.full_name || "?"} size={32} />
                          <span style={{ fontSize: 13, color: "var(--text)", fontWeight: 500, whiteSpace: "nowrap" }}>
                            {u.full_name}
                          </span>
                        </div>
                      </td>
                      {DEAL_STAGE_COLS.map(col => {
                        const cnt = (u as unknown as Record<string, number>)[col.key] ?? 0;
                        const max = dealRespMax[col.key] ?? 1;
                        return (
                          <td key={col.key} style={{ ...TDa, minWidth: 120 }}>
                            {cnt > 0 ? (
                              <>
                                <span style={{ fontSize: 13, color: "var(--text)" }}>{fmtNum(cnt)}</span>
                                <MiniBar value={cnt} max={max} color={col.color} height={3} />
                              </>
                            ) : (
                              <span style={{ fontSize: 13, color: "var(--text3)" }}>—</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}

                  {/* JAMI row */}
                  <tr style={{ background: "var(--bg3)", borderTop: "1px solid var(--border2)" }}>
                    <td style={{ ...TDa, position: "sticky", left: 0, background: "var(--bg3)" }} />
                    <td style={{ ...TDa, fontSize: 13, fontWeight: 700, color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.06em", position: "sticky", left: 44, background: "var(--bg3)", zIndex: 2 }}>
                      JAMI
                    </td>
                    {DEAL_STAGE_COLS.map(col => (
                      <td key={col.key} style={TDa}>
                        <span style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>
                          {fmtNum(dealRespTotals[col.key] ?? 0)}
                        </span>
                        <MiniBar value={1} max={1} color={col.color} />
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ══════════════════════════════════════════════════════════
            Bekor bo'lish sabablari
        ══════════════════════════════════════════════════════════ */}
        {(() => {
          const cancelItems = (cancelQ.data?.items ?? []).map((r) => ({
            ...r,
            total: parseInt(String(r.total), 10) || 0,
          }));
          const cancelMax = Math.max(1, ...cancelItems.map((r) => r.total));
          const cancelTotal = cancelItems.reduce((s, r) => s + r.total, 0);

          return (
            <div style={{ display: "grid", gridTemplateColumns: "1fr", marginBottom: 20 }}>
              <div style={{ background: "var(--bg2)", borderRadius: 12, border: "1px solid var(--border)", overflow: "hidden" }}>
                <div style={{
                  padding: "14px 20px 12px",
                  borderBottom: "1px solid var(--border)",
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                }}>
                  <span style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>Bekor bo'lish sabablari</span>
                  <span style={{ fontSize: 20, fontWeight: 800, color: "#FFC107" }}>{fmtNum(cancelTotal)}</span>
                </div>
                {cancelQ.isLoading ? (
                  <div style={{ padding: 24, color: "#666", fontSize: 13 }}>Yuklanmoqda…</div>
                ) : cancelItems.length === 0 ? (
                  <div style={{ padding: 24, color: "#555", fontSize: 13 }}>Ma'lumot yo'q</div>
                ) : (
                  <div style={{ padding: "6px 0 10px" }}>
                    {cancelItems.map((r, i) => (
                      <div key={i} style={{ padding: "7px 20px" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 5 }}>
                          <span style={{ fontSize: 12, color: "var(--text2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "80%" }}>
                            {r.reason}
                          </span>
                          <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", flexShrink: 0, marginLeft: 8 }}>
                            {fmtNum(r.total)}
                          </span>
                        </div>
                        <div style={{ height: 4, borderRadius: 2, background: "var(--bg4)", overflow: "hidden" }}>
                          <div style={{
                            height: "100%",
                            width: `${(r.total / cancelMax) * 100}%`,
                            background: "#FFC107",
                            borderRadius: 2,
                            transition: "width 0.3s",
                          }} />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })()}


        {/* ══════════════════════════════════════════════════════════
            Manba bo'yicha table
        ══════════════════════════════════════════════════════════ */}
        <div style={{ background: "var(--bg2)", borderRadius: 12, overflow: "hidden", marginBottom: 24 }}>
          <div style={{ padding: "16px 20px 12px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 10 }}>
            <BarChart2 size={16} style={{ color: "#9C27B0" }} />
            <span style={{ fontSize: 18, fontWeight: 700, color: "var(--text)" }}>Manba bo'yicha</span>
            <span style={{ fontSize: 12, color: "var(--text3)" }}>{srcStatRows.length} ta manba</span>
          </div>

          {sourceStatsQ.isLoading ? (
            <div style={{ padding: 24, color: "#666", fontSize: 13 }}>Yuklanmoqda…</div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
                <colgroup>
                  <col style={{ width: 44 }} />
                  <col style={{ minWidth: 200 }} />
                  <col />
                  <col />
                  <col />
                  <col />
                </colgroup>
                <thead>
                  <tr>
                    <th style={THc("#555", 44)}>#</th>
                    <th style={THc("#9E9E9E", 200)}>Manba</th>
                    <th style={THc("#2196F3")}>Umumiy</th>
                    <th style={THc("#FF9800")}>Jarayonda</th>
                    <th style={THc("#F44336")}>Bekor bo'ldi</th>
                    <th style={THc("#4CAF50")}>Sotuv bo'ldi</th>
                  </tr>
                </thead>
                <tbody>
                  {srcStatRows.map((r, i) => (
                    <tr key={r.source_id}
                      style={{ background: i % 2 === 0 ? "transparent" : "var(--bg)" }}
                      onMouseEnter={e => (e.currentTarget.style.background = "var(--bg3)")}
                      onMouseLeave={e => (e.currentTarget.style.background = i % 2 === 0 ? "transparent" : "var(--bg)")}>
                      <td style={{ ...TDa, color: "#555", fontSize: 13, fontWeight: 600 }}>
                        {String(i + 1).padStart(2, "0")}
                      </td>
                      <td style={{ ...TDa, fontSize: 13, color: "var(--text)", fontWeight: 500 }}>
                        {r.source_name}
                      </td>
                      <td style={TDa}>
                        <span style={{ fontSize: 15, fontWeight: 600, color: "var(--text)" }}>{fmtNum(r.umumiy)}</span>
                        <MiniBar value={r.umumiy} max={srcStatMax.umumiy} color="#2196F3" />
                      </td>
                      <td style={TDa}>
                        <span style={{ fontSize: 15, fontWeight: 600, color: "var(--text)" }}>{fmtNum(r.jarayonda)}</span>
                        <MiniBar value={r.jarayonda} max={srcStatMax.jarayonda} color="#FF9800" />
                      </td>
                      <td style={TDa}>
                        <span style={{ fontSize: 15, fontWeight: 600, color: "var(--text)" }}>{fmtNum(r.bekor_boldi)}</span>
                        <MiniBar value={r.bekor_boldi} max={srcStatMax.bekor_boldi} color="#F44336" />
                      </td>
                      <td style={TDa}>
                        <span style={{ fontSize: 15, fontWeight: 600, color: "var(--text)" }}>{fmtNum(r.sotuv_boldi)}</span>
                        <MiniBar value={r.sotuv_boldi} max={srcStatMax.sotuv_boldi} color="#4CAF50" />
                      </td>
                    </tr>
                  ))}

                  {/* JAMI row */}
                  <tr style={{ background: "var(--bg3)", borderTop: "1px solid var(--border2)" }}>
                    <td style={{ ...TDa, color: "#666" }} />
                    <td style={{ ...TDa, fontSize: 13, fontWeight: 700, color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                      JAMI
                    </td>
                    <td style={TDa}>
                      <span style={{ fontSize: 16, fontWeight: 700, color: "var(--text)" }}>{fmtNum(srcStatTotals.umumiy)}</span>
                      <MiniBar value={1} max={1} color="#2196F3" />
                    </td>
                    <td style={TDa}>
                      <span style={{ fontSize: 16, fontWeight: 700, color: "var(--text)" }}>{fmtNum(srcStatTotals.jarayonda)}</span>
                      <MiniBar value={1} max={1} color="#FF9800" />
                    </td>
                    <td style={TDa}>
                      <span style={{ fontSize: 16, fontWeight: 700, color: "var(--text)" }}>{fmtNum(srcStatTotals.bekor_boldi)}</span>
                      <MiniBar value={1} max={1} color="#F44336" />
                    </td>
                    <td style={TDa}>
                      <span style={{ fontSize: 16, fontWeight: 700, color: "var(--text)" }}>{fmtNum(srcStatTotals.sotuv_boldi)}</span>
                      <MiniBar value={1} max={1} color="#4CAF50" />
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </div>

        {(kpiQ.error || listQ.error) && (
          <div style={{
            marginTop: 12, padding: "10px 14px", borderRadius: 8, fontSize: 12,
            background: "rgba(239,68,68,.1)", border: "1px solid rgba(239,68,68,.25)", color: "#ef4444"
          }}>
            Xatolik: {((kpiQ.error ?? listQ.error) as Error).message}
          </div>
        )}
      </div>
    </>
  );
}

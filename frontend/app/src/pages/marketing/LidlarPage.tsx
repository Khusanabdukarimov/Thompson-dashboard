import { useMemo, useState, useRef, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  RefreshCw, Calendar, Users, Star, TrendingUp, Filter,
  Percent, ArrowLeftRight, Target, XCircle, ChevronDown, Search,
} from "lucide-react";
import { Topbar } from "@/components/Topbar";
import { Button } from "@/components/Button";
import {
  getDashboardStats, getResponsiblesStats, getConversionStats,
  getFilterOptions, getTasksSummary, getCancelReasons, getJunkReasons,
  getAmocrmSources,
  type DashFilter,
} from "@/lib/api/leads";
import { fmtNum } from "@/lib/utils";
import { useLocalStorage } from "@/hooks/useLocalStorage";

// ── Date helpers ──────────────────────────────────────────────────
const localISO = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const todayISO   = () => localISO(new Date());
const daysAgoISO = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return localISO(d); };

const getDefaultFilter = (): DashFilter => ({
  start_date: daysAgoISO(365),
  end_date: todayISO(),
});

// ── Responsible table column definitions ─────────────────────────
const RESPONSIBLE_COLS = [
  { key: "qongiroqlar",             label: "Qo'ng'iroqlar",            color: "#9E9E9E" },
  { key: "yangi_lid",               label: "Yangi lid",                color: "#2196F3" },
  { key: "propushenniy",            label: "Propushenniy",             color: "#9E9E9E" },
  { key: "javob_bermadi",           label: "Javob bermadi",            color: "#FF9800" },
  { key: "qayta_aloqa",             label: "Qayta aloqa",              color: "#00BCD4" },
  { key: "oylab_koradi",            label: "O'ylab ko'radi",           color: "#E91E63" },
  { key: "konsultatsiya",           label: "Konsultatsiya belgilandi", color: "#9C27B0" },
  { key: "otkazilmadi",             label: "O'tkazilmadi",             color: "#FF00FF" },
  { key: "konsultatsiya_otkazildi", label: "Konsultatsiya o'tkazildi", color: "#4CAF50" },
  { key: "sandiq",                  label: "Sandiq",                   color: "#42A5F5" },
  { key: "sifatsiz",                label: "Sifatsiz",                 color: "#F44336" },
  { key: "bekor_boldi",             label: "Bekor bo'ldi",             color: "#FFC107" },
] as const;
type RespColKey = typeof RESPONSIBLE_COLS[number]["key"];

// ── Shared mini-components ────────────────────────────────────────
const AVATAR_COLORS = [
  "#2196F3","#E91E63","#9C27B0","#00BCD4","#FF9800",
  "#4CAF50","#FF5722","#3F51B5","#009688","#795548",
];

function AvatarCircle({ name, size = 36 }: { name: string; size?: number }) {
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
    }}>
      {initials}
    </div>
  );
}

function MiniBar({ value, max, color, height = 3 }: { value: number; max: number; color: string; height?: number }) {
  const w = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div style={{ height, borderRadius: 2, background: "var(--bg4)", marginTop: 5, overflow: "hidden" }}>
      <div style={{ height: "100%", width: `${w}%`, background: color, borderRadius: 2, transition: "width 0.3s" }} />
    </div>
  );
}

function ConversionDonut({ pct, size = 38 }: { pct: number; size?: number }) {
  const sw = 3;
  const r  = (size - sw * 2) / 2;
  const circ = 2 * Math.PI * r;
  const fill = circ - (Math.min(100, pct) / 100) * circ;
  if (pct <= 0) {
    return (
      <div style={{ width: size, height: size, position: "relative", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <svg width={size} height={size} style={{ position: "absolute" }}>
          <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="var(--border)" strokeWidth={sw} />
        </svg>
        <span style={{ fontSize: 10, color: "#555", zIndex: 1 }}>—</span>
      </div>
    );
  }
  const label = pct < 10 ? `${pct.toFixed(1)}%` : `${Math.round(pct)}%`;
  return (
    <div style={{ width: size, height: size, position: "relative", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <svg width={size} height={size} style={{ position: "absolute", transform: "rotate(-90deg)" }}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="var(--border)" strokeWidth={sw} />
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="#4CAF50" strokeWidth={sw}
                strokeDasharray={circ} strokeDashoffset={fill} strokeLinecap="round" />
      </svg>
      <span style={{ fontSize: 9, color: "#4CAF50", fontWeight: 700, zIndex: 1 }}>{label}</span>
    </div>
  );
}

// ── Sparkline ─────────────────────────────────────────────────────
// Catmull-Rom → cubic Bézier smooth path
function smoothPath(pts: [number, number][]): string {
  if (pts.length < 2) return "";
  const d: string[] = [`M ${pts[0][0]},${pts[0][1]}`];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    const cp1x = p1[0] + (p2[0] - p0[0]) / 6;
    const cp1y = p1[1] + (p2[1] - p0[1]) / 6;
    const cp2x = p2[0] - (p3[0] - p1[0]) / 6;
    const cp2y = p2[1] - (p3[1] - p1[1]) / 6;
    d.push(`C ${cp1x.toFixed(1)},${cp1y.toFixed(1)} ${cp2x.toFixed(1)},${cp2y.toFixed(1)} ${p2[0]},${p2[1]}`);
  }
  return d.join(" ");
}

function Sparkline({ color, variant = 0 }: { color: string; variant?: number }) {
  // Sine-wave–style control points: y=0 is top, y=60 is bottom; peaks ~10, troughs ~52
  const variants: [number, number][][] = [
    // 0: Blue — classic 2.5-cycle sine wave
    [[0,42],[25,54],[50,28],[75,10],[100,28],[125,52],[150,30],[175,10],[200,28]],
    // 1: Teal — phase-shifted, starts at mid-rise
    [[0,28],[25,10],[50,30],[75,52],[100,32],[125,10],[150,32],[175,54],[200,36]],
    // 2: Purple — slightly stretched, 2 full cycles
    [[0,36],[30,52],[60,28],[90,10],[120,28],[150,52],[175,32],[200,12]],
    // 3: Green — upward-trending wave (used for conversion)
    [[0,54],[30,46],[58,32],[85,18],[110,30],[135,42],[158,26],[180,14],[200,12]],
  ];
  const pts = variants[variant % variants.length];
  const linePath = smoothPath(pts);
  const areaPath = `${linePath} L 200,60 L 0,60 Z`;
  const last = pts[pts.length - 1];
  const gid = `spk${variant}${color.replace(/[^a-z0-9]/gi, "")}`;
  return (
    <svg viewBox="0 0 200 60" preserveAspectRatio="none" style={{ width: "100%", height: 80, display: "block" }}>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor={color} stopOpacity="0.52" />
          <stop offset="100%" stopColor={color} stopOpacity="0.03" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#${gid})`} />
      <path d={linePath} fill="none" stroke={color} strokeWidth="2.5"
            strokeLinecap="round" strokeLinejoin="round" opacity="0.95" />
      <circle cx={last[0]} cy={last[1]} r="3.5" fill={color} />
    </svg>
  );
}

// ── Gradient card shell ───────────────────────────────────────────
type GradCardProps = {
  gradient: string; border: string; shadow: string;
  icon: React.ReactNode; title: string; children: React.ReactNode;
  sparkColor: string; sparkVariant?: number;
};
function GradCard({ gradient, border, shadow, icon, title, children, sparkColor, sparkVariant = 0 }: GradCardProps) {
  return (
    <div style={{
      background: gradient, border: `1px solid ${border}`, boxShadow: shadow,
      borderRadius: 16, padding: "16px 16px 0 16px",
      display: "flex", flexDirection: "column", overflow: "hidden", minHeight: 200,
    }}>
      <div style={{
        width: 36, height: 36, borderRadius: "50%",
        background: border.replace(/[\d.]+\)$/, "0.18)"),
        display: "flex", alignItems: "center", justifyContent: "center",
        marginBottom: 8, flexShrink: 0,
      }}>
        {icon}
      </div>
      <div style={{ fontSize: 12, fontWeight: 600, color: "#fff", marginBottom: 3 }}>{title}</div>
      {children}
      <div style={{ marginTop: "auto", marginLeft: -16, marginRight: -16 }}>
        <Sparkline color={sparkColor} variant={sparkVariant} />
      </div>
    </div>
  );
}

// ── Shared table header cell style ────────────────────────────────
const TH = (color: string, minW = 140): React.CSSProperties => ({
  padding: "11px 14px", textAlign: "left", fontSize: 12, fontWeight: 700,
  color, textTransform: "uppercase", letterSpacing: "0.04em",
  background: "var(--bg2)", borderBottom: "1px solid var(--border)",
  whiteSpace: "nowrap", minWidth: minW,
});
const TD: React.CSSProperties = {
  padding: "10px 14px", verticalAlign: "middle",
  borderBottom: "1px solid var(--border)",
};

// ─────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────
export default function LidlarPage() {
  const [filterOpen, setFilterOpen] = useState(false);
  const filterRef = useRef<HTMLDivElement>(null);
  const [search, setSearch] = useState("");
  const [mode, setMode] = useState<'default' | 'amocrm'>('default');

  const [applied, setApplied] = useLocalStorage<DashFilter>("lidlar.filter.v2", getDefaultFilter());
  const [pending, setPending] = useState<DashFilter>(applied);

  useEffect(() => {
    if (!filterOpen) return;
    const handler = (e: MouseEvent) => {
      if (filterRef.current && !filterRef.current.contains(e.target as Node))
        setFilterOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [filterOpen]);

  const filterOptsQ = useQuery({
    queryKey: ["filter-options"],
    queryFn: getFilterOptions,
    staleTime: 5 * 60 * 1000,
  });
  const filterOpts = filterOptsQ.data;

  const amocrmSrcQ = useQuery({
    queryKey: ["amocrm-sources"],
    queryFn: getAmocrmSources,
    staleTime: 10 * 60 * 1000,
    enabled: mode === 'amocrm',
  });

  const def = getDefaultFilter();
  const activeCount = [
    applied.responsible_id != null,
    applied.stage != null,
    applied.source != null,
    applied.start_date !== def.start_date || applied.end_date !== def.end_date,
  ].filter(Boolean).length;

  const appliedWithMode = { ...applied, mode };

  const statsQ      = useQuery({ queryKey: ["stats/dashboard",    appliedWithMode], queryFn: () => getDashboardStats(appliedWithMode) });
  const respQ       = useQuery({ queryKey: ["stats/responsibles", appliedWithMode], queryFn: () => getResponsiblesStats(appliedWithMode) });
  const conversionQ = useQuery({ queryKey: ["stats/conversion",   appliedWithMode], queryFn: () => getConversionStats(appliedWithMode) });
  const tasksQ      = useQuery({ queryKey: ["stats/tasks",        appliedWithMode], queryFn: () => getTasksSummary(appliedWithMode) });
  const cancelQ     = useQuery({ queryKey: ["stats/cancel-reasons", appliedWithMode], queryFn: () => getCancelReasons(appliedWithMode) });
  const junkQ       = useQuery({ queryKey: ["stats/junk-reasons",   appliedWithMode], queryFn: () => getJunkReasons(appliedWithMode) });

  const header       = statsQ.data?.header;
  const responsibles = respQ.data?.responsibles ?? [];

  const total             = header?.total_leads                    ?? 0;
  const sifatsizBekor     = header?.sifatsiz_bekor_count           ?? 0;
  const sifatliLid        = header?.sifatli_lid_count              ?? 0;
  const konsultBelgilandi = header?.konsultatsiya_belgilandi_count  ?? 0;
  const konsultOtkazildi  = header?.konsultatsiya_otkazildi_count   ?? 0;

  const sifatliKonvPct   = total > 0 ? (sifatliLid        / total) * 100 : 0;
  const leadToConsultPct = total > 0 ? (konsultBelgilandi / total) * 100 : 0;
  const overallConvPct   = total > 0 ? (konsultOtkazildi  / total) * 100 : 0;

  const byUserFiltered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return s ? responsibles.filter((u) => u.full_name.toLowerCase().includes(s)) : responsibles;
  }, [responsibles, search]);

  const colMaxes = useMemo(() => {
    const m: Partial<Record<RespColKey, number>> = {};
    for (const col of RESPONSIBLE_COLS)
      m[col.key] = Math.max(1, ...responsibles.map((u) => (u as unknown as Record<string, number>)[col.key] ?? 0));
    return m;
  }, [responsibles]);

  const totalsRow = useMemo(() => {
    const bs: Partial<Record<RespColKey, number>> = {};
    for (const u of responsibles)
      for (const col of RESPONSIBLE_COLS)
        bs[col.key] = (bs[col.key] ?? 0) + ((u as unknown as Record<string, number>)[col.key] ?? 0);
    return bs;
  }, [responsibles]);

  const isLoading = statsQ.isLoading;

  // ── Lid va Konversiya rows (sorted by total desc) ───────────────
  const convRows = useMemo(() => {
    const rows = [...(conversionQ.data?.conversion ?? [])];
    rows.sort((a, b) => b.total - a.total);
    return rows;
  }, [conversionQ.data]);

  const convMax = useMemo(() => ({
    total:    Math.max(1, ...convRows.map((r) => r.total)),
    jarayonda: Math.max(1, ...convRows.map((r) => r.jarayonda)),
    sifatsiz:  Math.max(1, ...convRows.map((r) => r.sifatsiz_lid)),
    otkazildi: Math.max(1, ...convRows.map((r) => r.tashrif_buyurdi)),
  }), [convRows]);

  const convTotals = useMemo(() => convRows.reduce(
    (acc, r) => ({
      total:    acc.total    + r.total,
      jarayonda: acc.jarayonda + r.jarayonda,
      sifatsiz:  acc.sifatsiz  + r.sifatsiz_lid,
      otkazildi: acc.otkazildi + r.tashrif_buyurdi,
    }),
    { total: 0, jarayonda: 0, sifatsiz: 0, otkazildi: 0 }
  ), [convRows]);

  return (
    <>
      <Topbar
        title="Lidlar analitika"
        actions={
          <Button onClick={() => { statsQ.refetch(); respQ.refetch(); conversionQ.refetch(); }}>
            <RefreshCw className="w-3.5 h-3.5" /> Yangilash
          </Button>
        }
      />

      <div className="flex-1 overflow-y-auto px-[22px] py-[18px]" style={{ background: "var(--bg)" }}>

        {/* ── Filter panel ── */}
        <div ref={filterRef} style={{ position: "relative", marginBottom: 20 }}>
          {/* Trigger button */}
          <button
            onClick={() => { setPending({ ...applied }); setFilterOpen((o) => !o); }}
            style={{
              display: "flex", alignItems: "center", gap: 10, width: "100%",
              background: "var(--bg2)",
              border: `1px solid ${filterOpen ? "#2196F3" : activeCount > 0 || mode === 'amocrm' ? "rgba(33,150,243,0.5)" : "var(--border)"}`,
              borderRadius: filterOpen ? "10px 10px 0 0" : 10,
              padding: "10px 16px", color: "#fff", fontSize: 13, fontWeight: 500,
              cursor: "pointer", textAlign: "left",
            }}
          >
            <Search size={16} style={{ color: "#9E9E9E", flexShrink: 0 }} />
            <span style={{ color: "#666", flex: 1 }}>Qidirish va filtrlash…</span>
            {mode === 'amocrm' && (
              <span style={{
                background: "rgba(217,119,6,0.15)", color: "#D97706",
                border: "1px solid rgba(217,119,6,0.4)",
                borderRadius: 10, padding: "2px 9px", fontSize: 11, fontWeight: 700,
              }}>
                AmoCRM
              </span>
            )}
            {activeCount > 0 && (
              <span style={{
                background: "#2196F3", color: "#fff", borderRadius: 10,
                padding: "2px 9px", fontSize: 11, fontWeight: 700,
              }}>
                {activeCount} filtr
              </span>
            )}
            <ChevronDown size={16} style={{
              color: "#9E9E9E",
              transform: filterOpen ? "rotate(180deg)" : "none",
              transition: "transform 0.2s",
            }} />
          </button>

          {/* Dropdown */}
          {filterOpen && (
            <div style={{
              position: "absolute", left: 0, right: 0, zIndex: 100,
              background: "var(--bg2)", border: "1px solid var(--border)", borderTop: "none",
              borderRadius: "0 0 12px 12px", boxShadow: "0 8px 32px rgba(0,0,0,0.6)",
            }}>
              <div style={{ display: "flex" }}>
                {/* Left sidebar — presets */}
                <div style={{
                  width: "26%", borderRight: "1px solid var(--border)",
                  padding: "16px 12px", flexShrink: 0,
                }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: "#444", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10 }}>
                    Saqlangan filtrlar
                  </div>
                  <button
                    onClick={() => { const d = getDefaultFilter(); setPending(d); setApplied(d); setMode('default'); }}
                    style={{
                      width: "100%", textAlign: "left",
                      background: mode === 'default' ? "rgba(33,150,243,0.08)" : "transparent",
                      border: `1px solid ${mode === 'default' ? "rgba(33,150,243,0.3)" : "var(--border)"}`,
                      borderRadius: 8,
                      color: mode === 'default' ? "#2196F3" : "var(--text2)",
                      fontSize: 12, fontWeight: 600,
                      padding: "8px 12px", cursor: "pointer", marginBottom: 6,
                    }}
                  >
                    Barcha lidlar
                  </button>
                  <button
                    onClick={() => { const d = getDefaultFilter(); setPending(d); setApplied(d); setMode('amocrm'); }}
                    style={{
                      width: "100%", textAlign: "left",
                      background: mode === 'amocrm' ? "rgba(217,119,6,0.10)" : "transparent",
                      border: `1px solid ${mode === 'amocrm' ? "rgba(217,119,6,0.4)" : "var(--border)"}`,
                      borderRadius: 8,
                      color: mode === 'amocrm' ? "#D97706" : "var(--text2)",
                      fontSize: 12, fontWeight: 600,
                      padding: "8px 12px", cursor: "pointer", marginBottom: 8,
                    }}
                  >
                    AmoCRM
                  </button>
                  <div style={{
                    border: "1px dashed var(--border)", borderRadius: 8,
                    padding: "12px 10px", color: "#444", fontSize: 11, textAlign: "center",
                  }}>
                    Saqlangan filtr yo'q
                  </div>
                </div>

                {/* Right form */}
                <div style={{ flex: 1, padding: "16px 20px" }}>
                  {/* Quick date presets */}
                  {(() => {
                    const presets = [
                      { label: "Bugun",   start: todayISO(),       end: todayISO() },
                      { label: "7 kun",   start: daysAgoISO(7),    end: todayISO() },
                      { label: "30 kun",  start: daysAgoISO(30),   end: todayISO() },
                      { label: "90 kun",  start: daysAgoISO(90),   end: todayISO() },
                      { label: "Barchasi", start: "",               end: "" },
                    ];
                    return (
                      <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap" }}>
                        {presets.map((p) => {
                          const active = pending.start_date === (p.start || undefined) && pending.end_date === (p.end || undefined);
                          return (
                            <button
                              key={p.label}
                              onClick={() => setPending((prev) => ({
                                ...prev,
                                start_date: p.start || undefined,
                                end_date:   p.end   || undefined,
                              }))}
                              style={{
                                background: active ? "#2196F3" : "var(--bg3)",
                                border: `1px solid ${active ? "#2196F3" : "var(--border)"}`,
                                color: active ? "#fff" : "#9E9E9E",
                                borderRadius: 20, padding: "5px 14px",
                                fontSize: 12, fontWeight: active ? 600 : 400,
                                cursor: "pointer", transition: "all 0.15s",
                              }}
                            >
                              {p.label}
                            </button>
                          );
                        })}
                      </div>
                    );
                  })()}

                  {/* Date row */}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
                    <div>
                      <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 600, color: "#9E9E9E", marginBottom: 6 }}>
                        <Calendar size={12} />{mode === 'amocrm' ? "Dan (amoCRM)" : "Dan (boshlanish)"}
                      </label>
                      <input
                        type="date"
                        value={pending.start_date ?? ""}
                        onChange={(e) => setPending((p) => ({ ...p, start_date: e.target.value || undefined }))}
                        style={{
                          width: "100%", background: "var(--bg)", border: "1px solid var(--border)",
                          borderRadius: 8, color: "#fff", fontSize: 12, padding: "8px 10px",
                          outline: "none", boxSizing: "border-box",
                        }}
                      />
                    </div>
                    <div>
                      <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 600, color: "#9E9E9E", marginBottom: 6 }}>
                        <Calendar size={12} />{mode === 'amocrm' ? "Gacha (amoCRM)" : "Gacha (tugash)"}
                      </label>
                      <input
                        type="date"
                        value={pending.end_date ?? ""}
                        onChange={(e) => setPending((p) => ({ ...p, end_date: e.target.value || undefined }))}
                        style={{
                          width: "100%", background: "var(--bg)", border: "1px solid var(--border)",
                          borderRadius: 8, color: "#fff", fontSize: 12, padding: "8px 10px",
                          outline: "none", boxSizing: "border-box",
                        }}
                      />
                    </div>
                  </div>

                  {/* Dropdown filters row */}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
                    <div>
                      <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 600, color: "#9E9E9E", marginBottom: 6 }}>
                        <Users size={12} />Mas'ul xodim
                      </label>
                      <select
                        value={pending.responsible_id ?? ""}
                        onChange={(e) => setPending((p) => ({ ...p, responsible_id: e.target.value ? Number(e.target.value) : undefined }))}
                        style={{
                          width: "100%", background: "var(--bg)", border: "1px solid var(--border)",
                          borderRadius: 8, color: pending.responsible_id ? "#fff" : "#555",
                          fontSize: 12, padding: "8px 10px", outline: "none",
                          appearance: "none", cursor: "pointer",
                        }}
                      >
                        <option value="">Barchasi</option>
                        {filterOpts?.responsibles.map((r) => (
                          <option key={r.id} value={r.id}>{r.full_name}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 600, color: "#9E9E9E", marginBottom: 6 }}>
                        <Filter size={12} />Bosqich
                      </label>
                      <select
                        value={pending.stage ?? ""}
                        onChange={(e) => setPending((p) => ({ ...p, stage: e.target.value || undefined }))}
                        style={{
                          width: "100%", background: "var(--bg)", border: "1px solid var(--border)",
                          borderRadius: 8, color: pending.stage ? "#fff" : "#555",
                          fontSize: 12, padding: "8px 10px", outline: "none",
                          appearance: "none", cursor: "pointer",
                        }}
                      >
                        <option value="">Barchasi</option>
                        {filterOpts?.stages.map((s) => (
                          <option key={s.bitrix_id} value={s.bitrix_id}>{s.name}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 600, color: "#9E9E9E", marginBottom: 6 }}>
                        <TrendingUp size={12} />Manba
                      </label>
                      <select
                        value={pending.source ?? ""}
                        onChange={(e) => setPending((p) => ({ ...p, source: e.target.value || undefined }))}
                        style={{
                          width: "100%", background: "var(--bg)", border: "1px solid var(--border)",
                          borderRadius: 8, color: pending.source ? "#fff" : "#555",
                          fontSize: 12, padding: "8px 10px", outline: "none",
                          appearance: "none", cursor: "pointer",
                        }}
                      >
                        <option value="">Barchasi</option>
                        {mode === 'amocrm'
                          ? (amocrmSrcQ.data ?? []).map((s) => (
                              <option key={s} value={s}>{s}</option>
                            ))
                          : filterOpts?.sources.map((s) => (
                              <option key={s.id} value={s.id}>{s.name}</option>
                            ))
                        }
                      </select>
                    </div>
                  </div>
                </div>
              </div>

              {/* Bottom action bar */}
              <div style={{
                display: "flex", justifyContent: "flex-end", gap: 10,
                padding: "12px 20px", borderTop: "1px solid var(--border)",
              }}>
                <button
                  onClick={() => { const d = getDefaultFilter(); setPending(d); setApplied(d); setFilterOpen(false); }}
                  style={{
                    background: "var(--bg3)", border: "1px solid var(--border)", color: "#9E9E9E",
                    borderRadius: 8, padding: "8px 22px", fontSize: 13, fontWeight: 500, cursor: "pointer",
                  }}
                >
                  Tozalash
                </button>
                <button
                  onClick={() => { setApplied({ ...pending }); setFilterOpen(false); }}
                  style={{
                    background: "#2196F3", border: "none", color: "#fff",
                    borderRadius: 8, padding: "8px 22px", fontSize: 13, fontWeight: 600, cursor: "pointer",
                  }}
                >
                  Topish
                </button>
              </div>
            </div>
          )}
        </div>

        {/* ── Row 1 — 4 gradient KPI cards ── */}
        {isLoading ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 12 }}>
            {[0,1,2,3].map((i) => <div key={i} style={{ height: 200, borderRadius: 16, background: "var(--bg2)" }} />)}
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 12 }}>
            <GradCard gradient="linear-gradient(135deg,#0d1b4a,#1a3a7a)" border="rgba(33,150,243,0.3)"
                      shadow="0 4px 20px rgba(33,150,243,0.15)" icon={<Users size={20} style={{ color:"#2196F3" }} />}
                      title="Umumiy Lidlar" sparkColor="#2196F3" sparkVariant={0}>
              <div style={{ fontSize:36, fontWeight:800, color:"#fff", lineHeight:1.1, marginBottom:3 }}>{fmtNum(total)}</div>
              <div style={{ fontSize:11, color:"#9E9E9E" }}>Umumiy Lid</div>
            </GradCard>
            <GradCard gradient="linear-gradient(135deg,#002a2a,#005555)" border="rgba(0,188,212,0.3)"
                      shadow="0 4px 20px rgba(0,188,212,0.15)" icon={<Star size={20} style={{ color:"#00BCD4" }} />}
                      title="Sifatli Lidlar" sparkColor="#00BCD4" sparkVariant={1}>
              <div style={{ fontSize:36, fontWeight:800, color:"#00BCD4", lineHeight:1.1, marginBottom:3 }}>{fmtNum(sifatliLid)}</div>
              <div style={{ fontSize:11, color:"#9E9E9E" }}>Sifatli Lid</div>
            </GradCard>
            <GradCard gradient="linear-gradient(135deg,#1a0033,#3d1a6e)" border="rgba(156,39,176,0.3)"
                      shadow="0 4px 20px rgba(156,39,176,0.15)" icon={<Calendar size={20} style={{ color:"#9C27B0" }} />}
                      title="Konsultatsiyalar" sparkColor="#9C27B0" sparkVariant={2}>
              <div style={{ display:"flex", alignItems:"baseline", gap:5, lineHeight:1.1, marginBottom:3 }}>
                <span style={{ fontSize:36, fontWeight:800, color:"#4CAF50" }}>{fmtNum(konsultBelgilandi)}</span>
                <span style={{ fontSize:24, fontWeight:700, color:"#fff" }}>/</span>
                <span style={{ fontSize:36, fontWeight:800, color:"#fff" }}>{fmtNum(konsultOtkazildi)}</span>
              </div>
              <div style={{ fontSize:10 }}>
                <span style={{ color:"#4CAF50" }}>Belgilandi</span>
                <span style={{ color:"#9E9E9E" }}> / </span>
                <span style={{ color:"#4CAF50" }}>O'tkazildi</span>
              </div>
            </GradCard>
            <GradCard gradient="linear-gradient(135deg,#0a2e0a,#1b5e20)" border="rgba(76,175,80,0.3)"
                      shadow="0 4px 20px rgba(76,175,80,0.15)" icon={<TrendingUp size={20} style={{ color:"#4CAF50" }} />}
                      title="Yakuniy Konversiya" sparkColor="#4CAF50" sparkVariant={3}>
              <div style={{ fontSize:36, fontWeight:800, color:"#fff", lineHeight:1.1, marginBottom:3 }}>{overallConvPct.toFixed(1)}%</div>
              <div style={{ fontSize:11, color:"#9E9E9E" }}>Konversiya</div>
            </GradCard>
          </div>
        )}

        {/* ── Row 2 — Funnel Efficiency + Discarded ── */}
        {!isLoading && (
          <div style={{ display:"grid", gridTemplateColumns:"1fr 280px", gap:12, marginBottom:20 }}>
            <div style={{ background:"var(--bg2)", border:"1px solid var(--border)", borderRadius:16, padding:16, maxHeight:140 }}>
              <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:14 }}>
                <Filter size={15} style={{ color:"#9E9E9E" }} />
                <span style={{ fontSize:13, fontWeight:700, color:"#fff" }}>Voronka samaradorligi</span>
                <span style={{ fontSize:11, color:"#9E9E9E", marginLeft:2 }}>Konversiya ko'rsatkichlari</span>
              </div>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:12 }}>
                {[
                  { icon:<Percent size={18} style={{ color:"#00BCD4" }} />, bg:"rgba(0,188,212,0.15)", val:sifatliKonvPct,   color:"#00BCD4", title:"Sifatli Konversiya",   sub:"Sifatli / Umumiy" },
                  { icon:<ArrowLeftRight size={18} style={{ color:"#4CAF50" }} />, bg:"rgba(76,175,80,0.15)", val:leadToConsultPct, color:"#4CAF50", title:"Lid → Konsultatsiya", sub:"Umumiy → K.Belgilandi" },
                  { icon:<Target size={18} style={{ color:"#4CAF50" }} />, bg:"rgba(76,175,80,0.15)", val:overallConvPct,   color:"#4CAF50", title:"Umumiy Konversiya",    sub:"Umumiy → K.O'tkazildi" },
                ].map((m) => (
                  <div key={m.title} style={{ display:"flex", alignItems:"center", gap:12 }}>
                    <div style={{ width:36, height:36, borderRadius:"50%", background:m.bg, flexShrink:0, display:"flex", alignItems:"center", justifyContent:"center" }}>{m.icon}</div>
                    <div>
                      <div style={{ fontSize:11, fontWeight:600, color:"#fff", marginBottom:3 }}>{m.title}</div>
                      <div style={{ fontSize:24, fontWeight:800, color:m.color, lineHeight:1.1, marginBottom:3 }}>{m.val.toFixed(1)}%</div>
                      <div style={{ fontSize:10, color:"#9E9E9E" }}>{m.sub}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div style={{ background:"linear-gradient(135deg,#2a0000,#6e1a1a)", border:"1px solid rgba(244,67,54,0.3)",
                          boxShadow:"0 4px 20px rgba(244,67,54,0.15)", borderRadius:16,
                          padding:"16px 16px 0 16px", display:"flex", flexDirection:"column", overflow:"hidden", maxHeight:140 }}>
              <div style={{ display:"flex", alignItems:"center", gap:14 }}>
                <div style={{ width:40, height:40, borderRadius:"50%", background:"rgba(244,67,54,0.2)", flexShrink:0, display:"flex", alignItems:"center", justifyContent:"center" }}>
                  <XCircle size={20} style={{ color:"#F44336" }} />
                </div>
                <div>
                  <div style={{ fontSize:12, fontWeight:600, color:"#fff" }}>Sifatsiz / Bekor</div>
                  <div style={{ fontSize:36, fontWeight:800, color:"#F44336", lineHeight:1.1, marginTop:3 }}>{fmtNum(sifatsizBekor)}</div>
                  <div style={{ fontSize:11, color:"#9E9E9E", marginTop:2 }}>Bekor qilingan lidlar</div>
                </div>
              </div>
              <div style={{ marginTop:"auto", marginLeft:-16, marginRight:-16 }}>
                <Sparkline color="#F44336" variant={0} />
              </div>
            </div>
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════
            Lid va Konversiya table
        ══════════════════════════════════════════════════════════ */}
        <div style={{ background:"var(--bg2)", borderRadius:12, overflow:"hidden", marginBottom:16 }}>
          <div style={{ padding:"16px 20px 12px", borderBottom:"1px solid var(--border)" }}>
            <span style={{ fontSize:18, fontWeight:700, color:"#fff" }}>Lid va Konversiya</span>
          </div>

          {conversionQ.isLoading ? (
            <div style={{ padding:24, color:"#666", fontSize:13 }}>Yuklanmoqda…</div>
          ) : (
            <div style={{ overflowX:"auto" }}>
              <table style={{ width:"100%", borderCollapse:"collapse", tableLayout:"fixed" }}>
                <colgroup>
                  <col style={{ width:44 }} />
                  <col style={{ width:200 }} />
                  <col />
                  <col />
                  <col />
                  <col />
                  <col style={{ width:80 }} />
                </colgroup>
                <thead>
                  <tr>
                    <th style={TH("#555", 44)}>#</th>
                    <th style={TH("#9E9E9E", 200)}>Menejer</th>
                    <th style={TH("#2196F3")}>Jami Lid</th>
                    <th style={TH("#FF9800")}>Jarayonda</th>
                    <th style={TH("#F44336")}>Sifatsiz Lid</th>
                    <th style={TH("#4CAF50")}>Konsultatsiya O'tkazildi</th>
                    <th style={{ ...TH("#4CAF50", 80), textAlign:"center" }}>Konversiya</th>
                  </tr>
                </thead>
                <tbody>
                  {convRows.map((r, i) => {
                    const konv = r.total > 0 ? (r.tashrif_buyurdi / r.total) * 100 : 0;
                    return (
                      <tr key={r.responsible_id}
                          style={{ background: i % 2 === 0 ? "transparent" : "var(--bg)" }}
                          onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg3)")}
                          onMouseLeave={(e) => (e.currentTarget.style.background = i % 2 === 0 ? "transparent" : "var(--bg)")}>
                        <td style={{ ...TD, color:"#555", fontSize:13, fontWeight:600, width:44 }}>
                          {String(i + 1).padStart(2, "0")}
                        </td>
                        <td style={{ ...TD, width:200 }}>
                          <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                            <AvatarCircle name={r.full_name || "?"} size={34} />
                            <span style={{ fontSize:13, color:"#fff", fontWeight:500, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                              {r.full_name}
                            </span>
                          </div>
                        </td>
                        <td style={TD}>
                          <span style={{ fontSize:15, fontWeight:600, color:"#fff" }}>{fmtNum(r.total)}</span>
                          <MiniBar value={r.total} max={convMax.total} color="#2196F3" />
                        </td>
                        <td style={TD}>
                          <span style={{ fontSize:15, fontWeight:600, color:"#fff" }}>{fmtNum(r.jarayonda)}</span>
                          <MiniBar value={r.jarayonda} max={convMax.jarayonda} color="#FF9800" />
                        </td>
                        <td style={TD}>
                          <span style={{ fontSize:15, fontWeight:600, color:"#fff" }}>{fmtNum(r.sifatsiz_lid)}</span>
                          <MiniBar value={r.sifatsiz_lid} max={convMax.sifatsiz} color="#F44336" />
                        </td>
                        <td style={TD}>
                          <span style={{ fontSize:15, fontWeight:600, color:"#fff" }}>{fmtNum(r.tashrif_buyurdi)}</span>
                          <MiniBar value={r.tashrif_buyurdi} max={convMax.otkazildi} color="#4CAF50" />
                        </td>
                        <td style={{ ...TD, textAlign:"center" }}>
                          <ConversionDonut pct={konv} size={38} />
                        </td>
                      </tr>
                    );
                  })}

                  {/* JAMI row */}
                  <tr style={{ background:"var(--bg3)", borderTop:"1px solid var(--border2)" }}>
                    <td style={{ ...TD, color:"#666" }} />
                    <td style={{ ...TD, fontSize:13, fontWeight:700, color:"#9E9E9E", textTransform:"uppercase", letterSpacing:"0.06em" }}>
                      JAMI
                    </td>
                    <td style={TD}>
                      <span style={{ fontSize:16, fontWeight:700, color:"#fff" }}>{fmtNum(convTotals.total)}</span>
                      <MiniBar value={1} max={1} color="#2196F3" />
                    </td>
                    <td style={TD}>
                      <span style={{ fontSize:16, fontWeight:700, color:"#fff" }}>{fmtNum(convTotals.jarayonda)}</span>
                      <MiniBar value={1} max={1} color="#FF9800" />
                    </td>
                    <td style={TD}>
                      <span style={{ fontSize:16, fontWeight:700, color:"#fff" }}>{fmtNum(convTotals.sifatsiz)}</span>
                      <MiniBar value={1} max={1} color="#F44336" />
                    </td>
                    <td style={TD}>
                      <span style={{ fontSize:16, fontWeight:700, color:"#fff" }}>{fmtNum(convTotals.otkazildi)}</span>
                      <MiniBar value={1} max={1} color="#4CAF50" />
                    </td>
                    <td style={{ ...TD, textAlign:"center" }}>
                      <ConversionDonut pct={convTotals.total > 0 ? (convTotals.otkazildi / convTotals.total) * 100 : 0} size={38} />
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ══════════════════════════════════════════════════════════
            Lid mas'ullar kesimida table
        ══════════════════════════════════════════════════════════ */}
        <div style={{ background:"var(--bg2)", borderRadius:12, overflow:"hidden", marginBottom:24 }}>
          <div style={{ padding:"16px 20px 12px", borderBottom:"1px solid var(--border)", display:"flex", alignItems:"center", justifyContent:"space-between", flexWrap:"wrap", gap:8 }}>
            <div style={{ display:"flex", alignItems:"center", gap:12 }}>
              <span style={{ fontSize:18, fontWeight:700, color:"#fff" }}>Lid mas'ullar kesimida</span>
              <span style={{ fontSize:12, color:"#555" }}>{byUserFiltered.length} ta xodim</span>
            </div>
            {/* Search */}
            <div style={{ position:"relative", display:"inline-flex", alignItems:"center" }}>
              <Search size={14} style={{ position:"absolute", left:10, color:"#555", pointerEvents:"none" }} />
              <input
                type="text"
                placeholder="Qidirish…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{
                  paddingLeft:30, paddingRight:12, paddingTop:7, paddingBottom:7,
                  background:"var(--bg)", border:"1px solid var(--border)", borderRadius:8,
                  color:"#fff", fontSize:12, outline:"none", width:180,
                }}
              />
            </div>
          </div>

          {respQ.isLoading && !responsibles.length ? (
            <div style={{ padding:24, color:"#666", fontSize:13 }}>Yuklanmoqda…</div>
          ) : (
            <div style={{ overflowX:"auto" }}>
              <table style={{ width:"100%", borderCollapse:"collapse", tableLayout:"auto" }}>
                <thead>
                  <tr>
                    <th style={{ ...TH("#555", 44), position:"sticky", left:0, zIndex:6 }}>#</th>
                    <th style={{ ...TH("#9E9E9E", 180), position:"sticky", left:44, zIndex:6 }}>Mas'ul</th>
                    {RESPONSIBLE_COLS.map((col) => (
                      <th key={col.key} style={TH(col.color)}>{col.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {byUserFiltered.map((u, i) => (
                    <tr key={u.responsible_id}
                        style={{ background: i % 2 === 0 ? "transparent" : "var(--bg)" }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg3)")}
                        onMouseLeave={(e) => (e.currentTarget.style.background = i % 2 === 0 ? "transparent" : "var(--bg)")}>
                      <td style={{ ...TD, color:"#555", fontSize:13, fontWeight:600, width:44, position:"sticky", left:0, background:"var(--bg2)" }}>
                        {String(i + 1).padStart(2, "0")}
                      </td>
                      <td style={{ ...TD, width:180, position:"sticky", left:44, background:"var(--bg2)", zIndex:2 }}>
                        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                          <AvatarCircle name={u.full_name || `U${u.responsible_id}`} size={32} />
                          <span style={{ fontSize:13, color:"#fff", fontWeight:500, whiteSpace:"nowrap" }}>
                            {u.full_name || `User ${u.responsible_id}`}
                          </span>
                        </div>
                      </td>
                      {RESPONSIBLE_COLS.map((col) => {
                        const cnt = (u as unknown as Record<string, number>)[col.key] ?? 0;
                        const max = colMaxes[col.key] ?? 1;
                        return (
                          <td key={col.key} style={{ ...TD, minWidth:90 }}>
                            {cnt > 0 ? (
                              <>
                                <span style={{ fontSize:13, color:"#fff" }}>{fmtNum(cnt)}</span>
                                <MiniBar value={cnt} max={max} color={col.color} height={3} />
                              </>
                            ) : (
                              <span style={{ fontSize:13, color:"#333" }}>—</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}

                  {/* JAMI row */}
                  <tr style={{ background:"var(--bg3)", borderTop:"1px solid var(--border2)" }}>
                    <td style={{ ...TD, position:"sticky", left:0, background:"var(--bg3)" }} />
                    <td style={{ ...TD, fontSize:13, fontWeight:700, color:"#9E9E9E", textTransform:"uppercase", letterSpacing:"0.06em", position:"sticky", left:44, background:"var(--bg3)", zIndex:2 }}>
                      JAMI
                    </td>
                    {RESPONSIBLE_COLS.map((col) => (
                      <td key={col.key} style={TD}>
                        <span style={{ fontSize:13, fontWeight:700, color:"#fff" }}>{fmtNum(totalsRow[col.key] ?? 0)}</span>
                        <MiniBar value={1} max={1} color={col.color} height={3} />
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ══════════════════════════════════════════════════════════
            Vazifalar kesimida table
        ══════════════════════════════════════════════════════════ */}
        {(() => {
          // pg returns COUNT() as strings — parse to int before any arithmetic
          const taskRows = (tasksQ.data?.tasks ?? []).map((r) => ({
            ...r,
            total:       parseInt(String(r.total),       10) || 0,
            in_progress: parseInt(String(r.in_progress), 10) || 0,
            completed:   parseInt(String(r.completed),   10) || 0,
            overdue:     parseInt(String(r.overdue),     10) || 0,
          }));
          const taskMax = {
            total:       Math.max(1, ...taskRows.map((r) => r.total)),
            in_progress: Math.max(1, ...taskRows.map((r) => r.in_progress)),
            completed:   Math.max(1, ...taskRows.map((r) => r.completed)),
            overdue:     Math.max(1, ...taskRows.map((r) => r.overdue)),
          };
          const taskTotals = taskRows.reduce(
            (acc, r) => ({
              total:       acc.total       + r.total,
              in_progress: acc.in_progress + r.in_progress,
              completed:   acc.completed   + r.completed,
              overdue:     acc.overdue     + r.overdue,
            }),
            { total: 0, in_progress: 0, completed: 0, overdue: 0 }
          );
          return (
            <div style={{ background: "var(--bg2)", borderRadius: 12, overflow: "hidden", marginBottom: 24 }}>
              <div style={{ padding: "16px 20px 12px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 12 }}>
                <span style={{ fontSize: 18, fontWeight: 700, color: "#fff" }}>Vazifalar kesimida</span>
                <span style={{ fontSize: 12, color: "#555" }}>{taskRows.length} ta xodim</span>
              </div>

              {tasksQ.isLoading ? (
                <div style={{ padding: 24, color: "#666", fontSize: 13 }}>Yuklanmoqda…</div>
              ) : taskRows.length === 0 ? (
                <div style={{ padding: 24, color: "#555", fontSize: 13 }}>Vazifalar topilmadi</div>
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
                      <col style={{ width: 90 }} />
                    </colgroup>
                    <thead>
                      <tr>
                        <th style={TH("#555", 44)}>#</th>
                        <th style={TH("#9E9E9E", 200)}>Mas'ul</th>
                        <th style={TH("#9E9E9E")}>Jami Vazifalar</th>
                        <th style={TH("#FF9800")}>Jarayondagi</th>
                        <th style={TH("#4CAF50")}>Tugatilgan</th>
                        <th style={TH("#F44336")}>Muddati O'tgan</th>
                        <th style={{ ...TH("#2196F3", 90), textAlign: "center" }}>Bajarilish</th>
                      </tr>
                    </thead>
                    <tbody>
                      {taskRows.map((r, i) => {
                        const pct = r.total > 0 ? (r.completed / r.total) * 100 : 0;
                        return (
                          <tr key={r.responsible_id}
                              style={{ background: i % 2 === 0 ? "transparent" : "var(--bg)" }}
                              onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg3)")}
                              onMouseLeave={(e) => (e.currentTarget.style.background = i % 2 === 0 ? "transparent" : "var(--bg)")}>
                            <td style={{ ...TD, color: "#555", fontSize: 13, fontWeight: 600, width: 44 }}>
                              {String(i + 1).padStart(2, "0")}
                            </td>
                            <td style={{ ...TD, width: 200 }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                <AvatarCircle name={r.full_name || "?"} size={34} />
                                <span style={{ fontSize: 13, color: "#fff", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                  {r.full_name}
                                </span>
                              </div>
                            </td>
                            <td style={TD}>
                              <span style={{ fontSize: 15, fontWeight: 600, color: "#fff" }}>{fmtNum(r.total)}</span>
                              <MiniBar value={r.total} max={taskMax.total} color="#9E9E9E" />
                            </td>
                            <td style={TD}>
                              {r.in_progress > 0 ? (
                                <>
                                  <span style={{ fontSize: 14, color: "#fff" }}>{fmtNum(r.in_progress)}</span>
                                  <MiniBar value={r.in_progress} max={taskMax.in_progress} color="#FF9800" />
                                </>
                              ) : <span style={{ fontSize: 13, color: "#333" }}>—</span>}
                            </td>
                            <td style={TD}>
                              {r.completed > 0 ? (
                                <>
                                  <span style={{ fontSize: 14, color: "#fff" }}>{fmtNum(r.completed)}</span>
                                  <MiniBar value={r.completed} max={taskMax.completed} color="#4CAF50" />
                                </>
                              ) : <span style={{ fontSize: 13, color: "#333" }}>—</span>}
                            </td>
                            <td style={TD}>
                              {r.overdue > 0 ? (
                                <>
                                  <span style={{ fontSize: 14, color: "#F44336" }}>{fmtNum(r.overdue)}</span>
                                  <MiniBar value={r.overdue} max={taskMax.overdue} color="#F44336" />
                                </>
                              ) : <span style={{ fontSize: 13, color: "#333" }}>—</span>}
                            </td>
                            <td style={{ ...TD, textAlign: "center" }}>
                              <ConversionDonut pct={pct} size={38} />
                            </td>
                          </tr>
                        );
                      })}

                      {/* JAMI row */}
                      <tr style={{ background: "var(--bg3)", borderTop: "1px solid var(--border2)" }}>
                        <td style={{ ...TD, color: "#666" }} />
                        <td style={{ ...TD, fontSize: 13, fontWeight: 700, color: "#9E9E9E", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                          JAMI
                        </td>
                        <td style={TD}>
                          <span style={{ fontSize: 16, fontWeight: 700, color: "#fff" }}>{fmtNum(taskTotals.total)}</span>
                          <MiniBar value={1} max={1} color="#9E9E9E" />
                        </td>
                        <td style={TD}>
                          <span style={{ fontSize: 16, fontWeight: 700, color: "#fff" }}>{fmtNum(taskTotals.in_progress)}</span>
                          <MiniBar value={1} max={1} color="#FF9800" />
                        </td>
                        <td style={TD}>
                          <span style={{ fontSize: 16, fontWeight: 700, color: "#fff" }}>{fmtNum(taskTotals.completed)}</span>
                          <MiniBar value={1} max={1} color="#4CAF50" />
                        </td>
                        <td style={TD}>
                          <span style={{ fontSize: 16, fontWeight: 700, color: taskTotals.overdue > 0 ? "#F44336" : "#fff" }}>
                            {fmtNum(taskTotals.overdue)}
                          </span>
                          <MiniBar value={1} max={1} color="#F44336" />
                        </td>
                        <td style={{ ...TD, textAlign: "center" }}>
                          <ConversionDonut pct={taskTotals.total > 0 ? (taskTotals.completed / taskTotals.total) * 100 : 0} size={38} />
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })()}

        {/* ══════════════════════════════════════════════════════════
            Bekor bo'lish va Sifatsiz sabablari (side-by-side)
        ══════════════════════════════════════════════════════════ */}
        {(() => {
          const cancelItems = (cancelQ.data?.items ?? []).map((r) => ({
            ...r,
            total: parseInt(String(r.total), 10) || 0,
          }));
          const junkItems = (junkQ.data?.items ?? []).map((r) => ({
            ...r,
            total: parseInt(String(r.total), 10) || 0,
          }));
          const cancelMax   = Math.max(1, ...cancelItems.map((r) => r.total));
          const junkMax     = Math.max(1, ...junkItems.map((r) => r.total));
          const cancelTotal = cancelItems.reduce((s, r) => s + r.total, 0);
          const junkTotal   = junkItems.reduce((s, r) => s + r.total, 0);

          const renderTable = (
            title: string,
            items: { reason: string; total: number }[],
            max: number,
            grandTotal: number,
            barColor: string,
            loading: boolean,
          ) => (
            <div style={{ background: "var(--bg2)", borderRadius: 12, overflow: "hidden" }}>
              <div style={{
                padding: "14px 20px 12px",
                borderBottom: "1px solid var(--border)",
                display: "flex", alignItems: "center", justifyContent: "space-between",
              }}>
                <span style={{ fontSize: 15, fontWeight: 700, color: "#fff" }}>{title}</span>
                <span style={{ fontSize: 20, fontWeight: 800, color: barColor }}>{fmtNum(grandTotal)}</span>
              </div>
              {loading ? (
                <div style={{ padding: 24, color: "#666", fontSize: 13 }}>Yuklanmoqda…</div>
              ) : items.length === 0 ? (
                <div style={{ padding: 24, color: "#555", fontSize: 13 }}>Ma'lumot yo'q</div>
              ) : (
                <div style={{ padding: "6px 0 10px" }}>
                  {items.map((r, i) => (
                    <div key={i} style={{ padding: "7px 20px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 5 }}>
                        <span style={{ fontSize: 12, color: "#ccc", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "80%" }}>
                          {r.reason}
                        </span>
                        <span style={{ fontSize: 13, fontWeight: 700, color: "#fff", flexShrink: 0, marginLeft: 8 }}>
                          {fmtNum(r.total)}
                        </span>
                      </div>
                      <div style={{ height: 4, borderRadius: 2, background: "var(--bg4)", overflow: "hidden" }}>
                        <div style={{
                          height: "100%",
                          width: `${(r.total / max) * 100}%`,
                          background: barColor,
                          borderRadius: 2,
                          transition: "width 0.3s",
                        }} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );

          return (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 24 }}>
              {renderTable("Bekor bo'lish sabablari", cancelItems, cancelMax, cancelTotal, "#FFC107", cancelQ.isLoading)}
              {renderTable("Sifatsiz sabablari",       junkItems,   junkMax,   junkTotal,   "#F44336", junkQ.isLoading)}
            </div>
          );
        })()}

        {statsQ.error && (
          <div className="p-3 bg-red-bg border border-red-bd text-red rounded-lg text-[12.5px]">
            Xatolik: {(statsQ.error as Error).message}
          </div>
        )}
      </div>
    </>
  );
}

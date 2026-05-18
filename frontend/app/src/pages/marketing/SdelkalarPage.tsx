import { useState, useCallback, useMemo } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import {
  RefreshCw, Search, ChevronLeft, ChevronRight,
  TrendingUp, DollarSign, CheckCircle, Percent, ShoppingCart,
  ChevronDown, Filter, Users,
} from "lucide-react";
import { Topbar } from "@/components/Topbar";
import { Button } from "@/components/Button";
import {
  getDealKpiStats, getDealsList, getDealFilterOptions,
  getDealsConversion, getDealsResponsibles,
} from "@/lib/api/deals";
import type { DealRow } from "@/lib/api/deals";
import { getDealCancelReasons } from "@/lib/api/leads";
import { fmtNum } from "@/lib/utils";

// ── Helpers ──────────────────────────────────────────────────────
const localISO = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const todayISO   = () => localISO(new Date());
const daysAgoISO = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return localISO(d); };

function fmtMoney(v: number) {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000)     return `$${(v / 1_000).toFixed(0)}K`;
  return `$${fmtNum(Math.round(v))}`;
}
function fmtDate(iso: string) {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;
}

// ── Status badge ─────────────────────────────────────────────────
function StatusBadge({ row }: { row: DealRow }) {
  if (row.is_won)   return <span style={badge("green")}>Sotuv bo'ldi</span>;
  if (row.is_final) return <span style={badge("red")}>Bekor</span>;
  return <span style={badge("amber")}>Jarayonda</span>;
}

function badge(c: "green" | "red" | "amber"): React.CSSProperties {
  const m = {
    green: { bg: "rgba(16,185,129,.12)", color: "#10b981", border: "rgba(16,185,129,.25)" },
    red:   { bg: "rgba(239,68,68,.12)",  color: "#ef4444", border: "rgba(239,68,68,.25)" },
    amber: { bg: "rgba(245,158,11,.12)", color: "#f59e0b", border: "rgba(245,158,11,.25)" },
  }[c];
  return { display:"inline-flex", alignItems:"center", padding:"2px 8px", borderRadius:20,
    fontSize:11, fontWeight:600, background:m.bg, color:m.color, border:`1px solid ${m.border}` };
}

// ── KPI card ─────────────────────────────────────────────────────
function KpiCard({ label, value, sub, gradient, icon }: {
  label: string; value: string; sub?: string;
  gradient: string; icon: React.ReactNode;
}) {
  return (
    <div style={{ borderRadius:12, padding:"16px 18px", background:gradient,
      display:"flex", flexDirection:"column", gap:6, minWidth:0 }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
        <span style={{ fontSize:11, color:"rgba(255,255,255,.7)", fontWeight:500 }}>{label}</span>
        <span style={{ opacity:.6 }}>{icon}</span>
      </div>
      <div style={{ fontSize:24, fontWeight:700, color:"#fff", lineHeight:1.2 }}>{value}</div>
      {sub && <div style={{ fontSize:11, color:"rgba(255,255,255,.55)" }}>{sub}</div>}
    </div>
  );
}

// ── Table styles ─────────────────────────────────────────────────
const TH: React.CSSProperties = {
  padding:"10px 12px", fontSize:11, fontWeight:600, color:"var(--text3)",
  textAlign:"left", whiteSpace:"nowrap", background:"var(--bg2)",
  borderBottom:"1px solid var(--border)", position:"sticky", top:0,
};
const TD: React.CSSProperties = {
  padding:"9px 12px", fontSize:12.5, color:"var(--text)",
  borderBottom:"1px solid var(--border)", whiteSpace:"nowrap",
};

// ── Colored TH for analytics tables (LidlarPage style) ───────────
const THc = (color: string, minW = 120): React.CSSProperties => ({
  padding:"11px 14px", textAlign:"left", fontSize:12, fontWeight:700,
  color, textTransform:"uppercase", letterSpacing:"0.04em",
  background:"var(--bg2)", borderBottom:"1px solid var(--border)",
  whiteSpace:"nowrap", minWidth:minW,
});
const TDa: React.CSSProperties = {
  padding:"10px 14px", verticalAlign:"middle",
  borderBottom:"1px solid var(--border)",
};

// ── AvatarCircle ─────────────────────────────────────────────────
const AVATAR_COLORS = [
  "#2196F3","#E91E63","#9C27B0","#00BCD4","#FF9800",
  "#4CAF50","#FF5722","#3F51B5","#009688","#795548",
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
      width:size, height:size, borderRadius:"50%", background:bg, flexShrink:0,
      display:"flex", alignItems:"center", justifyContent:"center",
      color:"#fff", fontSize:size * 0.36, fontWeight:700, userSelect:"none",
    }}>{initials}</div>
  );
}

// ── MiniBar ───────────────────────────────────────────────────────
function MiniBar({ value, max, color, height = 3 }: { value: number; max: number; color: string; height?: number }) {
  const w = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div style={{ height, borderRadius:2, background:"var(--bg4)", marginTop:5, overflow:"hidden" }}>
      <div style={{ height:"100%", width:`${w}%`, background:color, borderRadius:2, transition:"width 0.3s" }} />
    </div>
  );
}

// ── ConversionDonut ───────────────────────────────────────────────
function ConversionDonut({ pct, size = 38 }: { pct: number; size?: number }) {
  const sw = 3;
  const r  = (size - sw * 2) / 2;
  const circ = 2 * Math.PI * r;
  const fill = circ - (Math.min(100, pct) / 100) * circ;
  if (pct <= 0) {
    return (
      <div style={{ width:size, height:size, position:"relative", display:"flex", alignItems:"center", justifyContent:"center" }}>
        <svg width={size} height={size} style={{ position:"absolute" }}>
          <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="var(--border)" strokeWidth={sw} />
        </svg>
        <span style={{ fontSize:10, color:"#555", zIndex:1 }}>—</span>
      </div>
    );
  }
  const label = pct < 10 ? `${pct.toFixed(1)}%` : `${Math.round(pct)}%`;
  return (
    <div style={{ width:size, height:size, position:"relative", display:"flex", alignItems:"center", justifyContent:"center" }}>
      <svg width={size} height={size} style={{ position:"absolute", transform:"rotate(-90deg)" }}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="var(--border)" strokeWidth={sw} />
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="#4CAF50" strokeWidth={sw}
                strokeDasharray={circ} strokeDashoffset={fill} strokeLinecap="round" />
      </svg>
      <span style={{ fontSize:9, color:"#4CAF50", fontWeight:700, zIndex:1 }}>{label}</span>
    </div>
  );
}

// ── Select dropdown ───────────────────────────────────────────────
function SelectFilter({ label, value, onChange, options }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div style={{ flex:1, minWidth:140 }}>
      <div style={{ fontSize:11, color:"var(--text3)", marginBottom:4, display:"flex", alignItems:"center", gap:4 }}>
        {label}
      </div>
      <div style={{ position:"relative" }}>
        <select
          value={value}
          onChange={e => onChange(e.target.value)}
          style={{
            width:"100%", padding:"7px 28px 7px 10px", fontSize:12,
            background:"var(--bg3)", border:"1px solid var(--border)", color:value ? "var(--text)" : "var(--text3)",
            borderRadius:8, cursor:"pointer", appearance:"none",
          }}
        >
          <option value="">Barchasi</option>
          {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <ChevronDown size={12} style={{ position:"absolute", right:8, top:"50%", transform:"translateY(-50%)", color:"var(--text3)", pointerEvents:"none" }} />
      </div>
    </div>
  );
}

// ── Deal stage columns for "mas'ullar kesimida" table ─────────────
const DEAL_STAGE_COLS = [
  { key: "taqdimot",    label: "Taqdimot",     color: "#9C27B0" },
  { key: "konsultatsiya", label: "Konsultatsiya", color: "#2196F3" },
  { key: "kelishuv",    label: "Kelishuv",     color: "#FF9800" },
  { key: "sotuv_boldi", label: "Sotuv bo'ldi", color: "#4CAF50" },
  { key: "bekor_boldi", label: "Bekor bo'ldi", color: "#F44336" },
] as const;

// ── Page ─────────────────────────────────────────────────────────
export default function SdelkalarPage() {
  const [filterOpen, setFilterOpen] = useState(false);

  const [pending, setPending] = useState({
    from: daysAgoISO(365), to: todayISO(),
    responsible_id: "", stage_id: "", source: "",
  });
  const [applied, setApplied] = useState({ ...pending });

  const [search, setSearch]   = useState("");
  const [status, setStatus]   = useState<"" | "won" | "lost" | "active">("");
  const [page,   setPage]     = useState(1);
  const LIMIT = 20;

  const filterQ = useQuery({
    queryKey: ["deal-filter-options"],
    queryFn: getDealFilterOptions,
    staleTime: 5 * 60_000,
  });

  const kpiQ = useQuery({
    queryKey: ["deals-kpi", applied],
    queryFn: () => getDealKpiStats({
      from: applied.from, to: applied.to,
      responsible_id: applied.responsible_id ? Number(applied.responsible_id) : undefined,
      stage_id:       applied.stage_id       ? Number(applied.stage_id)       : undefined,
      source:         applied.source || undefined,
    }),
  });

  const listQ = useQuery({
    queryKey: ["deals-list", applied, search, status, page],
    queryFn: () => getDealsList({
      from: applied.from, to: applied.to,
      responsible_id: applied.responsible_id ? Number(applied.responsible_id) : undefined,
      stage_id:       applied.stage_id       ? Number(applied.stage_id)       : undefined,
      source:         applied.source || undefined,
      search: search || undefined,
      status: status || undefined,
      page, limit: LIMIT,
    }),
    placeholderData: keepPreviousData,
  });

  const convQ = useQuery({
    queryKey: ["deals-conversion", applied.from, applied.to],
    queryFn: () => getDealsConversion({ from: applied.from || undefined, to: applied.to || undefined }),
    staleTime: 60_000,
  });

  const respQ = useQuery({
    queryKey: ["deals-responsibles", applied.from, applied.to],
    queryFn: () => getDealsResponsibles({ from: applied.from || undefined, to: applied.to || undefined }),
    staleTime: 60_000,
  });

  const cancelQ = useQuery({
    queryKey: ["stats/deal-cancel-reasons", applied],
    queryFn: () => getDealCancelReasons({
      start_date: applied.from || undefined,
      end_date: applied.to || undefined,
      responsible_id: applied.responsible_id ? Number(applied.responsible_id) : undefined,
    }),
    staleTime: 60_000,
  });

  const apply = useCallback(() => {
    setApplied({ ...pending });
    setPage(1);
  }, [pending]);

  const clear = useCallback(() => {
    const def = { from: daysAgoISO(365), to: todayISO(), responsible_id: "", stage_id: "", source: "" };
    setPending(def);
    setApplied(def);
    setSearch("");
    setStatus("");
    setPage(1);
  }, []);

  const refresh = useCallback(() => {
    kpiQ.refetch();
    listQ.refetch();
    convQ.refetch();
    respQ.refetch();
  }, [kpiQ, listQ, convQ, respQ]);

  const kpi = kpiQ.data;
  const totalPages = listQ.data ? Math.ceil(listQ.data.total / LIMIT) : 1;

  const activeFilterCount = [
    applied.responsible_id, applied.stage_id, applied.source,
  ].filter(Boolean).length + (
    applied.from !== daysAgoISO(365) || applied.to !== todayISO() ? 1 : 0
  );

  const respOptions  = useMemo(() => (filterQ.data?.responsibles ?? []).map(r => ({ value: String(r.id), label: r.full_name })), [filterQ.data]);
  const stageOptions = useMemo(() => (filterQ.data?.stages ?? []).map(s => ({ value: String(s.id), label: s.name })), [filterQ.data]);
  const srcOptions   = useMemo(() => [
    { value: "__none__", label: "Manbasiz" },
    ...(filterQ.data?.sources ?? []).map(s => ({ value: s.id, label: s.name })),
  ], [filterQ.data]);

  const PRESETS = [
    { label: "Bugun",    f: todayISO(),       t: todayISO() },
    { label: "7 kun",   f: daysAgoISO(7),    t: todayISO() },
    { label: "30 kun",  f: daysAgoISO(30),   t: todayISO() },
    { label: "90 kun",  f: daysAgoISO(90),   t: todayISO() },
    { label: "Barchasi", f: daysAgoISO(365), t: todayISO() },
  ];

  // ── Conversion table derived data ────────────────────────────────
  const convRows = convQ.data ?? [];
  const convMax = useMemo(() => ({
    total:       Math.max(1, ...convRows.map(r => r.total)),
    jarayonda:   Math.max(1, ...convRows.map(r => r.jarayonda)),
    sotuv_boldi: Math.max(1, ...convRows.map(r => r.sotuv_boldi)),
    bekor_boldi: Math.max(1, ...convRows.map(r => r.bekor_boldi)),
    jami_sotuv:  Math.max(1, ...convRows.map(r => r.jami_sotuv)),
  }), [convRows]);
  const convTotals = useMemo(() => convRows.reduce(
    (acc, r) => ({
      total:       acc.total       + r.total,
      jarayonda:   acc.jarayonda   + r.jarayonda,
      sotuv_boldi: acc.sotuv_boldi + r.sotuv_boldi,
      bekor_boldi: acc.bekor_boldi + r.bekor_boldi,
      jami_sotuv:  acc.jami_sotuv  + Number(r.jami_sotuv),
    }),
    { total:0, jarayonda:0, sotuv_boldi:0, bekor_boldi:0, jami_sotuv:0 }
  ), [convRows]);

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
        sub={`${applied.from} → ${applied.to}`}
        actions={<Button onClick={refresh}><RefreshCw className="w-3.5 h-3.5" /> Yangilash</Button>}
      />

      <div style={{ flex:1, overflowY:"auto", padding:"18px 22px", background:"var(--bg)" }}>

        {/* ── Filter panel ── */}
        <div style={{
          background:"var(--bg2)", border:"1px solid var(--border)", borderRadius:10,
          marginBottom:16, overflow:"hidden",
        }}>
          <div
            style={{ padding:"10px 16px", display:"flex", alignItems:"center", gap:10, cursor:"pointer" }}
            onClick={() => setFilterOpen(o => !o)}
          >
            <Search size={14} style={{ color:"var(--text3)" }} />
            <span style={{ fontSize:12.5, color:"var(--text3)", flex:1 }}>
              {filterOpen ? "Qidirish va filtrlash..." : `Filtr: ${applied.from} → ${applied.to}${activeFilterCount > 0 ? ` · ${activeFilterCount} ta qo'shimcha` : ""}`}
            </span>
            {activeFilterCount > 0 && (
              <span style={{ fontSize:10, fontWeight:700, padding:"1px 6px", borderRadius:20,
                background:"#3b82f6", color:"#fff" }}>{activeFilterCount} filtr</span>
            )}
            <ChevronDown size={14} style={{ color:"var(--text3)", transform: filterOpen ? "rotate(180deg)" : "none", transition:"transform .2s" }} />
          </div>

          {filterOpen && (
            <div style={{ borderTop:"1px solid var(--border)", padding:"16px 20px" }}>
              <div style={{ display:"flex", gap:8, marginBottom:14, flexWrap:"wrap" }}>
                {PRESETS.map(p => {
                  const active = pending.from === p.f && pending.to === p.t;
                  return (
                    <button key={p.label} onClick={() => setPending(s => ({ ...s, from: p.f, to: p.t }))}
                      style={{
                        padding:"5px 14px", borderRadius:20, fontSize:12, cursor:"pointer",
                        background: active ? "#3b82f6" : "var(--bg3)",
                        border: `1px solid ${active ? "#3b82f6" : "var(--border)"}`,
                        color: active ? "#fff" : "var(--text2)", fontWeight: active ? 600 : 400,
                      }}>
                      {p.label}
                    </button>
                  );
                })}
              </div>

              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, marginBottom:14 }}>
                <div>
                  <div style={{ fontSize:11, color:"var(--text3)", marginBottom:4 }}>Dan (boshlanish)</div>
                  <input type="date" value={pending.from}
                    onChange={e => setPending(s => ({ ...s, from: e.target.value }))}
                    style={{ width:"100%", padding:"8px 10px", fontSize:12,
                      background:"var(--bg3)", border:"1px solid var(--border)",
                      color:"var(--text)", borderRadius:8 }} />
                </div>
                <div>
                  <div style={{ fontSize:11, color:"var(--text3)", marginBottom:4 }}>Gacha (tugash)</div>
                  <input type="date" value={pending.to}
                    onChange={e => setPending(s => ({ ...s, to: e.target.value }))}
                    style={{ width:"100%", padding:"8px 10px", fontSize:12,
                      background:"var(--bg3)", border:"1px solid var(--border)",
                      color:"var(--text)", borderRadius:8 }} />
                </div>
              </div>

              <div style={{ display:"flex", gap:12, flexWrap:"wrap", marginBottom:16 }}>
                <SelectFilter label="Mas'ul xodim" value={pending.responsible_id}
                  onChange={v => setPending(s => ({ ...s, responsible_id: v }))}
                  options={respOptions} />
                <SelectFilter label="Bosqich" value={pending.stage_id}
                  onChange={v => setPending(s => ({ ...s, stage_id: v }))}
                  options={stageOptions} />
                <SelectFilter label="Manba" value={pending.source}
                  onChange={v => setPending(s => ({ ...s, source: v }))}
                  options={srcOptions} />
              </div>

              <div style={{ display:"flex", justifyContent:"flex-end", gap:10 }}>
                <button onClick={clear}
                  style={{ padding:"7px 18px", borderRadius:8, fontSize:12, cursor:"pointer",
                    background:"var(--bg3)", border:"1px solid var(--border)", color:"var(--text2)" }}>
                  Tozalash
                </button>
                <button onClick={() => { apply(); setFilterOpen(false); }}
                  style={{ padding:"7px 18px", borderRadius:8, fontSize:12, cursor:"pointer",
                    background:"#3b82f6", border:"1px solid #3b82f6", color:"#fff", fontWeight:600 }}>
                  Topish
                </button>
              </div>
            </div>
          )}
        </div>

        {/* ── KPI Cards ── */}
        <div style={{ display:"grid", gridTemplateColumns:"repeat(5,1fr)", gap:12, marginBottom:20 }}>
          <KpiCard label="Yangi Sdelkalar" value={fmtNum(kpi?.yangi ?? 0)}
            sub="Jarayondagi" gradient="linear-gradient(135deg,#1d4ed8,#3b82f6)"
            icon={<TrendingUp size={16} color="#fff" />} />
          <KpiCard label="Sotuv bo'ldi" value={fmtNum(kpi?.sotuv_boldi ?? 0)}
            sub={`${fmtNum(kpi?.total ?? 0)} ta jami`} gradient="linear-gradient(135deg,#065f46,#10b981)"
            icon={<CheckCircle size={16} color="#fff" />} />
          <KpiCard label="Jami Sotuv" value={fmtMoney(kpi?.jami_sotuv ?? 0)}
            sub="Won sdelkalar daromadi" gradient="linear-gradient(135deg,#047857,#34d399)"
            icon={<DollarSign size={16} color="#fff" />} />
          <KpiCard label="O'rtacha Chek" value={fmtMoney(kpi?.ortacha_chek ?? 0)}
            sub="Won bo'yicha o'rtacha" gradient="linear-gradient(135deg,#92400e,#f59e0b)"
            icon={<ShoppingCart size={16} color="#fff" />} />
          <KpiCard label="Konversiya" value={`${kpi?.konversiya ?? 0}%`}
            sub="Won / Jami" gradient="linear-gradient(135deg,#5b21b6,#8b5cf6)"
            icon={<Percent size={16} color="#fff" />} />
        </div>

        {/* ══════════════════════════════════════════════════════════
            Sdelka va Konversiya table
        ══════════════════════════════════════════════════════════ */}
        <div style={{ background:"var(--bg2)", borderRadius:12, overflow:"hidden", marginBottom:16 }}>
          <div style={{ padding:"16px 20px 12px", borderBottom:"1px solid var(--border)", display:"flex", alignItems:"center", gap:10 }}>
            <CheckCircle size={16} style={{ color:"#4CAF50" }} />
            <span style={{ fontSize:18, fontWeight:700, color:"#fff" }}>Sdelka va Konversiya</span>
            <span style={{ fontSize:12, color:"#555" }}>{convRows.length} ta menejer</span>
          </div>

          {convQ.isLoading ? (
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
                  <col />
                  <col style={{ width:84 }} />
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
                    <th style={{ ...THc("#4CAF50", 84), textAlign:"center" }}>Konversiya</th>
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
                        <td style={{ ...TDa, color:"#555", fontSize:13, fontWeight:600 }}>
                          {String(i + 1).padStart(2, "0")}
                        </td>
                        <td style={TDa}>
                          <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                            <AvatarCircle name={r.full_name || "?"} size={34} />
                            <span style={{ fontSize:13, color:"#fff", fontWeight:500, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                              {r.full_name}
                            </span>
                          </div>
                        </td>
                        <td style={TDa}>
                          <span style={{ fontSize:15, fontWeight:600, color:"#fff" }}>{fmtNum(r.total)}</span>
                          <MiniBar value={r.total} max={convMax.total} color="#2196F3" />
                        </td>
                        <td style={TDa}>
                          <span style={{ fontSize:15, fontWeight:600, color:"#fff" }}>{fmtNum(r.jarayonda)}</span>
                          <MiniBar value={r.jarayonda} max={convMax.jarayonda} color="#FF9800" />
                        </td>
                        <td style={TDa}>
                          <span style={{ fontSize:15, fontWeight:600, color:"#fff" }}>{fmtNum(r.sotuv_boldi)}</span>
                          <MiniBar value={r.sotuv_boldi} max={convMax.sotuv_boldi} color="#4CAF50" />
                        </td>
                        <td style={TDa}>
                          <span style={{ fontSize:15, fontWeight:600, color:"#fff" }}>{fmtNum(r.bekor_boldi)}</span>
                          <MiniBar value={r.bekor_boldi} max={convMax.bekor_boldi} color="#F44336" />
                        </td>
                        <td style={TDa}>
                          <span style={{ fontSize:14, fontWeight:600, color:"#00BCD4" }}>{fmtMoney(Number(r.jami_sotuv))}</span>
                          <MiniBar value={Number(r.jami_sotuv)} max={convMax.jami_sotuv} color="#00BCD4" />
                        </td>
                        <td style={{ ...TDa, textAlign:"center" }}>
                          <ConversionDonut pct={konv} size={38} />
                        </td>
                      </tr>
                    );
                  })}

                  {/* JAMI row */}
                  <tr style={{ background:"var(--bg3)", borderTop:"1px solid var(--border2)" }}>
                    <td style={{ ...TDa, color:"#666" }} />
                    <td style={{ ...TDa, fontSize:13, fontWeight:700, color:"#9E9E9E", textTransform:"uppercase", letterSpacing:"0.06em" }}>
                      JAMI
                    </td>
                    <td style={TDa}>
                      <span style={{ fontSize:16, fontWeight:700, color:"#fff" }}>{fmtNum(convTotals.total)}</span>
                      <MiniBar value={1} max={1} color="#2196F3" />
                    </td>
                    <td style={TDa}>
                      <span style={{ fontSize:16, fontWeight:700, color:"#fff" }}>{fmtNum(convTotals.jarayonda)}</span>
                      <MiniBar value={1} max={1} color="#FF9800" />
                    </td>
                    <td style={TDa}>
                      <span style={{ fontSize:16, fontWeight:700, color:"#fff" }}>{fmtNum(convTotals.sotuv_boldi)}</span>
                      <MiniBar value={1} max={1} color="#4CAF50" />
                    </td>
                    <td style={TDa}>
                      <span style={{ fontSize:16, fontWeight:700, color:"#fff" }}>{fmtNum(convTotals.bekor_boldi)}</span>
                      <MiniBar value={1} max={1} color="#F44336" />
                    </td>
                    <td style={TDa}>
                      <span style={{ fontSize:15, fontWeight:700, color:"#00BCD4" }}>{fmtMoney(convTotals.jami_sotuv)}</span>
                      <MiniBar value={1} max={1} color="#00BCD4" />
                    </td>
                    <td style={{ ...TDa, textAlign:"center" }}>
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
        <div style={{ background:"var(--bg2)", borderRadius:12, overflow:"hidden", marginBottom:24 }}>
          <div style={{ padding:"16px 20px 12px", borderBottom:"1px solid var(--border)", display:"flex", alignItems:"center", gap:10 }}>
            <Users size={16} style={{ color:"#9E9E9E" }} />
            <span style={{ fontSize:18, fontWeight:700, color:"#fff" }}>Sdelka mas'ullar kesimida</span>
            <span style={{ fontSize:12, color:"#555" }}>{dealRespRows.length} ta xodim</span>
          </div>

          {respQ.isLoading ? (
            <div style={{ padding:24, color:"#666", fontSize:13 }}>Yuklanmoqda…</div>
          ) : (
            <div style={{ overflowX:"auto" }}>
              <table style={{ width:"100%", borderCollapse:"collapse", tableLayout:"auto" }}>
                <thead>
                  <tr>
                    <th style={{ ...THc("#555", 44), position:"sticky", left:0, zIndex:6 }}>#</th>
                    <th style={{ ...THc("#9E9E9E", 180), position:"sticky", left:44, zIndex:6 }}>Mas'ul</th>
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
                      <td style={{ ...TDa, color:"#555", fontSize:13, fontWeight:600, width:44, position:"sticky", left:0, background:"var(--bg2)" }}>
                        {String(i + 1).padStart(2, "0")}
                      </td>
                      <td style={{ ...TDa, width:180, position:"sticky", left:44, background:"var(--bg2)", zIndex:2 }}>
                        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                          <AvatarCircle name={u.full_name || "?"} size={32} />
                          <span style={{ fontSize:13, color:"#fff", fontWeight:500, whiteSpace:"nowrap" }}>
                            {u.full_name}
                          </span>
                        </div>
                      </td>
                      {DEAL_STAGE_COLS.map(col => {
                        const cnt = (u as unknown as Record<string, number>)[col.key] ?? 0;
                        const max = dealRespMax[col.key] ?? 1;
                        return (
                          <td key={col.key} style={{ ...TDa, minWidth:120 }}>
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
                    <td style={{ ...TDa, position:"sticky", left:0, background:"var(--bg3)" }} />
                    <td style={{ ...TDa, fontSize:13, fontWeight:700, color:"#9E9E9E", textTransform:"uppercase", letterSpacing:"0.06em", position:"sticky", left:44, background:"var(--bg3)", zIndex:2 }}>
                      JAMI
                    </td>
                    {DEAL_STAGE_COLS.map(col => (
                      <td key={col.key} style={TDa}>
                        <span style={{ fontSize:15, fontWeight:700, color:"#fff" }}>
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
          const cancelMax   = Math.max(1, ...cancelItems.map((r) => r.total));
          const cancelTotal = cancelItems.reduce((s, r) => s + r.total, 0);

          return (
            <div style={{ display: "grid", gridTemplateColumns: "1fr", marginBottom: 20 }}>
              <div style={{ background: "var(--bg2)", borderRadius: 12, border: "1px solid var(--border)", overflow: "hidden" }}>
                <div style={{
                  padding: "14px 20px 12px",
                  borderBottom: "1px solid var(--border)",
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                }}>
                  <span style={{ fontSize: 15, fontWeight: 700, color: "#fff" }}>Bekor bo'lish sabablari</span>
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

        {/* ── Deals list table ── */}
        <div style={{ background:"var(--bg2)", border:"1px solid var(--border)", borderRadius:10, overflow:"hidden", marginBottom:20 }}>
          <div style={{ padding:"12px 16px", borderBottom:"1px solid var(--border)",
            display:"flex", alignItems:"center", gap:10, flexWrap:"wrap" }}>
            <Filter size={14} style={{ color:"var(--text3)" }} />
            <span style={{ fontSize:13, fontWeight:600, color:"var(--text)" }}>Sdelkalar ro'yxati</span>
            {listQ.data && (
              <span style={{ fontSize:11, color:"var(--text3)" }}>· {fmtNum(listQ.data.total)} ta</span>
            )}
            <div style={{ marginLeft:"auto", display:"flex", alignItems:"center", gap:6, flexWrap:"wrap" }}>
              <div style={{ position:"relative" }}>
                <Search size={12} style={{ position:"absolute", left:8, top:"50%", transform:"translateY(-50%)", color:"var(--text3)" }} />
                <input value={search} placeholder="Qidirish…"
                  onChange={e => { setSearch(e.target.value); setPage(1); }}
                  style={{ paddingLeft:26, paddingRight:10, paddingTop:5, paddingBottom:5,
                    fontSize:12, background:"var(--bg3)", border:"1px solid var(--border)",
                    borderRadius:6, color:"var(--text)", width:160 }} />
              </div>
              {(["", "active", "won", "lost"] as const).map(s => {
                const labels: Record<string, string> = { "":"Barchasi", active:"Jarayonda", won:"Sotuv bo'ldi", lost:"Bekor" };
                const isActive = status === s;
                return (
                  <button key={s} onClick={() => { setStatus(s); setPage(1); }}
                    style={{ fontSize:11, padding:"4px 10px", borderRadius:20, cursor:"pointer",
                      background: isActive ? "#3b82f6" : "var(--bg3)",
                      border:`1px solid ${isActive ? "#3b82f6" : "var(--border)"}`,
                      color: isActive ? "#fff" : "var(--text2)" }}>
                    {labels[s]}
                  </button>
                );
              })}
            </div>
          </div>

          <div style={{ overflowX:"auto" }}>
            <table style={{ width:"100%", borderCollapse:"collapse" }}>
              <thead>
                <tr>
                  {["#", "Mas'ul", "Mijoz (tel)", "Summa", "Manba", "Sana", "Status"].map(h => (
                    <th key={h} style={TH}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {listQ.isLoading && (
                  <tr><td colSpan={7} style={{ ...TD, textAlign:"center", padding:32, color:"var(--text3)" }}>Yuklanmoqda…</td></tr>
                )}
                {!listQ.isLoading && listQ.data?.items.length === 0 && (
                  <tr><td colSpan={7} style={{ ...TD, textAlign:"center", padding:32, color:"var(--text3)" }}>Ma'lumot topilmadi</td></tr>
                )}
                {listQ.data?.items.map((row: DealRow, i: number) => (
                  <tr key={row.id}
                    style={{ background: i % 2 === 0 ? "transparent" : "var(--bg)" }}
                    onMouseEnter={e => (e.currentTarget.style.background = "var(--bg3)")}
                    onMouseLeave={e => (e.currentTarget.style.background = i % 2 === 0 ? "transparent" : "var(--bg)")}>
                    <td style={{ ...TD, color:"var(--text3)", width:40 }}>{(page-1)*LIMIT+i+1}</td>
                    <td style={TD}>{row.responsible || "—"}</td>
                    <td style={{ ...TD, fontFamily:"monospace", fontSize:12 }}>{row.mijoz}</td>
                    <td style={{ ...TD, color:"#10b981", fontWeight:600, fontFamily:"monospace" }}>
                      {Number(row.summa) > 0 ? fmtMoney(Number(row.summa)) : "—"}
                    </td>
                    <td style={{ ...TD, color:"var(--text2)" }}>{row.manba}</td>
                    <td style={{ ...TD, color:"var(--text3)", fontSize:12 }}>{fmtDate(row.sana)}</td>
                    <td style={TD}><StatusBadge row={row} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div style={{ padding:"10px 16px", borderTop:"1px solid var(--border)",
              display:"flex", alignItems:"center", justifyContent:"space-between" }}>
              <span style={{ fontSize:11, color:"var(--text3)" }}>
                {page} / {totalPages} sahifa · {fmtNum(listQ.data?.total ?? 0)} ta jami
              </span>
              <div style={{ display:"flex", gap:6 }}>
                <button onClick={() => setPage(p => Math.max(1, p-1))} disabled={page===1}
                  style={{ padding:"4px 10px", borderRadius:6, fontSize:12, cursor:page===1?"not-allowed":"pointer",
                    background:"var(--bg3)", border:"1px solid var(--border)", color:"var(--text2)", opacity:page===1?.4:1 }}>
                  <ChevronLeft size={13} />
                </button>
                <button onClick={() => setPage(p => Math.min(totalPages, p+1))} disabled={page===totalPages}
                  style={{ padding:"4px 10px", borderRadius:6, fontSize:12, cursor:page===totalPages?"not-allowed":"pointer",
                    background:"var(--bg3)", border:"1px solid var(--border)", color:"var(--text2)", opacity:page===totalPages?.4:1 }}>
                  <ChevronRight size={13} />
                </button>
              </div>
            </div>
          )}
        </div>

        {(kpiQ.error || listQ.error) && (
          <div style={{ marginTop:12, padding:"10px 14px", borderRadius:8, fontSize:12,
            background:"rgba(239,68,68,.1)", border:"1px solid rgba(239,68,68,.25)", color:"#ef4444" }}>
            Xatolik: {((kpiQ.error ?? listQ.error) as Error).message}
          </div>
        )}
      </div>
    </>
  );
}

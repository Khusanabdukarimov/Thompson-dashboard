import { useState, useCallback, useMemo } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import {
  RefreshCw, Search, ChevronLeft, ChevronRight,
  TrendingUp, DollarSign, CheckCircle, Percent, ShoppingCart,
  ChevronDown, Filter,
} from "lucide-react";
import { Topbar } from "@/components/Topbar";
import { Button } from "@/components/Button";
import { getDealKpiStats, getDealsList, getDealFilterOptions } from "@/lib/api/deals";
import type { DealRow } from "@/lib/api/deals";
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

// ── Page ─────────────────────────────────────────────────────────
export default function SdelkalarPage() {
  const [filterOpen, setFilterOpen] = useState(false);

  // pending = what's in the UI, applied = what's sent to API
  const [pending, setPending] = useState({
    from: daysAgoISO(365), to: todayISO(),
    responsible_id: "", stage_id: "", source: "",
  });
  const [applied, setApplied] = useState({ ...pending });

  const [search, setSearch]     = useState("");
  const [status, setStatus]     = useState<"" | "won" | "lost" | "active">("");
  const [page,   setPage]       = useState(1);
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
  }, [kpiQ, listQ]);

  const kpi = kpiQ.data;
  const totalPages = listQ.data ? Math.ceil(listQ.data.total / LIMIT) : 1;

  const activeFilterCount = [
    applied.responsible_id, applied.stage_id, applied.source,
  ].filter(Boolean).length + (
    applied.from !== daysAgoISO(365) || applied.to !== todayISO() ? 1 : 0
  );

  const respOptions  = useMemo(() => (filterQ.data?.responsibles ?? []).map(r => ({ value: String(r.id), label: r.full_name })), [filterQ.data]);
  const stageOptions = useMemo(() => (filterQ.data?.stages ?? []).map(s => ({ value: String(s.id), label: s.name })), [filterQ.data]);
  const srcOptions   = useMemo(() => (filterQ.data?.sources ?? []).map(s => ({ value: s.id, label: s.name })), [filterQ.data]);

  const PRESETS = [
    { label: "Bugun",  f: todayISO(),      t: todayISO() },
    { label: "7 kun",  f: daysAgoISO(7),   t: todayISO() },
    { label: "30 kun", f: daysAgoISO(30),  t: todayISO() },
    { label: "90 kun", f: daysAgoISO(90),  t: todayISO() },
    { label: "Barchasi", f: daysAgoISO(365), t: todayISO() },
  ];

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
          {/* Header row */}
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
              {/* Date presets */}
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

              {/* Date inputs */}
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

              {/* Dropdowns */}
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

              {/* Actions */}
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

        {/* ── Deals table ── */}
        <div style={{ background:"var(--bg2)", border:"1px solid var(--border)", borderRadius:10, overflow:"hidden" }}>
          {/* Toolbar */}
          <div style={{ padding:"12px 16px", borderBottom:"1px solid var(--border)",
            display:"flex", alignItems:"center", gap:10, flexWrap:"wrap" }}>
            <Filter size={14} style={{ color:"var(--text3)" }} />
            <span style={{ fontSize:13, fontWeight:600, color:"var(--text)" }}>
              Sdelkalar ro'yxati
            </span>
            {listQ.data && (
              <span style={{ fontSize:11, color:"var(--text3)" }}>· {fmtNum(listQ.data.total)} ta</span>
            )}
            <div style={{ marginLeft:"auto", display:"flex", alignItems:"center", gap:6, flexWrap:"wrap" }}>
              {/* Search */}
              <div style={{ position:"relative" }}>
                <Search size={12} style={{ position:"absolute", left:8, top:"50%", transform:"translateY(-50%)", color:"var(--text3)" }} />
                <input value={search} placeholder="Qidirish…"
                  onChange={e => { setSearch(e.target.value); setPage(1); }}
                  style={{ paddingLeft:26, paddingRight:10, paddingTop:5, paddingBottom:5,
                    fontSize:12, background:"var(--bg3)", border:"1px solid var(--border)",
                    borderRadius:6, color:"var(--text)", width:160 }} />
              </div>
              {/* Status tabs */}
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

          {/* Table */}
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

          {/* Pagination */}
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

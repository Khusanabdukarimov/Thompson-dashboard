import { useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  RefreshCw, Search, ChevronLeft, ChevronRight,
  TrendingUp, DollarSign, XCircle, CheckCircle, Percent,
} from "lucide-react";
import { Topbar } from "@/components/Topbar";
import { Button } from "@/components/Button";
import { getDealKpiStats, getDealsList } from "@/lib/api/deals";
import type { DealRow } from "@/lib/api/deals";
import { fmtNum } from "@/lib/utils";

// ── Date helpers ─────────────────────────────────────────────────
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
  if (row.is_won)   return <span style={badge("green")}>Yutuldi</span>;
  if (row.is_final) return <span style={badge("red")}>Bekor</span>;
  return <span style={badge("amber")}>Jarayonda</span>;
}

function badge(color: "green" | "red" | "amber") {
  const map = {
    green: { bg: "rgba(16,185,129,0.12)", color: "#10b981", border: "rgba(16,185,129,0.25)" },
    red:   { bg: "rgba(239,68,68,0.12)",  color: "#ef4444", border: "rgba(239,68,68,0.25)" },
    amber: { bg: "rgba(245,158,11,0.12)", color: "#f59e0b", border: "rgba(245,158,11,0.25)" },
  }[color];
  return {
    display: "inline-flex", alignItems: "center",
    padding: "2px 8px", borderRadius: 20, fontSize: 11, fontWeight: 600,
    background: map.bg, color: map.color, border: `1px solid ${map.border}`,
  } as React.CSSProperties;
}

// ── KPI card ─────────────────────────────────────────────────────
type CardDef = {
  label: string;
  value: string;
  sub?: string;
  gradient: string;
  icon: React.ReactNode;
};

function KpiCard({ card }: { card: CardDef }) {
  return (
    <div style={{
      borderRadius: 12, padding: "16px 18px",
      background: card.gradient,
      display: "flex", flexDirection: "column", gap: 6,
      minWidth: 0,
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: 11, color: "rgba(255,255,255,0.7)", fontWeight: 500 }}>{card.label}</span>
        <span style={{ opacity: 0.6 }}>{card.icon}</span>
      </div>
      <div style={{ fontSize: 24, fontWeight: 700, color: "#fff", lineHeight: 1.2 }}>{card.value}</div>
      {card.sub && <div style={{ fontSize: 11, color: "rgba(255,255,255,0.55)" }}>{card.sub}</div>}
    </div>
  );
}

// ── Table styles ─────────────────────────────────────────────────
const TH: React.CSSProperties = {
  padding: "10px 12px", fontSize: 11, fontWeight: 600,
  color: "var(--text3)", textAlign: "left", whiteSpace: "nowrap",
  background: "var(--bg2)", borderBottom: "1px solid var(--border)",
  position: "sticky", top: 0,
};
const TD: React.CSSProperties = {
  padding: "9px 12px", fontSize: 12.5, color: "var(--text)",
  borderBottom: "1px solid var(--border)", whiteSpace: "nowrap",
};

// ── Page ─────────────────────────────────────────────────────────
export default function SdelkalarPage() {
  const [from, setFrom]     = useState(daysAgoISO(365));
  const [to,   setTo]       = useState(todayISO());
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"" | "won" | "lost" | "active">("");
  const [page, setPage]     = useState(1);
  const LIMIT = 20;

  const kpiQ = useQuery({
    queryKey: ["deals-kpi", from, to],
    queryFn: () => getDealKpiStats({ from, to }),
  });

  const listQ = useQuery({
    queryKey: ["deals-list", from, to, search, status, page],
    queryFn: () => getDealsList({ from, to, search: search || undefined, status: status || undefined, page, limit: LIMIT }),
    keepPreviousData: true,
  });

  const refresh = useCallback(() => {
    kpiQ.refetch();
    listQ.refetch();
  }, [kpiQ, listQ]);

  const kpi = kpiQ.data;
  const totalPages = listQ.data ? Math.ceil(listQ.data.total / LIMIT) : 1;

  const cards: CardDef[] = [
    {
      label: "Yangi Sdelkalar",
      value: fmtNum(kpi?.in_progress ?? 0),
      sub: "Jarayondagi",
      gradient: "linear-gradient(135deg,#1d4ed8,#3b82f6)",
      icon: <TrendingUp size={16} color="#fff" />,
    },
    {
      label: "Yutqizilgan",
      value: fmtNum(kpi?.lost ?? 0),
      sub: "Bekor bo'ldi",
      gradient: "linear-gradient(135deg,#b91c1c,#ef4444)",
      icon: <XCircle size={16} color="#fff" />,
    },
    {
      label: "Jami Sotuv",
      value: fmtMoney(kpi?.jami_sotuv ?? 0),
      sub: `${fmtNum(kpi?.won ?? 0)} ta yutildi`,
      gradient: "linear-gradient(135deg,#065f46,#10b981)",
      icon: <DollarSign size={16} color="#fff" />,
    },
    {
      label: "O'rtacha Chek",
      value: fmtMoney(kpi?.ortacha_chek ?? 0),
      sub: "Won sdelkalar bo'yicha",
      gradient: "linear-gradient(135deg,#92400e,#f59e0b)",
      icon: <CheckCircle size={16} color="#fff" />,
    },
    {
      label: "Konversiya",
      value: `${kpi?.konversiya ?? 0}%`,
      sub: `${fmtNum(kpi?.total ?? 0)} ta jami`,
      gradient: "linear-gradient(135deg,#5b21b6,#8b5cf6)",
      icon: <Percent size={16} color="#fff" />,
    },
  ];

  return (
    <>
      <Topbar
        title="Sdelkalar"
        sub={`${from} → ${to}`}
        actions={
          <Button onClick={refresh}>
            <RefreshCw className="w-3.5 h-3.5" /> Yangilash
          </Button>
        }
      />

      <div style={{ flex: 1, overflowY: "auto", padding: "18px 22px", background: "var(--bg)" }}>

        {/* Date filter */}
        <div style={{
          background: "var(--bg2)", border: "1px solid var(--border)",
          borderRadius: 10, padding: "12px 16px", marginBottom: 16,
          display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
        }}>
          <label style={{ fontSize: 12, color: "var(--text3)" }}>Dan:</label>
          <input type="date" value={from} onChange={e => { setFrom(e.target.value); setPage(1); }}
            style={{ fontSize: 12, background: "var(--bg3)", border: "1px solid var(--border)", color: "var(--text)", borderRadius: 6, padding: "5px 8px" }} />
          <label style={{ fontSize: 12, color: "var(--text3)" }}>Gacha:</label>
          <input type="date" value={to} onChange={e => { setTo(e.target.value); setPage(1); }}
            style={{ fontSize: 12, background: "var(--bg3)", border: "1px solid var(--border)", color: "var(--text)", borderRadius: 6, padding: "5px 8px" }} />
          {[
            { label: "Bugun",  f: todayISO(),     t: todayISO() },
            { label: "7 kun",  f: daysAgoISO(7),  t: todayISO() },
            { label: "30 kun", f: daysAgoISO(30), t: todayISO() },
            { label: "1 yil",  f: daysAgoISO(365),t: todayISO() },
          ].map(p => {
            const active = p.f === from && p.t === to;
            return (
              <button key={p.label} onClick={() => { setFrom(p.f); setTo(p.t); setPage(1); }}
                style={{
                  fontSize: 11, padding: "4px 10px", borderRadius: 20, cursor: "pointer",
                  background: active ? "#3b82f6" : "var(--bg3)",
                  border: `1px solid ${active ? "#3b82f6" : "var(--border)"}`,
                  color: active ? "#fff" : "var(--text2)", fontWeight: active ? 600 : 400,
                }}>
                {p.label}
              </button>
            );
          })}
        </div>

        {/* KPI cards */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 12, marginBottom: 20 }}>
          {cards.map(c => <KpiCard key={c.label} card={c} />)}
        </div>

        {/* Deals list */}
        <div style={{ background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden" }}>

          {/* Table toolbar */}
          <div style={{
            padding: "12px 16px", borderBottom: "1px solid var(--border)",
            display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
          }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", marginRight: 4 }}>
              Sdelkalar ro'yxati
            </span>
            {listQ.data && (
              <span style={{ fontSize: 11, color: "var(--text3)" }}>
                · {fmtNum(listQ.data.total)} ta
              </span>
            )}

            {/* Search */}
            <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}>
              <div style={{ position: "relative" }}>
                <Search size={12} style={{ position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)", color: "var(--text3)" }} />
                <input
                  value={search} placeholder="Qidirish…"
                  onChange={e => { setSearch(e.target.value); setPage(1); }}
                  style={{
                    paddingLeft: 26, paddingRight: 10, paddingTop: 5, paddingBottom: 5,
                    fontSize: 12, background: "var(--bg3)", border: "1px solid var(--border)",
                    borderRadius: 6, color: "var(--text)", width: 160,
                  }}
                />
              </div>

              {/* Status filter */}
              {(["", "active", "won", "lost"] as const).map(s => {
                const labels = { "": "Barchasi", active: "Jarayonda", won: "Yutuldi", lost: "Bekor" };
                const active = status === s;
                return (
                  <button key={s} onClick={() => { setStatus(s); setPage(1); }}
                    style={{
                      fontSize: 11, padding: "4px 10px", borderRadius: 20, cursor: "pointer",
                      background: active ? "#3b82f6" : "var(--bg3)",
                      border: `1px solid ${active ? "#3b82f6" : "var(--border)"}`,
                      color: active ? "#fff" : "var(--text2)",
                    }}>
                    {labels[s]}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Table */}
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  {["#", "Mas'ul", "Mijoz (tel)", "Summa", "Manba", "Sana", "Status"].map(h => (
                    <th key={h} style={TH}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {listQ.isLoading && (
                  <tr><td colSpan={7} style={{ ...TD, textAlign: "center", padding: 32, color: "var(--text3)" }}>
                    Yuklanmoqda…
                  </td></tr>
                )}
                {!listQ.isLoading && listQ.data?.items.length === 0 && (
                  <tr><td colSpan={7} style={{ ...TD, textAlign: "center", padding: 32, color: "var(--text3)" }}>
                    Ma'lumot topilmadi
                  </td></tr>
                )}
                {listQ.data?.items.map((row: DealRow, i: number) => (
                  <tr key={row.id}
                    style={{ background: i % 2 === 0 ? "transparent" : "var(--bg)" }}
                    onMouseEnter={e => (e.currentTarget.style.background = "var(--bg3)")}
                    onMouseLeave={e => (e.currentTarget.style.background = i % 2 === 0 ? "transparent" : "var(--bg)")}>
                    <td style={{ ...TD, color: "var(--text3)", width: 40 }}>
                      {(page - 1) * LIMIT + i + 1}
                    </td>
                    <td style={TD}>{row.responsible || "—"}</td>
                    <td style={{ ...TD, fontFamily: "monospace", fontSize: 12 }}>{row.mijoz}</td>
                    <td style={{ ...TD, color: "#10b981", fontWeight: 600, fontFamily: "monospace" }}>
                      {row.summa > 0 ? fmtMoney(Number(row.summa)) : "—"}
                    </td>
                    <td style={{ ...TD, color: "var(--text2)" }}>{row.manba}</td>
                    <td style={{ ...TD, color: "var(--text3)", fontSize: 12 }}>{fmtDate(row.sana)}</td>
                    <td style={TD}><StatusBadge row={row} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div style={{
              padding: "10px 16px", borderTop: "1px solid var(--border)",
              display: "flex", alignItems: "center", justifyContent: "space-between",
            }}>
              <span style={{ fontSize: 11, color: "var(--text3)" }}>
                {page} / {totalPages} sahifa · {fmtNum(listQ.data?.total ?? 0)} ta jami
              </span>
              <div style={{ display: "flex", gap: 6 }}>
                <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                  style={{
                    padding: "4px 10px", borderRadius: 6, fontSize: 12, cursor: page === 1 ? "not-allowed" : "pointer",
                    background: "var(--bg3)", border: "1px solid var(--border)", color: "var(--text2)",
                    opacity: page === 1 ? 0.4 : 1,
                  }}>
                  <ChevronLeft size={13} />
                </button>
                <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                  style={{
                    padding: "4px 10px", borderRadius: 6, fontSize: 12, cursor: page === totalPages ? "not-allowed" : "pointer",
                    background: "var(--bg3)", border: "1px solid var(--border)", color: "var(--text2)",
                    opacity: page === totalPages ? 0.4 : 1,
                  }}>
                  <ChevronRight size={13} />
                </button>
              </div>
            </div>
          )}
        </div>

        {(kpiQ.error || listQ.error) && (
          <div style={{
            marginTop: 12, padding: "10px 14px", borderRadius: 8, fontSize: 12,
            background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.25)", color: "#ef4444",
          }}>
            Xatolik: {((kpiQ.error ?? listQ.error) as Error).message}
          </div>
        )}
      </div>
    </>
  );
}

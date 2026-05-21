import { useState, useMemo, useRef, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Phone, PhoneOutgoing, PhoneIncoming, CheckCircle, XCircle,
  Clock, PhoneMissed, Timer, ChevronDown, ChevronUp,
  SlidersHorizontal, Download, PhoneOff, RefreshCw, PhoneCall,
} from "lucide-react";
import { Topbar } from "@/components/Topbar";
import {
  getCallStats, getCallList, getCallGlobalStats, getCallReactionStats,
  syncCalls, syncUserPhotos,
  type CallStatsRow, type CallReactionRow,
} from "@/lib/api/leads";

// ── Helpers ───────────────────────────────────────────────────────
const localISO = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const todayISO  = () => localISO(new Date());
const daysAgoISO = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return localISO(d); };

function fmtDur(secs: number): string {
  if (!secs) return "00:00:00";
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  return [h, m, s].map((v) => String(v).padStart(2, "0")).join(":");
}

function fmtDurMin(secs: number): string {
  if (!secs) return "0 min";
  const m = Math.floor(secs / 60);
  const frac = Math.round((secs % 60) / 6);
  return frac > 0 ? `${m},${frac} min` : `${m} min`;
}

function fmtReaction(secs: number): string {
  if (!secs) return "—";
  if (secs < 60) return `${secs} son`;
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (h > 0) return `${h} ch, ${m} min`;
  return `${m} min`;
}

function prevPeriod(from: string, to: string): [string, string] {
  const f = new Date(from), t = new Date(to);
  const diff = t.getTime() - f.getTime();
  const pTo   = new Date(f.getTime() - 24 * 60 * 60 * 1000);
  const pFrom = new Date(pTo.getTime() - diff);
  return [localISO(pFrom), localISO(pTo)];
}

function initials(name: string) {
  return name.split(" ").filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
}
const AVATAR_COLORS = ["#4CAF50","#2196F3","#9C27B0","#FF9800","#F44336","#009688","#3F51B5","#E91E63","#00BCD4","#FF5722"];
const avatarColor = (id: number) => AVATAR_COLORS[id % AVATAR_COLORS.length];

// ── Avatar ────────────────────────────────────────────────────────
function Avatar({ name, photoUrl, id, size = 36 }: { name: string; photoUrl: string | null; id: number; size?: number }) {
  const [err, setErr] = useState(false);
  if (photoUrl && !err) {
    return <img src={photoUrl} alt={name} onError={() => setErr(true)}
      style={{ width: size, height: size, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }} />;
  }
  return (
    <div style={{ width: size, height: size, borderRadius: "50%", background: avatarColor(id), display: "flex", alignItems: "center", justifyContent: "center", fontSize: size * 0.34, fontWeight: 700, color: "#fff", flexShrink: 0 }}>
      {initials(name)}
    </div>
  );
}

// ── Metric Card ───────────────────────────────────────────────────
function Card({ label, value, sub, icon, iconBg, badge, badgeColor, valueColor, accentColor }: {
  label: string; value: React.ReactNode; sub?: string;
  icon: React.ReactNode; iconBg: string;
  badge?: string; badgeColor?: string; valueColor?: string; accentColor?: string;
}) {
  return (
    <div style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 14, padding: "18px 20px 16px", display: "flex", flexDirection: "column", minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 14 }}>
        <span style={{ fontSize: 12.5, color: accentColor || "var(--text2)", fontWeight: 600, lineHeight: 1.3 }}>{label}</span>
        <div style={{ width: 38, height: 38, borderRadius: 10, background: iconBg, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{icon}</div>
      </div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 8 }}>
        <div style={{ fontSize: 28, fontWeight: 700, lineHeight: 1, color: valueColor || "var(--text)" }}>{value}</div>
        {badge && (
          <span style={{ fontSize: 11, fontWeight: 700, color: badgeColor, background: `${badgeColor}18`, border: `1.5px solid ${badgeColor}35`, borderRadius: 6, padding: "2px 8px", lineHeight: 1.7, marginBottom: 2 }}>{badge}</span>
        )}
      </div>
      {sub && (
        <div style={{ fontSize: 11.5, color: "var(--text2)", marginTop: 7, display: "inline-flex", alignItems: "center", gap: 4, background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 6, padding: "3px 8px", alignSelf: "flex-start" }}>
          <Clock size={11} />{sub}
        </div>
      )}
    </div>
  );
}

// ── Filter popover ────────────────────────────────────────────────
function FilterPopover({ startDate, endDate, onStartDate, onEndDate, onClose }: {
  startDate: string; endDate: string;
  onStartDate: (v: string) => void; onEndDate: (v: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [onClose]);
  const preset = (days: number) => { onEndDate(todayISO()); onStartDate(daysAgoISO(days)); onClose(); };
  return (
    <div ref={ref} style={{ position: "absolute", top: "calc(100% + 8px)", right: 0, zIndex: 200, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 14, padding: "18px 20px", minWidth: 300, boxShadow: "0 8px 32px rgba(0,0,0,.12)" }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", marginBottom: 14 }}>Filtrlar</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <label style={{ fontSize: 12, color: "var(--text2)", display: "flex", flexDirection: "column", gap: 4 }}>
          Boshlanish sanasi
          <input type="date" value={startDate} onChange={(e) => onStartDate(e.target.value)} style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "7px 10px", fontSize: 13, background: "var(--bg2)", color: "var(--text)" }} />
        </label>
        <label style={{ fontSize: 12, color: "var(--text2)", display: "flex", flexDirection: "column", gap: 4 }}>
          Tugash sanasi
          <input type="date" value={endDate} onChange={(e) => onEndDate(e.target.value)} style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "7px 10px", fontSize: 13, background: "var(--bg2)", color: "var(--text)" }} />
        </label>
        <div style={{ display: "flex", gap: 6, marginTop: 4, flexWrap: "wrap" }}>
          {[{ label: "Bugun", days: 0 },{ label: "7 kun", days: 7 },{ label: "30 kun", days: 30 },{ label: "3 oy", days: 90 }].map(({ label, days }) => (
            <button key={label} onClick={() => preset(days)} style={{ padding: "5px 12px", borderRadius: 7, border: "1px solid var(--border)", background: "var(--bg2)", color: "var(--text2)", fontSize: 12, cursor: "pointer" }}>{label}</button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Delta badge ───────────────────────────────────────────────────
function Delta({ curr, prev }: { curr: number; prev: number | undefined }) {
  if (prev === undefined) return <span style={{ color: "var(--text2)", fontSize: 13 }}>—</span>;
  const diff = curr - prev;
  if (diff === 0) return <span style={{ color: "var(--text2)", fontSize: 12 }}>±0</span>;
  const color = diff > 0 ? "#4CAF50" : "#F44336";
  return (
    <span style={{ fontSize: 11.5, fontWeight: 600, color, background: `${color}15`, border: `1px solid ${color}30`, borderRadius: 5, padding: "2px 7px" }}>
      {diff > 0 ? "+" : ""}{diff}
    </span>
  );
}

// ── Call list sub-table ───────────────────────────────────────────
const CALL_TYPE_LABEL: Record<number, { label: string; color: string }> = {
  1: { label: "Chiquvchi", color: "#2196F3" },
  2: { label: "Kiruvchi",  color: "#4CAF50" },
};

function CallSubTable({ responsibleId, filter }: { responsibleId: number; filter: { start_date?: string; end_date?: string } }) {
  const q = useQuery({ queryKey: ["call-list", responsibleId, filter], queryFn: () => getCallList(responsibleId, filter) });
  if (q.isLoading) return <div style={{ padding: 24, textAlign: "center", color: "var(--text2)", fontSize: 13 }}>Yuklanmoqda...</div>;
  const calls = q.data ?? [];
  if (!calls.length) return <div style={{ padding: 24, textAlign: "center", color: "var(--text2)", fontSize: 13 }}>Qo'ng'iroqlar topilmadi</div>;
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
        <thead>
          <tr style={{ background: "rgba(33,150,243,0.05)" }}>
            {["#","Telefon","Turi","Davomiylik","Sana va vaqt","Status","Lead"].map((h) => (
              <th key={h} style={{ padding: "8px 14px", textAlign: "left", fontWeight: 600, color: "var(--text2)", borderBottom: "1px solid var(--border)", whiteSpace: "nowrap" }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {calls.map((c, i) => {
            const ct = c.call_type ? CALL_TYPE_LABEL[c.call_type] : null;
            const ok = c.status_code === 200 || (c.duration ?? 0) >= 10;
            return (
              <tr key={c.id} style={{ borderBottom: "1px solid var(--border)" }}>
                <td style={{ padding: "8px 14px", color: "var(--text2)" }}>{i + 1}</td>
                <td style={{ padding: "8px 14px", fontFamily: "monospace" }}>{c.phone_number || "—"}</td>
                <td style={{ padding: "8px 14px" }}>{ct ? <span style={{ fontSize: 11, fontWeight: 600, color: ct.color, background: `${ct.color}15`, border: `1px solid ${ct.color}30`, borderRadius: 5, padding: "2px 8px" }}>{ct.label}</span> : "—"}</td>
                <td style={{ padding: "8px 14px", fontFamily: "monospace" }}>{fmtDur(c.duration ?? 0)}</td>
                <td style={{ padding: "8px 14px", color: "var(--text2)", whiteSpace: "nowrap" }}>{c.call_start ? new Date(c.call_start).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—"}</td>
                <td style={{ padding: "8px 14px" }}><span style={{ fontSize: 11, fontWeight: 600, color: ok ? "#4CAF50" : "#F44336", background: ok ? "#4CAF5015" : "#F4433615", border: `1px solid ${ok ? "#4CAF5030" : "#F4433630"}`, borderRadius: 5, padding: "2px 8px" }}>{ok ? "Muvaffaqiyatli" : "Muvaffaqiyatsiz"}</span></td>
                <td style={{ padding: "8px 14px" }}>{c.lead_id ? <a href={`https://mountain.bitrix24.kz/crm/lead/details/${c.lead_id}/`} target="_blank" rel="noreferrer" style={{ color: "#2196F3", textDecoration: "none", fontSize: 12 }}>{c.lead_title || `#${c.lead_id}`}</a> : "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────
export default function CallStatistikasi() {
  const [startDate, setStartDate]         = useState(daysAgoISO(30));
  const [endDate,   setEndDate]           = useState(todayISO());
  const [filterOpen, setFilterOpen]       = useState(false);
  const [selectedResp, setSelectedResp]   = useState<{ id: number; name: string } | null>(null);
  const [syncing, setSyncing]             = useState(false);
  const [syncingPhotos, setSyncingPhotos] = useState(false);

  const statsQ     = useQuery({ queryKey: ["call-stats", startDate, endDate], queryFn: () => getCallStats({ start_date: startDate, end_date: endDate }) });
  const globalQ    = useQuery({ queryKey: ["call-global-stats", startDate, endDate], queryFn: () => getCallGlobalStats({ start_date: startDate, end_date: endDate }) });
  const reactionQ  = useQuery({ queryKey: ["call-reaction-stats", startDate, endDate], queryFn: () => getCallReactionStats({ start_date: startDate, end_date: endDate }) });

  const [prevFrom, prevTo] = useMemo(() => prevPeriod(startDate, endDate), [startDate, endDate]);
  const prevStatsQ    = useQuery({ queryKey: ["call-stats-prev", prevFrom, prevTo],    queryFn: () => getCallStats({ start_date: prevFrom, end_date: prevTo }) });
  const prevReactionQ = useQuery({ queryKey: ["call-reaction-prev", prevFrom, prevTo], queryFn: () => getCallReactionStats({ start_date: prevFrom, end_date: prevTo }) });

  const rows: CallStatsRow[]     = statsQ.data    ?? [];
  const reactionRows: CallReactionRow[] = reactionQ.data ?? [];

  const prevStatsMap = useMemo(() => { const m = new Map<number,CallStatsRow>();    (prevStatsQ.data    ?? []).forEach((r) => m.set(r.responsible_id, r)); return m; }, [prevStatsQ.data]);
  const prevReactMap = useMemo(() => { const m = new Map<number,CallReactionRow>(); (prevReactionQ.data ?? []).forEach((r) => m.set(r.responsible_id, r)); return m; }, [prevReactionQ.data]);

  const totals = useMemo(() => {
    const sum = (key: keyof CallStatsRow) => rows.reduce((a, r) => a + (Number(r[key]) || 0), 0);
    const total=sum("total_calls"), inbound=sum("inbound_calls"), outbound=sum("outbound_calls");
    const success=sum("success_calls"), failed=sum("failed_calls"), totalDur=sum("total_duration");
    return {
      total, inbound, outbound, success, failed, totalDur,
      avgDur: total > 0 ? Math.round(totalDur / total) : 0,
      missed: sum("missed_inbound"),
      callback: sum("callback_calls"),
      success_pct: total > 0 ? Math.round((success/total)*100) : 0,
      failed_pct:  total > 0 ? Math.round((failed /total)*100) : 0,
      inbound_dur: sum("inbound_duration"), outbound_dur: sum("outbound_duration"),
    };
  }, [rows]);

  const globalStats = globalQ.data;

  async function doSync() {
    if (syncing) return;
    setSyncing(true);
    try { await syncCalls(startDate, endDate); statsQ.refetch(); reactionQ.refetch(); } finally { setSyncing(false); }
  }
  async function doSyncPhotos() {
    if (syncingPhotos) return;
    setSyncingPhotos(true);
    try { await syncUserPhotos(); statsQ.refetch(); reactionQ.refetch(); } finally { setSyncingPhotos(false); }
  }

  const TH  = (extra?: React.CSSProperties): React.CSSProperties => ({ padding: "10px 14px", textAlign: "center", fontSize: 11, fontWeight: 700, color: "var(--text2)", textTransform: "uppercase", letterSpacing: "0.05em", background: "var(--bg2)", borderBottom: "1px solid var(--border)", whiteSpace: "nowrap", ...extra });
  const TD  = (extra?: React.CSSProperties): React.CSSProperties => ({ padding: "11px 14px", verticalAlign: "middle", borderBottom: "1px solid var(--border)", textAlign: "center", ...extra });
  const btn: React.CSSProperties = { display: "flex", alignItems: "center", gap: 7, padding: "7px 14px", borderRadius: 9, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text2)", fontSize: 13, cursor: "pointer", fontWeight: 500 };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "var(--bg2)" }}>
      <Topbar
        title="Call statistikasi"
        actions={
          <div style={{ display: "flex", gap: 8, position: "relative" }}>
            <button onClick={doSyncPhotos} disabled={syncingPhotos} style={btn} title="Bitrix24 dan foydalanuvchi rasmlarini yuklash">
              <PhoneCall size={14} />{syncingPhotos ? "Rasmlar..." : "Rasmlar sync"}
            </button>
            <button onClick={doSync} disabled={syncing} style={btn}>
              <RefreshCw size={14} style={{ opacity: syncing ? 0.5 : 1 }} />
              {syncing ? "Sinxronizatsiya..." : "Sinxronizatsiya"}
            </button>
            <div style={{ position: "relative" }}>
              <button onClick={() => setFilterOpen((v) => !v)} style={{ ...btn, color: filterOpen ? "#2196F3" : "var(--text2)", borderColor: filterOpen ? "#2196F3" : "var(--border)" }}>
                <SlidersHorizontal size={14} />Filtrlar
              </button>
              {filterOpen && <FilterPopover startDate={startDate} endDate={endDate} onStartDate={setStartDate} onEndDate={setEndDate} onClose={() => setFilterOpen(false)} />}
            </div>
          </div>
        }
      />

      <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px", display: "flex", flexDirection: "column", gap: 16 }}>

        {/* ── Row 1 ── */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12 }}>
          <Card label="Qo'ng'iroq jami" accentColor="#2196F3"
            value={<>{totals.total} <span style={{ fontSize: 16, fontWeight: 500, color: "var(--text2)" }}>ta</span></>}
            sub={fmtDur(totals.totalDur)}
            icon={<Phone size={19} color="#2196F3" />} iconBg="rgba(33,150,243,0.12)" />
          <Card label="Chiquvchi qo'ng'iroq" accentColor="#2196F3"
            value={<>{totals.outbound} <span style={{ fontSize: 16, fontWeight: 500, color: "var(--text2)" }}>ta</span></>}
            sub={fmtDur(totals.outbound_dur)}
            icon={<PhoneOutgoing size={19} color="#2196F3" />} iconBg="rgba(33,150,243,0.12)" />
          <Card label="Kiruvchi qo'ng'iroq" accentColor="#4CAF50"
            value={<>{totals.inbound} <span style={{ fontSize: 16, fontWeight: 500, color: "var(--text2)" }}>ta</span></>}
            sub={fmtDur(totals.inbound_dur)}
            icon={<PhoneIncoming size={19} color="#4CAF50" />} iconBg="rgba(76,175,80,0.12)" />
          <Card label="Muvaffaqiyatli" accentColor="#4CAF50"
            value={<span style={{ color: "#4CAF50" }}>{totals.success}</span>}
            icon={<CheckCircle size={19} color="#4CAF50" />} iconBg="rgba(76,175,80,0.12)"
            badge={`${totals.success_pct}%`} badgeColor="#4CAF50" />
          <Card label="Muvaffaqiyatsiz" accentColor="#F44336"
            value={<span style={{ color: "#F44336" }}>{totals.failed}</span>}
            icon={<XCircle size={19} color="#F44336" />} iconBg="rgba(244,67,54,0.10)"
            badge={totals.failed_pct > 0 ? `${totals.failed_pct}%` : undefined} badgeColor="#F44336" />
        </div>

        {/* ── Row 2 ── */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12 }}>
          <Card label="O'rtacha davomiyligi" accentColor="#9C27B0"
            value={fmtDurMin(totals.avgDur)}
            icon={<Timer size={19} color="#9C27B0" />} iconBg="rgba(156,39,176,0.10)" />
          <Card label="NDZ (javob berilmagan)" accentColor="#607D8B"
            value={<>{totals.failed} <span style={{ fontSize: 16, fontWeight: 500, color: "var(--text2)" }}>ta</span></>}
            icon={<PhoneOff size={19} color="#607D8B" />} iconBg="rgba(96,125,139,0.10)" />
          <Card label="Propushenniy" accentColor="#FF9800"
            value={<span style={{ color: "#FF9800" }}>{totals.missed} <span style={{ fontSize: 16, fontWeight: 500 }}>ta</span></span>}
            icon={<PhoneMissed size={19} color="#FF9800" />} iconBg="rgba(255,152,0,0.10)" />
          <Card label="Reaksiya vaqti" accentColor="#607D8B"
            value={<span style={{ fontSize: 22 }}>{fmtDur(globalStats?.reaksiya_vaqti ?? 0)}</span>}
            icon={<Clock size={19} color="#607D8B" />} iconBg="rgba(96,125,139,0.10)" />
          <Card label="Ne perezvonili" accentColor="#F44336"
            value={<>{globalStats?.ne_perezvonili ?? 0} <span style={{ fontSize: 16, fontWeight: 500, color: "var(--text2)" }}>ta</span></>}
            icon={<PhoneMissed size={19} color="#F44336" />} iconBg="rgba(244,67,54,0.10)" />
        </div>

        {/* ── Main stats table ── */}
        <div style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 14, overflow: "hidden" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px", borderBottom: "1px solid var(--border)" }}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>Xodimlar bo'yicha hisobot</div>
              <div style={{ fontSize: 12, color: "var(--text2)", marginTop: 2 }}>{rows.length} xodim • {startDate} — {endDate}</div>
            </div>
            <button title="Export" style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 34, height: 34, borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg2)", color: "var(--text2)", cursor: "pointer" }}><Download size={15} /></button>
          </div>

          {statsQ.isLoading ? (
            <div style={{ padding: 48, textAlign: "center", color: "var(--text2)" }}>Yuklanmoqda...</div>
          ) : rows.length === 0 ? (
            <div style={{ padding: 48, textAlign: "center", color: "var(--text2)" }}>Ma'lumot topilmadi. "Sinxronizatsiya" tugmasini bosing.</div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={TH({ textAlign: "left", minWidth: 200 })} rowSpan={2}>OPERATORLAR</th>
                    <th style={TH({ color: "#2196F3", borderLeft: "2px solid rgba(33,150,243,0.2)" })} colSpan={3}>QO'NG'IROQLAR SONI</th>
                    <th style={TH({ color: "#4CAF50", borderLeft: "2px solid rgba(76,175,80,0.2)" })} colSpan={3}>UNIKAL QO'NG'IROQLAR</th>
                    <th style={TH({ color: "#9C27B0", borderLeft: "2px solid rgba(156,39,176,0.2)" })} colSpan={3}>DAVOMIYLIK</th>
                    <th style={TH({ color: "#FF9800", borderLeft: "2px solid rgba(255,152,0,0.2)" })} colSpan={2}>NATIJA</th>
                    <th style={TH({ borderLeft: "2px solid rgba(0,0,0,0.06)" })} rowSpan={2}>DINAMIKA</th>
                  </tr>
                  <tr>
                    <th style={TH({ borderLeft: "2px solid rgba(33,150,243,0.2)" })}>Kiruvchi</th>
                    <th style={TH()}>Chiquvchi</th>
                    <th style={TH()}>Umumiy</th>
                    <th style={TH({ borderLeft: "2px solid rgba(76,175,80,0.2)" })}>Kiruvchi</th>
                    <th style={TH()}>Chiquvchi</th>
                    <th style={TH()}>Umumiy</th>
                    <th style={TH({ borderLeft: "2px solid rgba(156,39,176,0.2)" })}>Kiruvchi</th>
                    <th style={TH()}>Isxodyashie</th>
                    <th style={TH()}>Jami</th>
                    <th style={TH({ borderLeft: "2px solid rgba(255,152,0,0.2)" })}>Обратные</th>
                    <th style={TH()}>Ne perezv.</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((u) => {
                    const isSel = selectedResp?.id === u.responsible_id;
                    const prev  = prevStatsMap.get(u.responsible_id);
                    return (
                      <>
                        <tr key={u.responsible_id} style={{ background: isSel ? "rgba(33,150,243,0.06)" : "var(--bg)", cursor: "pointer" }}
                          onClick={() => setSelectedResp(isSel ? null : { id: u.responsible_id, name: u.full_name })}>
                          <td style={TD({ textAlign: "left" })}>
                            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                              <Avatar name={u.full_name} photoUrl={u.photo_url} id={u.responsible_id} />
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--text)" }}>{u.full_name}</div>
                                <div style={{ fontSize: 11.5, color: "var(--text2)" }}>ID: {u.responsible_id}</div>
                              </div>
                              {isSel ? <ChevronUp size={14} color="#2196F3" /> : <ChevronDown size={14} color="var(--text2)" />}
                            </div>
                          </td>
                          <td style={TD({ borderLeft: "2px solid rgba(33,150,243,0.10)" })}>{u.inbound_calls}</td>
                          <td style={TD()}>{u.outbound_calls}</td>
                          <td style={TD({ fontWeight: 700 })}>{u.total_calls}</td>
                          <td style={TD({ borderLeft: "2px solid rgba(76,175,80,0.10)" })}>{u.unique_inbound}</td>
                          <td style={TD()}>{u.unique_outbound}</td>
                          <td style={TD({ fontWeight: 700 })}>{u.unique_total}</td>
                          <td style={TD({ borderLeft: "2px solid rgba(156,39,176,0.10)", fontFamily: "monospace", fontSize: 12 })}>{fmtDur(u.inbound_duration)}</td>
                          <td style={TD({ fontFamily: "monospace", fontSize: 12 })}>{fmtDur(u.outbound_duration)}</td>
                          <td style={TD({ fontWeight: 700, fontFamily: "monospace", fontSize: 12 })}>{fmtDur(u.total_duration)}</td>
                          <td style={TD({ borderLeft: "2px solid rgba(255,152,0,0.10)", color: u.callback_calls > 0 ? "#4CAF50" : "var(--text)" })}>{u.callback_calls}</td>
                          <td style={TD({ color: "var(--text2)", fontSize: 12 })}>—</td>
                          <td style={TD({ borderLeft: "2px solid rgba(0,0,0,0.05)" })}><Delta curr={u.total_calls} prev={prev?.total_calls} /></td>
                        </tr>
                        {isSel && (
                          <tr key={`sub-${u.responsible_id}`}>
                            <td colSpan={13} style={{ padding: 0, background: "rgba(33,150,243,0.03)" }}>
                              <div style={{ borderTop: "1.5px solid rgba(33,150,243,0.2)" }}>
                                <div style={{ padding: "10px 18px", background: "rgba(33,150,243,0.06)", fontSize: 12.5, fontWeight: 600, color: "#2196F3" }}>
                                  {u.full_name} — qo'ng'iroqlar ro'yxati
                                </div>
                                <CallSubTable responsibleId={u.responsible_id} filter={{ start_date: startDate, end_date: endDate }} />
                              </div>
                            </td>
                          </tr>
                        )}
                      </>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ── Propushenniy va reaksiya vaqti table ── */}
        <div style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 14, overflow: "hidden" }}>
          <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)" }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>Propushenniy va reaksiya vaqti</div>
            <div style={{ fontSize: 12, color: "var(--text2)", marginTop: 2 }}>Pропushenniy qo'ng'iroqlar va qayta aloqa statistikasi</div>
          </div>

          {reactionQ.isLoading ? (
            <div style={{ padding: 40, textAlign: "center", color: "var(--text2)" }}>Yuklanmoqda...</div>
          ) : reactionRows.length === 0 ? (
            <div style={{ padding: 40, textAlign: "center", color: "var(--text2)" }}>Propushenniy qo'ng'iroqlar topilmadi</div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={TH({ textAlign: "left", minWidth: 200 })}>XODIM</th>
                    <th style={TH({ color: "#FF9800", borderLeft: "2px solid rgba(255,152,0,0.2)" })}>PРОПUSHENNIY</th>
                    <th style={TH({ color: "#F44336", borderLeft: "2px solid rgba(244,67,54,0.2)" })}>BEZ OTVETA (72 soat)</th>
                    <th style={TH({ color: "#9C27B0", borderLeft: "2px solid rgba(156,39,176,0.2)" })}>O'RTACHA REAKSIYA</th>
                    <th style={TH({ borderLeft: "2px solid rgba(0,0,0,0.06)" })}>DINAMIKA</th>
                  </tr>
                </thead>
                <tbody>
                  {reactionRows.map((u) => {
                    const prev = prevReactMap.get(u.responsible_id);
                    return (
                      <tr key={u.responsible_id} style={{ borderBottom: "1px solid var(--border)" }}>
                        <td style={TD({ textAlign: "left" })}>
                          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                            <Avatar name={u.full_name} photoUrl={u.photo_url} id={u.responsible_id} />
                            <div>
                              <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--text)" }}>{u.full_name}</div>
                              <div style={{ fontSize: 11.5, color: "var(--text2)" }}>ID: {u.responsible_id}</div>
                            </div>
                          </div>
                        </td>
                        <td style={TD({ borderLeft: "2px solid rgba(255,152,0,0.10)", color: "#FF9800", fontWeight: 600 })}>{u.missed_calls}</td>
                        <td style={TD({ borderLeft: "2px solid rgba(244,67,54,0.10)", color: u.bez_otveta > 0 ? "#F44336" : "var(--text)" })}>{u.bez_otveta}</td>
                        <td style={TD({ borderLeft: "2px solid rgba(156,39,176,0.10)", fontWeight: 600, color: "var(--text)" })}>
                          {u.avg_response_secs > 0 ? fmtReaction(u.avg_response_secs) : <span style={{ color: "var(--text2)" }}>—</span>}
                        </td>
                        <td style={TD({ borderLeft: "2px solid rgba(0,0,0,0.05)" })}>
                          <Delta curr={u.missed_calls} prev={prev?.missed_calls} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}

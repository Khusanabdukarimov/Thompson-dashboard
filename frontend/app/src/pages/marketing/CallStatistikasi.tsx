import { useState, useRef, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Phone, PhoneOutgoing, PhoneIncoming, CheckCircle, XCircle,
  Clock, PhoneMissed, Timer, ChevronDown, ChevronUp,
  SlidersHorizontal, Download, PhoneOff,
} from "lucide-react";
import { Topbar } from "@/components/Topbar";
import {
  getPyCallStats, getCallList,
  type PyCallStatsResult, type PyResponsibleCallStats,
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

function fmtPct(pct: number): string {
  if (pct > 0 && pct < 1) return "<1%";
  return `${Math.round(pct)}%`;
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
  const accent = accentColor || "#2196F3";
  return (
    <div style={{ position: "relative", minHeight: 112, background: `linear-gradient(145deg, ${accent}12 0%, var(--bg) 42%, var(--bg) 100%)`, border: `1px solid ${accent}33`, borderRadius: 14, padding: "18px 20px 18px", display: "flex", flexDirection: "column", minWidth: 0, overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 14 }}>
        <span style={{ fontSize: 12.5, color: accent, fontWeight: 700, lineHeight: 1.3 }}>{label}</span>
        <div style={{ width: 38, height: 38, borderRadius: 10, background: iconBg, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{icon}</div>
      </div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 8, alignSelf: "flex-start" }}>
        <div style={{ fontSize: 28, fontWeight: 700, lineHeight: 1, color: valueColor || "var(--text)" }}>{value}</div>
        {badge && (
          <span style={{ fontSize: 11, fontWeight: 700, color: badgeColor, background: `${badgeColor}18`, border: `1.5px solid ${badgeColor}35`, borderRadius: 6, padding: "2px 8px", lineHeight: 1.7, marginBottom: 2 }}>{badge}</span>
        )}
      </div>
      {sub && (
        <div style={{ position: "absolute", right: 14, bottom: 12, fontSize: 11.5, color: accent, display: "inline-flex", alignItems: "center", gap: 4, background: `${accent}14`, border: `1px solid ${accent}30`, borderRadius: 6, padding: "3px 8px" }}>
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

// ── Call list sub-table ───────────────────────────────────────────
const CALL_TYPE_LABEL: Record<number, { label: string; color: string }> = {
  1: { label: "Chiquvchi", color: "#2196F3" },
  2: { label: "Kiruvchi",  color: "#4CAF50" },
  3: { label: "Kiruvchi",  color: "#4CAF50" },
  4: { label: "Callback",  color: "#607D8B" },
};

function CallSubTable({ responsibleId, filter }: { responsibleId: number; filter: { start_date?: string; end_date?: string } }) {
  const q = useQuery({ queryKey: ["call-list", responsibleId, filter], queryFn: () => getCallList(responsibleId, filter) });
  if (q.isLoading) return <div style={{ padding: 24, textAlign: "center", color: "var(--text2)", fontSize: 13 }}>Yuklanmoqda...</div>;
  const calls = q.data ?? [];
  if (!calls.length) return <div style={{ padding: 24, textAlign: "center", color: "var(--text2)", fontSize: 13 }}>Qo'ng'iroqlar topilmadi</div>;
  return (
    <div style={{ maxHeight: "min(40vh, 320px)", overflow: "auto", borderTop: "1px solid var(--border)" }}>
      <table style={{ width: "100%", minWidth: 920, borderCollapse: "collapse", fontSize: 12.5 }}>
        <thead>
          <tr style={{ background: "rgba(33,150,243,0.05)" }}>
            {["#","Telefon","Turi","Davomiylik","Sana va vaqt","Status","Lead"].map((h) => (
              <th key={h} style={{ position: "sticky", top: 0, zIndex: 1, padding: "8px 14px", textAlign: "left", fontWeight: 600, color: "var(--text2)", background: "var(--bg2)", borderBottom: "1px solid var(--border)", whiteSpace: "nowrap" }}>{h}</th>
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
  const [startDate, setStartDate]       = useState(daysAgoISO(30));
  const [endDate,   setEndDate]         = useState(todayISO());
  const [filterOpen, setFilterOpen]     = useState(false);
  const [selectedResp, setSelectedResp] = useState<{ id: number; name: string } | null>(null);

  const statsQ = useQuery({
    queryKey: ["py-call-stats", startDate, endDate],
    queryFn:  () => getPyCallStats({ start_date: startDate, end_date: endDate }),
  });

  const data: PyCallStatsResult | undefined = statsQ.data;
  const rows: PyResponsibleCallStats[]      = data?.responsibles ?? [];
  const failedCalls = data?.failed_calls ?? 0;
  const ndzCalls = data?.ndz_calls ?? 0;

  const TH  = (extra?: React.CSSProperties): React.CSSProperties => ({ padding: "10px 14px", textAlign: "center", fontSize: 11, fontWeight: 700, color: "var(--text2)", textTransform: "uppercase", letterSpacing: "0.05em", background: "var(--bg2)", borderBottom: "1px solid var(--border)", whiteSpace: "nowrap", ...extra });
  const TD  = (extra?: React.CSSProperties): React.CSSProperties => ({ padding: "11px 14px", verticalAlign: "middle", borderBottom: "1px solid var(--border)", textAlign: "center", ...extra });

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "var(--bg2)" }}>
      <Topbar
        title="Call statistikasi"
        actions={
          <div style={{ display: "flex", gap: 8, position: "relative" }}>
            <div style={{ position: "relative" }}>
              <button onClick={() => setFilterOpen((v) => !v)} style={{ display: "flex", alignItems: "center", gap: 7, padding: "7px 14px", borderRadius: 9, border: `1px solid ${filterOpen ? "#2196F3" : "var(--border)"}`, background: "var(--bg)", color: filterOpen ? "#2196F3" : "var(--text2)", fontSize: 13, cursor: "pointer", fontWeight: 500 }}>
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
            value={<>{data?.total_calls ?? 0} <span style={{ fontSize: 16, fontWeight: 500, color: "var(--text2)" }}>ta</span></>}
            sub={fmtDur(data?.total_duration ?? 0)}
            icon={<Phone size={19} color="#2196F3" />} iconBg="rgba(33,150,243,0.12)" />
          <Card label="Chiquvchi qo'ng'iroq" accentColor="#2196F3"
            value={<>{data?.outbound_calls ?? 0} <span style={{ fontSize: 16, fontWeight: 500, color: "var(--text2)" }}>ta</span></>}
            sub={fmtDur(rows.reduce((s, r) => s + r.outbound_duration, 0))}
            icon={<PhoneOutgoing size={19} color="#2196F3" />} iconBg="rgba(33,150,243,0.12)" />
          <Card label="Kiruvchi qo'ng'iroq" accentColor="#4CAF50"
            value={<>{data?.inbound_calls ?? 0} <span style={{ fontSize: 16, fontWeight: 500, color: "var(--text2)" }}>ta</span></>}
            sub={fmtDur(rows.reduce((s, r) => s + r.inbound_duration, 0))}
            icon={<PhoneIncoming size={19} color="#4CAF50" />} iconBg="rgba(76,175,80,0.12)" />
          <Card label="Muvaffaqiyatli" accentColor="#4CAF50"
            value={<span style={{ color: "#4CAF50" }}>{data?.success_calls ?? 0}</span>}
            icon={<CheckCircle size={19} color="#4CAF50" />} iconBg="rgba(76,175,80,0.12)"
            badge={`${Math.round(data?.success_pct ?? 0)}%`} badgeColor="#4CAF50" />
          <Card label="Muvaffaqiyatsiz" accentColor="#F44336"
            value={<span style={{ color: "#F44336" }}>{failedCalls}</span>}
            icon={<XCircle size={19} color="#F44336" />} iconBg="rgba(244,67,54,0.10)"
            badge={failedCalls > 0 ? fmtPct(data?.failed_pct ?? 0) : undefined} badgeColor="#F44336" />
        </div>

        {/* ── Row 2 ── */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12 }}>
          <Card label="O'rtacha davomiyligi" accentColor="#9C27B0"
            value={fmtDurMin(data?.avg_duration ?? 0)}
            icon={<Timer size={19} color="#9C27B0" />} iconBg="rgba(156,39,176,0.10)" />
          <Card label="NDZ (javob berilmagan)" accentColor="#607D8B"
            value={<>{ndzCalls} <span style={{ fontSize: 16, fontWeight: 500, color: "var(--text2)" }}>ta</span></>}
            icon={<PhoneOff size={19} color="#607D8B" />} iconBg="rgba(96,125,139,0.10)" />
          <Card label="Propushenniy" accentColor="#FF9800"
            value={<span style={{ color: "#FF9800" }}>{data?.missed_inbound ?? 0} <span style={{ fontSize: 16, fontWeight: 500 }}>ta</span></span>}
            icon={<PhoneMissed size={19} color="#FF9800" />} iconBg="rgba(255,152,0,0.10)" />
          <Card label="Reaksiya vaqti" accentColor="#607D8B"
            value={<span style={{ fontSize: 22 }}>{fmtDur(data?.reaksiya_vaqti ?? 0)}</span>}
            icon={<Clock size={19} color="#607D8B" />} iconBg="rgba(96,125,139,0.10)" />
          <Card label="Ne perezvonili" accentColor="#F44336"
            value={<>{data?.ne_perezvonili ?? 0} <span style={{ fontSize: 16, fontWeight: 500, color: "var(--text2)" }}>ta</span></>}
            icon={<PhoneMissed size={19} color="#F44336" />} iconBg="rgba(244,67,54,0.10)" />
        </div>

        {/* ── Main stats table ── */}
        <div style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 14, overflow: "hidden" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px", borderBottom: "1px solid var(--border)" }}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>Xodimlar bo'yicha hisobot</div>
            </div>
            <button title="Export" style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 34, height: 34, borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg2)", color: "var(--text2)", cursor: "pointer" }}><Download size={15} /></button>
          </div>

          {statsQ.isLoading ? (
            <div style={{ padding: 48, textAlign: "center", color: "var(--text2)" }}>Yuklanmoqda...</div>
          ) : statsQ.isError ? (
            <div style={{ padding: 48, textAlign: "center", color: "#F44336", fontSize: 13 }}>Xatolik: {String((statsQ.error as Error)?.message ?? "noma'lum xato")}</div>
          ) : rows.length === 0 ? (
            <div style={{ padding: 48, textAlign: "center", color: "var(--text2)" }}>Ma'lumot topilmadi</div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={TH({ textAlign: "left", minWidth: 200 })} rowSpan={2}>OPERATORLAR</th>
                    <th style={TH({ color: "#2196F3", borderLeft: "2px solid rgba(33,150,243,0.2)" })} colSpan={3}>QO'NG'IROQLAR SONI</th>
                    <th style={TH({ color: "#4CAF50", borderLeft: "2px solid rgba(76,175,80,0.2)" })} colSpan={3}>UNIKAL QO'NG'IROQLAR</th>
                    <th style={TH({ color: "#9C27B0", borderLeft: "2px solid rgba(156,39,176,0.2)" })} colSpan={3}>DAVOMIYLIK</th>
                    <th style={TH({ color: "#FF9800", borderLeft: "2px solid rgba(255,152,0,0.24)" })} colSpan={3}>PROPUSHENNIY</th>
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
                    <th style={TH({ borderLeft: "2px solid rgba(255,152,0,0.24)" })}>Umumiy</th>
                    <th style={TH()}>Qayta chiqilgan</th>
                    <th style={TH()}>Chiqilmagan</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((u, idx) => {
                    const uid    = u.responsible_id ?? idx;
                    const isSel  = selectedResp?.id === uid;
                    return (
                      <>
                        <tr key={uid} style={{ background: isSel ? "rgba(33,150,243,0.06)" : "var(--bg)", cursor: "pointer" }}
                          onClick={() => setSelectedResp(isSel ? null : { id: uid, name: u.full_name })}>
                          <td style={TD({ textAlign: "left" })}>
                            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                              <Avatar name={u.full_name} photoUrl={u.photo_url} id={uid} />
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--text)" }}>{u.full_name}</div>
                                <div style={{ fontSize: 11.5, color: "var(--text2)" }}>ID: {u.responsible_id ?? "—"}</div>
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
                          <td style={TD({ borderLeft: "2px solid rgba(255,152,0,0.12)", color: "#FF9800", fontWeight: 700 })}>{u.missed_inbound}</td>
                          <td style={TD({ color: "#4CAF50", fontWeight: 700 })}>{u.missed_recalled}</td>
                          <td style={TD({ color: "#F44336", fontWeight: 700 })}>{u.missed_unrecalled}</td>
                        </tr>
                        {isSel && u.responsible_id != null && (
                          <tr key={`sub-${uid}`}>
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

      </div>
    </div>
  );
}

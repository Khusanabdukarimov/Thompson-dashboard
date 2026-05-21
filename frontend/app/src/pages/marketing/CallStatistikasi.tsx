import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Phone, PhoneOutgoing, PhoneIncoming, CheckCircle, XCircle,
  Clock, PhoneMissed, PhoneOff, Timer, PhoneCall,
  Download, CalendarDays, ChevronDown, ChevronUp,
} from "lucide-react";
import { Topbar } from "@/components/Topbar";
import { getCallStats, getCallList, syncCalls, type CallStatsRow } from "@/lib/api/leads";

// ── Helpers ───────────────────────────────────────────────────────
const localISO = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const todayISO = () => localISO(new Date());
const daysAgoISO = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return localISO(d);
};

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
  const s = secs % 60;
  return s > 0 ? `${m},${String(Math.round(s / 6))} min` : `${m} min`;
}

function initials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
}

const AVATAR_COLORS = [
  "#4CAF50", "#2196F3", "#9C27B0", "#FF9800",
  "#F44336", "#009688", "#3F51B5", "#E91E63",
];

function avatarColor(id: number) {
  return AVATAR_COLORS[id % AVATAR_COLORS.length];
}

// ── Metric card ───────────────────────────────────────────────────
function MetricCard({
  label, value, sub, icon, iconBg, badge, badgeColor,
}: {
  label: string;
  value: React.ReactNode;
  sub?: string;
  icon: React.ReactNode;
  iconBg: string;
  badge?: string;
  badgeColor?: string;
}) {
  return (
    <div style={{
      background: "var(--bg)",
      border: "1px solid var(--border)",
      borderRadius: 12,
      padding: "18px 20px",
      display: "flex",
      flexDirection: "column",
      gap: 10,
      minWidth: 0,
    }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
        <span style={{ fontSize: 12, color: "var(--text2)", fontWeight: 500 }}>{label}</span>
        <div style={{
          width: 36, height: 36, borderRadius: 10,
          background: iconBg, display: "flex", alignItems: "center",
          justifyContent: "center", flexShrink: 0,
        }}>
          {icon}
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 8 }}>
        <div style={{ fontSize: 26, fontWeight: 700, color: "var(--text)", lineHeight: 1 }}>
          {value}
        </div>
        {badge && (
          <span style={{
            fontSize: 11, fontWeight: 700, color: badgeColor || "#fff",
            background: badgeColor ? `${badgeColor}20` : "#4CAF5020",
            border: `1px solid ${badgeColor || "#4CAF50"}40`,
            borderRadius: 6, padding: "2px 7px", lineHeight: 1.6,
          }}>
            {badge}
          </span>
        )}
      </div>
      {sub && (
        <div style={{ fontSize: 12, color: "var(--text2)", display: "flex", alignItems: "center", gap: 4 }}>
          <Clock size={11} />
          {sub}
        </div>
      )}
    </div>
  );
}

// ── Call-list sub-row ─────────────────────────────────────────────
const CALL_TYPE_LABEL: Record<number, { label: string; color: string }> = {
  1: { label: "Chiquvchi", color: "#2196F3" },
  2: { label: "Kiruvchi", color: "#4CAF50" },
};

function CallSubTable({
  responsibleId,
  filter,
}: {
  responsibleId: number;
  filter: { start_date?: string; end_date?: string };
}) {
  const q = useQuery({
    queryKey: ["call-list", responsibleId, filter],
    queryFn: () => getCallList(responsibleId, filter),
  });

  if (q.isLoading) {
    return (
      <div style={{ padding: "20px", textAlign: "center", color: "var(--text2)", fontSize: 13 }}>
        Yuklanmoqda...
      </div>
    );
  }

  const calls = q.data ?? [];
  if (!calls.length) {
    return (
      <div style={{ padding: "20px", textAlign: "center", color: "var(--text2)", fontSize: 13 }}>
        Qo'ng'iroqlar topilmadi
      </div>
    );
  }

  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
        <thead>
          <tr style={{ background: "rgba(33,150,243,0.06)" }}>
            {["#", "Telefon", "Turi", "Davomiylik", "Sana", "Status", "Lead"].map((h) => (
              <th key={h} style={{
                padding: "8px 12px", textAlign: "left", fontWeight: 600,
                color: "var(--text2)", borderBottom: "1px solid var(--border)",
              }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {calls.map((c, i) => {
            const ct = c.call_type ? CALL_TYPE_LABEL[c.call_type] : null;
            const isSuccess = c.status_code === 200 || (c.duration ?? 0) >= 10;
            return (
              <tr key={c.id} style={{ borderBottom: "1px solid var(--border)" }}>
                <td style={{ padding: "7px 12px", color: "var(--text2)" }}>{i + 1}</td>
                <td style={{ padding: "7px 12px", fontFamily: "monospace" }}>
                  {c.phone_number || "—"}
                </td>
                <td style={{ padding: "7px 12px" }}>
                  {ct ? (
                    <span style={{
                      fontSize: 11, fontWeight: 600, color: ct.color,
                      background: `${ct.color}15`, border: `1px solid ${ct.color}30`,
                      borderRadius: 5, padding: "2px 7px",
                    }}>{ct.label}</span>
                  ) : "—"}
                </td>
                <td style={{ padding: "7px 12px", fontFamily: "monospace" }}>
                  {fmtDur(c.duration ?? 0)}
                </td>
                <td style={{ padding: "7px 12px", color: "var(--text2)" }}>
                  {c.call_start
                    ? new Date(c.call_start).toLocaleString("ru-RU", {
                        day: "2-digit", month: "2-digit", year: "2-digit",
                        hour: "2-digit", minute: "2-digit",
                      })
                    : "—"}
                </td>
                <td style={{ padding: "7px 12px" }}>
                  <span style={{
                    fontSize: 11, fontWeight: 600,
                    color: isSuccess ? "#4CAF50" : "#F44336",
                    background: isSuccess ? "#4CAF5015" : "#F4433615",
                    border: `1px solid ${isSuccess ? "#4CAF5030" : "#F4433630"}`,
                    borderRadius: 5, padding: "2px 7px",
                  }}>
                    {isSuccess ? "Muvaffaqiyatli" : "Muvaffaqiyatsiz"}
                  </span>
                </td>
                <td style={{ padding: "7px 12px" }}>
                  {c.lead_id ? (
                    <a
                      href={`https://mountain.bitrix24.kz/crm/lead/details/${c.lead_id}/`}
                      target="_blank"
                      rel="noreferrer"
                      style={{ color: "#2196F3", textDecoration: "none", fontSize: 12 }}
                    >
                      {c.lead_title || `#${c.lead_id}`}
                    </a>
                  ) : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────
export default function CallStatistikasi() {
  const [startDate, setStartDate] = useState(daysAgoISO(30));
  const [endDate, setEndDate] = useState(todayISO());
  const [selectedResp, setSelectedResp] = useState<{ id: number; name: string } | null>(null);
  const [syncing, setSyncing] = useState(false);

  const statsQ = useQuery({
    queryKey: ["call-stats", startDate, endDate],
    queryFn: () => getCallStats({ start_date: startDate, end_date: endDate }),
  });

  const rows: CallStatsRow[] = statsQ.data ?? [];

  // Global totals computed from per-row data
  const totals = useMemo(() => {
    const sum = (key: keyof CallStatsRow) =>
      rows.reduce((acc, r) => acc + (Number(r[key]) || 0), 0);
    const total_calls    = sum("total_calls");
    const inbound_calls  = sum("inbound_calls");
    const outbound_calls = sum("outbound_calls");
    const success_calls  = sum("success_calls");
    const failed_calls   = sum("failed_calls");
    const total_duration = sum("total_duration");
    const missed_inbound = sum("missed_inbound");
    const avg_dur = total_calls > 0 ? Math.round(total_duration / total_calls) : 0;
    const success_pct = total_calls > 0 ? Math.round((success_calls / total_calls) * 100) : 0;
    const failed_pct  = total_calls > 0 ? Math.round((failed_calls  / total_calls) * 100) : 0;
    return {
      total_calls, inbound_calls, outbound_calls,
      success_calls, failed_calls,
      total_duration, avg_dur,
      missed_inbound, success_pct, failed_pct,
      inbound_duration:  sum("inbound_duration"),
      outbound_duration: sum("outbound_duration"),
    };
  }, [rows]);

  async function handleSync() {
    if (syncing) return;
    setSyncing(true);
    try {
      await syncCalls(startDate, endDate);
      statsQ.refetch();
    } catch {
      // ignore
    } finally {
      setSyncing(false);
    }
  }

  const thStyle: React.CSSProperties = {
    padding: "11px 14px", textAlign: "left", fontSize: 11.5,
    fontWeight: 700, color: "var(--text2)", textTransform: "uppercase",
    letterSpacing: "0.04em", background: "var(--bg2)",
    borderBottom: "1px solid var(--border)", whiteSpace: "nowrap",
  };
  const thCenter: React.CSSProperties = { ...thStyle, textAlign: "center" };
  const tdStyle: React.CSSProperties = {
    padding: "10px 14px", verticalAlign: "middle",
    borderBottom: "1px solid var(--border)",
  };
  const tdCenter: React.CSSProperties = { ...tdStyle, textAlign: "center" };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "var(--bg2)" }}>
      <Topbar
        title="Call statistikasi"
        sub="Telefon qo'ng'iroqlari tahlili"
      />

      <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px", display: "flex", flexDirection: "column", gap: 20 }}>

        {/* ── Filter bar ── */}
        <div style={{
          display: "flex", alignItems: "center", gap: 10,
          background: "var(--bg)", border: "1px solid var(--border)",
          borderRadius: 12, padding: "12px 16px",
        }}>
          <CalendarDays size={16} color="var(--text2)" />
          <span style={{ fontSize: 13, color: "var(--text2)", marginRight: 4 }}>Sana:</span>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            style={{
              border: "1px solid var(--border)", borderRadius: 8,
              padding: "5px 10px", fontSize: 13, background: "var(--bg2)",
              color: "var(--text)", cursor: "pointer",
            }}
          />
          <span style={{ color: "var(--text2)" }}>—</span>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            style={{
              border: "1px solid var(--border)", borderRadius: 8,
              padding: "5px 10px", fontSize: 13, background: "var(--bg2)",
              color: "var(--text)", cursor: "pointer",
            }}
          />
          <div style={{ flex: 1 }} />
          <button
            onClick={handleSync}
            disabled={syncing}
            style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "7px 14px", borderRadius: 8, border: "1px solid var(--border)",
              background: syncing ? "var(--bg2)" : "var(--bg)",
              color: "var(--text2)", fontSize: 13, cursor: syncing ? "not-allowed" : "pointer",
            }}
          >
            <Phone size={14} />
            {syncing ? "Sinxronizatsiya..." : "Sinxronizatsiya"}
          </button>
          <button
            onClick={() => statsQ.refetch()}
            style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "7px 14px", borderRadius: 8, border: "1px solid var(--border)",
              background: "var(--bg)", color: "var(--text2)", fontSize: 13, cursor: "pointer",
            }}
          >
            Yangilash
          </button>
        </div>

        {/* ── Top metric cards row 1 ── */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12 }}>
          <MetricCard
            label="Qo'ng'iroq jami"
            value={<>{totals.total_calls} <span style={{ fontSize: 14, fontWeight: 500, color: "var(--text2)" }}>ta</span></>}
            sub={fmtDur(totals.total_duration)}
            icon={<Phone size={18} color="#2196F3" />}
            iconBg="rgba(33,150,243,0.12)"
          />
          <MetricCard
            label="Chiquvchi qo'ng'iroq"
            value={<>{totals.outbound_calls} <span style={{ fontSize: 14, fontWeight: 500, color: "var(--text2)" }}>ta</span></>}
            sub={fmtDur(totals.outbound_duration)}
            icon={<PhoneOutgoing size={18} color="#2196F3" />}
            iconBg="rgba(33,150,243,0.12)"
          />
          <MetricCard
            label="Kiruvchi qo'ng'iroq"
            value={<>{totals.inbound_calls} <span style={{ fontSize: 14, fontWeight: 500, color: "var(--text2)" }}>ta</span></>}
            sub={fmtDur(totals.inbound_duration)}
            icon={<PhoneIncoming size={18} color="#4CAF50" />}
            iconBg="rgba(76,175,80,0.12)"
          />
          <MetricCard
            label="Muvaffaqiyatli"
            value={<span style={{ color: "#4CAF50" }}>{totals.success_calls}</span>}
            icon={<CheckCircle size={18} color="#4CAF50" />}
            iconBg="rgba(76,175,80,0.12)"
            badge={`${totals.success_pct}%`}
            badgeColor="#4CAF50"
          />
          <MetricCard
            label="Muvaffaqiyatsiz"
            value={<span style={{ color: "#F44336" }}>{totals.failed_calls}</span>}
            icon={<XCircle size={18} color="#F44336" />}
            iconBg="rgba(244,67,54,0.12)"
            badge={`${totals.failed_pct}%`}
            badgeColor="#F44336"
          />
        </div>

        {/* ── Top metric cards row 2 ── */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
          <MetricCard
            label="O'rtacha davomiyligi"
            value={fmtDurMin(totals.avg_dur)}
            icon={<Timer size={18} color="#9C27B0" />}
            iconBg="rgba(156,39,176,0.12)"
          />
          <MetricCard
            label="NDZ (javob berilmagan)"
            value={<>{totals.failed_calls} <span style={{ fontSize: 14, fontWeight: 500, color: "var(--text2)" }}>ta</span></>}
            icon={<PhoneOff size={18} color="#607D8B" />}
            iconBg="rgba(96,125,139,0.12)"
          />
          <MetricCard
            label="Propushenniy"
            value={<span style={{ color: "#FF9800" }}>{totals.missed_inbound} <span style={{ fontSize: 14, fontWeight: 500 }}>ta</span></span>}
            icon={<PhoneMissed size={18} color="#FF9800" />}
            iconBg="rgba(255,152,0,0.12)"
          />
          <MetricCard
            label="Muvaffaqiyatli (davomiylik)"
            value={fmtDur(totals.total_duration)}
            icon={<PhoneCall size={18} color="#2196F3" />}
            iconBg="rgba(33,150,243,0.12)"
          />
        </div>

        {/* ── Per-responsible table ── */}
        <div style={{
          background: "var(--bg)", border: "1px solid var(--border)",
          borderRadius: 14, overflow: "hidden",
        }}>
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "16px 20px", borderBottom: "1px solid var(--border)",
          }}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>
                Xodimlar bo'yicha hisobot
              </div>
              <div style={{ fontSize: 12, color: "var(--text2)", marginTop: 2 }}>
                {rows.length} xodim • {startDate} — {endDate}
              </div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                style={{
                  display: "flex", alignItems: "center", gap: 6,
                  padding: "7px 12px", borderRadius: 8, border: "1px solid var(--border)",
                  background: "var(--bg2)", color: "var(--text2)", fontSize: 12, cursor: "pointer",
                }}
                title="Export (tez kunda)"
              >
                <Download size={14} />
              </button>
            </div>
          </div>

          {statsQ.isLoading ? (
            <div style={{ padding: 40, textAlign: "center", color: "var(--text2)" }}>
              Yuklanmoqda...
            </div>
          ) : rows.length === 0 ? (
            <div style={{ padding: 40, textAlign: "center", color: "var(--text2)" }}>
              Ma'lumot topilmadi. Sinxronizatsiya qiling.
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={{ ...thStyle, minWidth: 180 }} rowSpan={2}>Operatorlar</th>
                    <th style={{ ...thCenter, color: "#2196F3", borderLeft: "2px solid #2196F320" }} colSpan={3}>
                      Qo'ng'iroqlar soni
                    </th>
                    <th style={{ ...thCenter, color: "#4CAF50", borderLeft: "2px solid #4CAF5020" }} colSpan={3}>
                      Unikal qo'ng'iroqlar
                    </th>
                    <th style={{ ...thCenter, color: "#9C27B0", borderLeft: "2px solid #9C27B020" }} colSpan={3}>
                      Qo'ng'iroq davomiyligi
                    </th>
                  </tr>
                  <tr>
                    <th style={{ ...thCenter, borderLeft: "2px solid #2196F320" }}>Kiruvchi</th>
                    <th style={{ ...thCenter }}>Chiquvchi</th>
                    <th style={{ ...thCenter }}>Umumiy</th>
                    <th style={{ ...thCenter, borderLeft: "2px solid #4CAF5020" }}>Kiruvchi</th>
                    <th style={{ ...thCenter }}>Chiquvchi</th>
                    <th style={{ ...thCenter }}>Umumiy</th>
                    <th style={{ ...thCenter, borderLeft: "2px solid #9C27B020" }}>Kiruvchi</th>
                    <th style={{ ...thCenter }}>Isxodyashie</th>
                    <th style={{ ...thCenter }}>Jami</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((u) => {
                    const isSel = selectedResp?.id === u.responsible_id;
                    return (
                      <>
                        <tr
                          key={u.responsible_id}
                          style={{
                            background: isSel ? "rgba(33,150,243,0.07)" : "var(--bg)",
                            cursor: "pointer",
                            transition: "background 0.15s",
                          }}
                          onClick={() =>
                            setSelectedResp(isSel ? null : { id: u.responsible_id, name: u.full_name })
                          }
                        >
                          {/* Operator */}
                          <td style={tdStyle}>
                            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                              <div style={{
                                width: 34, height: 34, borderRadius: "50%",
                                background: avatarColor(u.responsible_id),
                                display: "flex", alignItems: "center", justifyContent: "center",
                                fontSize: 12, fontWeight: 700, color: "#fff", flexShrink: 0,
                              }}>
                                {initials(u.full_name)}
                              </div>
                              <div>
                                <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>
                                  {u.full_name}
                                </div>
                                <div style={{ fontSize: 11, color: "var(--text2)" }}>
                                  ID: {u.responsible_id}
                                </div>
                              </div>
                              <div style={{ marginLeft: "auto" }}>
                                {isSel
                                  ? <ChevronUp size={14} color="#2196F3" />
                                  : <ChevronDown size={14} color="var(--text2)" />}
                              </div>
                            </div>
                          </td>

                          {/* Qo'ng'iroqlar soni */}
                          <td style={{ ...tdCenter, borderLeft: "2px solid #2196F320" }}>{u.inbound_calls}</td>
                          <td style={tdCenter}>{u.outbound_calls}</td>
                          <td style={{ ...tdCenter, fontWeight: 700 }}>{u.total_calls}</td>

                          {/* Unikal */}
                          <td style={{ ...tdCenter, borderLeft: "2px solid #4CAF5020" }}>{u.unique_inbound}</td>
                          <td style={tdCenter}>{u.unique_outbound}</td>
                          <td style={{ ...tdCenter, fontWeight: 700 }}>{u.unique_total}</td>

                          {/* Davomiylik */}
                          <td style={{ ...tdCenter, borderLeft: "2px solid #9C27B020", fontFamily: "monospace", fontSize: 12 }}>
                            {fmtDur(u.inbound_duration)}
                          </td>
                          <td style={{ ...tdCenter, fontFamily: "monospace", fontSize: 12 }}>
                            {fmtDur(u.outbound_duration)}
                          </td>
                          <td style={{ ...tdCenter, fontWeight: 700, fontFamily: "monospace", fontSize: 12 }}>
                            {fmtDur(u.total_duration)}
                          </td>
                        </tr>

                        {/* Drill-down call list */}
                        {isSel && (
                          <tr key={`sub-${u.responsible_id}`}>
                            <td
                              colSpan={10}
                              style={{ padding: 0, background: "rgba(33,150,243,0.03)" }}
                            >
                              <div style={{
                                borderTop: "1px solid rgba(33,150,243,0.2)",
                                borderBottom: "1px solid rgba(33,150,243,0.2)",
                              }}>
                                <div style={{
                                  padding: "10px 16px",
                                  background: "rgba(33,150,243,0.06)",
                                  fontSize: 12, fontWeight: 600, color: "#2196F3",
                                }}>
                                  {u.full_name} — qo'ng'iroqlar ro'yxati
                                </div>
                                <CallSubTable
                                  responsibleId={u.responsible_id}
                                  filter={{ start_date: startDate, end_date: endDate }}
                                />
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

import { Fragment, useState, useRef, useMemo, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Phone, PhoneOutgoing, PhoneIncoming, CheckCircle, XCircle,
  Clock, PhoneMissed, Timer, ChevronDown,
  Download, PhoneOff, Search, Users, ChevronRight, ExternalLink,
} from "lucide-react";
import { Topbar } from "@/components/Topbar";
import { MultiSelect } from "@/components/MultiSelect";
import { DateRangePicker } from "@/components/DateRangePicker";
import { MissedCallsModal, type MissedCallsVariant } from "@/components/MissedCallsModal";
import { describeWorkHours } from "@/lib/workHours";
import { getConfig } from "@/lib/api/config";
import {
  getPyCallStats, getCallList, getCallFilterOptions,
  type CallDashboardFilter,
  type PyCallStatsResult, type PyResponsibleCallStats, type CallListRow,
} from "@/lib/api/leads";
import { leadStageColor, leadStageLabel } from "@/lib/leadStages";
import { StatusMark, Dot } from "@/components/StatusMark";
import { openLead, openByPhone } from "@/lib/status";
import { fmtNum } from "@/lib/utils";
import { EmptyState, ErrorState, LoadingRows, LoadingValue } from "@/components/DataState";
import { SidePanel, PanelStats } from "@/components/SidePanel";
import { ReactionPanel } from "@/components/ReactionPanel";
import { fmtSecs, fmtClock } from "@/lib/duration";

// The portal comes from /api/config (BITRIX24_PORTAL) — never hardcode it, or the
// links point at whichever portal the code was copied from.
function useBitrixPortal(): string {
  const q = useQuery({ queryKey: ["config"], queryFn: getConfig, staleTime: Infinity });
  return (q.data?.bitrix_portal ?? "").replace(/\/+$/, "");
}

// ── Helpers ───────────────────────────────────────────────────────
const localISO = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const todayISO  = () => localISO(new Date());
const daysAgoISO = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return localISO(d); };
const startOfMonthISO = () => { const d = new Date(); d.setDate(1); return localISO(d); };

/** A number cell of the operator table: a faint "—" for zero, so the real figures stand out. */
function Num({ v, time, color, style }: { v: number; time?: boolean; color?: string; style: React.CSSProperties }) {
  const zero = !v;
  return (
    <td style={{ ...style, fontVariantNumeric: "tabular-nums", color: zero ? "var(--text3)" : (color ?? "var(--text)"), fontWeight: zero ? 400 : style.fontWeight }}>
      {time ? fmtClock(v) : fmtNum(v ?? 0)}
    </td>
  );
}

/** Row hover / selection and the frozen name column of the operator table. */
const TABLE_CSS = `
  .cs-row td { background: var(--bg); transition: background .12s; }
  .cs-row:hover td { background: var(--bg3); }
  .cs-row[data-sel] td { background: rgba(37,99,235,.07); }
  .cs-row td.cs-sticky, th.cs-sticky { position: sticky; left: 0; z-index: 2; box-shadow: 1px 0 0 var(--border); }
  th.cs-sticky { z-index: 4; }
  .cs-go { color: var(--text3); opacity: 0; transition: opacity .12s; flex-shrink: 0; }
  .cs-row:hover .cs-go { opacity: 1; }
  .cl-row td { transition: background .12s; }
  .cl-row:hover td { background: var(--bg3); }
  .cl-link { cursor: pointer; }
  .cl-go { color: var(--text3); opacity: 0; transition: opacity .12s; }
  .cl-row:hover .cl-go { opacity: 1; }
`;

// Time formats are shared (lib/duration): fmtClock for totals ("117:19:34" → "117:19:34", 0 → "0:00"),
// fmtSecs for averages and waits ("1 daq 37 s") — one way of writing time across the page.
const fmtDur = (secs: number) => fmtClock(secs);
const fmtAvgDur = (secs: number) => fmtSecs(secs);

function fmtPct(pct: number): string {
  if (pct > 0 && pct < 1) return "<1%";
  return `${Math.round(pct)}%`;
}


type CallFilterState = {
  start_date: string;
  end_date: string;
  responsible_ids: string[];
  phone: string;
  source: string;
  call_kind: string;
  status: string;
  duration_from: string;
  duration_to: string;
  stage: string;
};

const callStatusOptions = [
  { value: "all", label: "Barchasi" },
  { value: "success", label: "Muvaffaqiyatli" },
  { value: "failed", label: "Muvaffaqiyatsiz" },
  { value: "missed", label: "Propushenniy" },
  { value: "ndz", label: "NDZ" },
  { value: "recalled", label: "Qayta chiqilgan" },
  { value: "unrecalled", label: "Qayta chiqilmagan" },
];

const callKindOptions = [
  { value: "all", label: "Barchasi" },
  { value: "inbound", label: "Kiruvchi" },
  { value: "outbound", label: "Chiquvchi" },
  { value: "callback", label: "Callback" },
];

function defaultCallFilters(): CallFilterState {
  const now = new Date();
  return {
    start_date: localISO(new Date(now.getFullYear(), now.getMonth(), 1)),
    end_date: todayISO(),
    responsible_ids: [],
    phone: "",
    source: "all",
    call_kind: "all",
    status: "all",
    duration_from: "",
    duration_to: "",
    stage: "all",
  };
}

function parseFilterNumber(value: string): number | undefined {
  if (value.trim() === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : undefined;
}

function toApiFilter(filter: CallFilterState): CallDashboardFilter {
  return {
    start_date: filter.start_date,
    end_date: filter.end_date,
    responsible_id: filter.responsible_ids.join(",") || undefined,
    phone: filter.phone.trim() || undefined,
    source: filter.source !== "all" ? filter.source : undefined,
    call_kind: filter.call_kind !== "all" ? filter.call_kind : undefined,
    status: filter.status !== "all" ? filter.status : undefined,
    duration_from: parseFilterNumber(filter.duration_from),
    duration_to: parseFilterNumber(filter.duration_to),
    stage: filter.stage !== "all" ? filter.stage : undefined,
  };
}

function activeFilterCount(filter: CallFilterState) {
  return [
    filter.responsible_ids.length > 0,
    Boolean(filter.phone.trim()),
    filter.source !== "all",
    filter.call_kind !== "all",
    filter.status !== "all",
    Boolean(filter.duration_from.trim()),
    Boolean(filter.duration_to.trim()),
    filter.stage !== "all",
  ].filter(Boolean).length;
}


// ── Metric Card ───────────────────────────────────────────────────
function Card({ label, term, value, sub, icon, iconBg, badge, badgeColor, valueColor, accentColor, onClick, hint, tip, loading }: {
  label: string; value: React.ReactNode; sub?: string;
  /** The call centre's own word for it (Propushenniy, NDZ, ...), shown small under the Uzbek label. */
  term?: string;
  /** Numbers still on their way: a shimmer instead of a 0. */
  loading?: boolean;
  icon: React.ReactNode; iconBg: string;
  badge?: string; badgeColor?: string; valueColor?: string; accentColor?: string;
  /** Makes the card a button; `hint` is the small "open" caption in its corner. */
  onClick?: () => void; hint?: string;
  /** Plain hover text (for a card that is not a button). */
  tip?: string;
}) {
  const accent = accentColor || "#2196F3";
  return (
    <div
      {...(onClick ? {
        role: "button", tabIndex: 0, title: hint, onClick,
        onKeyDown: (e: React.KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } },
      } : {})}
      title={onClick ? (tip ? `${hint} — ${tip}` : hint) : tip}
      style={{ position: "relative", minHeight: 112, background: `linear-gradient(145deg, ${accent}12 0%, var(--bg) 42%, var(--bg) 100%)`, border: `1px solid ${accent}33`, borderRadius: 14, padding: "18px 20px 18px", display: "flex", flexDirection: "column", minWidth: 0, overflow: "hidden", cursor: onClick ? "pointer" : undefined }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 14 }}>
        <span style={{ fontSize: 12.5, color: accent, fontWeight: 700, lineHeight: 1.3 }}>
          {label}
          {term && <span style={{ display: "block", fontSize: 11, fontWeight: 500, color: "var(--text3)", marginTop: 2 }}>{term}</span>}
        </span>
        <div style={{ width: 38, height: 38, borderRadius: 10, background: iconBg, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{icon}</div>
      </div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 8, alignSelf: "flex-start" }}>
        <div style={{ fontSize: 28, fontWeight: 700, lineHeight: 1, color: valueColor || "var(--text)" }}>{loading ? <LoadingValue width={84} height={28} /> : value}</div>
        {badge && !loading && (
          <span style={{ fontSize: 11, fontWeight: 700, color: badgeColor, background: `${badgeColor}18`, border: `1.5px solid ${badgeColor}35`, borderRadius: 6, padding: "2px 8px", lineHeight: 1.7, marginBottom: 2 }}>{badge}</span>
        )}
      </div>
      {onClick && hint && (
        <div style={{ position: "absolute", right: 14, bottom: 12, fontSize: 11.5, fontWeight: 600, color: accent, background: `${accent}14`, border: `1px solid ${accent}30`, borderRadius: 6, padding: "3px 8px" }}>
          {hint} →
        </div>
      )}
      {sub && (
        <div style={{ position: "absolute", right: 14, bottom: 12, fontSize: 11.5, color: accent, display: "inline-flex", alignItems: "center", gap: 4, background: `${accent}14`, border: `1px solid ${accent}30`, borderRadius: 6, padding: "3px 8px" }}>
          <Clock size={11} />{sub}
        </div>
      )}
    </div>
  );
}

// Team tags carried in PBX operator names, in the order the picker lists them.
const TEAM_ORDER = ["TLC", "TIS", "TL"];

// ── Date presets ─────────────────────────────────────────────────
const CALL_PRESETS = [
  { label: "Bugun",  f: todayISO(),        t: todayISO() },
  { label: "7 kun",  f: daysAgoISO(7),     t: todayISO() },
  { label: "30 kun", f: daysAgoISO(30),    t: todayISO() },
  { label: "Bu oy",  f: startOfMonthISO(), t: todayISO() },
  { label: "Barchasi", f: daysAgoISO(365), t: todayISO() },
];


// ── Delta badge ───────────────────────────────────────────────────

// ── Call list sub-table ───────────────────────────────────────────
/** Operator table row identity: Bitrix user, else the PBX/Moizvonki line, else its position (the queue row). */
const rowKey = (u: PyResponsibleCallStats, idx: number) =>
  u.responsible_id != null ? `r:${u.responsible_id}` : u.operator_ext ? `e:${u.operator_ext}` : `i:${idx}`;

/** "998901234567" / "901234567" → "90 123 45 67". */
const fmtPhone = (p?: string | null) => {
  const d = (p ?? "").replace(/\D/g, "");
  if (d.length < 9) return p || "—";
  const n = d.slice(-9);
  return `${n.slice(0, 2)} ${n.slice(2, 5)} ${n.slice(5, 7)} ${n.slice(7)}`;
};

/** m:ss / h:mm:ss — short enough for a table cell. */
const fmtShortDur = (secs: number) => {
  const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60), s = secs % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
};

type DirFilter = "all" | "in" | "out";
type ResFilter = "all" | "ok" | "no";

/** Query of one operator's call list — shared by the panel and the hover prefetch. */
const callListQuery = (responsibleId: number | null, ext: string | null | undefined, filter: CallDashboardFilter) => ({
  queryKey: ["call-list", responsibleId, ext ?? null, filter] as const,
  queryFn: () => getCallList(responsibleId, filter, ext),
  staleTime: 60_000,
});

function CallSubTable({ responsibleId, ext, filter }: { responsibleId: number | null; ext?: string | null; filter: CallDashboardFilter }) {
  const portal = useBitrixPortal();
  const q = useQuery(callListQuery(responsibleId, ext, filter));
  const [dir, setDir] = useState<DirFilter>("all");
  const [res, setRes] = useState<ResFilter>("all");
  const [search, setSearch] = useState("");
  // The panel gets the operator's whole period (it used to be cut at 1 000, so its counts disagreed
  // with the table row); rows are drawn in steps so a 5 000-call month stays smooth.
  const STEP = 300;
  const [limit, setLimit] = useState(STEP);
  useEffect(() => setLimit(STEP), [dir, res, search, q.data]);

  const calls = q.data ?? [];
  const isIn = (c: CallListRow) => c.call_type === 2 || c.call_type === 3;
  const counts = useMemo(() => ({
    all: calls.length,
    in: calls.filter(isIn).length,
    out: calls.filter((c) => c.call_type === 1).length,
    ok: calls.filter((c) => c.status_code === 200).length,
  }), [calls]);
  const needle = search.replace(/\s+/g, "").toLowerCase();
  const shown = calls.filter((c) =>
    (dir === "all" || (dir === "in" ? isIn(c) : c.call_type === 1)) &&
    (res === "all" || (res === "ok" ? c.status_code === 200 : c.status_code !== 200)) &&
    (!needle || (c.phone_number ?? "").replace(/\D/g, "").includes(needle.replace(/\D/g, "") || "\u0000") ||
      (c.lead_title ?? "").toLowerCase().includes(needle) || String(c.lead_id ?? "").includes(needle)));

  if (q.isLoading) return <LoadingRows rows={6} />;
  if (q.isError) return <ErrorState onRetry={() => q.refetch()} />;
  if (!calls.length) return <EmptyState title="Bu davrda qo'ng'iroq yo'q" />;

  const chip = (active: boolean, color: string): React.CSSProperties => ({
    display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 600, padding: "5px 11px", borderRadius: 999, cursor: "pointer",
    border: `1px solid ${active ? color : "var(--border)"}`, background: active ? `${color}14` : "var(--bg2)", color: active ? color : "var(--text2)",
  });
  const count = (n: number) => <span style={{ fontWeight: 700, opacity: 0.75, fontVariantNumeric: "tabular-nums" }}>{n}</span>;
  const TH: React.CSSProperties = { position: "sticky", top: 56, zIndex: 1, padding: "9px 14px", textAlign: "left", fontSize: 11, fontWeight: 600, letterSpacing: "0.04em", textTransform: "uppercase", color: "var(--text3)", background: "var(--bg2)", borderBottom: "1px solid var(--border)", whiteSpace: "nowrap" };
  const TD: React.CSSProperties = { padding: "10px 14px", verticalAlign: "middle" };

  return (
    <div>
      {/* Quick filters — narrow the operator's calls to the ones you are looking for */}
      <div style={{ position: "sticky", top: 0, zIndex: 3, height: 56, boxSizing: "border-box", display: "flex", alignItems: "center", gap: 8, padding: "0 16px", borderBottom: "1px solid var(--border)", background: "var(--bg2)", overflowX: "auto" }}>
        <button style={chip(dir === "all", "#64748B")} onClick={() => setDir("all")}>Hammasi {count(counts.all)}</button>
        <button style={chip(dir === "in", "#16A34A")} onClick={() => setDir(dir === "in" ? "all" : "in")}><PhoneIncoming size={13} /> Kiruvchi {count(counts.in)}</button>
        <button style={chip(dir === "out", "#2563EB")} onClick={() => setDir(dir === "out" ? "all" : "out")}><PhoneOutgoing size={13} /> Chiquvchi {count(counts.out)}</button>
        <span style={{ width: 1, height: 20, background: "var(--border)", margin: "0 4px" }} />
        <button style={chip(res === "ok", "#16A34A")} onClick={() => setRes(res === "ok" ? "all" : "ok")}><CheckCircle size={13} /> Gaplashildi {count(counts.ok)}</button>
        <button style={chip(res === "no", "#DC2626")} onClick={() => setRes(res === "no" ? "all" : "no")}><XCircle size={13} /> Javobsiz {count(counts.all - counts.ok)}</button>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6, border: "1px solid var(--border)", borderRadius: 8, padding: "4px 10px", background: "var(--bg)" }}>
          <Search size={13} style={{ color: "var(--text3)" }} />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Telefon yoki lid"
            style={{ border: 0, outline: "none", background: "transparent", color: "var(--text)", fontSize: 12.5, width: 160 }} />
        </div>
      </div>

      <div>
        <table style={{ width: "100%", minWidth: 860, borderCollapse: "collapse", fontSize: 12.5 }}>
          <thead>
            <tr>
              {["Vaqt", "Mijoz", "Yo'nalish", "Natija", "Lid holati"].map((h) => <th key={h} style={TH}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {shown.slice(0, limit).map((c) => {
              const inbound = isIn(c);
              // 200 = the operator talked (talk time > 0). Duration also counts ringing,
              // so a long unanswered call is not a success.
              const ok = c.status_code === 200;
              const when = c.call_start ? new Date(c.call_start) : null;
              const stageLabel = c.stage_name || c.stage_bitrix_id ? leadStageLabel(c.stage_bitrix_id, c.stage_name) : null;
              const dead = c.stage_bitrix_id === "JUNK" || c.stage_bitrix_id === "UC_L8G2B9";
              return (
                // The whole row opens the lead in Bitrix (no lead column with the long title).
                <tr key={c.id} className="cl-row cl-link"
                  title={c.lead_id ? "Bosing — lidni Bitrix'da ochish" : "Lid yo'q — bosing, raqam Bitrix'da kimga tegishli ekani ochiladi (odatda kontakt)"}
                  onClick={() => (c.lead_id ? openLead(portal, c.lead_id) : openByPhone(portal, c.phone_number))}>
                  <td style={{ ...TD, whiteSpace: "nowrap" }}>
                    {when ? <>
                      <span style={{ fontWeight: 600, color: "var(--text)", fontVariantNumeric: "tabular-nums" }}>{when.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}</span>
                      <span style={{ color: "var(--text3)", marginLeft: 6 }}>{when.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" })}</span>
                    </> : "—"}
                  </td>
                  <td style={{ ...TD, whiteSpace: "nowrap" }}>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontWeight: 600, color: "var(--text)", fontVariantNumeric: "tabular-nums", letterSpacing: "0.01em" }}>
                      {fmtPhone(c.phone_number)}
                      <ExternalLink size={12} className="cl-go" />
                    </span>
                  </td>
                  <td style={{ ...TD, whiteSpace: "nowrap" }}>
                    {c.call_type
                      ? <StatusMark tone="neutral" icon={inbound ? PhoneIncoming : PhoneOutgoing} muted>{inbound ? "Kiruvchi" : "Chiquvchi"}</StatusMark>
                      : "—"}
                  </td>
                  {(() => {
                    // Connected (answered, as Bitrix counts it) but only for a few seconds (≤ 10 s): picked
                    // up and hung up, or a voicemail / network message. Answered, flagged as short.
                    const brief = ok && (c.talk_time ?? 0) <= 10;
                    return (
                      <td style={{ ...TD, whiteSpace: "nowrap" }}
                        title={brief ? `Ulandi, ${c.talk_time} s — javob berilgan hisoblanadi (Bitrix'da ham), lekin 10 s dan qisqa: mijoz darhol uzgan yoki avtojavob. O'rtacha davomiylikka kirmaydi`
                          : ok ? `Suhbat ${fmtShortDur(c.talk_time ?? 0)} · jami ${fmtShortDur(c.duration ?? 0)} (jiringlash bilan)`
                          : `Javob berilmadi · ${fmtShortDur(c.duration ?? 0)} jiringladi`}>
                        <StatusMark tone={brief ? "warning" : ok ? "good" : "critical"} icon={ok ? CheckCircle : PhoneOff}>
                          {brief ? "Qisqa ulanish" : ok ? "Gaplashildi" : "Javobsiz"}
                          <span style={{ color: "var(--text3)", fontVariantNumeric: "tabular-nums" }}>{fmtShortDur(ok || brief ? (c.talk_time ?? 0) : (c.duration ?? 0))}</span>
                        </StatusMark>
                        {/* Bitrix's "Qo'ng'iroq davomiyligi" is the whole call, ringing included — shown
                            under the talk time so the two can be compared at a glance. */}
                        {(ok || brief) && (c.duration ?? 0) > (c.talk_time ?? 0) && (
                          <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 2, paddingLeft: 20, fontVariantNumeric: "tabular-nums" }}>jami {fmtShortDur(c.duration ?? 0)}</div>
                        )}
                      </td>
                    );
                  })()}
                  <td style={TD}>
                    {stageLabel ? (
                      <div>
                        <Dot color={leadStageColor(c.stage_bitrix_id)}><span style={{ color: "var(--text)" }}>{stageLabel}</span></Dot>
                        {dead && (
                          <div style={{ fontSize: 11.5, marginTop: 3, paddingLeft: 13, color: c.stage_reason ? "var(--text2)" : "var(--text3)", fontStyle: c.stage_reason ? "normal" : "italic" }}
                            title="Bitrix'da yozilgan sabab">
                            {c.stage_reason ?? "sabab yozilmagan"}
                          </div>
                        )}
                      </div>
                    ) : c.lead_id ? <span style={{ color: "var(--text3)" }}>—</span> : (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--text2)" }}>
                        <Search size={13} style={{ color: "var(--text3)" }} />Lid yo'q · Bitrix'da topish
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
            {!shown.length && (
              <tr><td colSpan={5} style={{ padding: 24, textAlign: "center", color: "var(--text3)" }}>Bu filtr bo'yicha qo'ng'iroq yo'q</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {shown.length > limit && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 16px", borderTop: "1px solid var(--border)" }}>
          <button onClick={() => setLimit((n) => n + STEP)} style={{ ...chip(false, "#64748B"), cursor: "pointer" }}>Yana {Math.min(STEP, shown.length - limit)} ta</button>
          <button onClick={() => setLimit(shown.length)} style={{ ...chip(false, "#64748B"), cursor: "pointer" }}>Barchasi ({fmtNum(shown.length)})</button>
          <span style={{ marginLeft: "auto", fontSize: 11.5, color: "var(--text3)" }}>{fmtNum(limit)} / {fmtNum(shown.length)}</span>
        </div>
      )}
      {calls.length >= 20000 && (
        <div style={{ padding: "8px 16px", fontSize: 11.5, color: "var(--text3)", borderTop: "1px solid var(--border)" }}>
          Oxirgi 20 000 ta qo'ng'iroq ko'rsatilmoqda — eskilarini ko'rish uchun sana oralig'ini qisqartiring.
        </div>
      )}
    </div>
  );
}

/** "Yangilangan: OnlinePBX 3 daq · Moizvonki 3 daq · Bitrix 12 daq oldin" — how fresh the page's numbers are. */
function freshnessLine(asOf?: Partial<Record<string, string>>): string | undefined {
  if (!asOf) return undefined;
  const ago = (iso?: string) => {
    if (!iso) return null;
    const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
    return min < 1 ? "hozirgina" : min < 60 ? `${min} daq oldin` : `${Math.floor(min / 60)} soat ${min % 60} daq oldin`;
  };
  const parts = [["OnlinePBX", ago(asOf.calls)], ["Moizvonki", ago(asOf.moizvonki_calls)], ["Bitrix javobsizlari", ago(asOf.bx_missed)]]
    .filter(([, v]) => v).map(([k, v]) => `${k} ${v}`);
  return parts.length ? `Yangilangan: ${parts.join(" · ")}` : undefined;
}

/** The operator table as a CSV file (opens in Excel; ";" separated, BOM for Cyrillic names). */
function exportCsv(rows: PyResponsibleCallStats[], from: string, to: string) {
  const cols: [string, (r: PyResponsibleCallStats) => string | number][] = [
    ["Xodim", (r) => r.full_name], ["Kiruvchi", (r) => r.inbound_calls], ["Chiquvchi", (r) => r.outbound_calls],
    ["Jami", (r) => r.total_calls], ["Gaplashildi", (r) => r.success_calls],
    ["Unikal kiruvchi", (r) => r.unique_inbound], ["Unikal chiquvchi", (r) => r.unique_outbound], ["Unikal jami", (r) => r.unique_total],
    ["Suhbat kiruvchi", (r) => fmtClock(r.inbound_duration)], ["Suhbat chiquvchi", (r) => fmtClock(r.outbound_duration)],
    ["Suhbat jami", (r) => fmtClock(r.total_duration)], ["Jiringlash bilan", (r) => fmtClock(r.call_dur_total)],
    ["Javobsiz kiruvchi", (r) => r.missed_inbound], ["Qayta chiqilgan", (r) => r.missed_recalled], ["Qayta chiqilmagan", (r) => r.missed_unrecalled],
  ];
  const esc = (v: string | number) => { const t = String(v ?? ""); return /[";\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
  const csv = [cols.map((c) => c[0]), ...rows.map((r) => cols.map((c) => c[1](r)))].map((line) => line.map(esc).join(";")).join("\r\n");
  const url = URL.createObjectURL(new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url; a.download = `qongiroqlar_${from}_${to}.csv`; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ── Page ──────────────────────────────────────────────────────────
export default function CallStatistikasi() {
  const [filters, setFilters]       = useState<CallFilterState>(() => defaultCallFilters());
  const [filterOpen, setFilterOpen] = useState(false);
  const [selectedResp, setSelectedResp] = useState<{ id: string; name: string } | null>(null);
  const [missedModal, setMissedModal] = useState<MissedCallsVariant | null>(null);
  const [reactionOpen, setReactionOpen] = useState(false);
  const [durBoth, setDurBoth] = useState(false);   // O'rtacha davomiyligi card: average only, or average + median
  const portal = useBitrixPortal();
  const pageScrollRef = useRef<HTMLDivElement>(null);
  const qc = useQueryClient();
  const apiFilter = toApiFilter(filters);
  const activeFilters = activeFilterCount(filters);

  const update = (patch: Partial<CallFilterState>) => setFilters(s => ({ ...s, ...patch }));

  const statsQ = useQuery({
    queryKey: ["py-call-stats", apiFilter],
    queryFn:  () => getPyCallStats(apiFilter),
    refetchInterval: 5 * 60_000,   // the calls sync every 10 min — an open page keeps up on its own
  });

  const filterOptionsQ = useQuery({
    queryKey: ["call-filter-options"],
    queryFn: getCallFilterOptions,
  });

  // Operators grouped by the team tag in their PBX name (TLC / TIS / TL), the known teams
  // first, then everyone without a tag; alphabetical inside each group.
  const responsibleOptions = useMemo(() => {
    const rank = (t: string | null | undefined) => { const i = TEAM_ORDER.indexOf(t ?? ""); return i === -1 ? TEAM_ORDER.length : i; };
    return [...(filterOptionsQ.data?.responsibles ?? [])]
      .sort((a, b) => rank(a.team) - rank(b.team) || (a.team ?? "").localeCompare(b.team ?? "") || (a.full_name ?? "").localeCompare(b.full_name ?? ""))
      .map(r => ({ value: String(r.id), label: r.full_name || `Ext ${r.id}`, group: r.team ?? undefined }));
  }, [filterOptionsQ.data]);

  const data: PyCallStatsResult | undefined = statsQ.data;
  const rows: PyResponsibleCallStats[]      = data?.responsibles ?? [];
  const failedCalls = data?.failed_calls ?? 0;
  const ndzCalls = data?.ndz_calls ?? 0;
  const selectedRow = selectedResp ? rows.find((u, idx) => rowKey(u, idx) === selectedResp.id) : null;


  const TH  = (extra?: React.CSSProperties): React.CSSProperties => ({ padding: "10px 14px", textAlign: "center", fontSize: 11, fontWeight: 700, color: "var(--text2)", textTransform: "uppercase", letterSpacing: "0.05em", background: "var(--bg2)", borderBottom: "1px solid var(--border)", whiteSpace: "nowrap", ...extra });
  const TD  = (extra?: React.CSSProperties): React.CSSProperties => ({ padding: "11px 14px", verticalAlign: "middle", borderBottom: "1px solid var(--border)", textAlign: "center", ...extra });

  const selStyle = { width: "100%", padding: "8px 10px", fontSize: 12, background: "var(--bg3)", border: "1px solid var(--border)", color: "var(--text)", borderRadius: 8 };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0, overflow: "hidden", background: "var(--bg2)" }}>
      <Topbar title="Call statistikasi" sub={freshnessLine(statsQ.data?.data_as_of)} />
      <style>{TABLE_CSS}</style>

      <div ref={pageScrollRef} style={{ flex: 1, minHeight: 0, overflowY: "auto", overscrollBehavior: "contain", padding: "18px 24px 96px", display: "flex", flexDirection: "column", gap: 16 }}>

        {/* ── Inline filter panel ── */}
        {/* Sticky under the page's 18px top padding: the shadow paints that strip in the page
            colour, so cards scrolling up disappear behind it instead of peeking out above. */}
        <div style={{ flexShrink: 0, background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 10, overflow: filterOpen ? "visible" : "hidden", position: "sticky", top: 0, zIndex: 10, boxShadow: "0 -19px 0 0 var(--bg2)" }}>
          <div style={{ padding: "10px 16px", display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}
            onClick={() => setFilterOpen(o => !o)}>
            <Search size={14} style={{ color: "var(--text3)" }} />
            <span style={{ fontSize: 12.5, color: "var(--text3)", flex: 1 }}>
              {`Filtr: ${filters.start_date} → ${filters.end_date}${activeFilters > 0 ? ` · ${activeFilters} ta qo'shimcha` : ""}`}
            </span>
            {activeFilters > 0 && (
              <span style={{ fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 20, background: "#3b82f6", color: "#fff" }}>{activeFilters} filtr</span>
            )}
            <ChevronDown size={14} style={{ color: "var(--text3)", transform: filterOpen ? "rotate(180deg)" : "none", transition: "transform .2s" }} />
          </div>

          {filterOpen && (
            <div style={{ borderTop: "1px solid var(--border)", padding: "16px 20px" }}>
              {/* Date range (calendar, or type it) + quick presets */}
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
                <DateRangePicker start={filters.start_date} end={filters.end_date} width={250}
                  onChange={(s, e) => update({ start_date: s, end_date: e })} />
                {CALL_PRESETS.map(p => {
                  const active = filters.start_date === p.f && filters.end_date === p.t;
                  return (
                    <button key={p.label} onClick={() => update({ start_date: p.f, end_date: p.t })}
                      style={{ padding: "5px 14px", borderRadius: 20, fontSize: 12, cursor: "pointer", background: active ? "#3b82f6" : "var(--bg3)", border: `1px solid ${active ? "#3b82f6" : "var(--border)"}`, color: active ? "#fff" : "var(--text2)", fontWeight: active ? 600 : 400 }}>
                      {p.label}
                    </button>
                  );
                })}
              </div>

              {/* Other filters row */}
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
                <MultiSelect label="Mas'ul xodim" icon={<Users size={12} />} searchable
                  options={responsibleOptions}
                  values={filters.responsible_ids}
                  onChange={v => update({ responsible_ids: v })}
                  loading={filterOptionsQ.isLoading} />
                <div style={{ flex: "1 1 140px", minWidth: 130 }}>
                  <div style={{ fontSize: 11, color: "var(--text3)", marginBottom: 4 }}>Holat</div>
                  <select value={filters.status} onChange={e => update({ status: e.target.value })} style={selStyle}>
                    {callStatusOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
                <div style={{ flex: "1 1 140px", minWidth: 130 }}>
                  <div style={{ fontSize: 11, color: "var(--text3)", marginBottom: 4 }}>Manba</div>
                  <select value={filters.source} onChange={e => update({ source: e.target.value })} style={selStyle}>
                    <option value="all">Barchasi</option>
                    {(filterOptionsQ.data?.sources ?? []).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
                <div style={{ flex: "1 1 140px", minWidth: 130 }}>
                  <div style={{ fontSize: 11, color: "var(--text3)", marginBottom: 4 }}>Qo'ng'iroq turi</div>
                  <select value={filters.call_kind} onChange={e => update({ call_kind: e.target.value })} style={selStyle}>
                    {callKindOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
                <div style={{ flex: "1 1 160px", minWidth: 140 }}>
                  <div style={{ fontSize: 11, color: "var(--text3)", marginBottom: 4 }}>Bosqich</div>
                  <select value={filters.stage} onChange={e => update({ stage: e.target.value })} style={selStyle}>
                    <option value="all">Barchasi</option>
                    {(filterOptionsQ.data?.stages ?? []).map(st => (
                      <option key={st.bitrix_id} value={st.bitrix_id}>{leadStageLabel(st.bitrix_id, st.name)}</option>
                    ))}
                  </select>
                </div>
                <div style={{ flex: "1 1 200px", minWidth: 180 }}>
                  <div style={{ fontSize: 11, color: "var(--text3)", marginBottom: 4 }}>Klient telefon</div>
                  <input value={filters.phone} onChange={e => update({ phone: e.target.value })} placeholder="Telefon klienta" style={selStyle} />
                </div>
              </div>

              {/* Duration */}
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 11, color: "var(--text3)", marginBottom: 4 }}>Davomiylik (sek)</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <input type="number" min={0} value={filters.duration_from} onChange={e => update({ duration_from: e.target.value })} placeholder="dan 0" style={selStyle} />
                  <input type="number" min={0} value={filters.duration_to} onChange={e => update({ duration_to: e.target.value })} placeholder="gacha ∞" style={selStyle} />
                </div>
              </div>

              {activeFilters > 0 && (
                <div style={{ paddingTop: 10, borderTop: "1px solid var(--border)", display: "flex", justifyContent: "flex-end" }}>
                  <button onClick={() => { setFilters(defaultCallFilters()); setSelectedResp(null); }} style={{ background: "none", border: "none", color: "#9E9E9E", fontSize: 12, cursor: "pointer", padding: "6px 10px" }}>Tozalash</button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Row 1 ── */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 12 }}>
          <Card loading={statsQ.isLoading && !data} label="Qo'ng'iroq jami" accentColor="#2196F3"
            value={<>{fmtNum(data?.total_calls ?? 0)} <span style={{ fontSize: 16, fontWeight: 500, color: "var(--text2)" }}>ta</span></>}
            sub={fmtDur(data?.total_duration ?? 0)}
            icon={<Phone size={19} color="#2196F3" />} iconBg="rgba(33,150,243,0.12)" />
          <Card loading={statsQ.isLoading && !data} label="Chiquvchi qo'ng'iroq" accentColor="#2196F3"
            value={<>{fmtNum(data?.outbound_calls ?? 0)} <span style={{ fontSize: 16, fontWeight: 500, color: "var(--text2)" }}>ta</span></>}
            sub={fmtDur(rows.reduce((s, r) => s + r.outbound_duration, 0))}
            icon={<PhoneOutgoing size={19} color="#2196F3" />} iconBg="rgba(33,150,243,0.12)" />
          <Card loading={statsQ.isLoading && !data} label="Kiruvchi qo'ng'iroq" accentColor="#4CAF50"
            value={<>{fmtNum(data?.inbound_calls ?? 0)} <span style={{ fontSize: 16, fontWeight: 500, color: "var(--text2)" }}>ta</span></>}
            sub={fmtDur(rows.reduce((s, r) => s + r.inbound_duration, 0))}
            icon={<PhoneIncoming size={19} color="#4CAF50" />} iconBg="rgba(76,175,80,0.12)" />
          <Card loading={statsQ.isLoading && !data} label="Muvaffaqiyatli" accentColor="#4CAF50"
            value={<span style={{ color: "#4CAF50" }}>{fmtNum(data?.success_calls ?? 0)}</span>}
            icon={<CheckCircle size={19} color="#4CAF50" />} iconBg="rgba(76,175,80,0.12)"
            badge={`${Math.round(data?.success_pct ?? 0)}%`} badgeColor="#4CAF50"
            tip="Ulangan qo'ng'iroqlar (gaplashish vaqti 1 s dan ko'p) — Bitrix24 'Разговор согласен' deb hisoblaganlari bilan bir xil. 10 s gacha ulanishlar ro'yxatda 'Qisqa ulanish' deb belgilanadi" />
          <Card loading={statsQ.isLoading && !data} label="Muvaffaqiyatsiz" accentColor="#F44336"
            value={<span style={{ color: "#F44336" }}>{fmtNum(failedCalls)}</span>}
            tip="Javob berilmagan qo'ng'iroqlar = chiquvchi javobsiz (NDZ) + kiruvchi javobsiz"
            icon={<XCircle size={19} color="#F44336" />} iconBg="rgba(244,67,54,0.10)"
            badge={failedCalls > 0 ? fmtPct(data?.failed_pct ?? 0) : undefined} badgeColor="#F44336" />
        </div>

        {/* ── Row 2 ── */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 12 }}>
          <Card loading={statsQ.isLoading && !data} label="O'rtacha davomiyligi" accentColor="#9C27B0"
            value={durBoth ? (
              <div style={{ display: "grid", gridTemplateColumns: "auto auto", columnGap: 10, rowGap: 4, alignItems: "baseline", fontSize: 18 }}>
                <span style={{ fontSize: 12, fontWeight: 500, color: "var(--text3)" }}>O'rtacha</span>
                <span>{fmtAvgDur(data?.avg_duration ?? 0)}</span>
                <span style={{ fontSize: 12, fontWeight: 500, color: "var(--text3)" }}>Mediana</span>
                <span>{data?.median_duration != null ? fmtAvgDur(data.median_duration) : "—"}</span>
              </div>
            ) : fmtAvgDur(data?.avg_duration ?? 0)}
            icon={<Timer size={19} color="#9C27B0" />} iconBg="rgba(156,39,176,0.10)"
            tip="Faqat haqiqiy suhbatlar (10 s dan uzun) bo'yicha — mijoz ko'tarib darhol uzgan qisqa ulanishlar o'rtachani tushirmasligi uchun. Bosing — o'rtacha va mediana. Mediana: suhbatlarning yarmi shundan qisqa"
            onClick={() => setDurBoth((v) => !v)} />
          <Card loading={statsQ.isLoading && !data} label="Chiquvchi javobsiz" term="NDZ" accentColor="#607D8B"
            tip="Operator qilgan, lekin mijoz ko'tarmagan qo'ng'iroqlar"
            value={<>{fmtNum(ndzCalls)} <span style={{ fontSize: 16, fontWeight: 500, color: "var(--text2)" }}>ta</span></>}
            icon={<PhoneOff size={19} color="#607D8B" />} iconBg="rgba(96,125,139,0.10)" />
          <Card loading={statsQ.isLoading && !data} label="Javobsiz kiruvchi" term="Propushenniy" accentColor="#FF9800"
            tip="Mijoz qilgan, hech kim ko'tarmagan qo'ng'iroqlar — Bitrix24 'Пропущенный' deb yozganlari bilan bir xil. Xodimlarga lid egasi bo'yicha yoziladi"
            value={<span style={{ color: "#FF9800" }}>{fmtNum(data?.missed_inbound ?? 0)} <span style={{ fontSize: 16, fontWeight: 500 }}>ta</span></span>}
            icon={<PhoneMissed size={19} color="#FF9800" />} iconBg="rgba(255,152,0,0.10)"
            onClick={() => setMissedModal("all")} hint="Ro'yxat" />
          <Card loading={statsQ.isLoading && !data} label="Reaksiya vaqti" accentColor="#607D8B"
            value={<span style={{ fontSize: 24 }}>{fmtSecs(data?.reaksiya_median ?? data?.reaksiya_vaqti ?? 0)}</span>}
            icon={<Clock size={19} color="#607D8B" />} iconBg="rgba(96,125,139,0.10)"
            term="mediana"
            tip={`Javobsiz kiruvchiga (Propushenniy) qayta bog'lanish — mediana, ish vaqti bo'yicha (${describeWorkHours(data?.work_hours)}). Bosing: javob berish tezligi, qayta qo'ng'iroq va yangi lidga qo'ng'iroq batafsil`}
            onClick={() => setReactionOpen(true)} hint="Batafsil" />
          <Card loading={statsQ.isLoading && !data} label="Qayta chiqilmagan" term="Ne perezvonili" accentColor="#F44336"
            value={<>{fmtNum(data?.ne_perezvonili ?? 0)} <span style={{ fontSize: 16, fontWeight: 500, color: "var(--text2)" }}>ta</span></>}
            icon={<PhoneMissed size={19} color="#F44336" />} iconBg="rgba(244,67,54,0.10)"
            tip="Javobsiz kirish qo'ng'iroqlari: 24 soat ichida operator o'sha raqamga qo'ng'iroq qilmagan (ko'tarilmagan qo'ng'iroq ham hisobga olinadi) va mijoz ham qayta qilib javob olmagan"
            onClick={() => setMissedModal("not_recalled")} hint="Ro'yxat" />
        </div>

        {/* ── Main stats table ── */}
        <div style={{ flexShrink: 0, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 14, overflow: "hidden" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px", borderBottom: "1px solid var(--border)" }}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>Xodimlar bo'yicha hisobot</div>
            </div>
            <button title="Jadvalni CSV (Excel) faylga yuklab olish" onClick={() => exportCsv(rows, filters.start_date, filters.end_date)} disabled={!rows.length} style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 34, height: 34, borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg2)", color: "var(--text2)", cursor: "pointer" }}><Download size={15} /></button>
          </div>

          {statsQ.isLoading ? (
            <LoadingRows rows={6} />
          ) : statsQ.isError ? (
            <ErrorState onRetry={() => statsQ.refetch()} />
          ) : rows.length === 0 ? (
            <EmptyState title="Bu davrda qo'ng'iroq yo'q" hint="Sana oralig'ini kengaytiring yoki filtrlarni tozalang." />
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0 }}>
                <thead style={{ position: "sticky", top: 0, zIndex: 2 }}>
                  <tr>
                    <th className="cs-sticky" style={TH({ textAlign: "left", minWidth: 200 })} rowSpan={2}>OPERATORLAR</th>
                    <th style={TH({ color: "#2196F3", borderLeft: "2px solid rgba(33,150,243,0.2)" })} colSpan={3}>QO'NG'IROQLAR SONI</th>
                    <th style={TH({ color: "#4CAF50", borderLeft: "2px solid rgba(76,175,80,0.2)" })} colSpan={3}>UNIKAL QO'NG'IROQLAR</th>
                    <th style={TH({ color: "#9C27B0", borderLeft: "2px solid rgba(156,39,176,0.2)" })} colSpan={4}>SUHBAT VAQTI</th>
                    <th style={TH({ color: "#FF9800", borderLeft: "2px solid rgba(255,152,0,0.24)" })} colSpan={3}
                      title="Javobsiz kiruvchi qo'ng'iroqlar lid egasiga yoziladi (Bitrix24'dagi kabi), qo'ng'iroqni qaysi liniya olganiga emas — shuning uchun bu ustun 'Kiruvchi'dan katta bo'lishi mumkin">JAVOBSIZ KIRUVCHI (PROPUSHENNIY)</th>
                  </tr>
                  <tr>
                    <th style={TH({ borderLeft: "2px solid rgba(33,150,243,0.2)" })}>Kiruvchi</th>
                    <th style={TH()}>Chiquvchi</th>
                    <th style={TH()}>Umumiy</th>
                    <th style={TH({ borderLeft: "2px solid rgba(76,175,80,0.2)" })}>Kiruvchi</th>
                    <th style={TH()}>Chiquvchi</th>
                    <th style={TH()}>Umumiy</th>
                    <th style={TH({ borderLeft: "2px solid rgba(156,39,176,0.2)" })}>Kiruvchi</th>
                    <th style={TH()}>Chiquvchi</th>
                    <th style={TH()}>Jami</th>
                    <th style={TH()} title="Qo'ng'iroqlarning to'liq uzunligi, jiringlash bilan — Bitrix24'dagi 'Qo'ng'iroq davomiyligi'">Jiringlash bilan</th>
                    <th style={TH({ borderLeft: "2px solid rgba(255,152,0,0.24)" })}>Umumiy</th>
                    <th style={TH()}>Qayta chiqilgan</th>
                    <th style={TH()}>Chiqilmagan</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((u, idx) => {
                    const uid    = rowKey(u, idx);
                    const isSel  = selectedResp?.id === uid;
                    return (
                      <Fragment key={uid}>
                        <tr key={uid} className="cs-row" data-sel={isSel || undefined} style={{ cursor: (u.responsible_id != null || u.operator_ext) ? "pointer" : "default" }}
                          // Start loading the call list on hover, so the panel opens with it already there.
                          onMouseEnter={() => { if (u.responsible_id != null || u.operator_ext) qc.prefetchQuery(callListQuery(u.responsible_id, u.operator_ext, apiFilter)); }}
                          onClick={() => { if (u.responsible_id != null || u.operator_ext) setSelectedResp({ id: uid, name: u.full_name }); }}>
                          <td className="cs-sticky" style={TD({ textAlign: "left" })}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                              <div style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 600, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{u.full_name}</div>
                              {(u.responsible_id != null || u.operator_ext) && <ChevronRight size={15} className="cs-go" />}
                            </div>
                          </td>
                          <Num v={u.inbound_calls} style={TD({ borderLeft: "2px solid rgba(33,150,243,0.10)" })} />
                          <Num v={u.outbound_calls} style={TD()} />
                          <Num v={u.total_calls} style={TD({ fontWeight: 700 })} />
                          <Num v={u.unique_inbound} style={TD({ borderLeft: "2px solid rgba(76,175,80,0.10)" })} />
                          <Num v={u.unique_outbound} style={TD()} />
                          <Num v={u.unique_total} style={TD({ fontWeight: 700 })} />
                          <Num v={u.inbound_duration} time style={TD({ borderLeft: "2px solid rgba(156,39,176,0.10)" })} />
                          <Num v={u.outbound_duration} time style={TD()} />
                          <Num v={u.total_duration} time style={TD()} />
                          <Num v={u.call_dur_total} time style={TD({ fontWeight: 700 })} />
                          <Num v={u.missed_inbound} color="#E8890C" style={TD({ borderLeft: "2px solid rgba(255,152,0,0.12)", fontWeight: 700 })} />
                          <Num v={u.missed_recalled} color="#2E9D4F" style={TD({ fontWeight: 700 })} />
                          <Num v={u.missed_unrecalled} color="#E5484D" style={TD({ fontWeight: 700 })} />
                        </tr>
                      </Fragment>
                    );
                  })}
                  {/* JAMI — the sum of the rows (= the cards). Unique numbers do not add up across operators. */}
                  {rows.length > 1 && (() => {
                    const sum = (k: keyof PyResponsibleCallStats) => rows.reduce((t, r) => t + (Number(r[k]) || 0), 0);
                    const T = (extra?: React.CSSProperties) => TD({ fontWeight: 700, background: "var(--bg2)", borderTop: "2px solid var(--border)", ...extra });
                    const na = <td style={T({ color: "var(--text3)" })} title="Bir raqam bir nechta xodimda bo'lishi mumkin — yig'ib bo'lmaydi">—</td>;
                    return (
                      <tr>
                        <td className="cs-sticky" style={T({ textAlign: "left", letterSpacing: "0.06em", fontSize: 12, color: "var(--text2)" })}>JAMI</td>
                        <Num v={sum("inbound_calls")} style={T({ borderLeft: "2px solid rgba(33,150,243,0.10)" })} />
                        <Num v={sum("outbound_calls")} style={T()} />
                        <Num v={sum("total_calls")} style={T()} />
                        {na}{na}{na}
                        <Num v={sum("inbound_duration")} time style={T({ borderLeft: "2px solid rgba(156,39,176,0.10)" })} />
                        <Num v={sum("outbound_duration")} time style={T()} />
                        <Num v={sum("total_duration")} time style={T()} />
                        <Num v={sum("call_dur_total")} time style={T()} />
                        <Num v={sum("missed_inbound")} color="#E8890C" style={T({ borderLeft: "2px solid rgba(255,152,0,0.12)" })} />
                        <Num v={sum("missed_recalled")} color="#2E9D4F" style={T()} />
                        <Num v={sum("missed_unrecalled")} color="#E5484D" style={T()} />
                      </tr>
                    );
                  })()}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ── Operator's calls: right-side panel ── */}
        <SidePanel
          open={!!selectedRow && (selectedRow.responsible_id != null || !!selectedRow.operator_ext)}
          onClose={() => setSelectedResp(null)}
          title={selectedRow?.full_name ?? ""}
          subtitle={`Qo'ng'iroqlar · ${filters.start_date} → ${filters.end_date}`}
          headerExtra={selectedRow && (
            <PanelStats items={[
              { label: "Jami", value: fmtNum(selectedRow.total_calls) },
              { label: "Kiruvchi", value: fmtNum(selectedRow.inbound_calls), color: "#16A34A" },
              { label: "Chiquvchi", value: fmtNum(selectedRow.outbound_calls), color: "#2563EB" },
              { label: "Suhbat vaqti", value: fmtClock(selectedRow.total_duration) },
              { label: "Propushenniy", value: fmtNum(selectedRow.missed_inbound), color: "#E8890C" },
              { label: "Chiqilmagan", value: fmtNum(selectedRow.missed_unrecalled), color: "#E5484D" },
            ]} />
          )}>
          {selectedRow && <CallSubTable responsibleId={selectedRow.responsible_id} ext={selectedRow.operator_ext} filter={apiFilter} />}
        </SidePanel>
      </div>
      {missedModal && <MissedCallsModal variant={missedModal} filter={apiFilter} portal={portal} onClose={() => setMissedModal(null)} />}
      {reactionOpen && <ReactionPanel filter={apiFilter} portal={portal} onClose={() => setReactionOpen(false)} />}
    </div>
  );
}

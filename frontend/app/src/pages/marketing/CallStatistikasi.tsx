import { Fragment, useState, useRef, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Phone, PhoneOutgoing, PhoneIncoming, CheckCircle, XCircle,
  Clock, PhoneMissed, Timer, ChevronDown, ChevronUp,
  SlidersHorizontal, Download, PhoneOff, X, CalendarDays, ChevronLeft, ChevronRight,
} from "lucide-react";
import { Topbar } from "@/components/Topbar";
import {
  getPyCallStats, getCallList, getCallFilterOptions,
  type CallDashboardFilter, type CallFilterOptions,
  type PyCallStatsResult, type PyResponsibleCallStats,
} from "@/lib/api/leads";

// ── Helpers ───────────────────────────────────────────────────────
const localISO = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const todayISO  = () => localISO(new Date());
const daysAgoISO = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return localISO(d); };
const MONTH_NAMES = ["Yanvar", "Fevral", "Mart", "Aprel", "May", "Iyun", "Iyul", "Avgust", "Sentabr", "Oktabr", "Noyabr", "Dekabr"];
const MONTH_SHORT_NAMES = ["Yan", "Fev", "Mar", "Apr", "May", "Iyn", "Iyl", "Avg", "Sen", "Okt", "Noy", "Dek"];
const WEEK_DAYS = ["Du", "Se", "Ch", "Pa", "Ju", "Sh", "Ya"];

function parseISODate(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return new Date();
  return new Date(y, m - 1, d);
}

function addDays(date: Date, days: number) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function addMonths(date: Date, months: number) {
  return new Date(date.getFullYear(), date.getMonth() + months, 1);
}

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function endOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

function startOfWeek(date: Date) {
  const d = new Date(date);
  const day = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - day);
  return d;
}

function endOfWeek(date: Date) {
  return addDays(startOfWeek(date), 6);
}

function startOfQuarter(date: Date) {
  return new Date(date.getFullYear(), Math.floor(date.getMonth() / 3) * 3, 1);
}

function endOfQuarter(date: Date) {
  const start = startOfQuarter(date);
  return new Date(start.getFullYear(), start.getMonth() + 3, 0);
}

function startOfYear(date: Date) {
  return new Date(date.getFullYear(), 0, 1);
}

function endOfYear(date: Date) {
  return new Date(date.getFullYear(), 11, 31);
}

function formatInputDate(iso: string) {
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return iso;
  return `${d}.${m}.${y}`;
}

function monthDiff(a: Date, b: Date) {
  return (b.getFullYear() - a.getFullYear()) * 12 + b.getMonth() - a.getMonth();
}

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


type CallFilterState = {
  start_date: string;
  end_date: string;
  responsible_id: string;
  phone: string;
  source: string;
  call_kind: string;
  status: string;
  duration_from: string;
  duration_to: string;
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
  return {
    start_date: daysAgoISO(30),
    end_date: todayISO(),
    responsible_id: "all",
    phone: "",
    source: "all",
    call_kind: "all",
    status: "all",
    duration_from: "",
    duration_to: "",
  };
}

function parseFilterNumber(value: string): number | undefined {
  if (value.trim() === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : undefined;
}

function toApiFilter(filter: CallFilterState): CallDashboardFilter {
  const responsibleId = filter.responsible_id !== "all" ? Number(filter.responsible_id) : undefined;
  return {
    start_date: filter.start_date,
    end_date: filter.end_date,
    responsible_id: Number.isFinite(responsibleId) ? responsibleId : undefined,
    phone: filter.phone.trim() || undefined,
    source: filter.source !== "all" ? filter.source : undefined,
    call_kind: filter.call_kind !== "all" ? filter.call_kind : undefined,
    status: filter.status !== "all" ? filter.status : undefined,
    duration_from: parseFilterNumber(filter.duration_from),
    duration_to: parseFilterNumber(filter.duration_to),
  };
}

function activeFilterCount(filter: CallFilterState) {
  return [
    filter.responsible_id !== "all",
    Boolean(filter.phone.trim()),
    filter.source !== "all",
    filter.call_kind !== "all",
    filter.status !== "all",
    Boolean(filter.duration_from.trim()),
    Boolean(filter.duration_to.trim()),
  ].filter(Boolean).length;
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

// ── Date range picker ─────────────────────────────────────────────
type RangeMode = "day" | "week" | "month" | "quarter" | "year";

function DateRangePicker({ startDate, endDate, onChange }: {
  startDate: string;
  endDate: string;
  onChange: (range: { start_date: string; end_date: string }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [rangeMode, setRangeMode] = useState<RangeMode>("day");
  const [pendingStart, setPendingStart] = useState<string | null>(null);
  const [viewMonth, setViewMonth] = useState(() => startOfMonth(parseISODate(startDate || todayISO())));
  const rootRef = useRef<HTMLDivElement>(null);
  const [popoverPosition, setPopoverPosition] = useState({ top: 96, left: 24, width: 520 });
  const selectedStart = startDate <= endDate ? startDate : endDate;
  const selectedEnd = startDate <= endDate ? endDate : startDate;
  const monthsToShow = Math.min(12, Math.max(3, monthDiff(startOfMonth(parseISODate(selectedStart)), startOfMonth(parseISODate(selectedEnd))) + 2));
  const months = Array.from({ length: monthsToShow }, (_, i) => addMonths(viewMonth, i));

  function updatePopoverPosition() {
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.min(540, Math.max(320, window.innerWidth - 24));
    const height = Math.min(520, window.innerHeight - 24);
    const left = Math.max(12, Math.min(rect.right - width, window.innerWidth - width - 12));
    const top = Math.max(12, Math.min(rect.bottom + 8, window.innerHeight - height - 12));
    setPopoverPosition({ top, left, width });
  }

  useEffect(() => {
    if (!open) return;
    updatePopoverPosition();
    const closeOnOutside = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const reposition = () => updatePopoverPosition();
    document.addEventListener("mousedown", closeOnOutside);
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      document.removeEventListener("mousedown", closeOnOutside);
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [open]);

  function applyRange(start: Date, end: Date, close = false) {
    const startIso = localISO(start);
    const endIso = localISO(end);
    setPendingStart(null);
    setViewMonth(startOfMonth(start));
    onChange(startIso <= endIso ? { start_date: startIso, end_date: endIso } : { start_date: endIso, end_date: startIso });
    if (close) setOpen(false);
  }

  function applyDate(iso: string) {
    const clicked = parseISODate(iso);

    if (rangeMode === "week") {
      applyRange(startOfWeek(clicked), endOfWeek(clicked), true);
      return;
    }
    if (rangeMode === "month") {
      applyRange(startOfMonth(clicked), endOfMonth(clicked), true);
      return;
    }
    if (rangeMode === "quarter") {
      applyRange(startOfQuarter(clicked), endOfQuarter(clicked), true);
      return;
    }
    if (rangeMode === "year") {
      applyRange(startOfYear(clicked), endOfYear(clicked), true);
      return;
    }

    if (!pendingStart) {
      setPendingStart(iso);
      onChange({ start_date: iso, end_date: iso });
      return;
    }

    const start = pendingStart <= iso ? pendingStart : iso;
    const end = pendingStart <= iso ? iso : pendingStart;
    setPendingStart(null);
    onChange({ start_date: start, end_date: end });
    setOpen(false);
  }

  function renderMonth(month: Date) {
    const first = startOfMonth(month);
    const last = endOfMonth(month);
    const leading = (first.getDay() + 6) % 7;
    const days = Array.from({ length: last.getDate() }, (_, i) => localISO(new Date(month.getFullYear(), month.getMonth(), i + 1)));
    const cells: (string | null)[] = [
      ...Array.from({ length: leading }, () => null),
      ...days,
    ];
    while (cells.length % 7 !== 0) cells.push(null);

    return (
      <div key={`${month.getFullYear()}-${month.getMonth()}`} style={{ paddingBottom: 10 }}>
        <div style={{ color: "var(--text)", fontSize: 14, fontWeight: 700, margin: "5px 0 8px" }}>
          {MONTH_NAMES[month.getMonth()]} {month.getFullYear()}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4, marginBottom: 5 }}>
          {WEEK_DAYS.map((d) => (
            <div key={d} style={{ textAlign: "center", color: "var(--text3)", fontSize: 10.5, fontWeight: 700 }}>{d}</div>
          ))}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4 }}>
          {cells.map((iso, idx) => {
            if (!iso) return <div key={`empty-${idx}`} style={{ height: 30 }} />;
            const isStart = iso === selectedStart;
            const isEnd = iso === selectedEnd;
            const inRange = iso >= selectedStart && iso <= selectedEnd;
            const isToday = iso === todayISO();
            const dayOfWeek = parseISODate(iso).getDay();
            const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
            return (
              <button
                key={iso}
                type="button"
                onClick={() => applyDate(iso)}
                style={{
                  height: 30,
                  border: `1px solid ${isStart || isEnd ? "#2196F3" : isToday ? "rgba(33,150,243,0.45)" : "transparent"}`,
                  borderRadius: isStart || isEnd ? 6 : 4,
                  background: isStart || isEnd ? "#2196F3" : inRange ? "rgba(33,150,243,0.18)" : "transparent",
                  color: isStart || isEnd ? "#fff" : isWeekend ? "#ff665c" : "var(--text)",
                  fontSize: 12,
                  fontWeight: isStart || isEnd || isToday ? 800 : 500,
                  cursor: "pointer",
                }}
              >
                {Number(iso.slice(-2))}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  function selectionStyle(active: boolean, soft = false): React.CSSProperties {
    return {
      border: `1px solid ${active ? "#2196F3" : soft ? "rgba(33,150,243,0.26)" : "transparent"}`,
      borderRadius: 6,
      background: active ? "rgba(33,150,243,0.28)" : soft ? "rgba(255,255,255,0.06)" : "transparent",
      color: active ? "#2196F3" : "var(--text)",
      fontSize: 13,
      fontWeight: active ? 800 : 500,
      cursor: "pointer",
    };
  }

  function renderMonthPicker() {
    const baseYear = parseISODate(selectedStart).getFullYear() - 2;
    const years = Array.from({ length: 8 }, (_, i) => baseYear + i);
    return (
      <div style={{ maxHeight: 360, overflowY: "auto", padding: "10px 12px" }}>
        {years.map((year) => (
          <div key={year} style={{ display: "grid", gridTemplateColumns: "56px repeat(3, 1fr)", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <div style={{ color: "var(--text3)", fontSize: 18, fontWeight: 600 }}>{year}</div>
            {MONTH_SHORT_NAMES.map((name, monthIndex) => {
              const start = startOfMonth(new Date(year, monthIndex, 1));
              const end = endOfMonth(start);
              const startIso = localISO(start);
              const endIso = localISO(end);
              const active = selectedStart >= startIso && selectedEnd <= endIso;
              return (
                <button key={`${year}-${name}`} type="button" onClick={() => applyRange(start, end, true)} style={{ ...selectionStyle(active), height: 36 }}>
                  {name}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    );
  }

  function renderQuarterPicker() {
    const baseYear = parseISODate(selectedStart).getFullYear() - 2;
    const years = Array.from({ length: 10 }, (_, i) => baseYear + i);
    return (
      <div style={{ maxHeight: 360, overflowY: "auto", padding: "10px 12px" }}>
        {years.map((year) => (
          <div key={year} style={{ display: "grid", gridTemplateColumns: "56px repeat(4, 1fr)", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <div style={{ color: "var(--text3)", fontSize: 18, fontWeight: 600 }}>{year}</div>
            {[0, 1, 2, 3].map((quarter) => {
              const anchor = new Date(year, quarter * 3, 1);
              const start = startOfQuarter(anchor);
              const end = endOfQuarter(anchor);
              const startIso = localISO(start);
              const endIso = localISO(end);
              const active = selectedStart >= startIso && selectedEnd <= endIso;
              return (
                <button key={`${year}-q${quarter + 1}`} type="button" onClick={() => applyRange(start, end, true)} style={{ ...selectionStyle(active), height: 36 }}>
                  Q{quarter + 1}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    );
  }

  function renderYearPicker() {
    const baseYear = parseISODate(selectedStart).getFullYear() - 2;
    const years = Array.from({ length: 36 }, (_, i) => baseYear + i);
    return (
      <div style={{ maxHeight: 360, overflowY: "auto", padding: "10px 12px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
          {years.map((year) => {
            const start = startOfYear(new Date(year, 0, 1));
            const end = endOfYear(start);
            const startIso = localISO(start);
            const endIso = localISO(end);
            const active = selectedStart >= startIso && selectedEnd <= endIso;
            return (
              <button key={year} type="button" onClick={() => applyRange(start, end, true)} style={{ ...selectionStyle(active), height: 40 }}>
                {year}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  const quickRanges = [
    { label: "Bugun", start: new Date(), end: new Date() },
    { label: "Kecha", start: addDays(new Date(), -1), end: addDays(new Date(), -1) },
    { label: "Bu hafta", start: startOfWeek(new Date()), end: new Date() },
    { label: "O'tgan hafta", start: addDays(startOfWeek(new Date()), -7), end: addDays(startOfWeek(new Date()), -1) },
    { label: "Bu oy", start: startOfMonth(new Date()), end: new Date() },
    { label: "O'tgan oy", start: startOfMonth(addMonths(new Date(), -1)), end: endOfMonth(addMonths(new Date(), -1)) },
  ];

  return (
    <div ref={rootRef} style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => {
          setOpen((v) => !v);
          setViewMonth(startOfMonth(parseISODate(selectedStart)));
        }}
        style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "12px", borderRadius: 5, border: `1px solid ${open ? "#2196F3" : "transparent"}`, background: "var(--bg2)", color: "var(--text)", cursor: "pointer" }}
      >
        <span style={{ fontSize: 13, fontWeight: 700 }}>{formatInputDate(selectedStart)} - {formatInputDate(selectedEnd)}</span>
        <CalendarDays size={16} color={open ? "#2196F3" : "var(--text2)"} />
      </button>

      {open && (
        <div style={{ position: "fixed", top: popoverPosition.top, left: popoverPosition.left, width: popoverPosition.width, zIndex: 800, border: "1px solid var(--border)", borderRadius: 8, background: "var(--bg)", boxShadow: "0 18px 42px rgba(0,0,0,0.34)", overflow: "hidden" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", borderBottom: "1px solid var(--border)" }}>
            {[
              { id: "day", label: "Kun" },
              { id: "week", label: "Hafta" },
              { id: "month", label: "Oy" },
              { id: "quarter", label: "Kvartal" },
              { id: "year", label: "Yil" },
            ].map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setRangeMode(item.id as RangeMode);
                  setPendingStart(null);
                }}
                style={{
                  border: 0,
                  borderBottom: rangeMode === item.id ? "2px solid #2196F3" : "2px solid transparent",
                  background: rangeMode === item.id ? "rgba(33,150,243,0.10)" : "transparent",
                  color: rangeMode === item.id ? "#2196F3" : "var(--text2)",
                  padding: "8px 0 7px",
                  fontSize: 11.5,
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                {item.label}
              </button>
            ))}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: `${popoverPosition.width < 420 ? 104 : 124}px 1fr`, minHeight: 360 }}>
            <div style={{ borderRight: "1px solid var(--border)", padding: "10px 8px", display: "flex", flexDirection: "column", gap: 4, background: "rgba(255,255,255,0.02)" }}>
              {quickRanges.map((p) => {
                const startIso = localISO(p.start);
                const endIso = localISO(p.end);
                const active = selectedStart === startIso && selectedEnd === endIso;
                return (
                  <button key={p.label} type="button" onClick={() => applyRange(p.start, p.end, true)} style={{ border: 0, borderRadius: 5, background: active ? "rgba(33,150,243,0.18)" : "transparent", color: active ? "#2196F3" : "var(--text2)", padding: "8px 8px", fontSize: 12.5, fontWeight: active ? 800 : 500, textAlign: "left", cursor: "pointer" }}>
                    {p.label}
                  </button>
                );
              })}
            </div>

            <div style={{ minWidth: 0 }}>
              {(rangeMode === "day" || rangeMode === "week") && (
                <>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 10px", borderBottom: "1px solid var(--border)" }}>
                    <button type="button" aria-label="Oldingi oy" onClick={() => setViewMonth((m) => addMonths(m, -1))} style={{ width: 30, height: 28, border: "1px solid var(--border)", borderRadius: 5, background: "transparent", color: "var(--text2)", display: "grid", placeItems: "center", cursor: "pointer" }}>
                      <ChevronLeft size={15} />
                    </button>
                    <button type="button" aria-label="Keyingi oy" onClick={() => setViewMonth((m) => addMonths(m, 1))} style={{ width: 30, height: 28, border: "1px solid var(--border)", borderRadius: 5, background: "transparent", color: "var(--text2)", display: "grid", placeItems: "center", cursor: "pointer" }}>
                      <ChevronRight size={15} />
                    </button>
                    <span style={{ color: "var(--text3)", fontSize: 11.5 }}>{rangeMode === "day" && pendingStart ? "Tugash sanasini tanlang" : "Oraliqni belgilang"}</span>
                  </div>
                  <div style={{ maxHeight: 360, overflowY: "auto", padding: "8px 10px 10px" }}>
                    {months.map(renderMonth)}
                  </div>
                </>
              )}
              {rangeMode === "month" && renderMonthPicker()}
              {rangeMode === "quarter" && renderQuarterPicker()}
              {rangeMode === "year" && renderYearPicker()}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Filter drawer ─────────────────────────────────────────────────
function FilterDrawer({ open, value, options, optionsLoading, onChange, onApply, onReset, onClose }: {
  open: boolean;
  value: CallFilterState;
  options?: CallFilterOptions;
  optionsLoading: boolean;
  onChange: (v: CallFilterState) => void;
  onApply: () => void;
  onReset: () => void;
  onClose: () => void;
}) {
  if (!open) return null;

  const inputStyle: React.CSSProperties = {
    width: "100%",
    border: "1px solid transparent",
    borderRadius: 4,
    background: "var(--bg2)",
    color: "var(--text)",
    padding: "11px 12px",
    fontSize: 13,
    outline: "none",
  };
  const labelStyle: React.CSSProperties = {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    fontSize: 11,
    color: "var(--text2)",
  };
  const update = (patch: Partial<CallFilterState>) => onChange({ ...value, ...patch });

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 500 }}>
      <button aria-label="Filtrni yopish" onClick={onClose} style={{ position: "absolute", inset: 0, border: 0, background: "rgba(0,0,0,0.35)", cursor: "default" }} />
      <aside style={{ position: "absolute", top: 0, right: 0, width: 336, maxWidth: "calc(100vw - 20px)", height: "100%", background: "var(--bg)", borderLeft: "1px solid var(--border)", boxShadow: "-18px 0 40px rgba(0,0,0,0.24)", display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "28px 24px 18px" }}>
          <div style={{ fontSize: 16, fontWeight: 800, letterSpacing: "0.08em", color: "var(--text)" }}>FILTR</div>
          <button onClick={onClose} style={{ width: 34, height: 34, border: 0, background: "transparent", color: "var(--text2)", cursor: "pointer", display: "grid", placeItems: "center" }}>
            <X size={20} />
          </button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "8px 20px 142px", display: "flex", flexDirection: "column", gap: 13 }}>
          <DateRangePicker
            startDate={value.start_date}
            endDate={value.end_date}
            onChange={(range) => update(range)}
          />

          <label style={labelStyle}>
            Xodim
            <select value={value.responsible_id} onChange={(e) => update({ responsible_id: e.target.value })} style={inputStyle}>
              <option value="all">{optionsLoading ? "Yuklanmoqda..." : "Barcha xodimlar"}</option>
              {(options?.responsibles ?? []).map((r) => (
                <option key={r.id} value={r.id}>{r.full_name}</option>
              ))}
            </select>
          </label>

          <label style={labelStyle}>
            Holat
            <select value={value.status} onChange={(e) => update({ status: e.target.value })} style={inputStyle}>
              {callStatusOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", color: "var(--text)", fontSize: 14, paddingTop: 4 }}>
            Klient
            <ChevronDown size={16} color="var(--text2)" />
          </div>

          <input value={value.phone} onChange={(e) => update({ phone: e.target.value })} placeholder="Telefon klienta" style={inputStyle} />

          <label style={labelStyle}>
            Manba
            <select value={value.source} onChange={(e) => update({ source: e.target.value })} style={inputStyle}>
              <option value="all">Barchasi</option>
              {(options?.sources ?? []).map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </label>

          <label style={labelStyle}>
            Qo'ng'iroq turi
            <select value={value.call_kind} onChange={(e) => update({ call_kind: e.target.value })} style={inputStyle}>
              {callKindOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", color: "var(--text)", fontSize: 14, paddingTop: 4 }}>
            Davomiylik
            <ChevronDown size={16} color="var(--text2)" />
          </div>

          <div style={{ color: "var(--text2)", fontSize: 13, marginTop: -2 }}>Qo'ng'iroq davomiyligi, sek</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1, overflow: "hidden", borderRadius: 4, border: "1px solid transparent", marginBottom: 12 }}>
            <input type="number" min={0} value={value.duration_from} onChange={(e) => update({ duration_from: e.target.value })} placeholder="dan 0" style={{ ...inputStyle, borderRadius: 0, border: 0 }} />
            <input type="number" min={0} value={value.duration_to} onChange={(e) => update({ duration_to: e.target.value })} placeholder="gacha ∞" style={{ ...inputStyle, borderRadius: 0, border: 0 }} />
          </div>
        </div>

        <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, padding: "18px 24px 24px", background: "linear-gradient(180deg, transparent, var(--bg) 24%)", display: "flex", gap: 10 }}>
          <button onClick={onReset} style={{ width: 88, border: "1px solid var(--border)", background: "var(--bg2)", color: "var(--text2)", borderRadius: 6, padding: "10px 12px", fontSize: 13, cursor: "pointer" }}>
            Tozalash
          </button>
          <button onClick={onApply} style={{ flex: 1, border: 0, background: "#1976D2", color: "#fff", borderRadius: 6, padding: "10px 14px", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>
            Qo'llash
          </button>
        </div>
      </aside>
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

function CallSubTable({ responsibleId, filter }: { responsibleId: number; filter: CallDashboardFilter }) {
  const q = useQuery({ queryKey: ["call-list", responsibleId, filter], queryFn: () => getCallList(responsibleId, filter) });
  if (q.isLoading) return <div style={{ padding: 24, textAlign: "center", color: "var(--text2)", fontSize: 13 }}>Yuklanmoqda...</div>;
  const calls = q.data ?? [];
  if (!calls.length) return <div style={{ padding: 24, textAlign: "center", color: "var(--text2)", fontSize: 13 }}>Qo'ng'iroqlar topilmadi</div>;
  return (
    <div style={{ maxHeight: "min(64vh, 640px)", overflow: "auto", overscrollBehavior: "contain", borderTop: "1px solid var(--border)" }}>
      <table style={{ width: "100%", minWidth: 1080, borderCollapse: "collapse", fontSize: 12.5 }}>
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
  const [filters, setFilters]           = useState<CallFilterState>(() => defaultCallFilters());
  const [draftFilters, setDraftFilters] = useState<CallFilterState>(() => defaultCallFilters());
  const [filterOpen, setFilterOpen]     = useState(false);
  const [selectedResp, setSelectedResp] = useState<{ id: number; name: string } | null>(null);
  const pageScrollRef = useRef<HTMLDivElement>(null);
  const detailRef = useRef<HTMLDivElement>(null);
  const apiFilter = toApiFilter(filters);
  const activeFilters = activeFilterCount(filters);

  const statsQ = useQuery({
    queryKey: ["py-call-stats", apiFilter],
    queryFn:  () => getPyCallStats(apiFilter),
  });

  const filterOptionsQ = useQuery({
    queryKey: ["call-filter-options"],
    queryFn: getCallFilterOptions,
  });

  const data: PyCallStatsResult | undefined = statsQ.data;
  const rows: PyResponsibleCallStats[]      = data?.responsibles ?? [];
  const failedCalls = data?.failed_calls ?? 0;
  const ndzCalls = data?.ndz_calls ?? 0;
  const selectedRow = selectedResp ? rows.find((u, idx) => (u.responsible_id ?? idx) === selectedResp.id) : null;

  useEffect(() => {
    if (!selectedResp) return;
    const t = window.setTimeout(() => {
      const scroller = pageScrollRef.current;
      const detail = detailRef.current;
      if (!scroller || !detail) return;
      scroller.scrollTo({ top: Math.max(0, detail.offsetTop - 16), behavior: "smooth" });
    }, 80);
    return () => window.clearTimeout(t);
  }, [selectedResp?.id]);

  const TH  = (extra?: React.CSSProperties): React.CSSProperties => ({ padding: "10px 14px", textAlign: "center", fontSize: 11, fontWeight: 700, color: "var(--text2)", textTransform: "uppercase", letterSpacing: "0.05em", background: "var(--bg2)", borderBottom: "1px solid var(--border)", whiteSpace: "nowrap", ...extra });
  const TD  = (extra?: React.CSSProperties): React.CSSProperties => ({ padding: "11px 14px", verticalAlign: "middle", borderBottom: "1px solid var(--border)", textAlign: "center", ...extra });

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0, overflow: "hidden", background: "var(--bg2)" }}>
      <Topbar
        title="Call statistikasi"
        actions={
          <div style={{ display: "flex", gap: 8, position: "relative" }}>
            <div style={{ position: "relative" }}>
              <button onClick={() => { setDraftFilters(filters); setFilterOpen(true); }} style={{ display: "flex", alignItems: "center", gap: 7, padding: "7px 14px", borderRadius: 9, border: `1px solid ${filterOpen || activeFilters ? "#2196F3" : "var(--border)"}`, background: "var(--bg)", color: filterOpen || activeFilters ? "#2196F3" : "var(--text2)", fontSize: 13, cursor: "pointer", fontWeight: 500 }}>
                <SlidersHorizontal size={14} />Filtrlar
                {activeFilters > 0 && (
                  <span style={{ minWidth: 18, height: 18, borderRadius: 9, background: "#2196F3", color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700 }}>
                    {activeFilters}
                  </span>
                )}
              </button>
            </div>
            <FilterDrawer
              open={filterOpen}
              value={draftFilters}
              options={filterOptionsQ.data}
              optionsLoading={filterOptionsQ.isLoading}
              onChange={setDraftFilters}
              onClose={() => setFilterOpen(false)}
              onReset={() => setDraftFilters(defaultCallFilters())}
              onApply={() => {
                setFilters(draftFilters);
                setSelectedResp(null);
                setFilterOpen(false);
              }}
            />
          </div>
        }
      />

      <div ref={pageScrollRef} style={{ flex: 1, minHeight: 0, overflowY: "auto", overscrollBehavior: "contain", padding: "20px 24px 96px", display: "flex", flexDirection: "column", gap: 16 }}>

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
        <div style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 14, overflow: "hidden", flex: 1 }}>
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
                      <Fragment key={uid}>
                        <tr key={uid} style={{ background: isSel ? "rgba(33,150,243,0.06)" : "var(--bg)", cursor: "pointer" }}
                          onClick={() => setSelectedResp(isSel ? null : { id: uid, name: u.full_name })}>
                          <td style={TD({ textAlign: "left" })}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--text)" }}>{u.full_name}</div>
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
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {selectedRow?.responsible_id != null && (
          <div ref={detailRef} style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 14, overflow: "hidden", scrollMarginTop: 16 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "14px 18px", borderBottom: "1px solid var(--border)", background: "rgba(33,150,243,0.05)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 700, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {selectedRow.full_name} — qo'ng'iroqlar ro'yxati
                  </div>
                </div>
              </div>
              <button onClick={() => setSelectedResp(null)} style={{ border: "1px solid var(--border)", background: "var(--bg2)", color: "var(--text2)", borderRadius: 8, padding: "6px 10px", fontSize: 12, cursor: "pointer" }}>
                Yopish
              </button>
            </div>
            <CallSubTable responsibleId={selectedRow.responsible_id} filter={apiFilter} />
          </div>
        )}

      </div>
    </div>
  );
}

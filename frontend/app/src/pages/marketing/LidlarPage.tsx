import { useMemo, useState, useRef, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useDarkMode } from "@/hooks/useDarkMode";
import {
  Calendar, Users, Star, TrendingUp, Filter,
  Percent, ArrowLeftRight, Target, XCircle, ChevronDown, Search,
} from "lucide-react";
import { Topbar } from "@/components/Topbar";
import { DateRangePicker } from "@/components/DateRangePicker";
import { ReasonsCard } from "@/components/ReasonsCard";
import { OperatorTable } from "@/components/OperatorTable";
import {
  getDashboardStats, getResponsiblesStats, getConversionStats,
  getFilterOptions, getTasksSummary, getCancelReasons, getJunkReasons,
  getAmocrmSources,
  getResponsibleTasks, getSourceLeads, getLeadDaily,
  getSourceStats, getSource1Stats, getHududStats, getPrichinaStats, getSource1Leads, getHududLeads, getPrichinaLeads, getUtmStats, getUtmCampaignStats, getUtmMediumStats, getUtmContentStats, getUtmTermStats, getUtmResponsibleStats, getResponsibleLeads,
  type DashFilter,
  type SourceStatsRow, type UfBreakdownRow, type ResponsibleLeadRow,
} from "@/lib/api/leads";
import { fmtNum } from "@/lib/utils";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { getConfig } from "@/lib/api/config";

// The portal comes from /api/config (BITRIX24_PORTAL) — never hardcode it, or
// links point at whichever portal the code was copied from.
function useBitrixPortal(): string {
  const q = useQuery({ queryKey: ["config"], queryFn: getConfig, staleTime: Infinity });
  return (q.data?.bitrix_portal ?? "").replace(/\/+$/, "");
}

// ── Date helpers ──────────────────────────────────────────────────
const localISO = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const todayISO   = () => localISO(new Date());
const daysAgoISO = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return localISO(d); };
const startOfYearISO  = () => `${new Date().getFullYear()}-01-01`;
const startOfMonthISO = () => { const d = new Date(); d.setDate(1); return localISO(d); };

const getDefaultFilter = (): DashFilter => ({ start_date: startOfMonthISO(), end_date: todayISO() });

// ── MultiSelect dropdown component ───────────────────────────────
function MultiSelect({
  label, icon, options, values, onChange, loading,
}: {
  label: string;
  icon: React.ReactNode;
  options: { value: string; label: string }[];
  values: string[];
  onChange: (v: string[]) => void;
  loading?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);

  const toggle = (v: string) => {
    onChange(values.includes(v) ? values.filter(x => x !== v) : [...values, v]);
  };

  const displayLabel = values.length === 0
    ? "Barchasi"
    : values.length === 1
      ? (options.find(o => o.value === values[0])?.label ?? values[0]).slice(0, 22)
      : `${values.length} ta tanlangan`;

  return (
    <div ref={ref} style={{ flex: "1 1 190px", minWidth: 170, position: "relative" }}>
      <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 600, color: "var(--text3)", marginBottom: 6 }}>
        {icon}{label}
      </label>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        style={{
          width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
          background: "var(--bg)", border: `1px solid ${values.length > 0 ? "rgba(33,150,243,0.5)" : "var(--border)"}`,
          borderRadius: 8, color: values.length > 0 ? "#2196F3" : "var(--text3)",
          fontSize: 12, padding: "8px 10px", cursor: "pointer", boxSizing: "border-box",
        }}
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {loading ? "Yuklanmoqda…" : displayLabel}
        </span>
        <ChevronDown size={12} style={{ flexShrink: 0, marginLeft: 4, transform: open ? "rotate(180deg)" : "none", transition: "transform 0.15s" }} />
      </button>
      {open && (
        <div style={{
          position: "absolute", top: "100%", left: 0, minWidth: "100%", zIndex: 600,
          background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 8,
          boxShadow: "0 4px 24px rgba(0,0,0,0.5)", maxHeight: 220, overflowY: "auto", marginTop: 4,
        }}>
          {options.length > 0 && (
            <div style={{ padding: "6px 12px", borderBottom: "1px solid var(--border)", display: "flex", gap: 12 }}>
              <button type="button" onClick={() => onChange(options.map(o => o.value))}
                style={{ fontSize: 11, color: "#2196F3", background: "none", border: "none", cursor: "pointer", padding: 0 }}>
                Barchasini tanlash
              </button>
              {values.length > 0 && (
                <button type="button" onClick={() => onChange([])}
                  style={{ fontSize: 11, color: "#9E9E9E", background: "none", border: "none", cursor: "pointer", padding: 0 }}>
                  Hammasini olib tashlash
                </button>
              )}
            </div>
          )}
          {options.map(o => {
            const checked = values.includes(o.value);
            return (
              <label key={o.value}
                style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 12px", cursor: "pointer", background: checked ? "rgba(33,150,243,0.08)" : "transparent" }}
                onMouseEnter={e => { if (!checked) (e.currentTarget as HTMLElement).style.background = "var(--bg3)"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = checked ? "rgba(33,150,243,0.08)" : "transparent"; }}
              >
                <input type="checkbox" checked={checked} onChange={() => toggle(o.value)} style={{ accentColor: "#2196F3", flexShrink: 0 }} />
                <span style={{ fontSize: 12, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {o.label}
                </span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Responsible table column definitions ─────────────────────────
// Column → live Bitrix stage_bid (as of the current lead pipeline):
//   qongiroqlar=NEW, tashrif_belgilandi=UC_N0PI5R, oylab_koradi='1',
//   yangi_lid=UC_IX1SKS, propushenniy=UC_O7Y5NT, dpu1='7', dpu2=UC_S5YC0D,
//   dpu3=UC_X316SW, qayta_aloqa=UC_63QL7L, kelmadi=UC_SWPARQ,
//   muvaffaqiyatli=CONVERTED, sandiq=JUNK, arxiv=UC_GSPVUS, yopildi=UC_L8G2B9,
//   student_hr=UC_W02434. The old "Target O'quv markaz/Kids/Maktab/Bog'cha"
// columns (IN_PROCESS/UC_6INRIS/UC_YGM8H2/UC_TO2TYK) were removed — those
// stages no longer exist in the portal, so they always read zero.
// Per-stage colours, keyed by Bitrix STATUS_ID. Only the colour lives here —
// the column set and every label come from the live stage list, so the table
// mirrors the Bitrix pipeline exactly and a rename or a new stage needs no
// code change. Unknown ids fall back to grey.
const STAGE_COLORS: Record<string, string> = {
  NEW: "#9E9E9E", UC_IX1SKS: "#03A9F4", UC_O7Y5NT: "#78909C",
  "7": "#FF5722", UC_S5YC0D: "#FF7043", UC_X316SW: "#FF8A65",
  UC_63QL7L: "#26C6DA", "1": "#607D8B", UC_N0PI5R: "#FF9800",
  UC_SWPARQ: "#FF00FF", CONVERTED: "#4CAF50", JUNK: "#42A5F5",
  UC_GSPVUS: "#8D6E63", UC_L8G2B9: "#616161", UC_W02434: "#FFC107",
};
const stageColor = (bid: string) => STAGE_COLORS[bid] ?? "#9E9E9E";


// Drill-down "BOSQICH" badge — kept in one place so both sub-tables (Lid va
// Konversiya, Lid mas'ullar kesimida) always show the same label for a stage.
// Legacy codes (UC_1KPATX, THINKING, ...) are kept as a fallback in case any
// old lead still carries a since-removed stage_bid.
const SUBTH: React.CSSProperties = { fontSize: 10, fontWeight: 700, color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.05em", textAlign: "left", padding: "8px 12px" };
const SUBTD: React.CSSProperties = { padding: "7px 12px", verticalAlign: "middle" };
const pill = (c: string): React.CSSProperties => ({ display: "inline-block", padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 600, background: `${c}22`, border: `1px solid ${c}55`, color: c, whiteSpace: "nowrap" });

// Task status, already normalised by upsertTask from the Bitrix STATUS code.
const TASK_STATUS: Record<string, { label: string; color: string }> = {
  pending:     { label: "Kutilmoqda",     color: "#9E9E9E" },
  in_progress: { label: "Jarayonda",      color: "#FF9800" },
  review:      { label: "Nazoratda",      color: "#26C6DA" },
  completed:   { label: "Tugatilgan",     color: "#4CAF50" },
  deferred:    { label: "Kechiktirilgan", color: "#8D6E63" },
  rejected:    { label: "Rad etilgan",    color: "#F44336" },
};

const STAGE_BADGE_MAP: Record<string, { label: string; color: string }> = {
  NEW:               { label: "Zvonki",             color: "#9E9E9E" },
  UC_N0PI5R:         { label: "Tashrif belgilandi",  color: "#FF9800" },
  "1":               { label: "O'ylab ko'radi",      color: "#607D8B" },
  UC_IX1SKS:         { label: "Yangi lid",           color: "#03A9F4" },
  UC_O7Y5NT:         { label: "Propushenniy",        color: "#78909C" },
  "7":               { label: "DPU 1",               color: "#FF5722" },
  UC_S5YC0D:         { label: "DPU 2",               color: "#FF7043" },
  UC_X316SW:         { label: "DPU 3",               color: "#FF8A65" },
  UC_63QL7L:         { label: "Qayta aloqa",         color: "#26C6DA" },
  UC_SWPARQ:         { label: "Kelmadi",             color: "#FF00FF" },
  CONVERTED:         { label: "Muvaffaqiyatli",      color: "#4CAF50" },
  JUNK:              { label: "Sandiq (JUNK)",       color: "#42A5F5" },
  UC_GSPVUS:         { label: "Arxiv 30+",           color: "#8D6E63" },
  UC_L8G2B9:         { label: "Yopildi",             color: "#616161" },
  UC_W02434:         { label: "Student/HR",          color: "#FFC107" },
  // Legacy stage codes, superseded by the ones above but kept for old leads.
  IN_PROCESS:        { label: "Yangi lid",           color: "#2196F3" },
  PROCESSED:         { label: "Propushenniy",        color: "#9E9E9E" },
  UC_1KPATX:         { label: "Javob bermadi",       color: "#FF9800" },
  NO_ANSWER:         { label: "Javob bermadi",       color: "#FF9800" },
  UC_Q2U9EL:         { label: "Qayta aloqa",         color: "#00BCD4" },
  CALLBACK:          { label: "Qayta aloqa",         color: "#00BCD4" },
  UC_KXC3ZW:         { label: "O'ylab ko'radi",      color: "#E91E63" },
  THINKING:          { label: "O'ylab ko'radi",      color: "#E91E63" },
  UC_L28G68:         { label: "Tashrif belgilandi",  color: "#9C27B0" },
  CONSULTATION:      { label: "Tashrif belgilandi",  color: "#9C27B0" },
  UC_5G8244:         { label: "Kelmadi",             color: "#FF00FF" },
  NOT_TRANSFERRED:   { label: "Kelmadi",             color: "#FF00FF" },
  ARCHIVE:           { label: "Sandiq",              color: "#42A5F5" },
  UC_F8K4GI:         { label: "Sifatsiz",            color: "#F44336" },
  UC_NAZK5J:         { label: "Bekor bo'ldi",        color: "#FFC107" },
  RECYCLED:          { label: "Bekor bo'ldi",        color: "#FFC107" },
  CONVERTED_CONSULT: { label: "Tashrif buyurdi",     color: "#4CAF50" },
};


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

// ── UTM source display name mapping ──────────────────────────────
const UTM_SOURCE_DISPLAY_NAMES: Record<string, string> = {
  ig:        "Instagram",
  fb:        "Facebook",
  facebook:  "Facebook",
  Facebook:  "Facebook",
  instagram: "Instagram",
  Instagram: "Instagram",
};

// ── Shared funnel column definitions ─────────────────────────────
const UTM_COLS_DEF = [
  { key: "umumiy_lidlar"            as const, label: "UMUMIY LIDLAR",             color: "#2196F3" },
  { key: "jarayonda"                as const, label: "JARAYONDA",                 color: "#FF9800" },
  { key: "sifatli_lid"              as const, label: "SIFATLI LID",               color: "#9C27B0" },
  { key: "konsultatsiya_belgilandi" as const, label: "KONSULTATSIYA BELGILANDI",  color: "#2196F3" },
  { key: "konsultatsiya_otkazildi"  as const, label: "KONSULTATSIYA O'TKAZILDI",  color: "#4CAF50" },
  { key: "sifatsiz"                 as const, label: "SIFATSIZ",                  color: "#F44336" },
  { key: "bekor_boldi"              as const, label: "BEKOR BO'LDI",              color: "#FFC107" },
] as const;


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

function Sparkline({ color, variant = 0, data, labels, unit = "ta", fmt }: {
  color: string; variant?: number;
  /** Bucketed series from /lead-daily. Falls back to the decorative wave when absent. */
  data?: number[] | null;
  labels?: string[] | null;
  unit?: string;
  fmt?: (v: number) => string;
}) {
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
  // A flat series carries no shape, so treat it as "no data" and keep the decor.
  const real = !!(data && labels && data.length >= 2 && labels.length === data.length && data.some(v => v !== data[0]));
  const vals = real ? data! : [];
  const vmax = real ? Math.max(1, ...vals) : 1;
  const [hover, setHover] = useState<number | null>(null);
  const pts: [number, number][] = real
    ? vals.map((v, i) => [(i / (vals.length - 1)) * 200, 56 - (v / vmax) * 46] as [number, number])
    : variants[variant % variants.length];
  const linePath = smoothPath(pts);
  const areaPath = `${linePath} L 200,60 L 0,60 Z`;
  const last = pts[pts.length - 1];
  const gid = `spk${variant}${color.replace(/[^a-z0-9]/gi, "")}`;
  const showFmt = fmt ?? ((v: number) => fmtNum(Math.round(v)));
  return (
    <div style={{ position: "relative" }}
         onMouseLeave={() => setHover(null)}
         onMouseMove={real ? (e) => {
           const r = e.currentTarget.getBoundingClientRect();
           if (!r.width) return;
           const ratio = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
           setHover(Math.round(ratio * (vals.length - 1)));
         } : undefined}>
      {real && hover !== null && (
        <div style={{
          position: "absolute", left: `${(hover / (vals.length - 1)) * 100}%`, bottom: 68,
          transform: "translateX(-50%)", background: "var(--bg2)", border: "1px solid var(--border)",
          borderRadius: 7, padding: "4px 9px", fontSize: 11, color: "var(--text)", whiteSpace: "nowrap",
          pointerEvents: "none", zIndex: 3, boxShadow: "0 4px 14px rgba(0,0,0,0.35)",
        }}>
          <span style={{ color: "var(--text3)" }}>{labels![hover]}</span>{" · "}
          <strong style={{ color }}>{showFmt(vals[hover])}</strong> {unit}
        </div>
      )}
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
    </div>
  );
}

// ── Gradient card shell ───────────────────────────────────────────
type GradCardProps = {
  gradient: string; lightGradient: string; border: string; lightBorder: string; shadow: string;
  icon: React.ReactNode; title: string; children: React.ReactNode;
  sparkColor: string; sparkVariant?: number;
  /** Bucketed series for the card's wave (from /lead-daily). */
  sparkData?: number[] | null;
  sparkLabels?: string[] | null;
  sparkUnit?: string;
  sparkFmt?: (v: number) => string;
};
function GradCard({ gradient, lightGradient, border, lightBorder, shadow, icon, title, children, sparkColor, sparkVariant = 0, sparkData, sparkLabels, sparkUnit, sparkFmt }: GradCardProps) {
  const { theme } = useDarkMode();
  const isDark = theme === 'dark';
  return (
    <div style={{
      background: isDark ? gradient : lightGradient,
      border: `1px solid ${isDark ? border : lightBorder}`,
      boxShadow: shadow,
      borderRadius: 16, padding: "16px 16px 0 16px",
      display: "flex", flexDirection: "column", overflow: "hidden", minHeight: 200,
    }}>
      <div style={{
        width: 36, height: 36, borderRadius: "50%",
        background: isDark ? border.replace(/[\d.]+\)$/, "0.18)") : lightBorder.replace(/[\d.]+\)$/, "0.18)"),
        display: "flex", alignItems: "center", justifyContent: "center",
        marginBottom: 8, flexShrink: 0,
      }}>
        {icon}
      </div>
      <div style={{ fontSize: 12, fontWeight: 600, color: isDark ? "#fff" : "var(--text)", marginBottom: 3 }}>{title}</div>
      {children}
      <div style={{ marginTop: "auto", marginLeft: -16, marginRight: -16 }}>
        <Sparkline color={sparkColor} variant={sparkVariant} data={sparkData} labels={sparkLabels} unit={sparkUnit} fmt={sparkFmt} />
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

// Shared by Manba 1 / Hudud / Sabab bo'yicha — same funnel columns as Manba
// bo'yicha, grouped by a UF enum value instead of source_id, each row
// expandable into a LID/SANA/BOSQICH drill-down (same shape as Manba bo'yicha's).
function UfBreakdownTable({
  title, unit, q, selected, setSelected, shown, setShown, listRef, leadsQ, bitrixPortal,
}: {
  title: string; unit: string;
  q: { data?: UfBreakdownRow[]; isLoading: boolean };
  selected: string | null; setSelected: (v: string | null) => void;
  shown: number; setShown: React.Dispatch<React.SetStateAction<number>>;
  listRef: React.RefObject<HTMLDivElement | null>;
  leadsQ: { data?: { items: ResponsibleLeadRow[] }; isLoading: boolean };
  bitrixPortal: string;
}) {
  const rows: UfBreakdownRow[] = q.data ?? [];
  const rowKey = (r: UfBreakdownRow) => r.enum_id ?? 'Nomalum';
  const ROW_PAGE = 12;
  const [shownRows, setShownRows] = useState(ROW_PAGE);
  const maxes = {
    umumiy:   Math.max(1, ...rows.map(r => r.umumiy_lidlar)),
    sifatli:  Math.max(1, ...rows.map(r => r.sifatli_lid)),
    konsB:    Math.max(1, ...rows.map(r => r.konsultatsiya_belgilandi)),
    konsO:    Math.max(1, ...rows.map(r => r.konsultatsiya_otkazildi)),
    sifatsiz: Math.max(1, ...rows.map(r => r.sifatsiz)),
    bekor:    Math.max(1, ...rows.map(r => r.bekor_boldi)),
  };
  return (
    <div style={{ background: "var(--bg2)", borderRadius: 12, overflow: "hidden", marginBottom: 16 }}>
      <div style={{ padding: "16px 20px 12px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 12 }}>
        <span style={{ fontSize: 18, fontWeight: 700, color: "var(--text)" }}>{title}</span>
        <span style={{ fontSize: 12, color: "var(--text3)" }}>{rows.length} ta {unit}</span>
      </div>
      {q.isLoading ? (
        <div style={{ padding: 24, color: "#666", fontSize: 13 }}>Yuklanmoqda…</div>
      ) : rows.length === 0 ? (
        <div style={{ padding: 24, color: "#555", fontSize: 13 }}>Ma'lumot yo'q</div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "auto" }}>
            <thead>
              <tr>
                <th style={TH("#9E9E9E", 180)}>{title.split(" bo'yicha")[0].toUpperCase()}</th>
                <th style={TH("#2196F3")}>UMUMIY LIDLAR</th>
                <th style={TH("#00BCD4")}>SIFATLI LID</th>
                <th style={TH("#9C27B0")}>TASHRIF BELGILANDI</th>
                <th style={TH("#4CAF50")}>USPESHNIY LID</th>
                <th style={TH("#F44336")}>SIFATSIZ</th>
                <th style={TH("#FFC107")}>BEKOR BO'LDI</th>
                <th style={{ ...TH("#4CAF50", 80), textAlign: "center" }}>KONVERSIYA</th>
                <th style={{ ...TH("#00BCD4", 80), textAlign: "center" }}>SIFATLI KON.</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, shownRows).flatMap((r, i) => {
                const konv        = r.umumiy_lidlar > 0 ? (r.konsultatsiya_otkazildi / r.umumiy_lidlar) * 100 : 0;
                const sifatliKonv = r.umumiy_lidlar > 0 ? (r.sifatli_lid / r.umumiy_lidlar) * 100 : 0;
                const key = rowKey(r);
                const isOpen = selected === key;
                const leads: ResponsibleLeadRow[] = isOpen ? (leadsQ.data?.items ?? []) : [];
                return [
                  <tr key={key}
                      onClick={() => { setShown(10); setSelected(isOpen ? null : key); }}
                      style={{ background: isOpen ? "rgba(33,150,243,0.08)" : i % 2 === 0 ? "transparent" : "var(--bg)", cursor: "pointer" }}
                      onMouseEnter={e => { if (!isOpen) e.currentTarget.style.background = "var(--bg3)"; }}
                      onMouseLeave={e => { e.currentTarget.style.background = isOpen ? "rgba(33,150,243,0.08)" : i % 2 === 0 ? "transparent" : "var(--bg)"; }}>
                    <td style={{ ...TD, fontWeight: 600, color: "var(--text)", fontSize: 13, whiteSpace: "nowrap" }}>{r.name}</td>
                    <td style={TD}>
                      <span style={{ fontSize: 14, fontWeight: 600, color: "var(--text)" }}>{fmtNum(r.umumiy_lidlar)}</span>
                      <MiniBar value={r.umumiy_lidlar} max={maxes.umumiy} color="#2196F3" />
                    </td>
                    <td style={TD}>
                      {r.sifatli_lid > 0 ? (
                        <><span style={{ fontSize: 14, fontWeight: 600, color: "var(--text)" }}>{fmtNum(r.sifatli_lid)}</span><MiniBar value={r.sifatli_lid} max={maxes.sifatli} color="#00BCD4" /></>
                      ) : <span style={{ fontSize: 13, color: "var(--text3)" }}>—</span>}
                    </td>
                    <td style={TD}>
                      {r.konsultatsiya_belgilandi > 0 ? (
                        <><span style={{ fontSize: 14, fontWeight: 600, color: "var(--text)" }}>{fmtNum(r.konsultatsiya_belgilandi)}</span><MiniBar value={r.konsultatsiya_belgilandi} max={maxes.konsB} color="#9C27B0" /></>
                      ) : <span style={{ fontSize: 13, color: "var(--text3)" }}>—</span>}
                    </td>
                    <td style={TD}>
                      {r.konsultatsiya_otkazildi > 0 ? (
                        <><span style={{ fontSize: 14, fontWeight: 600, color: "var(--text)" }}>{fmtNum(r.konsultatsiya_otkazildi)}</span><MiniBar value={r.konsultatsiya_otkazildi} max={maxes.konsO} color="#4CAF50" /></>
                      ) : <span style={{ fontSize: 13, color: "var(--text3)" }}>—</span>}
                    </td>
                    <td style={TD}>
                      {r.sifatsiz > 0 ? (
                        <><span style={{ fontSize: 14, fontWeight: 600, color: "var(--text)" }}>{fmtNum(r.sifatsiz)}</span><MiniBar value={r.sifatsiz} max={maxes.sifatsiz} color="#F44336" /></>
                      ) : <span style={{ fontSize: 13, color: "var(--text3)" }}>—</span>}
                    </td>
                    <td style={TD}>
                      {r.bekor_boldi > 0 ? (
                        <><span style={{ fontSize: 14, fontWeight: 600, color: "var(--text)" }}>{fmtNum(r.bekor_boldi)}</span><MiniBar value={r.bekor_boldi} max={maxes.bekor} color="#FFC107" /></>
                      ) : <span style={{ fontSize: 13, color: "var(--text3)" }}>—</span>}
                    </td>
                    <td style={{ ...TD, textAlign: "center" }}><ConversionDonut pct={konv} size={38} /></td>
                    <td style={{ ...TD, textAlign: "center" }}><ConversionDonut pct={sifatliKonv} size={38} /></td>
                  </tr>,
                  isOpen ? (
                    <tr key={`${key}-leads`}>
                      <td colSpan={9} style={{ padding: "0 12px 12px" }}>
                        <div style={{ border: "1px solid #2196F3", borderTop: "none", borderRadius: "0 0 12px 12px", background: "rgba(33,150,243,0.04)", overflow: "hidden" }}>
                          {leadsQ.isLoading ? (
                            <div style={{ padding: "14px 20px", color: "var(--text3)", fontSize: 13 }}>Yuklanmoqda…</div>
                          ) : !leads.length ? (
                            <div style={{ padding: "14px 20px", color: "var(--text3)", fontSize: 13 }}>Ma'lumot yo'q</div>
                          ) : (
                            <>
                              <div ref={listRef} style={{ maxHeight: 340, overflowY: "auto" }}>
                                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                                  <thead>
                                    <tr style={{ background: "rgba(33,150,243,0.06)" }}>
                                      <th style={{ ...SUBTH, width: 44, paddingLeft: 20 }}>#</th>
                                      <th style={SUBTH}>LID</th>
                                      <th style={{ ...SUBTH, width: 110 }}>SANA</th>
                                      <th style={{ ...SUBTH, width: 210 }}>BOSQICH</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {leads.slice(0, shown).map((lead, li) => {
                                      const st = STAGE_BADGE_MAP[lead.stage_bid] ?? { label: lead.stage_bid, color: "#9E9E9E" };
                                      return (
                                        <tr key={lead.id} style={{ background: li % 2 === 0 ? "transparent" : "rgba(0,0,0,0.15)" }}>
                                          <td style={{ ...SUBTD, color: "var(--text3)", fontSize: 12, paddingLeft: 20 }}>{String(li + 1).padStart(2, "0")}</td>
                                          <td style={{ ...SUBTD, maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                            <a href={`${bitrixPortal}/crm/lead/details/${lead.id}/`} target="_blank" rel="noreferrer"
                                               onClick={e => e.stopPropagation()} style={{ fontSize: 12, color: "#2196F3", textDecoration: "underline" }}>
                                              {lead.title || `Lid #${lead.id}`}
                                            </a>
                                          </td>
                                          <td style={{ ...SUBTD, fontSize: 12, color: "var(--text3)", whiteSpace: "nowrap" }}>
                                            {lead.date_create ? String(lead.date_create).slice(0, 10) : "—"}
                                          </td>
                                          <td style={SUBTD}><span style={pill(st.color)}>{st.label}</span></td>
                                        </tr>
                                      );
                                    })}
              {shownRows < rows.length && (
                <tr>
                  <td colSpan={9} style={{ padding: "10px 12px", borderTop: "1px solid var(--border)" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <button onClick={() => setShownRows(n => n + ROW_PAGE)}
                        style={{ display: "inline-flex", alignItems: "center", gap: 5, background: "var(--bg3)", border: "1px solid var(--border)", borderRadius: 7, color: "var(--text2)", fontSize: 11.5, fontWeight: 600, padding: "5px 12px", cursor: "pointer" }}>
                        Yana {Math.min(ROW_PAGE, rows.length - shownRows)} ta <ChevronDown size={12} />
                      </button>
                      <button onClick={() => setShownRows(rows.length)}
                        style={{ background: "transparent", border: "1px solid var(--border)", borderRadius: 7, color: "var(--text2)", fontSize: 11.5, fontWeight: 600, padding: "5px 12px", cursor: "pointer" }}>
                        Barchasi ({rows.length})
                      </button>
                      <span style={{ fontSize: 11, color: "var(--text3)", marginLeft: "auto" }}>
                        {Math.min(shownRows, rows.length)} / {rows.length}
                      </span>
                    </div>
                  </td>
                </tr>
              )}
                                  </tbody>
                                </table>
                              </div>
                              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 20px", background: "rgba(33,150,243,0.06)" }}>
                                {shown < leads.length && (
                                  <>
                                    <button onClick={e => {
                                              e.stopPropagation();
                                              setShown((n: number) => n + 10);
                                              requestAnimationFrame(() => listRef.current?.scrollTo({ top: listRef.current!.scrollHeight, behavior: "smooth" }));
                                            }}
                                      style={{ display: "inline-flex", alignItems: "center", gap: 5, background: "var(--bg3)", border: "1px solid var(--border)", borderRadius: 7, color: "var(--text2)", fontSize: 11.5, fontWeight: 600, padding: "5px 12px", cursor: "pointer" }}>
                                      Yana 10 ta <ChevronDown size={12} />
                                    </button>
                                    <button onClick={e => {
                                              e.stopPropagation();
                                              setShown(leads.length);
                                              requestAnimationFrame(() => listRef.current?.scrollTo({ top: 0, behavior: "smooth" }));
                                            }}
                                      style={{ background: "transparent", border: "1px solid var(--border)", borderRadius: 7, color: "var(--text2)", fontSize: 11.5, fontWeight: 600, padding: "5px 12px", cursor: "pointer" }}>
                                      Barchasi ({leads.length})
                                    </button>
                                  </>
                                )}
                                <span style={{ fontSize: 11, color: "var(--text3)", marginLeft: "auto" }}>
                                  {Math.min(shown, leads.length)} / {leads.length} ta lid
                                </span>
                              </div>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ) : null,
                ];
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// No responsible is hidden from the tables. Blacklisting names here (Data365,
// Main, ...) dropped their rows but not their leads, so the JAMI row could never
// add up to the KPI cards above it — the cards count every lead in scope.

// ─────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────
/** Pill switcher for tables that show the same period cut a different way. */
function TabSwitch({ tabs, value, onChange }: {
  tabs: [string, string][];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div style={{ display: "inline-flex", gap: 4, background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 10, padding: 4, marginBottom: 12 }}>
      {tabs.map(([key, label]) => {
        const on = value === key;
        return (
          <button key={key} onClick={() => onChange(key)}
            style={{
              border: "none", borderRadius: 7, cursor: "pointer", padding: "6px 16px",
              fontSize: 12.5, fontWeight: 600,
              background: on ? "#2196F3" : "transparent",
              color: on ? "#fff" : "var(--text3)",
              transition: "background .15s ease, color .15s ease",
            }}>
            {label}
          </button>
        );
      })}
    </div>
  );
}

export default function LidlarPage() {
  const { theme } = useDarkMode();
  const isDark = theme === 'dark';
  const [filterOpen, setFilterOpen] = useState(false);
  const [filterSettled, setFilterSettled] = useState(false);
  useEffect(() => {
    if (!filterOpen) { setFilterSettled(false); return; }
    const t = setTimeout(() => setFilterSettled(true), 240);
    return () => clearTimeout(t);
  }, [filterOpen]);
  const filterRef = useRef<HTMLDivElement>(null);
  const [search] = useState("");
  const [mode] = useState<'default' | 'amocrm' | 'bitrix24'>('default');
  const bitrixPortal = useBitrixPortal();

  const [applied, setApplied] = useLocalStorage<DashFilter>("lidlar.filter.v4", getDefaultFilter());

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
    queryKey: ["filter-options", mode],
    queryFn: () => getFilterOptions(mode),
    staleTime: 5 * 60 * 1000,
  });
  const filterOpts = filterOptsQ.data;

  // One button per project, straight from the filter options. Kids used to be
  // folded into O'quv markaz; it is its own button now so any combination can
  // be selected.
  const proektGroups = useMemo(
    () => (filterOpts?.proekts ?? []).map((pr) => ({ name: pr.name, ids: [pr.id] })),
    [filterOpts]
  );

  const amocrmSrcQ = useQuery({
    queryKey: ["amocrm-sources"],
    queryFn: getAmocrmSources,
    staleTime: 10 * 60 * 1000,
    enabled: mode === 'amocrm',
  });

  const activeCount = [
    (applied.responsible_ids?.length ?? 0) > 0,
    (applied.stages?.length ?? 0) > 0,
    (applied.sources?.length ?? 0) > 0,
    (applied.form_ids?.length ?? 0) > 0,
    (applied.proekts?.length ?? 0) > 0,
    (applied.courses?.length ?? 0) > 0,
    (applied.source1s?.length ?? 0) > 0,
    (applied.filials?.length ?? 0) > 0,
    (applied.reasons?.length ?? 0) > 0,
    (applied.hududs?.length ?? 0) > 0,
    applied.start_date != null || applied.end_date != null,
  ].filter(Boolean).length;

  const appliedWithMode = { ...applied, mode };

  const statsQ      = useQuery({ queryKey: ["stats/dashboard",    appliedWithMode], queryFn: () => getDashboardStats(appliedWithMode) });
  const respQ       = useQuery({ queryKey: ["stats/responsibles", appliedWithMode], queryFn: () => getResponsiblesStats(appliedWithMode) });

  const conversionQ = useQuery({ queryKey: ["stats/conversion",   appliedWithMode], queryFn: () => getConversionStats(appliedWithMode) });
  const tasksQ      = useQuery({ queryKey: ["stats/tasks",        appliedWithMode], queryFn: () => getTasksSummary(appliedWithMode) });
  const cancelQ     = useQuery({ queryKey: ["stats/cancel-reasons", appliedWithMode], queryFn: () => getCancelReasons(appliedWithMode) });
  const junkQ       = useQuery({ queryKey: ["stats/junk-reasons",   appliedWithMode], queryFn: () => getJunkReasons(appliedWithMode) });
  const sourceQ     = useQuery({ queryKey: ["stats/source-stats", appliedWithMode], queryFn: () => getSourceStats(appliedWithMode) });
  const source1Q    = useQuery({ queryKey: ["stats/source1-stats", appliedWithMode], queryFn: () => getSource1Stats(appliedWithMode) });
  const hududQ      = useQuery({ queryKey: ["stats/hudud-stats", appliedWithMode], queryFn: () => getHududStats(appliedWithMode) });
  const reasonStatsQ = useQuery({ queryKey: ["stats/reason-stats", appliedWithMode], queryFn: () => getPrichinaStats(appliedWithMode) });
  const utmStatsQ   = useQuery({ queryKey: ["stats/utm-stats", appliedWithMode], queryFn: () => getUtmStats(appliedWithMode) });
  const dailyQ = useQuery({
    queryKey: ["stats/lead-daily", appliedWithMode],
    queryFn: () => getLeadDaily(appliedWithMode),
    staleTime: 60_000,
  });
  const daily = dailyQ.data;
  const [selectedSource, setSelectedSource] = useState<string | null>(null);
  const [shownSrcLeads, setShownSrcLeads] = useState(10);
  const srcListRef = useRef<HTMLDivElement>(null);
  const srcLeadsQ = useQuery({
    queryKey: ["stats/source-leads", selectedSource, appliedWithMode],
    queryFn: () => getSourceLeads(selectedSource!, appliedWithMode, { limit: 1000 }),
    enabled: selectedSource !== null,
  });
  const [selectedSource1, setSelectedSource1] = useState<string | null>(null);
  const [shownSource1Leads, setShownSource1Leads] = useState(10);
  const source1ListRef = useRef<HTMLDivElement>(null);
  const source1LeadsQ = useQuery({
    queryKey: ["stats/source1-leads", selectedSource1, appliedWithMode],
    queryFn: () => getSource1Leads(selectedSource1!, appliedWithMode, { limit: 1000 }),
    enabled: selectedSource1 !== null,
  });
  const [selectedHudud, setSelectedHudud] = useState<string | null>(null);
  const [shownHududLeads, setShownHududLeads] = useState(10);
  const hududListRef = useRef<HTMLDivElement>(null);
  const hududLeadsQ = useQuery({
    queryKey: ["stats/hudud-leads", selectedHudud, appliedWithMode],
    queryFn: () => getHududLeads(selectedHudud!, appliedWithMode, { limit: 1000 }),
    enabled: selectedHudud !== null,
  });
  const [selectedReason, setSelectedReason] = useState<string | null>(null);
  const [shownReasonLeads, setShownReasonLeads] = useState(10);
  const reasonListRef = useRef<HTMLDivElement>(null);
  const reasonLeadsQ = useQuery({
    queryKey: ["stats/reason-leads", selectedReason, appliedWithMode],
    queryFn: () => getPrichinaLeads(selectedReason!, appliedWithMode, { limit: 1000 }),
    enabled: selectedReason !== null,
  });
  const MASUL_PAGE = 12;
  const [shownMasulRows, setShownMasulRows] = useState(MASUL_PAGE);
  const [shownMasulLeads, setShownMasulLeads] = useState(10);
  const masulListRef = useRef<HTMLDivElement>(null);
  const [selectedTaskResp, setSelectedTaskResp] = useState<number | null>(null);
  const respTasksQ = useQuery({
    queryKey: ["stats/responsible-tasks", selectedTaskResp, appliedWithMode],
    queryFn: () => getResponsibleTasks(selectedTaskResp!, appliedWithMode),
    enabled: selectedTaskResp !== null,
  });
  const [tabA, setTabA] = useState<string>("masul");
  const [tabB, setTabB] = useState<string>("manba");
  const [selectedRespConv, setSelectedRespConv] = useState<{ id: number; name: string } | null>(null);
  const respLeadsConvQ = useQuery({
    queryKey: ["stats/responsible-leads-conv", selectedRespConv?.id, appliedWithMode],
    queryFn: () => getResponsibleLeads(selectedRespConv!.id, appliedWithMode),
    enabled: selectedRespConv !== null,
  });
  const [selectedRespMasul, setSelectedRespMasul] = useState<{ id: number; name: string } | null>(null);
  const respLeadsMasulQ = useQuery({
    queryKey: ["stats/responsible-leads-masul", selectedRespMasul?.id, appliedWithMode],
    queryFn: () => getResponsibleLeads(selectedRespMasul!.id, appliedWithMode),
    enabled: selectedRespMasul !== null,
  });
  type UtmPath = {
    source?: string;
    medium?: string;
    campaign?: string;
    content?: string;
    term?: string;
  };
  const [utmPath, setUtmPath] = useState<UtmPath>({});

  const utmLevel =
    utmPath.term     !== undefined ? 5 :
    utmPath.content  !== undefined ? 4 :
    utmPath.campaign !== undefined ? 3 :
    utmPath.medium   !== undefined ? 2 :
    utmPath.source   !== undefined ? 1 : 0;

  const utmMediumQ = useQuery({
    queryKey: ["stats/utm-medium", utmPath.source, appliedWithMode],
    queryFn: () => getUtmMediumStats(utmPath.source!, appliedWithMode),
    enabled: utmLevel >= 1,
    staleTime: 60_000,
  });
  const utmCampaignQ = useQuery({
    queryKey: ["stats/utm-campaigns", utmPath.source, utmPath.medium, appliedWithMode],
    queryFn: () => getUtmCampaignStats(utmPath.source!, utmPath.medium!, appliedWithMode),
    enabled: utmLevel >= 2,
    staleTime: 60_000,
  });
  const utmContentQ = useQuery({
    queryKey: ["stats/utm-content", utmPath.source, utmPath.medium, utmPath.campaign, appliedWithMode],
    queryFn: () => getUtmContentStats({ source: utmPath.source!, medium: utmPath.medium!, campaign: utmPath.campaign! }, appliedWithMode),
    enabled: utmLevel >= 3,
    staleTime: 60_000,
  });
  const utmTermQ = useQuery({
    queryKey: ["stats/utm-term", utmPath.source, utmPath.medium, utmPath.campaign, utmPath.content, appliedWithMode],
    queryFn: () => getUtmTermStats({ source: utmPath.source!, medium: utmPath.medium!, campaign: utmPath.campaign!, content: utmPath.content! }, appliedWithMode),
    enabled: utmLevel >= 4,
    staleTime: 60_000,
  });
  const utmRespQ = useQuery({
    queryKey: ["stats/utm-responsibles", utmPath, appliedWithMode],
    queryFn: () => getUtmResponsibleStats({ source: utmPath.source!, campaign: utmPath.campaign!, medium: utmPath.medium, content: utmPath.content, term: utmPath.term }, appliedWithMode),
    enabled: utmLevel >= 5,
    staleTime: 60_000,
  });

  const header       = statsQ.data?.header;
  const responsibles = (respQ.data?.responsibles ?? []);

  const enrichedResponsibles = responsibles;

  const total             = header?.total_leads                    ?? 0;
  const jarayondaCount    = header?.in_process                     ?? 0;
  const sifatsizBekor     = header?.sifatsiz_bekor_count           ?? 0;
  const bekorBoldiCount   = header?.bekor_boldi_count              ?? 0;
  const sifatliLid        = header?.sifatli_lid_count              ?? 0;
  const konsultBelgilandi = header?.konsultatsiya_belgilandi_count  ?? 0;
  const konsultOtkazildi  = header?.konsultatsiya_otkazildi_count   ?? 0;

  const sifatliKonvPct   = total > 0 ? (sifatliLid        / total) * 100 : 0;
  const leadToConsultPct = total > 0 ? (konsultBelgilandi / total) * 100 : 0;
  const overallConvPct   = total > 0 ? (konsultOtkazildi  / total) * 100 : 0;

  const byUserFiltered = useMemo(() => {
    // When a filter (proekt / stage / source / responsible / form) is active,
    // drop responsibles with no leads — same rule as the Lid va Konversiya table.
    const hasFilter =
      (applied.proekts?.length ?? 0) > 0 ||
      (applied.stages?.length ?? 0) > 0 ||
      (applied.sources?.length ?? 0) > 0 ||
      (applied.responsible_ids?.length ?? 0) > 0 ||
      (applied.form_ids?.length ?? 0) > 0;
    const s = search.trim().toLowerCase();
    let rows = enrichedResponsibles;
    if (hasFilter) rows = rows.filter((u) => (u.total ?? 0) > 0);
    if (s) rows = rows.filter((u) => u.full_name.toLowerCase().includes(s));
    return rows;
  }, [enrichedResponsibles, search, applied]);

  // Columns = the portal's current lead stages, in Bitrix sort order, with the
  // Bitrix name as the header. Nothing here is hardcoded, so the table can not
  // drift away from the pipeline the way the old fixed column list did.
  const stageCols = useMemo(
    () => (filterOpts?.stages ?? []).map((s) => ({
      key: s.bitrix_id,
      label: s.name,
      color: stageColor(s.bitrix_id),
    })),
    [filterOpts]
  );

  // bitrix_id → human name, for the drill-down "BOSQICH" badge. Falls back to
  // the static map, then to the raw id only if the stage is unknown to both.
  const stageName = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of filterOpts?.stages ?? []) m.set(s.bitrix_id, s.name);
    return m;
  }, [filterOpts]);

  const stageBadge = (bid: string) => ({
    label: stageName.get(bid) ?? STAGE_BADGE_MAP[bid]?.label ?? bid,
    color: STAGE_COLORS[bid] ?? STAGE_BADGE_MAP[bid]?.color ?? "#9E9E9E",
  });

  const colMaxes = useMemo(() => {
    const m: Record<string, number> = {};
    for (const col of stageCols)
      m[col.key] = Math.max(1, ...enrichedResponsibles.map((u) => u.by_stage?.[col.key] ?? 0));
    return m;
  }, [enrichedResponsibles, stageCols]);

  const totalsRow = useMemo(() => {
    const bs: Record<string, number> = {};
    for (const u of enrichedResponsibles)
      for (const col of stageCols)
        bs[col.key] = (bs[col.key] ?? 0) + (u.by_stage?.[col.key] ?? 0);
    return bs;
  }, [enrichedResponsibles, stageCols]);

  const isLoading = statsQ.isLoading;

  // ── Lid va Konversiya rows (sorted by total desc) ───────────────
  const convRows = useMemo(() => {
    // When a filter (proekt / stage / source / responsible / form) is active,
    // drop responsibles with no leads in the filtered view.
    const hasFilter =
      (applied.proekts?.length ?? 0) > 0 ||
      (applied.stages?.length ?? 0) > 0 ||
      (applied.sources?.length ?? 0) > 0 ||
      (applied.responsible_ids?.length ?? 0) > 0 ||
      (applied.form_ids?.length ?? 0) > 0;
    let rows = (conversionQ.data?.conversion ?? []);
    if (hasFilter) rows = rows.filter((r) => r.total > 0);
    return [...rows].sort((a, b) => b.total - a.total);
  }, [conversionQ.data, applied]);



  return (
    <>
      <Topbar
        title="Lidlar analitika"
        actions={null}
      />

      <div className="flex-1 overflow-y-auto px-3 sm:px-[22px] py-3 sm:py-[18px]" style={{ background: "var(--bg)" }}>

        {/* ── Filter panel ── */}
        <div ref={filterRef} style={{ position: "relative", width: "100%", marginBottom: 20 }}>
          {/* Trigger button */}
          <button
            onClick={() => setFilterOpen((o) => !o)}
            style={{
              display: "flex", alignItems: "center", gap: 10, width: "100%",
              background: "var(--bg2)",
              border: `1px solid ${filterOpen ? "#2196F3" : activeCount > 0 || mode !== 'default' ? "rgba(33,150,243,0.5)" : "var(--border)"}`,
              borderRadius: filterOpen ? "10px 10px 0 0" : 10,
              padding: "10px 16px", color: "var(--text)", fontSize: 13, fontWeight: 500,
              cursor: "pointer", textAlign: "left",
            }}
          >
            <Search size={16} style={{ color: "var(--text3)", flexShrink: 0 }} />
            <span style={{ color: "var(--text3)", flex: 1 }}>
              {applied.start_date || applied.end_date
                ? `Yaratilgan sana: ${applied.start_date ?? '…'} → ${applied.end_date ?? '…'}`
                : 'Qidirish va filtrlash…'}
            </span>
            {mode === 'amocrm' && (
              <span style={{ background: "rgba(217,119,6,0.15)", color: "#D97706", border: "1px solid rgba(217,119,6,0.4)", borderRadius: 10, padding: "2px 9px", fontSize: 11, fontWeight: 700 }}>AmoCRM</span>
            )}
            {mode === 'bitrix24' && (
              <span style={{ background: "rgba(33,150,243,0.15)", color: "#2196F3", border: "1px solid rgba(33,150,243,0.4)", borderRadius: 10, padding: "2px 9px", fontSize: 11, fontWeight: 700 }}>Bitrix24</span>
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
          <div style={{
            background: "var(--bg2)",
            border: filterOpen ? "1px solid var(--border)" : "1px solid transparent",
            borderTop: "none",
            borderRadius: "0 0 10px 10px",
            maxHeight: filterOpen ? (filterSettled ? "none" : 640) : 0,
            opacity: filterOpen ? 1 : 0,
            overflow: filterSettled ? "visible" : "hidden",
            transition: "max-height .24s cubic-bezier(.4,0,.2,1), opacity .18s ease",
          }}>
            {filterOpen && (
              <div style={{ padding: "16px 20px" }}>
                {/* Yaratilgan sana — range picker and the quick presets share one row,
                    so the applied range is always visible next to the shortcut that set it. */}
                <div style={{ marginBottom: 14 }}>
                  <label title="Дата создания" style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 600, color: "var(--text3)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                    <Calendar size={12} />{mode === 'amocrm' ? "Yaratilgan sana (amoCRM)" : "Yaratilgan sana"}
                  </label>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <DateRangePicker start={applied.start_date} end={applied.end_date}
                      onChange={(s, e) => setApplied((p) => ({ ...p, start_date: s || undefined, end_date: e || undefined }))}
                      onClear={() => setApplied((p) => ({ ...p, start_date: undefined, end_date: undefined }))} />
                    {[
                      { label: "Bugun",      start: todayISO(),        end: todayISO() },
                      { label: "7 kun",      start: daysAgoISO(7),     end: todayISO() },
                      { label: "30 kun",     start: daysAgoISO(30),    end: todayISO() },
                      { label: "Bu oy",      start: startOfMonthISO(), end: todayISO() },
                      // Anchored to January rather than left unbounded: the years
                      // before this one are nearly empty, and including them
                      // flattened every wave to a line with one spike at the end.
                      { label: "Butun davr", start: startOfYearISO(),  end: todayISO() },
                    ].map((p) => {
                      const active = applied.start_date === (p.start || undefined) && applied.end_date === (p.end || undefined);
                      return (
                        <button key={p.label}
                          onClick={() => setApplied((prev) => ({ ...prev, start_date: p.start || undefined, end_date: p.end || undefined }))}
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
                    {/* Proekt buttons — multi-select; click to toggle, none selected = all */}
                    <div style={{ marginLeft: "auto", display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {proektGroups.map((pr) => {
                        const sel = applied.proekts ?? [];
                        const active = pr.ids.length > 0 && pr.ids.every((id) => sel.includes(id));
                        return (
                          <button key={pr.name}
                            onClick={() => setApplied((prev) => {
                              const sel0 = prev.proekts ?? [];
                              const next = active
                                ? sel0.filter((id) => !pr.ids.includes(id))
                                : [...sel0, ...pr.ids.filter((id) => !sel0.includes(id))];
                              return { ...prev, proekts: next.length ? next : undefined };
                            })}
                            style={{
                              background: active ? "#7C4DFF" : "var(--bg3)",
                              border: `1px solid ${active ? "#7C4DFF" : "var(--border)"}`,
                              color: active ? "#fff" : "#9E9E9E",
                              borderRadius: 20, padding: "5px 14px",
                              fontSize: 12, fontWeight: active ? 600 : 400,
                              cursor: "pointer", transition: "all 0.15s",
                            }}
                          >
                            {pr.name}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* MultiSelect filters row */}
                <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginBottom: 12 }}>
                  <MultiSelect
                    label="Mas'ul xodim" icon={<Users size={12} />}
                    options={(filterOpts?.responsibles ?? []).map(r => ({ value: String(r.id), label: r.full_name }))}
                    values={(applied.responsible_ids ?? []).map(String)}
                    onChange={(vals) => setApplied(p => ({ ...p, responsible_ids: vals.map(Number) }))}
                    loading={filterOptsQ.isLoading}
                  />
                  <MultiSelect
                    label="Bosqich" icon={<Filter size={12} />}
                    options={(filterOpts?.stages ?? []).map(s => ({ value: s.bitrix_id, label: s.name }))}
                    values={applied.stages ?? []}
                    onChange={(vals) => setApplied(p => ({ ...p, stages: vals.length ? vals : undefined }))}
                    loading={filterOptsQ.isLoading}
                  />
                  <MultiSelect
                    label="Manba" icon={<TrendingUp size={12} />}
                    options={mode === 'amocrm'
                      ? (amocrmSrcQ.data ?? []).map(s => ({ value: s, label: s }))
                      : (filterOpts?.sources ?? []).map(s => ({ value: s.id, label: s.name }))}
                    values={applied.sources ?? []}
                    onChange={(vals) => setApplied(p => ({ ...p, sources: vals.length ? vals : undefined }))}
                    loading={mode === 'amocrm' ? amocrmSrcQ.isLoading : filterOptsQ.isLoading}
                  />
                </div>

                {/* Kurslar / Manba 1 / Filial / Sabab / Hudud — the Bitrix enum
                    fields the team filters reports by. Options come from
                    lead_uf_enums, so new values appear without a code change. */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr 1fr", gap: 12, marginBottom: 12 }}>
                  <MultiSelect
                    label="Kurslar" icon={<Filter size={12} />}
                    options={(filterOpts?.courses ?? []).map(o => ({ value: o.id, label: o.name }))}
                    values={applied.courses ?? []}
                    onChange={(v) => setApplied(p => ({ ...p, courses: v.length ? v : undefined }))}
                    loading={filterOptsQ.isLoading}
                  />
                  <MultiSelect
                    label="Manba 1" icon={<TrendingUp size={12} />}
                    options={(filterOpts?.source1s ?? []).map(o => ({ value: o.id, label: o.name }))}
                    values={applied.source1s ?? []}
                    onChange={(v) => setApplied(p => ({ ...p, source1s: v.length ? v : undefined }))}
                    loading={filterOptsQ.isLoading}
                  />
                  <MultiSelect
                    label="Filial" icon={<Users size={12} />}
                    options={(filterOpts?.filials ?? []).map(o => ({ value: o.id, label: o.name }))}
                    values={applied.filials ?? []}
                    onChange={(v) => setApplied(p => ({ ...p, filials: v.length ? v : undefined }))}
                    loading={filterOptsQ.isLoading}
                  />
                  <MultiSelect
                    label="Sabab" icon={<XCircle size={12} />}
                    options={(filterOpts?.reasons ?? []).map(o => ({ value: o.id, label: o.name }))}
                    values={applied.reasons ?? []}
                    onChange={(v) => setApplied(p => ({ ...p, reasons: v.length ? v : undefined }))}
                    loading={filterOptsQ.isLoading}
                  />
                  <MultiSelect
                    label="Hudud" icon={<Filter size={12} />}
                    options={(filterOpts?.hududs ?? []).map(o => ({ value: o.id, label: o.name }))}
                    values={applied.hududs ?? []}
                    onChange={(v) => setApplied(p => ({ ...p, hududs: v.length ? v : undefined }))}
                    loading={filterOptsQ.isLoading}
                  />
                </div>

                {activeCount > 0 && (
                  <div style={{ paddingTop: 12, borderTop: "1px solid var(--border)", display: "flex", justifyContent: "flex-end" }}>
                    <button onClick={() => setApplied(getDefaultFilter())}
                      style={{ background: "none", border: "none", color: "#9E9E9E", fontSize: 12, cursor: "pointer", padding: "6px 10px" }}>
                      Tozalash
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ── KPI cards + Voronka ── */}
        {isLoading ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 12 }}>
            {[0,1,2,3].map((i) => <div key={i} style={{ height: 200, borderRadius: 16, background: "var(--bg2)" }} />)}
          </div>
        ) : (
          <>
            {/* Row 1 — 4 equal KPI cards */}
            <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:12, marginBottom:12 }}>
              <GradCard gradient="linear-gradient(135deg,#0d1b4a,#1a3a7a)" lightGradient="linear-gradient(135deg,rgba(33,150,243,0.07),rgba(33,150,243,0.03))"
                        border="rgba(33,150,243,0.3)" lightBorder="rgba(33,150,243,0.25)"
                        shadow="0 4px 20px rgba(33,150,243,0.15)" icon={<Users size={20} style={{ color:"#2196F3" }} />}
                        title="Umumiy Lidlar" sparkColor="#2196F3" sparkVariant={0} sparkData={daily?.total} sparkLabels={daily?.labels}>
                <div style={{ fontSize:36, fontWeight:800, color: isDark ? "#fff" : "var(--text)", lineHeight:1.1, marginBottom:3 }}>{fmtNum(total)}</div>
                <div style={{ fontSize:11, color: isDark ? "#9E9E9E" : "var(--text3)" }}>Umumiy Lid</div>
              </GradCard>
              <GradCard gradient="linear-gradient(135deg,#002a2a,#005555)" lightGradient="linear-gradient(135deg,rgba(0,188,212,0.07),rgba(0,188,212,0.03))"
                        border="rgba(0,188,212,0.3)" lightBorder="rgba(0,188,212,0.25)"
                        shadow="0 4px 20px rgba(0,188,212,0.15)" icon={<Star size={20} style={{ color:"#00BCD4" }} />}
                        title="Sifatli Lidlar" sparkColor="#00BCD4" sparkVariant={1} sparkData={daily?.sifatli} sparkLabels={daily?.labels}>
                <div style={{ fontSize:36, fontWeight:800, color:"#00BCD4", lineHeight:1.1, marginBottom:3 }}>{fmtNum(sifatliLid)}</div>
                <div style={{ fontSize:11, color: isDark ? "#9E9E9E" : "var(--text3)" }}>Sifatli Lid</div>
              </GradCard>
              <GradCard gradient="linear-gradient(135deg,#2a1500,#6e3d00)" lightGradient="linear-gradient(135deg,rgba(255,152,0,0.07),rgba(255,152,0,0.03))"
                        border="rgba(255,152,0,0.3)" lightBorder="rgba(255,152,0,0.25)"
                        shadow="0 4px 20px rgba(255,152,0,0.15)" icon={<ArrowLeftRight size={20} style={{ color:"#FF9800" }} />}
                        title="Jarayonda" sparkColor="#FF9800" sparkVariant={2} sparkData={daily?.jarayonda} sparkLabels={daily?.labels}>
                <div style={{ fontSize:36, fontWeight:800, color:"#FF9800", lineHeight:1.1, marginBottom:3 }}>{fmtNum(jarayondaCount)}</div>
                <div style={{ fontSize:11, color: isDark ? "#9E9E9E" : "var(--text3)" }}>Jarayondagi lidlar</div>
              </GradCard>
              <GradCard gradient="linear-gradient(135deg,#0a2e0a,#1b5e20)" lightGradient="linear-gradient(135deg,rgba(76,175,80,0.07),rgba(76,175,80,0.03))"
                        border="rgba(76,175,80,0.3)" lightBorder="rgba(76,175,80,0.25)"
                        shadow="0 4px 20px rgba(76,175,80,0.15)" icon={<TrendingUp size={20} style={{ color:"#4CAF50" }} />}
                        title="Yakuniy Konversiya" sparkColor="#4CAF50" sparkVariant={3} sparkData={daily?.convPct} sparkLabels={daily?.labels} sparkUnit="%" sparkFmt={(v) => v.toFixed(1)}>
                <div style={{ fontSize:36, fontWeight:800, color: isDark ? "#fff" : "var(--text)", lineHeight:1.1, marginBottom:3 }}>{overallConvPct.toFixed(1)}%</div>
                <div style={{ fontSize:11, color: isDark ? "#9E9E9E" : "var(--text3)" }}>Tashrif o'tkazildi / umumiy lid</div>
              </GradCard>
            </div>

            {/* Row 2 — Voronka (3 cols) + Sifatsiz/Bekor (1 col) */}
            <div style={{ display:"grid", gridTemplateColumns:"3fr 1fr", gap:12, marginBottom:20 }}>
              {/* Voronka — each step shows the rate, a track with the value
                  marked on it, and the raw pair the rate came from. Without the
                  pair a percentage is unverifiable; with it the reader can see
                  1 989 of 3 125 and check it against the cards above. */}
              <div style={{ background:"var(--bg2)", border:"1px solid var(--border)", borderRadius:16, padding:"18px 22px", display:"flex", flexDirection:"column" }}>
                <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:18 }}>
                  <div style={{ width:40, height:40, borderRadius:12, background: isDark ? "rgba(33,150,243,0.15)" : "rgba(33,150,243,0.10)", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                    <Filter size={18} style={{ color:"#2196F3" }} />
                  </div>
                  <div>
                    <div style={{ fontSize:15, fontWeight:800, color:"var(--text)", lineHeight:1.2 }}>Voronka samaradorligi</div>
                    <div style={{ fontSize:11.5, color:"var(--text3)", marginTop:1 }}>Konversiya ko'rsatkichlari</div>
                  </div>
                </div>

                <div style={{ flex:1, display:"grid", gridTemplateColumns:"1fr auto 1fr auto 1fr auto 1fr", alignItems:"stretch", alignContent:"center" }}>
                  {[
                    { icon:<Percent size={24} />,        val:sifatliKonvPct,  color:"#2196F3", title:"Sifatli Konversiya",     sub:"Sifatli / Umumiy",      num:sifatliLid,       den:total },
                    { icon:<ArrowLeftRight size={24} />, val:leadToConsultPct, color:"#22C55E", title:"Lid \u2192 Tashrif",       sub:"T.Belgilandi / Umumiy", num:konsultBelgilandi, den:total },
                    { icon:<Target size={24} />,         val: konsultBelgilandi > 0 ? (konsultOtkazildi / konsultBelgilandi) * 100 : 0, color:"#9333EA", title:"T.O'tkazildi / Belgilandi", sub:"O'tkazildi / Belgilandi", num:konsultOtkazildi, den:konsultBelgilandi },
                    { icon:<Target size={24} />,         val: sifatliLid > 0 ? (konsultOtkazildi / sifatliLid) * 100 : 0,               color:"#4F46E5", title:"Sifatli \u2192 Uchrashuv",   sub:"O'tkazildi / Sifatli",    num:konsultOtkazildi, den:sifatliLid },
                  ].flatMap((m, i) => [
                    <div key={m.title} style={{ display:"flex", flexDirection:"column", alignItems:"center", padding:"6px 16px", gap:12 }}>
                      <div style={{ width:56, height:56, borderRadius:"50%", background:`${m.color}1A`, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                        <span style={{ color:m.color, display:"flex" }}>{m.icon}</span>
                      </div>
                      <div style={{ fontSize:13, fontWeight:700, color:"var(--text)", textAlign:"center", lineHeight:1.25 }}>{m.title}</div>
                      <div style={{ fontSize:34, fontWeight:800, color:m.color, lineHeight:1, marginTop:6 }}>{m.val.toFixed(1)}%</div>
                      {/* Track with the value marked on it — reads as a position
                          along the funnel rather than a bare number. */}
                      <div style={{ position:"relative", width:"100%", height:8 }}>
                        <div style={{ position:"absolute", inset:0, borderRadius:5, background:"var(--bg4)" }} />
                        <div style={{ position:"absolute", left:0, top:0, height:8, width:`${Math.min(100, m.val)}%`, borderRadius:5, background:m.color, transition:"width .5s cubic-bezier(.4,0,.2,1)" }} />
                        <div style={{ position:"absolute", left:`calc(${Math.min(100, m.val)}% - 6px)`, top:-2, width:12, height:12, borderRadius:"50%", background:"#fff", border:`2px solid ${m.color}`, boxShadow:"0 1px 4px rgba(0,0,0,0.25)" }} />
                      </div>
                      <div style={{ fontSize:11.5, color:"var(--text3)", textAlign:"center" }}>{m.sub}</div>
                      <div style={{ background:`${m.color}1A`, color:m.color, borderRadius:20, padding:"4px 12px", fontSize:12, fontWeight:700, fontVariantNumeric:"tabular-nums", whiteSpace:"nowrap" }}>
                        {fmtNum(m.num)} / {fmtNum(m.den)}
                      </div>
                    </div>,
                    i < 3 ? (
                      <div key={`sep-${i}`} style={{ width:1, background:"var(--border)", alignSelf:"stretch", margin:"6px 0" }} />
                    ) : null,
                  ])}
                </div>
              </div>

              {/* Jarayonda + Sifatsiz + Bekor bo'ldi — stacked */}
              <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
                {/* Konsultatsiyalar */}
                <div style={{ flex:1, background: isDark ? "linear-gradient(135deg,#1a0033,#3d1a6e)" : "linear-gradient(135deg,rgba(156,39,176,0.07),rgba(156,39,176,0.03))",
                              border: `1px solid ${isDark ? "rgba(156,39,176,0.3)" : "rgba(156,39,176,0.25)"}`,
                              boxShadow:"0 4px 20px rgba(156,39,176,0.12)", borderRadius:16,
                              padding:"16px 16px 0 16px", display:"flex", flexDirection:"column", overflow:"hidden" }}>
                  <div style={{ display:"flex", alignItems:"center", gap:12 }}>
                    <div style={{ width:40, height:40, borderRadius:"50%", background:"rgba(156,39,176,0.2)", flexShrink:0, display:"flex", alignItems:"center", justifyContent:"center" }}>
                      <Calendar size={20} style={{ color:"#9C27B0" }} />
                    </div>
                    <div>
                      <div style={{ fontSize:13, fontWeight:600, color: isDark ? "#fff" : "var(--text)" }}>Tashriflar</div>
                      <div style={{ display:"flex", alignItems:"baseline", gap:5, lineHeight:1.1, marginTop:2 }}>
                        <span style={{ fontSize:34, fontWeight:800, color: isDark ? "#fff" : "var(--text)" }}>{fmtNum(konsultBelgilandi)}</span>
                        <span style={{ fontSize:20, fontWeight:700, color: isDark ? "#9E9E9E" : "var(--text3)" }}>/</span>
                        <span style={{ fontSize:34, fontWeight:800, color:"#4CAF50" }}>{fmtNum(konsultOtkazildi)}</span>
                      </div>
                      <div style={{ fontSize:11, marginTop:2 }}>
                        <span style={{ color: isDark ? "#9E9E9E" : "var(--text3)" }}>Belgilandi</span>
                        <span style={{ color: isDark ? "#555" : "var(--text3)" }}> / </span>
                        <span style={{ color:"#4CAF50" }}>O'tkazildi</span>
                      </div>
                    </div>
                  </div>
                  <div style={{ marginTop:"auto", marginLeft:-16, marginRight:-16 }}>
                    <Sparkline color="#9C27B0" variant={2} data={daily?.belgilandi} labels={daily?.labels} />
                  </div>
                </div>
                {/* Sifatsiz */}
                <div style={{ flex:1, background: isDark ? "linear-gradient(135deg,#2a0000,#6e1a1a)" : "linear-gradient(135deg,rgba(244,67,54,0.07),rgba(244,67,54,0.03))",
                              border: `1px solid ${isDark ? "rgba(244,67,54,0.3)" : "rgba(244,67,54,0.25)"}`,
                              boxShadow:"0 4px 20px rgba(244,67,54,0.15)", borderRadius:16,
                              padding:"16px 16px 0 16px", display:"flex", flexDirection:"column", overflow:"hidden" }}>
                  <div style={{ display:"flex", alignItems:"center", gap:12 }}>
                    <div style={{ width:40, height:40, borderRadius:"50%", background:"rgba(244,67,54,0.2)", flexShrink:0, display:"flex", alignItems:"center", justifyContent:"center" }}>
                      <XCircle size={20} style={{ color:"#F44336" }} />
                    </div>
                    <div>
                      <div style={{ fontSize:13, fontWeight:600, color: isDark ? "#fff" : "var(--text)" }}>Sifatsiz</div>
                      <div style={{ fontSize:34, fontWeight:800, color:"#F44336", lineHeight:1.1, marginTop:2 }}>{fmtNum(sifatsizBekor)}</div>
                      <div style={{ fontSize:11, color: isDark ? "#9E9E9E" : "var(--text3)", marginTop:2 }}>Sifatsiz lidlar</div>
                    </div>
                  </div>
                  <div style={{ marginTop:"auto", marginLeft:-16, marginRight:-16 }}>
                    <Sparkline color="#F44336" variant={0} data={daily?.sifatsiz} labels={daily?.labels} />
                  </div>
                </div>
                {/* Bekor bo'ldi */}
                <div style={{ flex:1, background: isDark ? "linear-gradient(135deg,#2a1a00,#6e4a00)" : "linear-gradient(135deg,rgba(255,193,7,0.07),rgba(255,193,7,0.03))",
                              border: `1px solid ${isDark ? "rgba(255,193,7,0.3)" : "rgba(255,193,7,0.25)"}`,
                              boxShadow:"0 4px 20px rgba(255,193,7,0.12)", borderRadius:16,
                              padding:"16px 16px 0 16px", display:"flex", flexDirection:"column", overflow:"hidden" }}>
                  <div style={{ display:"flex", alignItems:"center", gap:12 }}>
                    <div style={{ width:40, height:40, borderRadius:"50%", background:"rgba(255,193,7,0.2)", flexShrink:0, display:"flex", alignItems:"center", justifyContent:"center" }}>
                      <XCircle size={20} style={{ color:"#FFC107" }} />
                    </div>
                    <div>
                      <div style={{ fontSize:13, fontWeight:600, color: isDark ? "#fff" : "var(--text)" }}>Bekor bo'ldi</div>
                      <div style={{ fontSize:34, fontWeight:800, color:"#FFC107", lineHeight:1.1, marginTop:2 }}>{fmtNum(bekorBoldiCount)}</div>
                      <div style={{ fontSize:11, color: isDark ? "#9E9E9E" : "var(--text3)", marginTop:2 }}>Bekor bo'lgan lidlar</div>
                    </div>
                  </div>
                  <div style={{ marginTop:"auto", marginLeft:-16, marginRight:-16 }}>
                    <Sparkline color="#FFC107" variant={1} data={daily?.bekor} labels={daily?.labels} />
                  </div>
                </div>
              </div>
            </div>
          </>
        )}

        {/* ══════════════════════════════════════════════════════════
            Lid va Konversiya table
        ══════════════════════════════════════════════════════════ */}
        <div style={{ background:"var(--bg2)", borderRadius:12, overflow:"hidden", marginBottom:16 }}>
          <div style={{ padding:"16px 20px 14px", borderBottom:"1px solid var(--border)", display:"flex", alignItems:"baseline", gap:10 }}>
            <span style={{ fontSize:18, fontWeight:700, color:"var(--text)" }}>Lid va Konversiya</span>
            <span style={{ fontSize:11.5, color:"var(--text3)" }}>
              Umumiy lidlar bo'yicha reyting
            </span>
          </div>
          <div style={{ paddingTop:16 }}>
            <OperatorTable
              rows={convRows}
              loading={conversionQ.isLoading}
              selected={selectedRespConv}
              onSelect={setSelectedRespConv}
              leads={respLeadsConvQ.data}
              leadsLoading={respLeadsConvQ.isLoading}
            />
          </div>
        </div>

        {/* Mas'ul / Vazifalar / UTM share one slot — three views of the same
            period that were previously three full-height tables stacked on top
            of each other, so comparing them meant scrolling past one to reach
            the next. */}
        <TabSwitch
          tabs={[["masul", "Mas'ul"], ["vazifalar", "Vazifalar"], ["utm", "UTM"]]}
          value={tabA} onChange={setTabA}
        />
        {tabA === "masul" && (<>
        {/* ══════════════════════════════════════════════════════════
            Lid mas'ullar kesimida table
        ══════════════════════════════════════════════════════════ */}
        <div style={{ background:"var(--bg2)", borderRadius:12, overflow:"hidden", marginBottom:24 }}>
          <div style={{ padding:"16px 20px 12px", borderBottom:"1px solid var(--border)", display:"flex", alignItems:"center", gap:12 }}>
            <span style={{ fontSize:18, fontWeight:700, color:"var(--text)" }}>Lid mas'ullar kesimida</span>
            <span style={{ fontSize:12, color:"var(--text3)" }}>{byUserFiltered.length} ta xodim</span>
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
                    {stageCols.map((col) => (
                      <th key={col.key} style={TH(col.color)}>{col.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {byUserFiltered.slice(0, shownMasulRows).map((u, i) => {
                    const isSel = selectedRespMasul?.id === u.responsible_id;
                    const subLeads: ResponsibleLeadRow[] = isSel ? (respLeadsMasulQ.data ?? []) : [];
                    const colCount = 2 + stageCols.length;
                    return (
                      <>
                        <tr key={u.responsible_id}
                            style={{ background: isSel ? "rgba(33,150,243,0.08)" : i % 2 === 0 ? "transparent" : "var(--bg)", cursor: "pointer" }}
                            onClick={() => { setShownMasulLeads(10); setSelectedRespMasul(isSel ? null : { id: u.responsible_id, name: u.full_name || `User ${u.responsible_id}` }); }}
                            onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg3)")}
                            onMouseLeave={(e) => (e.currentTarget.style.background = isSel ? "rgba(33,150,243,0.08)" : i % 2 === 0 ? "transparent" : "var(--bg)")}>
                          <td style={{ ...TD, color:"#555", fontSize:13, fontWeight:600, width:44, position:"sticky", left:0, background:"var(--bg2)" }}>
                            {String(i + 1).padStart(2, "0")}
                          </td>
                          <td style={{ ...TD, width:180, position:"sticky", left:44, background:"var(--bg2)", zIndex:2 }}>
                            <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                              <AvatarCircle name={u.full_name || `U${u.responsible_id}`} size={32} />
                              <span style={{ fontSize:13, color: isSel ? "#2196F3" : "var(--text)", fontWeight:500, whiteSpace:"nowrap" }}>
                                {u.full_name || `User ${u.responsible_id}`}
                              </span>
                            </div>
                          </td>
                          {stageCols.map((col) => {
                            const cnt = u.by_stage?.[col.key] ?? 0;
                            const max = colMaxes[col.key] ?? 1;
                            return (
                              <td key={col.key} style={{ ...TD, minWidth:90 }}>
                                {cnt > 0 ? (
                                  <>
                                    <span style={{ fontSize:13, color:"var(--text)" }}>{fmtNum(cnt)}</span>
                                    <MiniBar value={cnt} max={max} color={col.color} height={3} />
                                  </>
                                ) : (
                                  <span style={{ fontSize:13, color:"var(--text3)" }}>—</span>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                        {isSel && (
                          <tr key={`sub-masul-${u.responsible_id}`}>
                            <td colSpan={colCount} style={{ padding: "0 12px 12px" }}>
                              <div style={{ border: "1px solid #2196F3", borderTop: "none", borderRadius: "0 0 12px 12px", background: "rgba(33,150,243,0.04)", overflow: "hidden" }}>
                              {respLeadsMasulQ.isLoading ? (
                                <div style={{ padding: "14px 20px", color: "var(--text3)", fontSize: 13 }}>Yuklanmoqda…</div>
                              ) : subLeads.length === 0 ? (
                                <div style={{ padding: "14px 20px", color: "var(--text3)", fontSize: 13 }}>Ma'lumot yo'q</div>
                              ) : (
                                <div ref={masulListRef} style={{ maxHeight: 340, overflowY: "auto" }}>
                                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                                  <thead>
                                    <tr style={{ background: "rgba(33,150,243,0.06)" }}>
                                      <th style={{ ...TH("#555", 40), paddingLeft: 32 }}>#</th>
                                      <th style={TH("#9E9E9E", 260)}>LID</th>
                                      <th style={TH("#2196F3", 90)}>SANA</th>
                                      <th style={TH("#9C27B0", 130)}>TASHRIF SANASI</th>
                                      <th style={TH("#FF9800", 190)}>BOSQICH</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {subLeads.slice(0, shownMasulLeads).map((lead, li) => {
                                      const stage = stageBadge(lead.stage_bid);
                                      return (
                                        <tr key={lead.id} style={{ background: li % 2 === 0 ? "transparent" : "rgba(0,0,0,0.15)" }}>
                                          <td style={{ ...TD, color: "#555", fontSize: 12, paddingLeft: 32 }}>
                                            {String(li + 1).padStart(2, "0")}
                                          </td>
                                          <td style={{ ...TD, maxWidth: 300, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                            <a href={`${bitrixPortal}/crm/lead/details/${lead.id}/`}
                                               target="_blank" rel="noopener noreferrer"
                                               style={{ fontSize: 12, color: "#2196F3", textDecoration: "underline" }}>
                                              {lead.title || `Lid #${lead.id}`}
                                            </a>
                                          </td>
                                          <td style={{ ...TD, fontSize: 12, color: "var(--text3)", whiteSpace: "nowrap" }}>
                                            {lead.date_create ? new Date(lead.date_create).toLocaleDateString("uz-UZ", { day:"2-digit", month:"2-digit", year:"numeric" }) : "—"}
                                          </td>
                                          <td style={{ ...TD, fontSize: 12, color: lead.tashrif_sanasi ? "#9C27B0" : "#333", whiteSpace: "nowrap" }}>
                                            {lead.tashrif_sanasi ? new Date(lead.tashrif_sanasi).toLocaleDateString("uz-UZ", { day:"2-digit", month:"2-digit", year:"numeric" }) : "—"}
                                          </td>
                                          <td style={TD}>
                                            <span style={{
                                              display: "inline-block", padding: "3px 10px", borderRadius: 20,
                                              fontSize: 11, fontWeight: 600,
                                              background: `${stage.color}22`, border: `1px solid ${stage.color}55`, color: stage.color,
                                              whiteSpace: "nowrap",
                                            }}>
                                              {stage.label}
                                            </span>
                                          </td>
                                        </tr>
                                      );
                                    })}
                                    <tr style={{ background: "rgba(33,150,243,0.06)", borderTop: "1px solid var(--border2)" }}>
                                      <td style={{ ...TD, paddingLeft: 32, color: "#666" }} />
                                      <td style={{ ...TD, fontSize: 12, fontWeight: 700, color: "var(--text3)", textTransform: "uppercase" }}>JAMI</td>
                                      <td colSpan={3} style={{ ...TD, fontSize: 12, fontWeight: 700, color: "var(--text)" }}>{subLeads.length} ta lid</td>
                                    </tr>
                                  </tbody>
                                </table>
                                </div>
                              )}
                              {subLeads.length > 0 && (
                                <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 20px", background: "rgba(33,150,243,0.06)" }}>
                                  {shownMasulLeads < subLeads.length && (
                                    <>
                                      <button onClick={(e) => {
                                                e.stopPropagation();
                                                setShownMasulLeads((n) => n + 10);
                                                requestAnimationFrame(() => masulListRef.current?.scrollTo({ top: masulListRef.current.scrollHeight, behavior: "smooth" }));
                                              }}
                                        style={{ display: "inline-flex", alignItems: "center", gap: 5, background: "var(--bg3)", border: "1px solid var(--border)", borderRadius: 7, color: "var(--text2)", fontSize: 11.5, fontWeight: 600, padding: "5px 12px", cursor: "pointer" }}>
                                        Yana 10 ta <ChevronDown size={12} />
                                      </button>
                                      <button onClick={(e) => {
                                                e.stopPropagation();
                                                setShownMasulLeads(subLeads.length);
                                                requestAnimationFrame(() => masulListRef.current?.scrollTo({ top: 0, behavior: "smooth" }));
                                              }}
                                        style={{ background: "transparent", border: "1px solid var(--border)", borderRadius: 7, color: "var(--text2)", fontSize: 11.5, fontWeight: 600, padding: "5px 12px", cursor: "pointer" }}>
                                        Barchasi ({subLeads.length})
                                      </button>
                                    </>
                                  )}
                                  <span style={{ fontSize: 11, color: "var(--text3)", marginLeft: "auto" }}>
                                    {Math.min(shownMasulLeads, subLeads.length)} / {subLeads.length} ta lid
                                  </span>
                                </div>
                              )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </>
                    );
                  })}

                  {shownMasulRows < byUserFiltered.length && (
                    <tr>
                      <td colSpan={2 + stageCols.length} style={{ padding: "10px 12px", borderTop: "1px solid var(--border)" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <button onClick={() => setShownMasulRows(n => n + MASUL_PAGE)}
                            style={{ display: "inline-flex", alignItems: "center", gap: 5, background: "var(--bg3)", border: "1px solid var(--border)", borderRadius: 7, color: "var(--text2)", fontSize: 11.5, fontWeight: 600, padding: "5px 12px", cursor: "pointer" }}>
                            Yana {Math.min(MASUL_PAGE, byUserFiltered.length - shownMasulRows)} ta <ChevronDown size={12} />
                          </button>
                          <button onClick={() => setShownMasulRows(byUserFiltered.length)}
                            style={{ background: "transparent", border: "1px solid var(--border)", borderRadius: 7, color: "var(--text2)", fontSize: 11.5, fontWeight: 600, padding: "5px 12px", cursor: "pointer" }}>
                            Barchasi ({byUserFiltered.length})
                          </button>
                          <span style={{ fontSize: 11, color: "var(--text3)", marginLeft: "auto" }}>
                            {Math.min(shownMasulRows, byUserFiltered.length)} / {byUserFiltered.length} xodim
                          </span>
                        </div>
                      </td>
                    </tr>
                  )}
                  {/* JAMI row */}
                  <tr style={{ background:"var(--bg3)", borderTop:"1px solid var(--border2)" }}>
                    <td style={{ ...TD, position:"sticky", left:0, background:"var(--bg3)" }} />
                    <td style={{ ...TD, fontSize:13, fontWeight:700, color:"var(--text3)", textTransform:"uppercase", letterSpacing:"0.06em", position:"sticky", left:44, background:"var(--bg3)", zIndex:2 }}>
                      JAMI
                    </td>
                    {stageCols.map((col) => (
                      <td key={col.key} style={TD}>
                        <span style={{ fontSize:13, fontWeight:700, color:"var(--text)" }}>{fmtNum(totalsRow[col.key] ?? 0)}</span>
                        <MiniBar value={1} max={1} color={col.color} height={3} />
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          )}

        </div>
        </>)}
        {tabA === "vazifalar" && (<>
        {/* ══════════════════════════════════════════════════════════
            Vazifalar kesimida table
        ══════════════════════════════════════════════════════════ */}
        {(() => {
          const taskRows = (tasksQ.data?.tasks ?? []).map((r) => ({
            ...r,
            total:          parseInt(String(r.total),          10) || 0,
            in_progress:    parseInt(String(r.in_progress),    10) || 0,
            completed:      parseInt(String(r.completed),      10) || 0,
            overdue:        parseInt(String(r.overdue),        10) || 0,
            completed_late: parseInt(String(r.completed_late), 10) || 0,
          }));
          const taskMax = {
            total:          Math.max(1, ...taskRows.map((r) => r.total)),
            in_progress:    Math.max(1, ...taskRows.map((r) => r.in_progress)),
            completed:      Math.max(1, ...taskRows.map((r) => r.completed)),
            overdue:        Math.max(1, ...taskRows.map((r) => r.overdue)),
            completed_late: Math.max(1, ...taskRows.map((r) => r.completed_late)),
          };
          const taskTotals = taskRows.reduce(
            (acc, r) => ({
              total:          acc.total          + r.total,
              in_progress:    acc.in_progress    + r.in_progress,
              completed:      acc.completed      + r.completed,
              overdue:        acc.overdue        + r.overdue,
              completed_late: acc.completed_late + r.completed_late,
            }),
            { total: 0, in_progress: 0, completed: 0, overdue: 0, completed_late: 0 }
          );
          return (
            <div style={{ background: "var(--bg2)", borderRadius: 12, overflow: "hidden", marginBottom: 24 }}>
              <div style={{ padding: "16px 20px 12px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 12 }}>
                <span style={{ fontSize: 18, fontWeight: 700, color: "var(--text)" }}>Vazifalar kesimida</span>
                <span style={{ fontSize: 12, color: "var(--text3)" }}>{taskRows.length} ta xodim</span>
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
                        <th style={TH("#FF5722")}>Muddati O'tib Bajarilgan</th>
                        <th style={{ ...TH("#2196F3", 90), textAlign: "center" }}>Bajarilish</th>
                      </tr>
                    </thead>
                    <tbody>
                      {taskRows.flatMap((r, i) => {
                        const pct = r.total > 0 ? (r.completed / r.total) * 100 : 0;
                        const isTaskOpen = selectedTaskResp === r.responsible_id;
                        const tasks = isTaskOpen ? (respTasksQ.data?.items ?? []) : [];
                        return [
                          <tr key={r.responsible_id}
                              onClick={() => setSelectedTaskResp(isTaskOpen ? null : r.responsible_id)}
                              style={{ background: isTaskOpen ? "rgba(33,150,243,0.08)" : i % 2 === 0 ? "transparent" : "var(--bg)", cursor: "pointer" }}
                              onMouseEnter={(e) => { if (!isTaskOpen) e.currentTarget.style.background = "var(--bg3)"; }}
                              onMouseLeave={(e) => { e.currentTarget.style.background = isTaskOpen ? "rgba(33,150,243,0.08)" : i % 2 === 0 ? "transparent" : "var(--bg)"; }}>
                            <td style={{ ...TD, color: "#555", fontSize: 13, fontWeight: 600, width: 44 }}>
                              {String(i + 1).padStart(2, "0")}
                            </td>
                            <td style={{ ...TD, width: 200 }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                <AvatarCircle name={r.full_name || "?"} size={34} />
                                <span style={{ fontSize: 13, color: "var(--text)", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                  {r.full_name}
                                </span>
                              </div>
                            </td>
                            <td style={TD}>
                              <span style={{ fontSize: 15, fontWeight: 600, color: "var(--text)" }}>{fmtNum(r.total)}</span>
                              <MiniBar value={r.total} max={taskMax.total} color="#9E9E9E" />
                            </td>
                            <td style={TD}>
                              {r.in_progress > 0 ? (
                                <>
                                  <span style={{ fontSize: 14, color: "var(--text)" }}>{fmtNum(r.in_progress)}</span>
                                  <MiniBar value={r.in_progress} max={taskMax.in_progress} color="#FF9800" />
                                </>
                              ) : <span style={{ fontSize: 13, color: "var(--text3)" }}>—</span>}
                            </td>
                            <td style={TD}>
                              {r.completed > 0 ? (
                                <>
                                  <span style={{ fontSize: 14, color: "var(--text)" }}>{fmtNum(r.completed)}</span>
                                  <MiniBar value={r.completed} max={taskMax.completed} color="#4CAF50" />
                                </>
                              ) : <span style={{ fontSize: 13, color: "var(--text3)" }}>—</span>}
                            </td>
                            <td style={TD}>
                              {r.overdue > 0 ? (
                                <>
                                  <span style={{ fontSize: 14, color: "#F44336" }}>{fmtNum(r.overdue)}</span>
                                  <MiniBar value={r.overdue} max={taskMax.overdue} color="#F44336" />
                                </>
                              ) : <span style={{ fontSize: 13, color: "var(--text3)" }}>—</span>}
                            </td>
                            <td style={TD}>
                              {r.completed_late > 0 ? (
                                <>
                                  <span style={{ fontSize: 14, color: "#FF5722" }}>{fmtNum(r.completed_late)}</span>
                                  <MiniBar value={r.completed_late} max={taskMax.completed_late} color="#FF5722" />
                                </>
                              ) : <span style={{ fontSize: 13, color: "var(--text3)" }}>—</span>}
                            </td>
                            <td style={{ ...TD, textAlign: "center" }}>
                              <ConversionDonut pct={pct} size={38} />
                            </td>
                          </tr>,
                          isTaskOpen ? (
                            <tr key={`${r.responsible_id}-tasks`}>
                              <td colSpan={8} style={{ padding: "0 12px 12px" }}>
                                <div style={{ border: "1px solid #2196F3", borderTop: "none", borderRadius: "0 0 12px 12px", background: "rgba(33,150,243,0.04)", overflow: "hidden" }}>
                                  {respTasksQ.isLoading ? (
                                    <div style={{ padding: "14px 20px", color: "var(--text3)", fontSize: 13 }}>Yuklanmoqda…</div>
                                  ) : !tasks.length ? (
                                    <div style={{ padding: "14px 20px", color: "var(--text3)", fontSize: 13 }}>Ma’lumot yo’q</div>
                                  ) : (
                                    <div style={{ maxHeight: 340, overflowY: "auto" }}>
                                      <table style={{ width: "100%", borderCollapse: "collapse" }}>
                                        <thead>
                                          <tr style={{ background: "rgba(33,150,243,0.06)" }}>
                                            <th style={{ ...SUBTH, width: 44, paddingLeft: 20 }}>#</th>
                                            <th style={SUBTH}>VAZIFA</th>
                                            <th style={{ ...SUBTH, width: 150 }}>HOLATI</th>
                                            <th style={{ ...SUBTH, width: 210 }}>LID BOSQICHI</th>
                                            <th style={{ ...SUBTH, width: 110 }}>SANA</th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {tasks.map((t, ti) => {
                                            const st = TASK_STATUS[t.status] ?? { label: t.status, color: "#9E9E9E" };
                                            const ls = t.lead_stage_bid ? (STAGE_BADGE_MAP[t.lead_stage_bid] ?? { label: t.lead_stage_bid, color: "#9E9E9E" }) : null;
                                            return (
                                              <tr key={t.id} style={{ background: ti % 2 === 0 ? "transparent" : "rgba(0,0,0,0.15)" }}>
                                                <td style={{ ...SUBTD, color: "var(--text3)", fontSize: 12, paddingLeft: 20 }}>{String(ti + 1).padStart(2, "0")}</td>
                                                <td style={{ ...SUBTD, maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12, color: "var(--text2)" }}>
                                                  {t.title || `Vazifa #${t.id}`}
                                                </td>
                                                <td style={SUBTD}><span style={pill(st.color)}>{st.label}</span></td>
                                                <td style={SUBTD}>
                                                  {t.lead_id && ls ? (
                                                    <a href={`${bitrixPortal}/crm/lead/details/${t.lead_id}/`} target="_blank" rel="noreferrer"
                                                       onClick={e => e.stopPropagation()} style={{ textDecoration: "none" }}>
                                                      <span style={pill(ls.color)}>{ls.label}</span>
                                                    </a>
                                                  ) : <span style={{ fontSize: 12, color: "var(--text3)" }}>—</span>}
                                                </td>
                                                <td style={{ ...SUBTD, fontSize: 12, color: "var(--text3)", whiteSpace: "nowrap" }}>
                                                  {t.date_created ? String(t.date_created).slice(0, 10) : "—"}
                                                </td>
                                              </tr>
                                            );
                                          })}
                                        </tbody>
                                      </table>
                                    </div>
                                  )}
                                </div>
                              </td>
                            </tr>
                          ) : null,
                        ];
                      })}

                      {/* JAMI row */}
                      <tr style={{ background: "var(--bg3)", borderTop: "1px solid var(--border2)" }}>
                        <td style={{ ...TD, color: "var(--text3)" }} />
                        <td style={{ ...TD, fontSize: 13, fontWeight: 700, color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                          JAMI
                        </td>
                        <td style={TD}>
                          <span style={{ fontSize: 16, fontWeight: 700, color: "var(--text)" }}>{fmtNum(taskTotals.total)}</span>
                          <MiniBar value={1} max={1} color="#9E9E9E" />
                        </td>
                        <td style={TD}>
                          <span style={{ fontSize: 16, fontWeight: 700, color: "var(--text)" }}>{fmtNum(taskTotals.in_progress)}</span>
                          <MiniBar value={1} max={1} color="#FF9800" />
                        </td>
                        <td style={TD}>
                          <span style={{ fontSize: 16, fontWeight: 700, color: "var(--text)" }}>{fmtNum(taskTotals.completed)}</span>
                          <MiniBar value={1} max={1} color="#4CAF50" />
                        </td>
                        <td style={TD}>
                          <span style={{ fontSize: 16, fontWeight: 700, color: taskTotals.overdue > 0 ? "#F44336" : "var(--text)" }}>
                            {fmtNum(taskTotals.overdue)}
                          </span>
                          <MiniBar value={1} max={1} color="#F44336" />
                        </td>
                        <td style={TD}>
                          <span style={{ fontSize: 16, fontWeight: 700, color: taskTotals.completed_late > 0 ? "#FF5722" : "var(--text)" }}>
                            {fmtNum(taskTotals.completed_late)}
                          </span>
                          <MiniBar value={1} max={1} color="#FF5722" />
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
        </>)}
        {tabA === "utm" && (<>
        {/* ══════════════════════════════════════════════════════════
            UTM bo'yicha — single table, 6-level breadcrumb navigation
        ══════════════════════════════════════════════════════════ */}
        {(() => {
          const UTM_COL_LABELS   = ["UTM MANBA", "UTM MEDIUM", "KAMPANIYA", "AD SET (CONTENT)", "REKLAMA (TERM)", "MAS'UL"];
          const UTM_COUNT_LABELS = ["manba", "medium", "kampaniya", "ad set", "reklama", "mas'ul"];

          const utmRowsAll: Record<number, any[]> = {
            0: utmStatsQ.data ?? [],
            1: utmMediumQ.data ?? [],
            2: utmCampaignQ.data ?? [],
            3: utmContentQ.data ?? [],
            4: utmTermQ.data ?? [],
            5: utmRespQ.data ?? [],
          };
          const utmLoadingAll: Record<number, boolean> = {
            0: utmStatsQ.isLoading,
            1: utmMediumQ.isLoading,
            2: utmCampaignQ.isLoading,
            3: utmContentQ.isLoading,
            4: utmTermQ.isLoading,
            5: utmRespQ.isLoading,
          };
          const utmNameKeys = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "full_name"];

          const rows    = utmRowsAll[utmLevel];
          const loading = utmLoadingAll[utmLevel];
          const nameKey = utmNameKeys[utmLevel];

          const maxes: Record<string, number> = {};
          for (const c of UTM_COLS_DEF)
            maxes[c.key] = Math.max(1, ...rows.map((r: any) => Number(r[c.key]) || 0));
          const totals = rows.reduce((acc: Record<string, number>, r: any) => {
            for (const c of UTM_COLS_DEF) acc[c.key] = (acc[c.key] || 0) + (Number(r[c.key]) || 0);
            return acc;
          }, {} as Record<string, number>);

          const breadcrumbVals: (string | undefined)[] = [
            undefined, utmPath.source, utmPath.medium, utmPath.campaign, utmPath.content, utmPath.term,
          ];

          const goTo = (targetLevel: number) => {
            if (targetLevel === 0) setUtmPath({});
            else if (targetLevel === 1) setUtmPath({ source: utmPath.source });
            else if (targetLevel === 2) setUtmPath({ source: utmPath.source, medium: utmPath.medium });
            else if (targetLevel === 3) setUtmPath({ source: utmPath.source, medium: utmPath.medium, campaign: utmPath.campaign });
            else if (targetLevel === 4) setUtmPath({ source: utmPath.source, medium: utmPath.medium, campaign: utmPath.campaign, content: utmPath.content });
          };

          const handleRowClick = (row: any) => {
            const rawVal = row[nameKey];
            const val = rawVal === 'Nomalum' ? '' : (rawVal ?? '');
            if (utmLevel === 0) setUtmPath({ source: row.utm_source });
            else if (utmLevel === 1) setUtmPath({ ...utmPath, medium: val });
            else if (utmLevel === 2) setUtmPath({ ...utmPath, campaign: val });
            else if (utmLevel === 3) setUtmPath({ ...utmPath, content: val });
            else if (utmLevel === 4) setUtmPath({ ...utmPath, term: val });
          };

          return (
            <div style={{ background: "var(--bg2)", borderRadius: 12, overflow: "hidden", marginBottom: 16 }}>
              {/* Breadcrumb header */}
              <div style={{ padding: "14px 20px 12px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
                {Array.from({ length: utmLevel + 1 }, (_, lv) => (
                  <span key={lv} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    {lv > 0 && <span style={{ color: "#444", fontSize: 13, padding: "0 2px" }}>/</span>}
                    <span
                      style={{
                        fontSize: lv === utmLevel ? 15 : 13,
                        fontWeight: lv === utmLevel ? 700 : 500,
                        color: lv < utmLevel ? "#2196F3" : "var(--text)",
                        cursor: lv < utmLevel ? "pointer" : "default",
                        whiteSpace: "nowrap",
                        textDecoration: lv < utmLevel ? "underline" : "none",
                      }}
                      onClick={() => lv < utmLevel && goTo(lv)}
                    >
                      {lv === 0 ? "UTM bo'yicha" : (breadcrumbVals[lv] || '(bo\'sh)')}
                    </span>
                  </span>
                ))}
                <span style={{ marginLeft: "auto", fontSize: 12, color: "#555", flexShrink: 0 }}>
                  {loading ? "..." : `${rows.length} ta ${UTM_COUNT_LABELS[utmLevel]}`}
                </span>
              </div>

              {/* Table */}
              {loading ? (
                <div style={{ padding: 24, color: "#666", fontSize: 13 }}>Yuklanmoqda…</div>
              ) : rows.length === 0 ? (
                <div style={{ padding: 24, color: "#555", fontSize: 13 }}>Ma'lumot yo'q</div>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "auto" }}>
                    <thead>
                      <tr>
                        <th style={TH("#9E9E9E", 220)}>{UTM_COL_LABELS[utmLevel]}</th>
                        {UTM_COLS_DEF.map(c => <th key={c.key} style={TH(c.color)}>{c.label}</th>)}
                        <th style={{ ...TH("#4CAF50", 80), textAlign: "center" }}>KONVERSIYA</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r: any, i: number) => {
                        const rawName  = String(r[nameKey] ?? '—');
                        const displayName = utmLevel === 0
                          ? (UTM_SOURCE_DISPLAY_NAMES[rawName] ?? rawName)
                          : rawName;
                        const isClickable = utmLevel < 5;
                        const konv = (Number(r.umumiy_lidlar) || 0) > 0
                          ? ((Number(r.konsultatsiya_otkazildi) || 0) / (Number(r.umumiy_lidlar) || 1)) * 100 : 0;
                        const subCount = Number(r.campaign_count || r.responsible_count || 0);
                        const subLabel = ["kampaniya", "kampaniya", "mas'ul", "mas'ul", "mas'ul", ""][utmLevel];
                        return (
                          <tr key={rawName + i}
                              style={{ background: i % 2 === 0 ? "transparent" : "var(--bg)", cursor: isClickable ? "pointer" : "default" }}
                              onClick={() => isClickable && handleRowClick(r)}
                              onMouseEnter={e => { if (isClickable) e.currentTarget.style.background = "var(--bg3)"; }}
                              onMouseLeave={e => { if (isClickable) e.currentTarget.style.background = i % 2 === 0 ? "transparent" : "var(--bg)"; }}>
                            <td style={{ ...TD, fontWeight: 600, fontSize: 13, whiteSpace: "nowrap" }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                {isClickable && <ChevronDown size={13} style={{ color: "#9E9E9E", flexShrink: 0 }} />}
                                <span style={{ color: isClickable ? "#2196F3" : "var(--text)" }}>{displayName || "(bo'sh)"}</span>
                                {subCount > 0 && (
                                  <span style={{ fontSize: 10, background: "rgba(33,150,243,0.1)", color: "#2196F3", borderRadius: 8, padding: "1px 6px", flexShrink: 0 }}>
                                    {subCount} {subLabel}
                                  </span>
                                )}
                              </div>
                            </td>
                            {UTM_COLS_DEF.map(c => {
                              const val = Number(r[c.key]) || 0;
                              return (
                                <td key={c.key} style={TD}>
                                  {val > 0 ? (
                                    <><span style={{ fontSize: 14, fontWeight: 600, color: "var(--text)" }}>{fmtNum(val)}</span><MiniBar value={val} max={maxes[c.key]} color={c.color} /></>
                                  ) : <span style={{ fontSize: 13, color: "var(--text3)" }}>—</span>}
                                </td>
                              );
                            })}
                            <td style={{ ...TD, textAlign: "center" }}><ConversionDonut pct={konv} size={38} /></td>
                          </tr>
                        );
                      })}
                      <tr style={{ background: "var(--bg3)", borderTop: "1px solid var(--border2)" }}>
                        <td style={{ ...TD, fontSize: 13, fontWeight: 700, color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.06em" }}>JAMI</td>
                        {UTM_COLS_DEF.map(c => (
                          <td key={c.key} style={TD}>
                            <span style={{ fontSize: 14, fontWeight: 700, color: "var(--text)" }}>{fmtNum(totals[c.key] || 0)}</span>
                            <MiniBar value={1} max={1} color={c.color} />
                          </td>
                        ))}
                        <td style={{ ...TD, textAlign: "center" }}>
                          <ConversionDonut pct={(totals.umumiy_lidlar || 0) > 0 ? ((totals.konsultatsiya_otkazildi || 0) / (totals.umumiy_lidlar || 0)) * 100 : 0} size={38} />
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })()}

        </>)}

        {/* ══════════════════════════════════════════════════════════
            Bekor bo'lish va Sifatsiz sabablari (side-by-side)
        ══════════════════════════════════════════════════════════ */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 24 }}>
          <ReasonsCard
            title="Bekor bo'lish sabablari" barColor="#FFC107" kind="cancel" filter={applied}
            loading={cancelQ.isLoading}
            items={(cancelQ.data?.items ?? []).map((r) => ({ reason: r.reason, total: parseInt(String(r.total), 10) || 0 }))}
          />
          <ReasonsCard
            title="Sifatsiz sabablari" barColor="#F44336" kind="junk" filter={applied}
            loading={junkQ.isLoading}
            items={(junkQ.data?.items ?? []).map((r) => ({ reason: r.reason, total: parseInt(String(r.total), 10) || 0 }))}
          />
        </div>

        {/* ══════════════════════════════════════════════════════════
            Sabab (Причина) bo'yicha — same funnel columns as Manba
            bo'yicha, under Bekor bo'ldi / Sifatsiz sabablari.
        ══════════════════════════════════════════════════════════ */}
        <UfBreakdownTable
          title="Sabab bo'yicha" unit="sabab" q={reasonStatsQ} bitrixPortal={bitrixPortal}
          selected={selectedReason} setSelected={setSelectedReason}
          shown={shownReasonLeads} setShown={setShownReasonLeads}
          listRef={reasonListRef} leadsQ={reasonLeadsQ}
        />


        {/* Manba / Manba 1 / Hudud — same columns, different grouping field. */}
        <TabSwitch
          tabs={[["manba", "Manba"], ["manba1", "Manba 1"], ["hudud", "Hudud"]]}
          value={tabB} onChange={setTabB}
        />
        {tabB === "manba" && (<>
        {/* ══════════════════════════════════════════════════════════
            Manba bo'yicha table
        ══════════════════════════════════════════════════════════ */}
        {(() => {
          const srcRows: SourceStatsRow[] = sourceQ.data ?? [];
          const srcMaxes = {
            umumiy:   Math.max(1, ...srcRows.map(r => r.umumiy_lidlar)),
            sifatli:  Math.max(1, ...srcRows.map(r => r.sifatli_lid)),
            konsB:    Math.max(1, ...srcRows.map(r => r.konsultatsiya_belgilandi)),
            konsO:    Math.max(1, ...srcRows.map(r => r.konsultatsiya_otkazildi)),
            sifatsiz: Math.max(1, ...srcRows.map(r => r.sifatsiz)),
            bekor:    Math.max(1, ...srcRows.map(r => r.bekor_boldi)),
          };
          const srcTotals = srcRows.reduce(
            (acc, r) => ({
              umumiy:   acc.umumiy   + r.umumiy_lidlar,
              sifatli:  acc.sifatli  + r.sifatli_lid,
              konsB:    acc.konsB    + r.konsultatsiya_belgilandi,
              konsO:    acc.konsO    + r.konsultatsiya_otkazildi,
              sifatsiz: acc.sifatsiz + r.sifatsiz,
              bekor:    acc.bekor    + r.bekor_boldi,
            }),
            { umumiy: 0, sifatli: 0, konsB: 0, konsO: 0, sifatsiz: 0, bekor: 0 }
          );
          return (
            <div style={{ background: "var(--bg2)", borderRadius: 12, overflow: "hidden", marginBottom: 16 }}>
              <div style={{ padding: "16px 20px 12px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 12 }}>
                <span style={{ fontSize: 18, fontWeight: 700, color: "var(--text)" }}>Manba bo'yicha</span>
                <span style={{ fontSize: 12, color: "var(--text3)" }}>{srcRows.length} ta manba</span>
              </div>
              {sourceQ.isLoading ? (
                <div style={{ padding: 24, color: "#666", fontSize: 13 }}>Yuklanmoqda…</div>
              ) : srcRows.length === 0 ? (
                <div style={{ padding: 24, color: "#555", fontSize: 13 }}>Ma'lumot yo'q</div>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "auto" }}>
                    <thead>
                      <tr>
                        <th style={TH("#9E9E9E", 180)}>MANBA</th>
                        <th style={TH("#2196F3")}>UMUMIY LIDLAR</th>
                        <th style={TH("#00BCD4")}>SIFATLI LID</th>
                        <th style={TH("#9C27B0")}>TASHRIF BELGILANDI</th>
                        <th style={TH("#4CAF50")}>USPESHNIY LID</th>
                        <th style={TH("#F44336")}>SIFATSIZ</th>
                        <th style={TH("#FFC107")}>BEKOR BO'LDI</th>
                        <th style={{ ...TH("#4CAF50", 80), textAlign: "center" }}>KONVERSIYA</th>
                        <th style={{ ...TH("#00BCD4", 80), textAlign: "center" }}>SIFATLI KON.</th>
                      </tr>
                    </thead>
                    <tbody>
                      {srcRows.flatMap((r, i) => {
                        const konv      = r.umumiy_lidlar > 0 ? (r.konsultatsiya_otkazildi / r.umumiy_lidlar) * 100 : 0;
                        const sifatliKonv = r.umumiy_lidlar > 0 ? (r.sifatli_lid / r.umumiy_lidlar) * 100 : 0;
                        const isSrcOpen = selectedSource === r.source_id;
                        const srcLeads = isSrcOpen ? (srcLeadsQ.data?.items ?? []) : [];
                        return [
                          <tr key={r.source_id}
                              onClick={() => { setShownSrcLeads(10); setSelectedSource(isSrcOpen ? null : r.source_id); }}
                              style={{ background: isSrcOpen ? "rgba(33,150,243,0.08)" : i % 2 === 0 ? "transparent" : "var(--bg)", cursor: "pointer" }}
                              onMouseEnter={e => { if (!isSrcOpen) e.currentTarget.style.background = "var(--bg3)"; }}
                              onMouseLeave={e => { e.currentTarget.style.background = isSrcOpen ? "rgba(33,150,243,0.08)" : i % 2 === 0 ? "transparent" : "var(--bg)"; }}>
                            <td style={{ ...TD, fontWeight: 600, color: "var(--text)", fontSize: 13, whiteSpace: "nowrap" }}>
                              {r.source_name}
                            </td>
                            <td style={TD}>
                              <span style={{ fontSize: 14, fontWeight: 600, color: "var(--text)" }}>{fmtNum(r.umumiy_lidlar)}</span>
                              <MiniBar value={r.umumiy_lidlar} max={srcMaxes.umumiy} color="#2196F3" />
                            </td>
                            <td style={TD}>
                              {r.sifatli_lid > 0 ? (
                                <><span style={{ fontSize: 14, fontWeight: 600, color: "var(--text)" }}>{fmtNum(r.sifatli_lid)}</span><MiniBar value={r.sifatli_lid} max={srcMaxes.sifatli} color="#00BCD4" /></>
                              ) : <span style={{ fontSize: 13, color: "var(--text3)" }}>—</span>}
                            </td>
                            <td style={TD}>
                              {r.konsultatsiya_belgilandi > 0 ? (
                                <><span style={{ fontSize: 14, fontWeight: 600, color: "var(--text)" }}>{fmtNum(r.konsultatsiya_belgilandi)}</span><MiniBar value={r.konsultatsiya_belgilandi} max={srcMaxes.konsB} color="#9C27B0" /></>
                              ) : <span style={{ fontSize: 13, color: "var(--text3)" }}>—</span>}
                            </td>
                            <td style={TD}>
                              {r.konsultatsiya_otkazildi > 0 ? (
                                <><span style={{ fontSize: 14, fontWeight: 600, color: "var(--text)" }}>{fmtNum(r.konsultatsiya_otkazildi)}</span><MiniBar value={r.konsultatsiya_otkazildi} max={srcMaxes.konsO} color="#4CAF50" /></>
                              ) : <span style={{ fontSize: 13, color: "var(--text3)" }}>—</span>}
                            </td>
                            <td style={TD}>
                              {r.sifatsiz > 0 ? (
                                <><span style={{ fontSize: 14, fontWeight: 600, color: "var(--text)" }}>{fmtNum(r.sifatsiz)}</span><MiniBar value={r.sifatsiz} max={srcMaxes.sifatsiz} color="#F44336" /></>
                              ) : <span style={{ fontSize: 13, color: "var(--text3)" }}>—</span>}
                            </td>
                            <td style={TD}>
                              {r.bekor_boldi > 0 ? (
                                <><span style={{ fontSize: 14, fontWeight: 600, color: "var(--text)" }}>{fmtNum(r.bekor_boldi)}</span><MiniBar value={r.bekor_boldi} max={srcMaxes.bekor} color="#FFC107" /></>
                              ) : <span style={{ fontSize: 13, color: "var(--text3)" }}>—</span>}
                            </td>
                            <td style={{ ...TD, textAlign: "center" }}>
                              <ConversionDonut pct={konv} size={38} />
                            </td>
                            <td style={{ ...TD, textAlign: "center" }}>
                              <ConversionDonut pct={sifatliKonv} size={38} />
                            </td>
                          </tr>,
                          isSrcOpen ? (
                            <tr key={`${r.source_id}-leads`}>
                              <td colSpan={9} style={{ padding: "0 12px 12px" }}>
                                <div style={{ border: "1px solid #2196F3", borderTop: "none", borderRadius: "0 0 12px 12px", background: "rgba(33,150,243,0.04)", overflow: "hidden" }}>
                                  {srcLeadsQ.isLoading ? (
                                    <div style={{ padding: "14px 20px", color: "var(--text3)", fontSize: 13 }}>Yuklanmoqda…</div>
                                  ) : !srcLeads.length ? (
                                    <div style={{ padding: "14px 20px", color: "var(--text3)", fontSize: 13 }}>Ma'lumot yo'q</div>
                                  ) : (
                                    <>
                                      <div ref={srcListRef} style={{ maxHeight: 340, overflowY: "auto" }}>
                                        <table style={{ width: "100%", borderCollapse: "collapse" }}>
                                          <thead>
                                            <tr style={{ background: "rgba(33,150,243,0.06)" }}>
                                              <th style={{ ...SUBTH, width: 44, paddingLeft: 20 }}>#</th>
                                              <th style={SUBTH}>LID</th>
                                              <th style={{ ...SUBTH, width: 110 }}>SANA</th>
                                              <th style={{ ...SUBTH, width: 210 }}>BOSQICH</th>
                                            </tr>
                                          </thead>
                                          <tbody>
                                            {srcLeads.slice(0, shownSrcLeads).map((lead, li) => {
                                              const st = STAGE_BADGE_MAP[lead.stage_bid] ?? { label: lead.stage_bid, color: "#9E9E9E" };
                                              return (
                                                <tr key={lead.id} style={{ background: li % 2 === 0 ? "transparent" : "rgba(0,0,0,0.15)" }}>
                                                  <td style={{ ...SUBTD, color: "var(--text3)", fontSize: 12, paddingLeft: 20 }}>{String(li + 1).padStart(2, "0")}</td>
                                                  <td style={{ ...SUBTD, maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                                    <a href={`${bitrixPortal}/crm/lead/details/${lead.id}/`} target="_blank" rel="noreferrer"
                                                       onClick={e => e.stopPropagation()} style={{ fontSize: 12, color: "#2196F3", textDecoration: "underline" }}>
                                                      {lead.title || `Lid #${lead.id}`}
                                                    </a>
                                                  </td>
                                                  <td style={{ ...SUBTD, fontSize: 12, color: "var(--text3)", whiteSpace: "nowrap" }}>
                                                    {lead.date_create ? String(lead.date_create).slice(0, 10) : "—"}
                                                  </td>
                                                  <td style={SUBTD}><span style={pill(st.color)}>{st.label}</span></td>
                                                </tr>
                                              );
                                            })}
                                          </tbody>
                                        </table>
                                      </div>
                                      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 20px", background: "rgba(33,150,243,0.06)" }}>
                                        {shownSrcLeads < srcLeads.length && (
                                          <>
                                            <button onClick={e => {
                                                      e.stopPropagation();
                                                      setShownSrcLeads(n => n + 10);
                                                      requestAnimationFrame(() => srcListRef.current?.scrollTo({ top: srcListRef.current.scrollHeight, behavior: "smooth" }));
                                                    }}
                                              style={{ display: "inline-flex", alignItems: "center", gap: 5, background: "var(--bg3)", border: "1px solid var(--border)", borderRadius: 7, color: "var(--text2)", fontSize: 11.5, fontWeight: 600, padding: "5px 12px", cursor: "pointer" }}>
                                              Yana 10 ta <ChevronDown size={12} />
                                            </button>
                                            <button onClick={e => {
                                                      e.stopPropagation();
                                                      setShownSrcLeads(srcLeads.length);
                                                      requestAnimationFrame(() => srcListRef.current?.scrollTo({ top: 0, behavior: "smooth" }));
                                                    }}
                                              style={{ background: "transparent", border: "1px solid var(--border)", borderRadius: 7, color: "var(--text2)", fontSize: 11.5, fontWeight: 600, padding: "5px 12px", cursor: "pointer" }}>
                                              Barchasi ({srcLeads.length})
                                            </button>
                                          </>
                                        )}
                                        <span style={{ fontSize: 11, color: "var(--text3)", marginLeft: "auto" }}>
                                          {Math.min(shownSrcLeads, srcLeads.length)} / {srcLeads.length} ta lid
                                        </span>
                                      </div>
                                    </>
                                  )}
                                </div>
                              </td>
                            </tr>
                          ) : null,
                        ];
                      })}
                      {/* JAMI row */}
                      <tr style={{ background: "var(--bg3)", borderTop: "1px solid var(--border2)" }}>
                        <td style={{ ...TD, fontSize: 13, fontWeight: 700, color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.06em" }}>JAMI</td>
                        <td style={TD}><span style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>{fmtNum(srcTotals.umumiy)}</span><MiniBar value={1} max={1} color="#2196F3" /></td>
                        <td style={TD}><span style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>{fmtNum(srcTotals.sifatli)}</span><MiniBar value={1} max={1} color="#00BCD4" /></td>
                        <td style={TD}><span style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>{fmtNum(srcTotals.konsB)}</span><MiniBar value={1} max={1} color="#9C27B0" /></td>
                        <td style={TD}><span style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>{fmtNum(srcTotals.konsO)}</span><MiniBar value={1} max={1} color="#4CAF50" /></td>
                        <td style={TD}><span style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>{fmtNum(srcTotals.sifatsiz)}</span><MiniBar value={1} max={1} color="#F44336" /></td>
                        <td style={TD}><span style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>{fmtNum(srcTotals.bekor)}</span><MiniBar value={1} max={1} color="#FFC107" /></td>
                        <td style={{ ...TD, textAlign: "center" }}>
                          <ConversionDonut pct={srcTotals.umumiy > 0 ? (srcTotals.konsO / srcTotals.umumiy) * 100 : 0} size={38} />
                        </td>
                        <td style={{ ...TD, textAlign: "center" }}>
                          <ConversionDonut pct={srcTotals.umumiy > 0 ? (srcTotals.sifatli / srcTotals.umumiy) * 100 : 0} size={38} />
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })()}
        </>)}
        {tabB === "manba1" && (<>
        {/* ══════════════════════════════════════════════════════════
            Manba 1 / Hudud bo'yicha — same funnel columns as Manba
            bo'yicha, grouped by a UF enum field instead of source_id.
        ══════════════════════════════════════════════════════════ */}
        <UfBreakdownTable
          title="Manba 1 bo'yicha" unit="manba" q={source1Q} bitrixPortal={bitrixPortal}
          selected={selectedSource1} setSelected={setSelectedSource1}
          shown={shownSource1Leads} setShown={setShownSource1Leads}
          listRef={source1ListRef} leadsQ={source1LeadsQ}
        />
        </>)}
        {tabB === "hudud" && (<>
        <UfBreakdownTable
          title="Hudud bo'yicha" unit="hudud" q={hududQ} bitrixPortal={bitrixPortal}
          selected={selectedHudud} setSelected={setSelectedHudud}
          shown={shownHududLeads} setShown={setShownHududLeads}
          listRef={hududListRef} leadsQ={hududLeadsQ}
        />
        </>)}

        {statsQ.error && (
          <div className="p-3 bg-red-bg border border-red-bd text-red rounded-lg text-[12.5px]">
            Xatolik: {(statsQ.error as Error).message}
          </div>
        )}
      </div>
    </>
  );
}

import { Fragment, useState, useCallback, useMemo, useRef, useEffect } from "react";
import { useDarkMode } from "@/hooks/useDarkMode";
import { useQuery, useInfiniteQuery } from "@tanstack/react-query";
import {
  Search, TrendingUp, CheckCircle, ChevronDown, Users, BarChart2, Layers, Info,
} from "lucide-react";
import { Topbar } from "@/components/Topbar";
import { InfoTip } from "@/components/InfoTip";
import { getDealFilterOptions } from "@/lib/api/deals";
import {
  getPipelineKpi, getPipelineManagers, getPipelineSources, getPipelineReasons, getPipelineDeals,
  getPipelineReportStages,
  NONE_KEY,
  type PipelineKey, type PipelineFilter, type PipelineDealsFilter, type PipelineStage,
  type PipelineManagerRow, type ReasonScope,
} from "@/lib/api/pipelineDeals";
import { fmtNum } from "@/lib/utils";
import { useBitrixPortal } from "@/lib/api/config";

// ── Helpers ──────────────────────────────────────────────────────
const localISO = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const todayISO = () => localISO(new Date());
const daysAgoISO = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return localISO(d); };
const startOfMonthISO = () => { const d = new Date(); d.setDate(1); return localISO(d); };

/** "2026-09-30 18:17" in Tashkent time. */
const fmtDateTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("sv-SE", { timeZone: "Asia/Tashkent" }).slice(0, 16) : "—";

const pct = (part: number, whole: number) => (whole > 0 ? (part / whole) * 100 : 0);

// ── Pipelines ────────────────────────────────────────────────────
const PIPELINES: { key: PipelineKey; label: string }[] = [
  { key: "uc",    label: "Учебный центр" },
  { key: "yangi", label: "Школа | YANGI" },
];

type CardStyle = { gradient: string; lightGradient: string; icon: React.ReactNode };
const CARD_STYLES: CardStyle[] = [
  { gradient: "linear-gradient(135deg,#065f46,#10b981)", lightGradient: "linear-gradient(135deg,rgba(4,150,107,0.07),rgba(16,185,129,0.12))", icon: <CheckCircle size={16} /> },
  { gradient: "linear-gradient(135deg,#92400e,#f59e0b)", lightGradient: "linear-gradient(135deg,rgba(146,64,14,0.07),rgba(245,158,11,0.12))", icon: <Layers size={16} /> },
  { gradient: "linear-gradient(135deg,#5b21b6,#8b5cf6)", lightGradient: "linear-gradient(135deg,rgba(91,33,182,0.07),rgba(139,92,246,0.12))", icon: <TrendingUp size={16} /> },
];

/**
 * KPI cards that count one named stage, after "Jami" and "Yangi".
 * Labels come from Bitrix at runtime; only the stage ids are fixed here.
 */
const STAGE_CARDS: Record<PipelineKey, string[]> = {
  uc:    ["NEW", "1", "WON"],      // Визит в офис Тошкент, Пробный урок, Оплата (+)
  yangi: ["C25:WON", "C25:NEW"],   // To'lov | O'qimoqda, Tashrif buyurdi
};

const PROCESS_PALETTE = ["#2196F3", "#00BCD4", "#3F51B5", "#009688", "#673AB7", "#03A9F4", "#5C6BC0", "#26A69A", "#7E57C2", "#29B6F6"];
function stageColor(s: PipelineStage | undefined, i = 0) {
  if (!s) return "#9E9E9E";
  if (s.kind === "won") return "#4CAF50";
  if (s.kind === "lost") return "#F44336";
  return s.color || PROCESS_PALETTE[i % PROCESS_PALETTE.length];
}

// Accounts that are not sales managers (integrations, admins). They are folded
// into one row rather than dropped, so every table still adds up to the cards.
const RESP_EXCL_LC = ["data365", "data365 support", "abror", "sardor jumayev", "sardor jjumayev", "main (asosiy)", "main"];
const isRespExcluded = (name: string) => RESP_EXCL_LC.some(ex => (name ?? "").trim().toLowerCase().includes(ex));

// ── KPI card ─────────────────────────────────────────────────────
function KpiCard({ label, value, sub, gradient, lightGradient, icon, active, onClick, info }: {
  label: string; value: string; sub?: string;
  gradient: string; lightGradient: string; icon: React.ReactNode;
  active?: boolean; onClick?: () => void;
  /** What the number counts — shown behind a "?" badge. */
  info?: React.ReactNode;
}) {
  const { theme } = useDarkMode();
  const isDark = theme === 'dark';
  return (
    <div onClick={onClick} title={onClick ? "Bosing — sdelkalar ro'yxati" : undefined} style={{
      borderRadius: 12, padding: "16px 18px", background: isDark ? gradient : lightGradient,
      border: active ? "1px solid #3b82f6" : isDark ? "1px solid transparent" : "1px solid var(--border)",
      boxShadow: active ? "0 0 0 2px rgba(59,130,246,0.25)" : "none",
      display: "flex", flexDirection: "column", gap: 6, minWidth: 0, cursor: onClick ? "pointer" : "default",
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <span style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0, fontSize: 11, color: isDark ? "rgba(255,255,255,.7)" : "var(--text3)", fontWeight: 500 }}>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
          {info && <InfoTip text={info} label={`${label} — izoh`} size={14} />}
        </span>
        <span style={{ opacity: .6, color: isDark ? "#fff" : "var(--text2)", flexShrink: 0 }}>{icon}</span>
      </div>
      <div style={{ fontSize: 24, fontWeight: 700, color: isDark ? "#fff" : "var(--text)", lineHeight: 1.2 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: isDark ? "rgba(255,255,255,.55)" : "var(--text3)" }}>{sub}</div>}
    </div>
  );
}

// ── Colored TH for analytics tables (LidlarPage style) ───────────
const THc = (color: string, minW = 120): React.CSSProperties => ({
  padding: "11px 14px", textAlign: "left", fontSize: 12, fontWeight: 700,
  color, textTransform: "uppercase", letterSpacing: "0.04em",
  background: "var(--bg2)", borderBottom: "1px solid var(--border)",
  whiteSpace: "nowrap", minWidth: minW,
});
const TDa: React.CSSProperties = {
  padding: "10px 14px", verticalAlign: "middle",
  borderBottom: "1px solid var(--border)",
};

// ── AvatarCircle ─────────────────────────────────────────────────
const AVATAR_COLORS = [
  "#2196F3", "#E91E63", "#9C27B0", "#00BCD4", "#FF9800",
  "#4CAF50", "#FF5722", "#3F51B5", "#009688", "#795548",
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
      width: size, height: size, borderRadius: "50%", background: bg, flexShrink: 0,
      display: "flex", alignItems: "center", justifyContent: "center",
      color: "#fff", fontSize: size * 0.36, fontWeight: 700, userSelect: "none",
    }}>{initials}</div>
  );
}

// ── MiniBar ───────────────────────────────────────────────────────
function MiniBar({ value, max, color, height = 3 }: { value: number; max: number; color: string; height?: number }) {
  const w = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div style={{ height, borderRadius: 2, background: "var(--bg4)", marginTop: 5, overflow: "hidden" }}>
      <div style={{ height: "100%", width: `${w}%`, background: color, borderRadius: 2, transition: "width 0.3s" }} />
    </div>
  );
}

// ── ConversionDonut ───────────────────────────────────────────────
function ConversionDonut({ pct, size = 38 }: { pct: number; size?: number }) {
  const sw = 3;
  const r = (size - sw * 2) / 2;
  const circ = 2 * Math.PI * r;
  const fill = circ - (Math.min(100, pct) / 100) * circ;
  if (pct <= 0) {
    return (
      <div style={{ width: size, height: size, position: "relative", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <svg width={size} height={size} style={{ position: "absolute" }}>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--border)" strokeWidth={sw} />
        </svg>
        <span style={{ fontSize: 10, color: "#555", zIndex: 1 }}>—</span>
      </div>
    );
  }
  const label = pct < 10 ? `${pct.toFixed(1)}%` : `${Math.round(pct)}%`;
  return (
    <div style={{ width: size, height: size, position: "relative", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <svg width={size} height={size} style={{ position: "absolute", transform: "rotate(-90deg)" }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--border)" strokeWidth={sw} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#4CAF50" strokeWidth={sw}
          strokeDasharray={circ} strokeDashoffset={fill} strokeLinecap="round" />
      </svg>
      <span style={{ fontSize: 9, color: "#4CAF50", fontWeight: 700, zIndex: 1 }}>{label}</span>
    </div>
  );
}

function RoleBadge({ role }: { role?: string | null }) {
  if (!role) return <span style={{ color: "var(--text3)", fontSize: 11 }}>—</span>;
  const r = role.toLowerCase();
  const isHunter = r.includes("hunter");
  const isCloser = r.includes("closer");
  const color = isHunter && isCloser ? "#9c27b0" : isHunter ? "#2196F3" : isCloser ? "#4caf50" : "#9E9E9E";
  return (
    <span style={{ fontSize: 11, fontWeight: 500, color, whiteSpace: "nowrap" }}>
      {role}
    </span>
  );
}

// ── MultiSelect for Sdelkalar ─────────────────────────────────────
function SdelkaMultiSelect({ label, options, values, onChange, loading }: {
  label: string;
  options: { value: string; label: string }[];
  values: string[];
  onChange: (v: string[]) => void;
  loading?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);

  const toggle = (v: string) => onChange(values.includes(v) ? values.filter(x => x !== v) : [...values, v]);

  const displayLabel = values.length === 0
    ? "Barchasi"
    : values.length === 1 ? (options.find(o => o.value === values[0])?.label ?? values[0]).slice(0, 20) : `${values.length} ta tanlangan`;

  return (
    <div ref={ref} style={{ flex: 1, minWidth: 140, position: "relative" }}>
      <div style={{ fontSize: 11, color: "var(--text3)", marginBottom: 4 }}>{label}</div>
      <button type="button" onClick={() => setOpen(o => !o)}
        style={{
          width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "7px 10px", fontSize: 12, background: "var(--bg3)",
          border: `1px solid ${values.length > 0 ? "rgba(59,130,246,0.5)" : "var(--border)"}`,
          color: values.length > 0 ? "#3b82f6" : "var(--text3)", borderRadius: 8, cursor: "pointer", boxSizing: "border-box",
        }}>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {loading ? "Yuklanmoqda…" : displayLabel}
        </span>
        <ChevronDown size={12} style={{ flexShrink: 0, marginLeft: 4, transform: open ? "rotate(180deg)" : "none" }} />
      </button>
      {open && (
        <div style={{ position: "absolute", top: "100%", left: 0, minWidth: "100%", zIndex: 500, background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 8, boxShadow: "0 4px 20px rgba(0,0,0,0.5)", maxHeight: 220, overflowY: "auto", marginTop: 4 }}>
          {values.length > 0 && (
            <div style={{ padding: "6px 12px", borderBottom: "1px solid var(--border)" }}>
              <button type="button" onClick={() => onChange([])} style={{ fontSize: 11, color: "#9E9E9E", background: "none", border: "none", cursor: "pointer", padding: 0 }}>Hammasini olib tashlash</button>
            </div>
          )}
          {options.map(o => {
            const checked = values.includes(o.value);
            return (
              <label key={o.value} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 12px", cursor: "pointer", background: checked ? "rgba(59,130,246,0.08)" : "transparent" }}>
                <input type="checkbox" checked={checked} onChange={() => toggle(o.value)} style={{ accentColor: "#3b82f6", flexShrink: 0 }} />
                <span style={{ fontSize: 12, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{o.label}</span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Segmented switch (pipeline) ──────────────────────────────────
function Segmented<T extends string>({ value, onChange, options }: {
  value: T; onChange: (v: T) => void;
  options: { value: T; label: string; color: string }[];
}) {
  return (
    <div style={{ display: "flex", background: "var(--bg3)", border: "1px solid var(--border)", borderRadius: 8, padding: 3, gap: 2 }}>
      {options.map(o => (
        <button key={o.value} type="button" onClick={() => onChange(o.value)}
          style={{
            border: "none", borderRadius: 6, fontSize: 11.5, fontWeight: 600, padding: "5px 12px", cursor: "pointer",
            background: value === o.value ? o.color : "transparent",
            color: value === o.value ? "#fff" : "var(--text2)", transition: "all 0.2s", whiteSpace: "nowrap",
          }}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ── Section card ─────────────────────────────────────────────────
function Section({ icon, title, sub, right, children }: {
  icon: React.ReactNode; title: string; sub?: string; right?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <div style={{ background: "var(--bg2)", borderRadius: 12, overflow: "hidden", marginBottom: 16, border: "1px solid var(--border)" }}>
      <div style={{ padding: "16px 20px 12px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        {icon}
        <span style={{ fontSize: 18, fontWeight: 700, color: "var(--text)" }}>{title}</span>
        {sub && <span style={{ fontSize: 12, color: "var(--text3)" }}>{sub}</span>}
        {right && <div style={{ marginLeft: "auto" }}>{right}</div>}
      </div>
      {children}
    </div>
  );
}

/** Hover feedback for clickable cells; inline styles cannot express :hover. */
const PAGE_CSS = `
  .sd-click { transition: box-shadow .12s, filter .12s; }
  .sd-click:hover { box-shadow: inset 0 0 0 1.5px rgba(99,102,241,.55); filter: brightness(1.08); }
  .sd-row:hover > td { background-image: linear-gradient(rgba(99,102,241,.05), rgba(99,102,241,.05)); }
`;

const Loading = () => <div style={{ padding: 24, color: "#666", fontSize: 13 }}>Yuklanmoqda…</div>;
const Empty = () => <div style={{ padding: 24, color: "var(--text3)", fontSize: 13 }}>Ma'lumot yo'q</div>;

// ── Clickable count cell ─────────────────────────────────────────
function CountCell({ value, max, color, active, onClick, total }: {
  value: number; max: number; color: string; active?: boolean; onClick?: () => void; total?: boolean;
}) {
  const clickable = value > 0 && !!onClick;
  return (
    <td
      onClick={clickable ? (e) => { e.stopPropagation(); onClick!(); } : undefined}
      title={clickable ? "Bosing — sdelkalar ro'yxati" : undefined}
      className={clickable ? "sd-click" : undefined}
      style={{ ...TDa, minWidth: 96, cursor: clickable ? "pointer" : "default", background: active ? `${color}1f` : undefined }}>
      {value > 0 ? (
        <>
          <span style={{ fontSize: total ? 16 : 14, fontWeight: total ? 700 : 600, color: active ? color : "var(--text)" }}>
            {fmtNum(value)}
          </span>
          <MiniBar value={value} max={max} color={color} />
        </>
      ) : (
        <span style={{ fontSize: 13, color: "var(--text3)" }}>—</span>
      )}
    </td>
  );
}

// ── Heat-map cell for the manager × stage matrix ─────────────────
/** Tint scales with value / column max, so busy stages read at a glance. */
function HeatCell({ value, max, color, active, onClick, strong }: {
  value: number; max: number; color: string; active?: boolean; onClick?: () => void; strong?: boolean;
}) {
  const clickable = value > 0 && !!onClick;
  const ratio = max > 0 ? value / max : 0;
  // Faint floor so every non-zero cell is visible; the ceiling stays low enough
  // that a full column never reads as a solid block, in either theme.
  const alpha = value > 0 ? Math.round((0.05 + ratio * 0.27) * 255).toString(16).padStart(2, "0") : "00";
  return (
    <td
      onClick={clickable ? (e) => { e.stopPropagation(); onClick!(); } : undefined}
      title={clickable ? "Bosing — sdelkalar ro'yxati" : undefined}
      className={clickable ? "sd-click" : undefined}
      style={{
        padding: "9px 6px", textAlign: "center", borderBottom: "1px solid var(--border)",
        cursor: clickable ? "pointer" : "default",
        background: value > 0 ? `${color}${alpha}` : undefined,
        boxShadow: active ? `inset 0 0 0 2px ${color}` : undefined,
      }}>
      {value > 0
        ? <span style={{ fontSize: strong ? 15 : 13.5, fontWeight: strong || ratio > 0.6 ? 700 : 600, color: "var(--text)" }}>{fmtNum(value)}</span>
        : <span style={{ color: "var(--text3)", opacity: 0.45 }}>·</span>}
    </td>
  );
}

const KIND_GROUPS: { kind: PipelineStage["kind"]; label: string; color: string }[] = [
  { kind: "process", label: "Jarayonda", color: "#3b82f6" },
  { kind: "won",     label: "Yutildi",   color: "#4CAF50" },
  { kind: "lost",    label: "Yo'qotildi", color: "#F44336" },
];

// ── Deals drill-down (shared by every table) ─────────────────────
const DRILL_PAGE = 100;

function DealsDrilldown({ filter, colSpan, title, showReason, onClose }: {
  filter: PipelineDealsFilter; colSpan: number; title: string; showReason: boolean; onClose: () => void;
}) {
  // Учебный центр carries both Причина and Стадия (для отчетов); showReason gates the pair.
  const portal = useBitrixPortal();
  const q = useInfiniteQuery({
    queryKey: ["pipeline-deals", filter],
    queryFn: ({ pageParam }) => getPipelineDeals({ ...filter, limit: DRILL_PAGE, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (last) => {
      const next = last.offset + last.items.length;
      return next < last.total ? next : undefined;
    },
    staleTime: 60_000,
  });
  // Offset paging over a live window can repeat a deal if one arrives between pages.
  const items = useMemo(() => [...new Map((q.data?.pages ?? []).flatMap(p => p.items).map(d => [d.id, d])).values()], [q.data]);
  const total = q.data?.pages[0]?.total ?? 0;
  const cols = ["ID", "Sdelka", "Mas'ul", "Bosqich", ...(showReason ? ["Стадия (отчет)"] : []), "Manba", ...(showReason ? ["Причина"] : []), "Yaratildi", "O'zgardi"];

  return (
    <td colSpan={colSpan} style={{ padding: 0, background: "var(--bg)", borderBottom: "1px solid var(--border)" }}>
      <div style={{ position: "sticky", left: 0, maxWidth: "calc(100vw - 320px)", padding: "10px 14px 12px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
          <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text)" }}>{title}</span>
          <span style={{ fontSize: 12, color: "var(--text3)" }}>
            {q.isLoading ? "Yuklanmoqda…" : `${fmtNum(total)} ta sdelka${items.length < total ? ` · ${fmtNum(items.length)} tasi ko'rsatilgan` : ""}`}
          </span>
          <button type="button" onClick={onClose}
            style={{ marginLeft: "auto", background: "none", border: "1px solid var(--border)", borderRadius: 6, color: "var(--text3)", fontSize: 11, padding: "3px 10px", cursor: "pointer" }}>
            Yopish
          </button>
        </div>
        {q.isError ? (
          <div style={{ fontSize: 12, color: "#ef4444" }}>Xatolik: {(q.error as Error).message}</div>
        ) : !q.isLoading && items.length === 0 ? (
          <div style={{ fontSize: 12, color: "var(--text3)", fontStyle: "italic" }}>Sdelkalar topilmadi</div>
        ) : (
          <div style={{ maxHeight: 360, overflow: "auto", border: "1px solid var(--border)", borderRadius: 8 }}>
            <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "var(--bg3)", position: "sticky", top: 0, zIndex: 1 }}>
                  {cols.map(h => (
                    <th key={h} style={{ padding: "6px 10px", textAlign: "left", fontWeight: 600, color: "var(--text3)", fontSize: 11, borderBottom: "1px solid var(--border)", whiteSpace: "nowrap" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.map((d, i) => {
                  const kc = d.stage_kind === "won" ? "#4CAF50" : d.stage_kind === "lost" ? "#F44336" : "#2196F3";
                  return (
                    <tr key={d.id} style={{ background: i % 2 === 0 ? "transparent" : "var(--bg2)" }}>
                      <td style={{ padding: "5px 10px", whiteSpace: "nowrap" }}>
                        <a href={`${portal}/crm/deal/details/${d.id}/`} target="_blank" rel="noreferrer"
                          style={{ color: "#2196F3", fontWeight: 600, textDecoration: "none" }}>#{d.id}</a>
                      </td>
                      <td style={{ padding: "5px 10px", color: "var(--text)", maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={d.title ?? undefined}>
                        {d.title || d.phone || "—"}
                      </td>
                      <td style={{ padding: "5px 10px", color: "var(--text2)", whiteSpace: "nowrap" }}>{d.responsible || "—"}</td>
                      <td style={{ padding: "5px 10px", whiteSpace: "nowrap" }}>
                        <span style={{ fontSize: 11, padding: "2px 7px", borderRadius: 10, background: `${kc}22`, color: kc, fontWeight: 600 }}>{d.stage_name}</span>
                      </td>
                      {showReason && <td style={{ padding: "5px 10px", color: "var(--text2)", whiteSpace: "nowrap" }}>{d.report_stage || "—"}</td>}
                      <td style={{ padding: "5px 10px", color: "var(--text3)", whiteSpace: "nowrap" }}>{d.source_name}</td>
                      {showReason && <td style={{ padding: "5px 10px", color: "var(--text2)", whiteSpace: "nowrap" }}>{d.reason || "—"}</td>}
                      <td style={{ padding: "5px 10px", color: "var(--text3)", whiteSpace: "nowrap" }}>{fmtDateTime(d.date_create)}</td>
                      <td style={{ padding: "5px 10px", color: "var(--text3)", whiteSpace: "nowrap" }}>{fmtDateTime(d.date_modify)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {q.hasNextPage && (
          <button type="button" onClick={() => q.fetchNextPage()} disabled={q.isFetchingNextPage}
            style={{ marginTop: 8, background: "var(--bg3)", border: "1px solid var(--border)", borderRadius: 6, color: "#3b82f6", fontSize: 12, fontWeight: 600, padding: "5px 14px", cursor: "pointer" }}>
            {q.isFetchingNextPage ? "Yuklanmoqda…" : `Yana ${fmtNum(Math.min(DRILL_PAGE, total - items.length))} ta yuklash`}
          </button>
        )}
      </div>
    </td>
  );
}

/** Which table cell's deals are open. Only one drill-down is open at a time. */
type Drill = { table: string; row: string; col: string; title: string; filter: Partial<PipelineDealsFilter> };

/** Manager row with the ids to filter its deals by (several for the folded row). */
type MgrRow = PipelineManagerRow & { key: string; ids: string; members?: string[] };

// ── Page ─────────────────────────────────────────────────────────
export default function SdelkalarPage() {
  const [filterOpen, setFilterOpen] = useState(false);
  // Always opens on Учебный центр.
  const [pipeline, setPipeline] = useState<PipelineKey>("uc");
  const [reasonScope, setReasonScope] = useState<ReasonScope>("lost");
  const [hideEmptyStages, setHideEmptyStages] = useState(false);
  const [drill, setDrill] = useState<Drill | null>(null);

  const [filter, setFilter] = useState({
    from: startOfMonthISO(), to: todayISO(),
    responsible_ids: [] as string[],
    stage_ids: [] as string[],
    sources: [] as string[],
    report_stages: [] as string[],
  });

  const filterQ = useQuery({
    queryKey: ["deal-filter-options"],
    queryFn: () => getDealFilterOptions(),
    staleTime: 5 * 60_000,
  });

  // Always all deals (no Bitrix24/AmoCRM split): only the date window narrows them.
  const apiFrom = filter.from || undefined;
  const apiTo   = filter.to   || undefined;

  const base: PipelineFilter = useMemo(() => ({
    pipeline, from: apiFrom, to: apiTo,
    responsible_id: filter.responsible_ids.join(',') || undefined,
    source: filter.sources.join(',') || undefined,
    stage: filter.stage_ids.join(',') || undefined,
    report_stage: pipeline === "uc" && filter.report_stages.length ? JSON.stringify(filter.report_stages) : undefined,
  }), [pipeline, apiFrom, apiTo, filter.responsible_ids, filter.sources, filter.stage_ids, filter.report_stages]);

  // Keep the last result on screen while a filter changes, but never across a
  // pipeline switch: the old pipeline's numbers would sit under the new labels.
  const samePipeline = <T,>(prev: T | undefined, key: readonly unknown[] | undefined) =>
    (key?.[1] as PipelineFilter | undefined)?.pipeline === pipeline ? prev : undefined;
  const kpiQ = useQuery({ queryKey: ["pipeline-kpi", base], queryFn: () => getPipelineKpi(base), placeholderData: (p, q) => samePipeline(p, q?.queryKey) });
  const managersQ = useQuery({ queryKey: ["pipeline-managers", base], queryFn: () => getPipelineManagers(base), placeholderData: (p, q) => samePipeline(p, q?.queryKey) });
  const sourcesQ = useQuery({ queryKey: ["pipeline-sources", base], queryFn: () => getPipelineSources(base), placeholderData: (p, q) => samePipeline(p, q?.queryKey) });
  const reasonsQ = useQuery({
    queryKey: ["pipeline-reasons", base, reasonScope],
    queryFn: () => getPipelineReasons({ ...base, scope: reasonScope }),
    placeholderData: (p, q) => (q?.queryKey[2] === reasonScope ? samePipeline(p, q?.queryKey) : undefined),
  });

  const reportStagesQ = useQuery({
    queryKey: ["pipeline-report-stages", pipeline, apiFrom, apiTo],
    queryFn: () => getPipelineReportStages({ pipeline, from: apiFrom, to: apiTo }),
    enabled: pipeline === "uc",
    staleTime: 60_000,
  });

  const clearFilter = useCallback(() => {
    setFilter({ from: startOfMonthISO(), to: todayISO(), responsible_ids: [], stage_ids: [], sources: [], report_stages: [] });
    setDrill(null);
  }, []);

  const switchPipeline = (p: PipelineKey) => {
    if (p === pipeline) return;
    setPipeline(p);
    // Stage ids and Стадия (для отчетов) are per pipeline; other filters carry over.
    setFilter(s => ({ ...s, stage_ids: [], report_stages: [] }));
    setDrill(null);
  };

  const kpi = kpiQ.data;
  const stages = useMemo(() => kpi?.stages ?? [], [kpi]);
  const stageById = useMemo(() => Object.fromEntries(stages.map(s => [s.id, s])), [stages]);
  const wonStage = stages.find(s => s.kind === "won");
  const lostStages = stages.filter(s => s.kind === "lost");
  const wonLabel = wonStage?.name ?? "Sotuv";
  const lostLabel = lostStages.map(s => s.name).join(" + ") || "Bekor";
  const showReason = pipeline === "uc";
  const pipelineLabel = PIPELINES.find(p => p.key === pipeline)!.label;

  const periodLabel = `${filter.from || "boshidan"} → ${filter.to || "bugungacha"}`;

  const activeFilterCount = [
    filter.responsible_ids.length > 0,
    filter.stage_ids.length > 0,
    filter.sources.length > 0,
    filter.report_stages.length > 0,
    filter.from !== startOfMonthISO() || filter.to !== todayISO(),
  ].filter(Boolean).length;

  const respOptions = useMemo(() => (filterQ.data?.responsibles ?? [])
    .filter(r => !isRespExcluded(r.full_name ?? ""))
    .map(r => ({ value: String(r.id), label: r.full_name })), [filterQ.data]);
  const stageOptions = useMemo(() => stages.map(s => ({ value: s.id, label: s.name })), [stages]);
  const srcOptions = useMemo(() => (filterQ.data?.sources ?? []).map(s => ({ value: s.id, label: s.name })), [filterQ.data]);
  const reportStageOptions = useMemo(() => {
    const d = reportStagesQ.data;
    const opts = d?.available ? d.items.map(i => ({ value: i.value, label: `${i.label} (${fmtNum(i.total)})` })) : [];
    // Keep picked values selectable even when the date window no longer contains them.
    for (const v of filter.report_stages) if (!opts.some(o => o.value === v)) opts.push({ value: v, label: v === NONE_KEY ? "Ko'rsatilmagan" : v });
    return opts;
  }, [reportStagesQ.data, filter.report_stages]);

  const PRESETS = [
    { label: "Bugun", f: todayISO(), t: todayISO() },
    { label: "7 kun", f: daysAgoISO(7), t: todayISO() },
    { label: "30 kun", f: daysAgoISO(30), t: todayISO() },
    { label: "90 kun", f: daysAgoISO(90), t: todayISO() },
    // No lower bound: the same scope as the Bitrix kanban.
    { label: "Barchasi", f: "", t: todayISO() },
  ];

  // ── Drill-down plumbing ──────────────────────────────────────────
  const isOpen = (table: string, row: string, col: string) =>
    drill?.table === table && drill.row === row && drill.col === col;
  const rowOpen = (table: string, row: string) => drill?.table === table && drill.row === row;
  const toggle = (d: Drill) => setDrill(cur =>
    cur && cur.table === d.table && cur.row === d.row && cur.col === d.col ? null : d);
  const drillCell = (colSpan: number) => drill && (
    <DealsDrilldown
      filter={{ ...base, ...drill.filter } as PipelineDealsFilter}
      colSpan={colSpan}
      title={drill.title}
      showReason={showReason}
      onClose={() => setDrill(null)}
    />
  );

  // ── Managers (shared by the stage matrix and Sdelka va Konversiya) ──
  const mgrRows: MgrRow[] = useMemo(() => {
    const rows = managersQ.data?.managers ?? [];
    const people: MgrRow[] = [];
    const folded: PipelineManagerRow[] = [];
    for (const m of rows) {
      if (isRespExcluded(m.full_name)) folded.push(m);
      else people.push({ ...m, key: String(m.responsible_id ?? "none"), ids: m.responsible_id != null ? String(m.responsible_id) : "" });
    }
    if (folded.length) {
      const by_stage: Record<string, number> = {};
      for (const m of folded) for (const [k, v] of Object.entries(m.by_stage)) by_stage[k] = (by_stage[k] ?? 0) + v;
      const sum = (f: "total" | "in_process" | "won" | "lost") => folded.reduce((a, m) => a + m[f], 0);
      people.push({
        responsible_id: null, full_name: "Tizim / admin hisoblari", work_position: null, by_stage,
        total: sum("total"), in_process: sum("in_process"), won: sum("won"), lost: sum("lost"),
        key: "__system__", ids: folded.filter(m => m.responsible_id != null).map(m => m.responsible_id).join(","),
        members: folded.map(m => m.full_name),
      });
    }
    return people;
  }, [managersQ.data]);
  const allMatrixStages = managersQ.data?.stages ?? stages;
  const peopleCount = mgrRows.filter(r => r.key !== "__system__").length;

  const colTotal = useMemo(() => {
    const t: Record<string, number> = { total: 0, in_process: 0, won: 0, lost: 0 };
    for (const r of mgrRows) {
      t.total += r.total; t.in_process += r.in_process; t.won += r.won; t.lost += r.lost;
      for (const [k, v] of Object.entries(r.by_stage)) t[`s:${k}`] = (t[`s:${k}`] ?? 0) + v;
    }
    return t;
  }, [mgrRows]);
  // Columns grouped as the funnel reads: in progress → won → lost.
  const matrixStages = useMemo(() => KIND_GROUPS.flatMap(g =>
    allMatrixStages.filter(s => s.kind === g.kind && (!hideEmptyStages || (colTotal[`s:${s.id}`] ?? 0) > 0))),
  [allMatrixStages, hideEmptyStages, colTotal]);
  const matrixGroups = KIND_GROUPS.map(g => ({ ...g, span: matrixStages.filter(s => s.kind === g.kind).length })).filter(g => g.span > 0);
  const emptyStageCount = allMatrixStages.filter(s => (colTotal[`s:${s.id}`] ?? 0) === 0).length;

  const colMax = useMemo(() => {
    const m: Record<string, number> = { total: 1, in_process: 1, won: 1, lost: 1 };
    for (const r of mgrRows) {
      m.total = Math.max(m.total, r.total); m.in_process = Math.max(m.in_process, r.in_process);
      m.won = Math.max(m.won, r.won); m.lost = Math.max(m.lost, r.lost);
      for (const [k, v] of Object.entries(r.by_stage)) m[`s:${k}`] = Math.max(m[`s:${k}`] ?? 1, v);
    }
    return m;
  }, [mgrRows]);

  /** Name cell for a manager row (avatar + name + chevron), shared by both tables. */
  const managerCell = (r: MgrRow, open: boolean, stickyBg?: string) => (
    <td style={{ ...TDa, ...(stickyBg ? { position: "sticky", left: 44, background: stickyBg, zIndex: 2 } : {}) }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
        <AvatarCircle name={r.full_name || "?"} size={32} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13, color: open ? "#2196F3" : "var(--text)", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {r.full_name}
          </div>
          {r.members && (
            <div style={{ fontSize: 10.5, color: "var(--text3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.members.join(", ")}>
              {r.members.join(", ")}
            </div>
          )}
        </div>
        {r.ids && <ChevronDown size={12} style={{ color: "var(--text3)", marginLeft: "auto", transform: open ? "rotate(180deg)" : "none", transition: "transform .2s", flexShrink: 0 }} />}
      </div>
    </td>
  );

  // ── Sources / reasons ────────────────────────────────────────────
  const srcRows = sourcesQ.data?.sources ?? [];
  const srcTotal = srcRows.reduce((a, r) => ({ total: a.total + r.total, in_process: a.in_process + r.in_process, won: a.won + r.won, lost: a.lost + r.lost }), { total: 0, in_process: 0, won: 0, lost: 0 });
  const srcMax = {
    total: Math.max(1, ...srcRows.map(r => r.total)), in_process: Math.max(1, ...srcRows.map(r => r.in_process)),
    won: Math.max(1, ...srcRows.map(r => r.won)), lost: Math.max(1, ...srcRows.map(r => r.lost)),
  };
  const reasons = reasonsQ.data;
  const reasonItems = reasons?.available ? reasons.items : [];
  const reasonTotal = reasonItems.reduce((a, r) => a + r.total, 0);
  const reasonMax = Math.max(1, ...reasonItems.map(r => r.total));

  // ── KPI cards ────────────────────────────────────────────────────
  const cards = [
    { id: "total", label: "Jami Sdelkalar", value: kpi?.total ?? 0, sub: `${pipelineLabel} · barcha bosqichlar`,
      gradient: "linear-gradient(135deg,#0d1b4a,#1a3a7a)", lightGradient: "linear-gradient(135deg,rgba(33,150,243,0.07),rgba(59,130,246,0.12))",
      icon: <BarChart2 size={16} />, drill: {},
      info: <>Tanlangan davrda <b>yaratilgan</b> va «{pipelineLabel}» voronkasidagi barcha sdelkalar — hozirgi bosqichidan qat'i nazar. Bitrix kanbani esa barcha vaqtni ko'rsatadi.</> },
    { id: "process", label: "Yangi Sdelkalar", value: kpi?.in_process ?? 0, sub: "Jarayonda · yutilgan va yo'qotilganlarsiz",
      gradient: "linear-gradient(135deg,#1d4ed8,#3b82f6)", lightGradient: "linear-gradient(135deg,rgba(59,130,246,0.07),rgba(99,157,246,0.12))",
      icon: <TrendingUp size={16} />, drill: { kind: "process" as const },
      info: <>Hali yakunlanmagan sdelkalar: «{wonLabel}» (yutilgan) va «{lostLabel}» (yo'qotilgan) bosqichlaridan tashqari barcha bosqichlardagilar.</> },
    ...STAGE_CARDS[pipeline].map((id, i) => {
      const st = stageById[id];
      return {
        id, label: st?.name ?? id, value: kpi?.by_stage[id] ?? 0,
        sub: kpi && kpi.total > 0 ? `Jamidan ${pct(kpi.by_stage[id] ?? 0, kpi.total).toFixed(1)}%` : "Bitrix bosqichi",
        ...CARD_STYLES[i % CARD_STYLES.length], drill: { stage: id },
        info: <>Hozir Bitrix'dagi «{st?.name ?? id}» bosqichida turgan sdelkalar (shu davrda yaratilganlar orasidan). Foiz — Jami sdelkalarga nisbatan.</>,
      };
    }),
  ];

  const anyError = kpiQ.error ?? managersQ.error ?? sourcesQ.error ?? reasonsQ.error;

  return (
    <>
      <Topbar
        title="Sdelkalar"
        sub={`${pipelineLabel} · ${periodLabel}`}
        actions={
          <div style={{ display: "flex", alignItems: "center" }}>
            <Segmented
              value={pipeline}
              onChange={switchPipeline}
              options={PIPELINES.map(p => ({ value: p.key, label: p.label, color: "#6366f1" }))}
            />
          </div>
        }
      />

      <div style={{ flex: 1, overflowY: "auto", padding: "18px 22px", background: "var(--bg)" }}>
        <style>{PAGE_CSS}</style>

        {/* ── Filter panel ── */}
        <div style={{
          background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 10,
          marginBottom: 16, overflow: filterOpen ? "visible" : "hidden",
          position: "sticky", top: 0, zIndex: 10,
        }}>
          <div
            style={{ padding: "10px 16px", display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}
            onClick={() => setFilterOpen(o => !o)}
          >
            <Search size={14} style={{ color: "var(--text3)" }} />
            <span style={{ fontSize: 12.5, color: "var(--text3)", flex: 1 }}>
              {`Filtr: ${periodLabel}${activeFilterCount > 0 ? ` · ${activeFilterCount} ta qo'shimcha` : ""}`}
            </span>
            <span style={{ background: "rgba(99,102,241,0.15)", color: "#6366f1", border: "1px solid rgba(99,102,241,0.4)", borderRadius: 10, padding: "1px 8px", fontSize: 11, fontWeight: 700 }}>{pipelineLabel}</span>
            {activeFilterCount > 0 && (
              <span style={{ fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 20, background: "#3b82f6", color: "#fff" }}>{activeFilterCount} filtr</span>
            )}
            <ChevronDown size={14} style={{ color: "var(--text3)", transform: filterOpen ? "rotate(180deg)" : "none", transition: "transform .2s" }} />
          </div>

          {filterOpen && (
            <div style={{ borderTop: "1px solid var(--border)", padding: "16px 20px" }}>
              {/* Quick date presets */}
              <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
                {PRESETS.map(p => {
                  const active = filter.from === p.f && filter.to === p.t;
                  return (
                    <button key={p.label} onClick={() => setFilter(s => ({ ...s, from: p.f, to: p.t }))}
                      style={{
                        padding: "5px 14px", borderRadius: 20, fontSize: 12, cursor: "pointer",
                        background: active ? "#3b82f6" : "var(--bg3)",
                        border: `1px solid ${active ? "#3b82f6" : "var(--border)"}`,
                        color: active ? "#fff" : "var(--text2)", fontWeight: active ? 600 : 400,
                      }}>
                      {p.label}
                    </button>
                  );
                })}
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
                <div>
                  <div style={{ fontSize: 11, color: "var(--text3)", marginBottom: 4 }}>Dan (boshlanish)</div>
                  <input type="date" value={filter.from}
                    onChange={e => setFilter(s => ({ ...s, from: e.target.value }))}
                    style={{ width: "100%", padding: "8px 10px", fontSize: 12, background: "var(--bg3)", border: "1px solid var(--border)", color: "var(--text)", borderRadius: 8 }} />
                </div>
                <div>
                  <div style={{ fontSize: 11, color: "var(--text3)", marginBottom: 4 }}>Gacha (tugash)</div>
                  <input type="date" value={filter.to}
                    onChange={e => setFilter(s => ({ ...s, to: e.target.value }))}
                    style={{ width: "100%", padding: "8px 10px", fontSize: 12, background: "var(--bg3)", border: "1px solid var(--border)", color: "var(--text)", borderRadius: 8 }} />
                </div>
              </div>

              <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
                <SdelkaMultiSelect label="Mas'ul xodim" options={respOptions} values={filter.responsible_ids}
                  onChange={v => setFilter(s => ({ ...s, responsible_ids: v }))} loading={filterQ.isLoading} />
                <SdelkaMultiSelect label="Bosqich" options={stageOptions} values={filter.stage_ids}
                  onChange={v => setFilter(s => ({ ...s, stage_ids: v }))} loading={kpiQ.isLoading} />
                <SdelkaMultiSelect label="Manba (Источник)" options={srcOptions} values={filter.sources}
                  onChange={v => setFilter(s => ({ ...s, sources: v }))} loading={filterQ.isLoading} />
                {pipeline === "uc" && (
                  <SdelkaMultiSelect label="Стадия (для отчетов)" options={reportStageOptions} values={filter.report_stages}
                    onChange={v => setFilter(s => ({ ...s, report_stages: v }))} loading={reportStagesQ.isLoading} />
                )}
              </div>

              {activeFilterCount > 0 && (
                <div style={{ paddingTop: 10, borderTop: "1px solid var(--border)", display: "flex", justifyContent: "flex-end" }}>
                  <button onClick={clearFilter} style={{ background: "none", border: "none", color: "#9E9E9E", fontSize: 12, cursor: "pointer", padding: "6px 10px" }}>Tozalash</button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* What every number on the page counts — the usual source of "Bitrix shows more". */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "var(--text3)", margin: "-4px 2px 10px" }}>
          <Info size={12} style={{ flexShrink: 0 }} />
          <span>
            Ko'rsatkichlar: <b style={{ color: "var(--text2)" }}>{periodLabel}</b> oralig'ida <b style={{ color: "var(--text2)" }}>yaratilgan</b> sdelkalar,
            hozirgi bosqichi bo'yicha. Bitrix kanbanida esa barcha vaqtdagi sdelkalar ko'rinadi — solishtirish uchun «Barchasi»ni tanlang.
          </span>
        </div>
        {/* ── KPI Cards (click → deals) ── */}
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${cards.length}, minmax(0, 1fr))`, gap: 12, marginBottom: 12 }}>
          {cards.map(c => (
            <KpiCard key={c.id} label={c.label} value={fmtNum(c.value)} sub={c.sub} info={c.info}
              gradient={c.gradient} lightGradient={c.lightGradient} icon={c.icon}
              active={isOpen("kpi", "cards", c.id)}
              // Only with deals behind it: the card's stage replaces the Bosqich filter in the
              // drill, so a 0 card (stage outside that filter) would list unrelated deals.
              onClick={c.value > 0 ? () => toggle({ table: "kpi", row: "cards", col: c.id, title: `${pipelineLabel} · ${c.label}`, filter: c.drill }) : undefined} />
          ))}
        </div>
        {rowOpen("kpi", "cards") && (
          <div style={{ background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden", marginBottom: 16 }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}><tbody><tr>{drillCell(1)}</tr></tbody></table>
          </div>
        )}
        <div style={{ marginBottom: 16 }} />

        {/* ══════════════════════════════════════════════════════════
            Menejerlar × bosqichlar (live Bitrix stages)
        ══════════════════════════════════════════════════════════ */}
        <Section
          icon={<Layers size={16} style={{ color: "#6366f1" }} />}
          title="Bosqichlar bo'yicha menejerlar"
          sub={`${pipelineLabel} · ${peopleCount} ta menejer · ${matrixStages.length} ta bosqich · raqamni bosing — sdelkalar`}
          right={emptyStageCount > 0 ? (
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text2)", cursor: "pointer", userSelect: "none" }}>
              <input type="checkbox" checked={hideEmptyStages} onChange={e => setHideEmptyStages(e.target.checked)} style={{ accentColor: "#6366f1" }} />
              Bo'sh bosqichlarni yashirish ({emptyStageCount})
            </label>
          ) : undefined}>
          {managersQ.isLoading ? <Loading /> : mgrRows.length === 0 ? <Empty /> : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed", minWidth: 254 + 84 + matrixStages.length * 92 }}>
                <colgroup>
                  <col style={{ width: 44 }} />
                  <col style={{ width: 210 }} />
                  <col style={{ width: 84 }} />
                  {matrixStages.map(s => <col key={s.id} />)}
                </colgroup>
                <thead>
                  <tr>
                    <th rowSpan={2} style={{ ...THc("#555", 44), position: "sticky", left: 0, zIndex: 3, verticalAlign: "bottom" }}>#</th>
                    <th rowSpan={2} style={{ ...THc("#9E9E9E", 210), position: "sticky", left: 44, zIndex: 3, verticalAlign: "bottom" }}>Menejer</th>
                    <th rowSpan={2} style={{ ...THc("#2196F3", 84), textAlign: "center", verticalAlign: "bottom" }}>Jami</th>
                    {matrixGroups.map(g => (
                      <th key={g.kind} colSpan={g.span} style={{
                        padding: "8px 6px 6px", fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase",
                        color: g.color, textAlign: "center", background: "var(--bg2)",
                        borderBottom: `2px solid ${g.color}`, borderLeft: "1px solid var(--border)",
                      }}>
                        {g.label}
                      </th>
                    ))}
                  </tr>
                  <tr>
                    {matrixStages.map((s, i) => (
                      <th key={s.id} title={`${s.name} · ${s.id}`} style={{
                        padding: "8px 6px", fontSize: 11.5, fontWeight: 600, lineHeight: 1.25, color: "var(--text2)",
                        textAlign: "center", verticalAlign: "bottom", whiteSpace: "normal", wordBreak: "break-word",
                        background: "var(--bg2)", borderBottom: "1px solid var(--border)",
                        borderLeft: i > 0 && s.kind !== matrixStages[i - 1].kind ? "1px solid var(--border)" : undefined,
                      }}>
                        <span style={{ display: "inline-block", width: 7, height: 7, borderRadius: "50%", background: stageColor(s, i), marginRight: 5, verticalAlign: "middle" }} />
                        {s.name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {mgrRows.map((r, i) => {
                    const open = rowOpen("matrix", r.key);
                    // Frozen cells need an opaque background, so they repeat the stripe/highlight on top of it.
                    const base = i % 2 === 0 ? "var(--bg2)" : "var(--bg)";
                    const bg = open ? `linear-gradient(rgba(99,102,241,0.08), rgba(99,102,241,0.08)), ${base}` : base;
                    const drillFor = (col: string, title: string, f: Partial<PipelineDealsFilter>) =>
                      r.ids ? () => toggle({ table: "matrix", row: r.key, col, title: `${r.full_name} · ${title}`, filter: { responsible_id: r.ids, ...f } }) : undefined;
                    return (
                      <Fragment key={r.key}>
                        <tr className="sd-row" style={{ background: bg, cursor: r.ids ? "pointer" : "default" }}
                          onClick={drillFor("all", "barcha sdelkalar", {})}>
                          <td style={{ ...TDa, color: "var(--text3)", fontSize: 13, fontWeight: 600, position: "sticky", left: 0, background: bg, zIndex: 2 }}>
                            {String(i + 1).padStart(2, "0")}
                          </td>
                          {managerCell(r, open, bg)}
                          <HeatCell strong value={r.total} max={colMax.total} color="#2196F3" active={isOpen("matrix", r.key, "all")}
                            onClick={drillFor("all", "barcha sdelkalar", {})} />
                          {matrixStages.map((s, si) => (
                            <HeatCell key={s.id} value={r.by_stage[s.id] ?? 0} max={colMax[`s:${s.id}`] ?? 1} color={stageColor(s, si)}
                              active={isOpen("matrix", r.key, s.id)} onClick={drillFor(s.id, s.name, { stage: s.id })} />
                          ))}
                        </tr>
                        {open && <tr>{drillCell(3 + matrixStages.length)}</tr>}
                      </Fragment>
                    );
                  })}
                  <tr style={{ background: "var(--bg3)" }}>
                    <td style={{ ...TDa, position: "sticky", left: 0, background: "var(--bg3)", zIndex: 2 }} />
                    <td style={{ ...TDa, fontSize: 13, fontWeight: 700, color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.06em", position: "sticky", left: 44, background: "var(--bg3)", zIndex: 2 }}>JAMI</td>
                    <HeatCell strong value={colTotal.total} max={0} color="#2196F3" active={isOpen("matrix", "__total__", "all")}
                      onClick={() => toggle({ table: "matrix", row: "__total__", col: "all", title: `${pipelineLabel} · barcha sdelkalar`, filter: {} })} />
                    {matrixStages.map((s, si) => (
                      <HeatCell key={s.id} strong value={colTotal[`s:${s.id}`] ?? 0} max={0} color={stageColor(s, si)}
                        active={isOpen("matrix", "__total__", s.id)}
                        onClick={() => toggle({ table: "matrix", row: "__total__", col: s.id, title: `${pipelineLabel} · ${s.name}`, filter: { stage: s.id } })} />
                    ))}
                  </tr>
                  {rowOpen("matrix", "__total__") && <tr>{drillCell(3 + matrixStages.length)}</tr>}
                </tbody>
              </table>
            </div>
          )}
        </Section>

        {/* ══════════════════════════════════════════════════════════
            Sdelka va Konversiya
        ══════════════════════════════════════════════════════════ */}
        <Section
          icon={<CheckCircle size={16} style={{ color: "#4CAF50" }} />}
          title="Sdelka va Konversiya"
          sub={`${peopleCount} ta menejer · konversiya = ${wonLabel} / Jami`}>
          {managersQ.isLoading ? <Loading /> : mgrRows.length === 0 ? <Empty /> : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={THc("#555", 44)}>#</th>
                    <th style={THc("#9E9E9E", 210)}>Menejer</th>
                    <th style={THc("#9E9E9E", 100)}>Rol</th>
                    <th style={THc("#2196F3")}>Jami Sdelka</th>
                    <th style={THc("#FF9800")}>Jarayonda</th>
                    <th style={{ ...THc("#4CAF50"), textTransform: "none" }}>{wonLabel}</th>
                    <th style={{ ...THc("#F44336"), textTransform: "none" }}>{lostLabel}</th>
                    <th style={{ ...THc("#4CAF50", 84), textAlign: "center" }}>Konversiya</th>
                  </tr>
                </thead>
                <tbody>
                  {mgrRows.map((r, i) => {
                    const open = rowOpen("conv", r.key);
                    const bg = open ? "var(--bg3)" : i % 2 === 0 ? "transparent" : "var(--bg)";
                    const drillFor = (col: string, title: string, f: Partial<PipelineDealsFilter>) =>
                      r.ids ? () => toggle({ table: "conv", row: r.key, col, title: `${r.full_name} · ${title}`, filter: { responsible_id: r.ids, ...f } }) : undefined;
                    return (
                      <Fragment key={r.key}>
                        <tr className="sd-row" style={{ background: bg, cursor: r.ids ? "pointer" : "default" }} onClick={drillFor("all", "barcha sdelkalar", {})}>
                          <td style={{ ...TDa, color: "#555", fontSize: 13, fontWeight: 600 }}>{String(i + 1).padStart(2, "0")}</td>
                          {managerCell(r, open)}
                          <td style={TDa}><RoleBadge role={r.work_position} /></td>
                          <CountCell value={r.total} max={colMax.total} color="#2196F3" active={isOpen("conv", r.key, "all")} onClick={drillFor("all", "barcha sdelkalar", {})} />
                          <CountCell value={r.in_process} max={colMax.in_process} color="#FF9800" active={isOpen("conv", r.key, "process")} onClick={drillFor("process", "jarayonda", { kind: "process" })} />
                          <CountCell value={r.won} max={colMax.won} color="#4CAF50" active={isOpen("conv", r.key, "won")} onClick={drillFor("won", wonLabel, { kind: "won" })} />
                          <CountCell value={r.lost} max={colMax.lost} color="#F44336" active={isOpen("conv", r.key, "lost")} onClick={drillFor("lost", lostLabel, { kind: "lost" })} />
                          <td style={{ ...TDa, textAlign: "center" }}><ConversionDonut pct={pct(r.won, r.total)} size={38} /></td>
                        </tr>
                        {open && <tr>{drillCell(8)}</tr>}
                      </Fragment>
                    );
                  })}
                  <tr style={{ background: "var(--bg3)" }}>
                    <td style={TDa} />
                    <td style={{ ...TDa, fontSize: 13, fontWeight: 700, color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.06em" }}>JAMI</td>
                    <td style={TDa} />
                    {([["all", "total", "#2196F3", "barcha sdelkalar", {}],
                       ["process", "in_process", "#FF9800", "jarayonda", { kind: "process" }],
                       ["won", "won", "#4CAF50", wonLabel, { kind: "won" }],
                       ["lost", "lost", "#F44336", lostLabel, { kind: "lost" }]] as const).map(([col, key, color, title, f]) => (
                      <CountCell key={col} total value={colTotal[key]} max={1} color={color} active={isOpen("conv", "__total__", col)}
                        onClick={() => toggle({ table: "conv", row: "__total__", col, title: `${pipelineLabel} · ${title}`, filter: f })} />
                    ))}
                    <td style={{ ...TDa, textAlign: "center" }}><ConversionDonut pct={pct(colTotal.won, colTotal.total)} size={38} /></td>
                  </tr>
                  {rowOpen("conv", "__total__") && <tr>{drillCell(8)}</tr>}
                </tbody>
              </table>
            </div>
          )}
        </Section>

        {/* ══════════════════════════════════════════════════════════
            Bekor bo'lish sabablari
        ══════════════════════════════════════════════════════════ */}
        {pipeline === "uc" ? (
          <Section
            icon={<Info size={16} style={{ color: "#FFC107" }} />}
            title="Bekor bo'lish sabablari"
            sub={`Причина maydoni · ${reasonScope === "lost" ? `«${lostLabel}» bosqichidagi sdelkalar` : "barcha bosqichlar"}`}
            right={
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <Segmented value={reasonScope} onChange={(s) => { setReasonScope(s); setDrill(d => d?.table === "reasons" ? null : d); }}
                  options={[
                    { value: "lost", label: "Bekor bo'lganlar", color: "#F44336" },
                    { value: "all",  label: "Barcha sdelkalar", color: "#6366f1" },
                  ]} />
                <span style={{ fontSize: 20, fontWeight: 800, color: "#FFC107" }}>{fmtNum(reasonTotal)}</span>
              </div>
            }>
            {reasonsQ.isLoading ? <Loading /> : reasonItems.length === 0 ? <Empty /> : (
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={THc("#555", 44)}>#</th>
                    <th style={{ ...THc("#9E9E9E", 240), textTransform: "none" }}>Причина</th>
                    <th style={THc("#FFC107")}>Soni</th>
                    <th style={THc("#9E9E9E", 90)}>Ulushi</th>
                  </tr>
                </thead>
                <tbody>
                  {reasonItems.map((r, i) => {
                    const open = rowOpen("reasons", r.reason_id);
                    const go = () => toggle({ table: "reasons", row: r.reason_id, col: "n", title: `Причина · ${r.reason}`, filter: { reason: r.reason_id, reason_scope: reasonScope } });
                    return (
                      <Fragment key={r.reason_id}>
                        <tr onClick={go} style={{ cursor: "pointer", background: open ? "rgba(255,193,7,0.08)" : i % 2 === 0 ? "transparent" : "var(--bg)" }}>
                          <td style={{ ...TDa, color: "#555", fontSize: 13, fontWeight: 600 }}>{String(i + 1).padStart(2, "0")}</td>
                          <td style={{ ...TDa, fontSize: 13, color: r.reason_id === NONE_KEY ? "var(--text3)" : "var(--text)", fontStyle: r.reason_id === NONE_KEY ? "italic" : "normal" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                              {r.reason}
                              <ChevronDown size={12} style={{ color: "var(--text3)", transform: open ? "rotate(180deg)" : "none", transition: "transform .2s" }} />
                            </div>
                          </td>
                          <CountCell value={r.total} max={reasonMax} color="#FFC107" active={open} onClick={go} />
                          <td style={{ ...TDa, fontSize: 13, color: "var(--text2)" }}>{pct(r.total, reasonTotal).toFixed(1)}%</td>
                        </tr>
                        {open && <tr>{drillCell(4)}</tr>}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            )}
          </Section>
        ) : (
          <Section
            icon={<Info size={16} style={{ color: "#FFC107" }} />}
            title="Bekor bo'lish sabablari"
            sub={pipelineLabel}>
            <div style={{ padding: "16px 20px", display: "flex", gap: 12, alignItems: "flex-start", background: "rgba(255,193,7,0.06)", borderBottom: "1px solid var(--border)" }}>
              <Info size={18} style={{ color: "#FFC107", flexShrink: 0, marginTop: 1 }} />
              <div style={{ fontSize: 13, color: "var(--text2)", lineHeight: 1.55 }}>
                <b style={{ color: "var(--text)" }}>«{pipelineLabel}» voronkasida bekor bo'lish sababi maydoni yo'q.</b><br />
                Bitrix24'da bu voronka sdelkalari uchun «Bekor bo'lish sababi» ro'yxat maydoni hali yaratilmagan, shuning uchun
                sabablar bo'yicha taqsimotni ko'rsatib bo'lmaydi. IT mutaxassisimizdan sdelka kartasiga shu maydonni qo'shishni
                va «{lostLabel}» bosqichiga o'tkazishda uni majburiy qilishni so'rang — maydon qo'shilgach, bu jadval
                «Учебный центр»dagi kabi avtomatik to'ladi.
              </div>
            </div>
            {lostStages.length > 0 && (
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={THc("#555", 44)}>#</th>
                    <th style={{ ...THc("#9E9E9E", 240), textTransform: "none" }}>Yo'qotilgan bosqich</th>
                    <th style={THc("#F44336")}>Soni</th>
                  </tr>
                </thead>
                <tbody>
                  {lostStages.map((s, i) => {
                    const n = kpi?.by_stage[s.id] ?? 0;
                    const go = () => toggle({ table: "reasons", row: s.id, col: "n", title: `${pipelineLabel} · ${s.name}`, filter: { stage: s.id } });
                    return (
                      <Fragment key={s.id}>
                        <tr onClick={n > 0 ? go : undefined} style={{ cursor: n > 0 ? "pointer" : "default", background: i % 2 === 0 ? "transparent" : "var(--bg)" }}>
                          <td style={{ ...TDa, color: "#555", fontSize: 13, fontWeight: 600 }}>{String(i + 1).padStart(2, "0")}</td>
                          <td style={{ ...TDa, fontSize: 13, color: "var(--text)" }}>{s.name}</td>
                          <CountCell value={n} max={Math.max(1, ...lostStages.map(x => kpi?.by_stage[x.id] ?? 0))} color="#F44336" active={rowOpen("reasons", s.id)} onClick={go} />
                        </tr>
                        {rowOpen("reasons", s.id) && <tr>{drillCell(3)}</tr>}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            )}
          </Section>
        )}

        {/* ══════════════════════════════════════════════════════════
            Manba bo'yicha (Источник)
        ══════════════════════════════════════════════════════════ */}
        <Section
          icon={<Users size={16} style={{ color: "#9C27B0" }} />}
          title="Manba bo'yicha"
          sub={`Bitrix «Источник» (SOURCE_ID) · ${srcRows.length} ta manba`}>
          {sourcesQ.isLoading ? <Loading /> : srcRows.length === 0 ? <Empty /> : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={THc("#555", 44)}>#</th>
                    <th style={THc("#9E9E9E", 220)}>Manba</th>
                    <th style={THc("#2196F3")}>Umumiy</th>
                    <th style={THc("#FF9800")}>Jarayonda</th>
                    <th style={{ ...THc("#4CAF50"), textTransform: "none" }}>{wonLabel}</th>
                    <th style={{ ...THc("#F44336"), textTransform: "none" }}>{lostLabel}</th>
                    <th style={{ ...THc("#4CAF50", 84), textAlign: "center" }}>Konversiya</th>
                  </tr>
                </thead>
                <tbody>
                  {srcRows.map((r, i) => {
                    const open = rowOpen("src", r.source_id);
                    const drillFor = (col: string, title: string, f: Partial<PipelineDealsFilter>) =>
                      () => toggle({ table: "src", row: r.source_id, col, title: `${r.source_name} · ${title}`, filter: { source: r.source_id, ...f } });
                    return (
                      <Fragment key={r.source_id}>
                        <tr className="sd-row" style={{ cursor: "pointer", background: open ? "rgba(156,39,176,0.06)" : i % 2 === 0 ? "transparent" : "var(--bg)" }}
                          onClick={drillFor("all", "barcha sdelkalar", {})}>
                          <td style={{ ...TDa, color: "#555", fontSize: 13, fontWeight: 600 }}>{String(i + 1).padStart(2, "0")}</td>
                          <td style={{ ...TDa, fontSize: 13, color: open ? "#9C27B0" : "var(--text)", fontWeight: 500 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                              <span style={{ fontStyle: r.source_id === NONE_KEY ? "italic" : "normal" }}>{r.source_name}</span>
                              {r.source_id !== NONE_KEY && (
                                <span title="Bitrix SOURCE_ID" style={{ fontSize: 10, fontFamily: "monospace", color: "var(--text3)", background: "var(--bg3)", border: "1px solid var(--border)", borderRadius: 4, padding: "0 5px" }}>
                                  {r.source_id}
                                </span>
                              )}
                              <ChevronDown size={12} style={{ color: "var(--text3)", transform: open ? "rotate(180deg)" : "none", transition: "transform .2s", flexShrink: 0 }} />
                            </div>
                          </td>
                          <CountCell value={r.total} max={srcMax.total} color="#2196F3" active={isOpen("src", r.source_id, "all")} onClick={drillFor("all", "barcha sdelkalar", {})} />
                          <CountCell value={r.in_process} max={srcMax.in_process} color="#FF9800" active={isOpen("src", r.source_id, "process")} onClick={drillFor("process", "jarayonda", { kind: "process" })} />
                          <CountCell value={r.won} max={srcMax.won} color="#4CAF50" active={isOpen("src", r.source_id, "won")} onClick={drillFor("won", wonLabel, { kind: "won" })} />
                          <CountCell value={r.lost} max={srcMax.lost} color="#F44336" active={isOpen("src", r.source_id, "lost")} onClick={drillFor("lost", lostLabel, { kind: "lost" })} />
                          <td style={{ ...TDa, textAlign: "center" }}><ConversionDonut pct={pct(r.won, r.total)} size={38} /></td>
                        </tr>
                        {open && <tr>{drillCell(7)}</tr>}
                      </Fragment>
                    );
                  })}
                  <tr style={{ background: "var(--bg3)" }}>
                    <td style={TDa} />
                    <td style={{ ...TDa, fontSize: 13, fontWeight: 700, color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.06em" }}>JAMI</td>
                    <CountCell total value={srcTotal.total} max={1} color="#2196F3" />
                    <CountCell total value={srcTotal.in_process} max={1} color="#FF9800" />
                    <CountCell total value={srcTotal.won} max={1} color="#4CAF50" />
                    <CountCell total value={srcTotal.lost} max={1} color="#F44336" />
                    <td style={{ ...TDa, textAlign: "center" }}><ConversionDonut pct={pct(srcTotal.won, srcTotal.total)} size={38} /></td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </Section>

        {anyError && (
          <div style={{
            marginTop: 12, padding: "10px 14px", borderRadius: 8, fontSize: 12,
            background: "rgba(239,68,68,.1)", border: "1px solid rgba(239,68,68,.25)", color: "#ef4444"
          }}>
            Xatolik: {(anyError as Error).message}
          </div>
        )}
      </div>
    </>
  );
}

import { Fragment, useState, useCallback, useMemo, useRef, useEffect } from "react";
import { useDarkMode } from "@/hooks/useDarkMode";
import { useQuery, useInfiniteQuery } from "@tanstack/react-query";
import {
  Search, TrendingUp, CheckCircle, ChevronDown, Users, BarChart2, Layers, Info, Calendar, Filter, ListChecks,
  User, ExternalLink,
} from "lucide-react";
import { Topbar } from "@/components/Topbar";
import { InfoTip } from "@/components/InfoTip";
import { MultiSelect } from "@/components/MultiSelect";
import { DateRangePicker } from "@/components/DateRangePicker";
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
/** "<1", "4.5", "37" — a non-zero share never rounds down to "0". */
const fmtShare = (p: number) => (p > 0 && p < 1 ? "<1" : p < 10 ? p.toFixed(1).replace(/\.0$/, "") : String(Math.round(p)));

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

// Mid-tone hues: each keeps roughly ≥3.5:1 contrast against both the light and the dark
// card background, so stage names stay readable as header text in either theme.
// Greens and reds are left to the won / lost stages.
const PROCESS_PALETTE = ["#3B82F6", "#0891B2", "#6366F1", "#0D9488", "#8B5CF6", "#0284C7", "#A855F7", "#2563EB", "#C026D3", "#D97706"];
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

// ── MiniBar ───────────────────────────────────────────────────────
function MiniBar({ value, max, color, height = 3 }: { value: number; max: number; color: string; height?: number }) {
  const w = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div style={{ height, borderRadius: 2, background: "var(--bg4)", marginTop: 5, overflow: "hidden" }}>
      <div style={{ height: "100%", width: `${w}%`, background: color, borderRadius: 2, transition: "width 0.3s" }} />
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
    // Size container: drill-down panels inside size to the card (100cqw), not the viewport.
    <div style={{ background: "var(--bg2)", borderRadius: 12, overflow: "hidden", marginBottom: 16, border: "1px solid var(--border)", containerType: "inline-size" }}>
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
  .sd-click { transition: box-shadow .12s; }
  .sd-click:hover { box-shadow: inset 0 0 0 1.5px rgba(99,102,241,.55); }
  .sd-reason:hover { background: var(--bg3); }
  /* Rows as in OperatorTable: lift on hover, blue tint + side rules when open.
     Frozen cells take their background from the class (not inline) so they follow. */
  .sd-op { transition: background .18s ease, box-shadow .18s ease; }
  .sd-op > td.sd-sticky { background: var(--bg2); }
  .sd-op:hover { background: var(--bg3); box-shadow: 0 4px 18px rgba(0,0,0,.28); }
  .sd-op:hover > td.sd-sticky { background: var(--bg3); }
  .sd-op.sd-open { background: rgba(33,150,243,.08); }
  .sd-op.sd-open > td.sd-sticky { background: color-mix(in srgb, #2196F3 8%, var(--bg2)); }
  .sd-op.sd-open > td:first-child { box-shadow: inset 1px 0 0 #2196F3; }
  .sd-op.sd-open > td:last-child { box-shadow: inset -1px 0 0 #2196F3; }
  .sd-total > td { border-top: 1px solid var(--border); }
  .sd-op .sd-actions { opacity: 0; transition: opacity .18s ease; }
  .sd-op:hover .sd-actions { opacity: 1; }
`;

const Loading = () => <div style={{ padding: 24, color: "#666", fontSize: 13 }}>Yuklanmoqda…</div>;
const Empty = () => <div style={{ padding: 24, color: "var(--text3)", fontSize: 13 }}>Ma'lumot yo'q</div>;

const KIND_GROUPS: { kind: PipelineStage["kind"]; label: string; color: string }[] = [
  { kind: "process", label: "Jarayonda", color: "#3b82f6" },
  { kind: "won",     label: "Yutildi",   color: "#4CAF50" },
  { kind: "lost",    label: "Yo'qotildi", color: "#F44336" },
];

// ── Lidlar OperatorTable look (components/OperatorTable.tsx) ───────
// Same header, cell, rank and avatar treatment as the Lidlar operator table, so the
// two pages read the same way. That component is lead-specific, hence the copy.
const OT_TH: React.CSSProperties = {
  fontSize: 10.5, fontWeight: 700, color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.05em",
  textAlign: "left", padding: "0 12px 10px", whiteSpace: "nowrap", verticalAlign: "bottom", background: "var(--bg2)",
};
const OT_TD: React.CSSProperties = { padding: "11px 12px", verticalAlign: "middle" };
const RANK_MEDAL = ["🥇", "🥈", "🥉"];
const OP_AVATAR_COLORS = ["#7C4DFF", "#2196F3", "#00BCD4", "#4CAF50", "#FF9800", "#E91E63", "#9C27B0", "#607D8B"];
const KONV_COLOR = "#9C27B0";

function OpAvatar({ name, id }: { name: string; id: number | null }) {
  const initials = name.trim().split(/\s+/).slice(0, 2).map(w => w[0]).join("").toUpperCase();
  return (
    <div style={{ width: 30, height: 30, borderRadius: "50%", background: id == null ? "#9E9E9E" : OP_AVATAR_COLORS[id % OP_AVATAR_COLORS.length], color: "#fff", fontSize: 11.5, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
      {initials}
    </div>
  );
}

/** 🥇🥈🥉 for the top three, then #4, #5…; null (system row) is unranked. */
const rankLabel = (rank: number | null, medals = true) =>
  rank == null ? "—" : medals && rank < 3 ? RANK_MEDAL[rank] : `#${rank + 1}`;

/** Number over a 3px bar — OperatorTable's cell. Clickable when there are deals. */
function OtCell({ value, max, color, active, onClick, total, hint, divider }: {
  value: number; max: number; color: string; active?: boolean; onClick?: () => void; total?: boolean; hint?: string;
  /** Rule on the left — marks where a stage group starts in the matrix. */
  divider?: boolean;
}) {
  const clickable = value > 0 && !!onClick;
  return (
    <td onClick={clickable ? (e) => { e.stopPropagation(); onClick!(); } : undefined}
      title={clickable ? `${hint ? `${hint} · ` : ""}bosing — sdelkalar ro'yxati` : undefined}
      className={clickable ? "sd-click" : undefined}
      style={{ ...OT_TD, cursor: clickable ? "pointer" : "default", background: active ? `${color}1f` : undefined, borderLeft: divider ? "1px solid var(--border)" : undefined }}>
      <span style={{ fontSize: total ? 14.5 : 13.5, fontWeight: total ? 800 : 600, color: value > 0 ? (active ? color : "var(--text)") : "var(--text3)" }}>
        {fmtNum(value)}
      </span>
      <MiniBar value={value} max={max} color={color} />
    </td>
  );
}

/** Konversiya as in OperatorTable: purple % on the right over a purple bar. */
function KonvCell({ value, max, total }: { value: number; max: number; total?: boolean }) {
  return (
    <td style={{ ...OT_TD, textAlign: "right" }}>
      <span style={{ fontSize: total ? 15.5 : 15, fontWeight: 800, color: KONV_COLOR }}>{value.toFixed(1)}%</span>
      <MiniBar value={value} max={max} color={KONV_COLOR} />
    </td>
  );
}

// ── Deals drill-down (shared by every table) ─────────────────────
const DRILL_PAGE = 100;

function DealsDrilldown({ filter, colSpan, title, showReason, showReportStage, onClose, inline = false, bare = false }: {
  filter: PipelineDealsFilter; colSpan: number; title: string; showReason: boolean; showReportStage: boolean; onClose: () => void;
  /** Render as a block (for the reasons list) instead of a table cell. */
  inline?: boolean;
  /** No own background/border — it sits inside a framed panel. */
  bare?: boolean;
}) {
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
  // A drill pinned to one manager / one stage would repeat it on every row — drop that column.
  const oneResp = !!filter.responsible_id && !String(filter.responsible_id).includes(",");
  const oneStage = !!filter.stage && !String(filter.stage).includes(",");
  const oneReason = !!filter.reason && !String(filter.reason).includes(",");
  const cols = ["ID", "Sdelka", ...(oneResp ? [] : ["Mas'ul"]), ...(oneStage ? [] : ["Bosqich"]), ...(showReportStage ? ["Стадия (отчет)"] : []), "Manba", ...(showReason && !oneReason ? ["Причина"] : []), "Yaratildi", "O'zgardi"];

  const Wrap = inline ? "div" : "td";
  return (
    <Wrap colSpan={inline ? undefined : colSpan} style={{ padding: 0, background: bare ? "transparent" : "var(--bg)", borderBottom: bare ? "none" : "1px solid var(--border)" }}>
      <div style={{ position: "sticky", left: 0, maxWidth: "100cqw", boxSizing: "border-box", padding: inline && !bare ? "10px 20px 12px" : "10px 14px 12px" }}>
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
                      {!oneResp && <td style={{ padding: "5px 10px", color: "var(--text2)", whiteSpace: "nowrap" }}>{d.responsible || "—"}</td>}
                      {!oneStage && (
                        <td style={{ padding: "5px 10px", whiteSpace: "nowrap" }}>
                          <span style={{ fontSize: 11, padding: "2px 7px", borderRadius: 10, background: `${kc}22`, color: kc, fontWeight: 600 }}>{d.stage_name}</span>
                        </td>
                      )}
                      {showReportStage && <td style={{ padding: "5px 10px", color: "var(--text2)", whiteSpace: "nowrap" }}>{d.report_stage || "—"}</td>}
                      <td style={{ padding: "5px 10px", color: "var(--text3)", whiteSpace: "nowrap" }}>{d.source_name}</td>
                      {showReason && !oneReason && <td style={{ padding: "5px 10px", color: "var(--text2)", whiteSpace: "nowrap" }}>{d.reason || "—"}</td>}
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
    </Wrap>
  );
}

/** Which table cell's deals are open. Only one drill-down is open at a time. */
type Drill = { table: string; row: string; col: string; title: string; filter: Partial<PipelineDealsFilter> };

/** Manager row with the ids to filter its deals by (several for the folded row). */
type MgrRow = PipelineManagerRow & { key: string; ids: string; members?: string[] };

// ── Page ─────────────────────────────────────────────────────────
export default function SdelkalarPage() {
  const portal = useBitrixPortal();
  const [filterOpen, setFilterOpen] = useState(false);
  const filterRef = useRef<HTMLDivElement>(null);
  // As on Lidlar: a click outside the open panel closes it. The date and dropdown
  // popovers are DOM children of the panel, so clicks inside them do not.
  useEffect(() => {
    if (!filterOpen) return;
    const h = (e: MouseEvent) => { if (filterRef.current && !filterRef.current.contains(e.target as Node)) setFilterOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [filterOpen]);
  // Always opens on Учебный центр.
  const [pipeline, setPipeline] = useState<PipelineKey>("uc");
  const [reasonScope, setReasonScope] = useState<ReasonScope>("lost");
  const REASONS_PAGE = 12;
  const [shownReasons, setShownReasons] = useState(REASONS_PAGE);
  const [hideEmptyStages, setHideEmptyStages] = useState(false);
  // The preset chip the user picked. Derived-from-dates alone lights up two chips when
  // ranges coincide (on the 8th, "7 kun" and "Bu oy" both start on the 1st).
  const [presetLabel, setPresetLabel] = useState<string | null>("Bu oy");
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
    setPresetLabel("Bu oy");
    setDrill(null);
  }, []);

  const switchPipeline = (p: PipelineKey) => {
    if (p === pipeline) return;
    setPipeline(p);
    setShownReasons(REASONS_PAGE);
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
  // Both pipelines read Причина; Стадия (для отчетов) exists only on Учебный центр.
  const showReason = true;
  const showReportStage = pipeline === "uc";
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

  // Same shortcuts as the Lidlar filter; "Barchasi" has no lower bound — the Bitrix kanban's scope.
  const PRESETS = [
    { label: "Bugun", f: todayISO(), t: todayISO() },
    { label: "7 kun", f: daysAgoISO(7), t: todayISO() },
    { label: "30 kun", f: daysAgoISO(30), t: todayISO() },
    { label: "Bu oy", f: startOfMonthISO(), t: todayISO() },
    { label: "Barchasi", f: "", t: todayISO() },
  ];

  // ── Drill-down plumbing ──────────────────────────────────────────
  const isOpen = (table: string, row: string, col: string) =>
    drill?.table === table && drill.row === row && drill.col === col;
  const rowOpen = (table: string, row: string) => drill?.table === table && drill.row === row;
  const toggle = (d: Drill) => setDrill(cur =>
    cur && cur.table === d.table && cur.row === d.row && cur.col === d.col ? null : d);
  const drillPanel = () => drill && (
    <DealsDrilldown inline
      filter={{ ...base, ...drill.filter } as PipelineDealsFilter}
      colSpan={1}
      title={drill.title}
      showReason={showReason}
      showReportStage={showReportStage}
      onClose={() => setDrill(null)}
    />
  );
  /** Deal list under a row, framed like OperatorTable's expanded row. */
  const framedDrill = (colSpan: number) => drill && (
    <td colSpan={colSpan} style={{ padding: "0 12px 12px" }}>
      <div style={{ border: "1px solid #2196F3", borderTop: "none", borderRadius: "0 0 12px 12px", background: "rgba(33,150,243,0.04)", overflow: "hidden" }}>
        <DealsDrilldown inline bare
          filter={{ ...base, ...drill.filter } as PipelineDealsFilter}
          colSpan={1}
          title={drill.title}
          showReason={showReason}
          showReportStage={showReportStage}
          onClose={() => setDrill(null)}
        />
      </div>
    </td>
  );
  const drillCell = (colSpan: number) => drill && (
    <DealsDrilldown
      filter={{ ...base, ...drill.filter } as PipelineDealsFilter}
      colSpan={colSpan}
      title={drill.title}
      showReason={showReason}
      showReportStage={showReportStage}
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
        responsible_id: null, full_name: "Tizim / admin", work_position: null, by_stage,
        total: sum("total"), in_process: sum("in_process"), won: sum("won"), lost: sum("lost"),
        key: "__system__", ids: folded.filter(m => m.responsible_id != null).map(m => m.responsible_id).join(","),
        members: folded.map(m => m.full_name),
      });
    }
    return people;
  }, [managersQ.data]);
  const allMatrixStages = managersQ.data?.stages ?? stages;

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
  // Colours come from the full stage list, so hiding empty stages never recolours the rest.
  const stageColorById = useMemo(() => {
    let p = 0;
    return Object.fromEntries(allMatrixStages.map(st => [st.id, stageColor(st, st.kind === "process" ? p++ : 0)]));
  }, [allMatrixStages]);
  /** System/admin row: neutral bars, so it never reads as the top performer. */
  const rowColor = (r: MgrRow, c: string) => (r.key === "__system__" ? "#9E9E9E" : c);
  /** Stage column i starts a group (or sits right after Jami) — gets a divider. */
  const isGroupStart = (i: number) => i === 0 || matrixStages[i].kind !== matrixStages[i - 1].kind;
  const matrixGroups = KIND_GROUPS.map(g => ({ ...g, span: matrixStages.filter(s => s.kind === g.kind).length })).filter(g => g.span > 0);
  const emptyStageCount = allMatrixStages.filter(s => (colTotal[`s:${s.id}`] ?? 0) === 0).length;

  const colMax = useMemo(() => {
    const m: Record<string, number> = { total: 1, in_process: 1, won: 1, lost: 1 };
    for (const r of mgrRows) {
      // The folded system/admin row would set every scale and shrink real managers'
      // bars to slivers; it is left out (its own bars just clamp at 100%).
      if (r.key === "__system__") continue;
      m.total = Math.max(m.total, r.total); m.in_process = Math.max(m.in_process, r.in_process);
      m.won = Math.max(m.won, r.won); m.lost = Math.max(m.lost, r.lost);
      for (const [k, v] of Object.entries(r.by_stage)) m[`s:${k}`] = Math.max(m[`s:${k}`] ?? 1, v);
    }
    return m;
  }, [mgrRows]);

  /** Manager cell as in OperatorTable: avatar, name, quick links on hover. */
  const opIconBtn: React.CSSProperties = { width: 22, height: 22, borderRadius: 6, display: "inline-flex", alignItems: "center", justifyContent: "center", background: "var(--bg4)", color: "var(--text2)", textDecoration: "none" };
  const nameCell = (r: MgrRow, sticky: boolean) => (
    <td className={sticky ? "sd-sticky" : undefined}
      style={{ ...OT_TD, whiteSpace: "nowrap", ...(sticky ? { position: "sticky", left: 44, zIndex: 2 } : {}) }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
        <OpAvatar name={r.full_name || "?"} id={r.key === "__system__" ? null : r.responsible_id} />
        <div style={{ minWidth: 0 }}>
          <div title={r.full_name} style={{ fontSize: 13.5, fontWeight: 600, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis" }}>{r.full_name}</div>
          {r.members && (
            <div title={r.members.join(", ")} style={{ fontSize: 10.5, color: "var(--text3)", overflow: "hidden", textOverflow: "ellipsis" }}>{r.members.join(", ")}</div>
          )}
        </div>
        {/* Not in the matrix: its frozen name column is fixed-width, and the (invisible) links would truncate names. */}
        {!sticky && r.responsible_id != null && (
          <span className="sd-actions" style={{ display: "flex", gap: 4, flexShrink: 0, marginLeft: "auto" }}>
            <a href={`${portal}/company/personal/user/${r.responsible_id}/`} target="_blank" rel="noreferrer"
              title="Profil" onClick={e => e.stopPropagation()} style={opIconBtn}><User size={12} /></a>
            <a href={`${portal}/crm/deal/list/?apply_filter=Y&ASSIGNED_BY_ID=${r.responsible_id}`} target="_blank" rel="noreferrer"
              title="Bitrix'da sdelkalari" onClick={e => e.stopPropagation()} style={opIconBtn}><ExternalLink size={12} /></a>
          </span>
        )}
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
  // Ko'rsatilmagan (no reason) goes last and off the bar scale: on YANGI it is 464 of 491,
  // and scaling to it would squash every real reason into a dot.
  const reasonItems = useMemo(() => {
    const items = reasons?.available ? reasons.items : [];
    return [...items.filter(r => r.reason_id !== NONE_KEY), ...items.filter(r => r.reason_id === NONE_KEY)];
  }, [reasons]);
  const reasonTotal = reasonItems.reduce((a, r) => a + r.total, 0);
  const reasonMax = Math.max(1, ...reasonItems.filter(r => r.reason_id !== NONE_KEY).map(r => r.total));
  const konvMaxMgr = Math.max(1, ...mgrRows.filter(r => r.key !== "__system__").map(r => pct(r.won, r.total)));
  const konvMaxSrc = Math.max(1, ...srcRows.map(r => pct(r.won, r.total)));
  // One label width for the whole list (as ReasonsCard), so every bar starts at the same x.
  const reasonGrid = `${Math.min(26, Math.max(6, ...reasonItems.map(r => r.reason.length)))}ch minmax(0, 1fr) 64px 52px 18px`;
  const moreBtn: React.CSSProperties = { display: "inline-flex", alignItems: "center", gap: 5, background: "var(--bg3)", border: "1px solid var(--border)", borderRadius: 7, color: "var(--text2)", fontSize: 11.5, fontWeight: 600, padding: "5px 12px", cursor: "pointer" };

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

        {/* ── Filter panel — same layout and controls as the Lidlar page ── */}
        {/* top: -18 = minus the scroller's top padding, so the bar sits flush under the Topbar while scrolling. */}
        <div ref={filterRef} style={{ position: "sticky", top: -18, zIndex: 50, marginBottom: 16 }}>
          <button type="button" onClick={() => setFilterOpen(o => !o)}
            style={{
              display: "flex", alignItems: "center", gap: 10, width: "100%",
              background: "var(--bg2)",
              border: `1px solid ${filterOpen ? "#2196F3" : activeFilterCount > 0 ? "rgba(33,150,243,0.5)" : "var(--border)"}`,
              borderRadius: filterOpen ? "10px 10px 0 0" : 10,
              padding: "10px 16px", color: "var(--text)", fontSize: 13, fontWeight: 500, cursor: "pointer", textAlign: "left",
            }}>
            <Search size={16} style={{ color: "var(--text3)", flexShrink: 0 }} />
            <span style={{ color: "var(--text3)", flex: 1 }}>{`Yaratilgan sana: ${periodLabel}`}</span>
            <span style={{ background: "rgba(99,102,241,0.15)", color: "#6366f1", border: "1px solid rgba(99,102,241,0.4)", borderRadius: 10, padding: "2px 9px", fontSize: 11, fontWeight: 700 }}>{pipelineLabel}</span>
            {activeFilterCount > 0 && (
              <span style={{ background: "#2196F3", color: "#fff", borderRadius: 10, padding: "2px 9px", fontSize: 11, fontWeight: 700 }}>{activeFilterCount} filtr</span>
            )}
            <ChevronDown size={16} style={{ color: "#9E9E9E", transform: filterOpen ? "rotate(180deg)" : "none", transition: "transform 0.2s" }} />
          </button>

          {filterOpen && (
            <div style={{ background: "var(--bg2)", border: "1px solid var(--border)", borderTop: "none", borderRadius: "0 0 10px 10px", padding: "16px 20px" }}>
              {/* Yaratilgan sana — calendar range and the quick presets on one row. */}
              <div style={{ marginBottom: 14 }}>
                <label title="Дата создания" style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 600, color: "var(--text3)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                  <Calendar size={12} />Yaratilgan sana
                </label>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <DateRangePicker start={filter.from || undefined} end={filter.to || undefined}
                    onChange={(f, t) => { setPresetLabel(null); setFilter(p => ({ ...p, from: f, to: t })); }}
                    onClear={() => { setPresetLabel("Barchasi"); setFilter(p => ({ ...p, from: "", to: todayISO() })); }} />
                  {PRESETS.map(p => {
                    const active = presetLabel === p.label && filter.from === p.f && filter.to === p.t;
                    return (
                      <button key={p.label} type="button" onClick={() => { setPresetLabel(p.label); setFilter(s => ({ ...s, from: p.f, to: p.t })); }}
                        style={{
                          background: active ? "#2196F3" : "var(--bg3)",
                          border: `1px solid ${active ? "#2196F3" : "var(--border)"}`,
                          color: active ? "#fff" : "#9E9E9E",
                          borderRadius: 20, padding: "5px 14px", fontSize: 12, fontWeight: active ? 600 : 400,
                          cursor: "pointer", transition: "all 0.15s",
                        }}>
                        {p.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginBottom: 12 }}>
                <MultiSelect label="Mas'ul xodim" icon={<Users size={12} />} searchable
                  options={respOptions} values={filter.responsible_ids}
                  onChange={v => setFilter(s => ({ ...s, responsible_ids: v }))} loading={filterQ.isLoading} />
                <MultiSelect label="Bosqich" icon={<Filter size={12} />}
                  options={stageOptions} values={filter.stage_ids}
                  onChange={v => setFilter(s => ({ ...s, stage_ids: v }))} loading={kpiQ.isLoading} />
                <MultiSelect label="Manba (Источник)" icon={<TrendingUp size={12} />}
                  options={srcOptions} values={filter.sources}
                  onChange={v => setFilter(s => ({ ...s, sources: v }))} loading={filterQ.isLoading} />
                {pipeline === "uc" && (
                  <MultiSelect label="Стадия (для отчетов)" icon={<ListChecks size={12} />}
                    options={reportStageOptions} values={filter.report_stages}
                    onChange={v => setFilter(s => ({ ...s, report_stages: v }))} loading={reportStagesQ.isLoading} />
                )}
              </div>

              {activeFilterCount > 0 && (
                <div style={{ paddingTop: 12, borderTop: "1px solid var(--border)", display: "flex", justifyContent: "flex-end" }}>
                  <button type="button" onClick={clearFilter}
                    style={{ background: "none", border: "none", color: "#9E9E9E", fontSize: 12, cursor: "pointer", padding: "6px 10px" }}>
                    Tozalash
                  </button>
                </div>
              )}
            </div>
          )}
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
          <div style={{ background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden", marginBottom: 16, containerType: "inline-size" }}>
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
          right={emptyStageCount > 0 ? (
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text2)", cursor: "pointer", userSelect: "none" }}>
              <input type="checkbox" checked={hideEmptyStages} onChange={e => setHideEmptyStages(e.target.checked)} style={{ accentColor: "#6366f1" }} />
              Bo'sh bosqichlarni yashirish ({emptyStageCount})
            </label>
          ) : undefined}>
          {managersQ.isLoading ? <Loading /> : mgrRows.length === 0 ? <Empty /> : (
            <div style={{ overflowX: "auto", padding: "14px 8px 6px" }}>
              {/* Fits 10 stages from a 1366px screen up: 44 + 176 + 76 + 10 × 78 = 1076px (+16px padding). */}
              <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0, tableLayout: "fixed", minWidth: 44 + 176 + 76 + matrixStages.length * 78 }}>
                <colgroup>
                  <col style={{ width: 44 }} />
                  <col style={{ width: 176 }} />
                  <col style={{ width: 76 }} />
                  {matrixStages.map(st => <col key={st.id} />)}
                </colgroup>
                <thead>
                  <tr>
                    <th rowSpan={2} style={{ ...OT_TH, textAlign: "center", position: "sticky", left: 0, zIndex: 3 }}>#</th>
                    <th rowSpan={2} style={{ ...OT_TH, position: "sticky", left: 44, zIndex: 3 }}>Menejer</th>
                    <th rowSpan={2} style={OT_TH}>Jami</th>
                    {matrixGroups.map(g => (
                      <th key={g.kind} colSpan={g.span} style={{ ...OT_TH, padding: "0 12px 6px", borderBottom: `2px solid ${g.color}`, borderLeft: "1px solid var(--border)" }}>
                        {g.label}
                      </th>
                    ))}
                  </tr>
                  <tr>
                    {matrixStages.map((st, i) => (
                      <th key={st.id} title={`${st.name} · ${st.id}`} style={{
                        ...OT_TH, padding: "8px 12px 10px", whiteSpace: "normal", lineHeight: 1.3, wordBreak: "break-word",
                        borderLeft: isGroupStart(i) ? "1px solid var(--border)" : undefined,
                      }}>
                        {st.name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {mgrRows.map((r, i) => {
                    const open = rowOpen("matrix", r.key);
                    const rank = r.key === "__system__" ? null : i;
                    const drillFor = (col: string, title: string, f: Partial<PipelineDealsFilter>) =>
                      r.ids ? () => toggle({ table: "matrix", row: r.key, col, title: `${r.full_name} · ${title}`, filter: { responsible_id: r.ids, ...f } }) : undefined;
                    return (
                      <Fragment key={r.key}>
                        <tr className={`sd-op${open ? " sd-open" : ""}`} style={{ cursor: r.ids ? "pointer" : "default" }}
                          onClick={drillFor("all", "barcha sdelkalar", {})}>
                          <td className="sd-sticky" style={{ ...OT_TD, textAlign: "center", position: "sticky", left: 0, zIndex: 2 }}>
                            <span style={{ fontSize: rank != null && rank < 3 ? 17 : 12.5, fontWeight: 700, color: "var(--text3)" }}>{rankLabel(rank)}</span>
                          </td>
                          {nameCell(r, true)}
                          <OtCell value={r.total} max={colMax.total} color={rowColor(r, "#2196F3")} active={isOpen("matrix", r.key, "all")}
                            onClick={drillFor("all", "barcha sdelkalar", {})} hint={`${r.full_name}: ${fmtNum(r.total)} ta sdelka`} />
                          {matrixStages.map((st, si) => {
                            const v = r.by_stage[st.id] ?? 0;
                            return (
                              <OtCell key={st.id} value={v} max={colMax[`s:${st.id}`] ?? 1} color={rowColor(r, stageColorById[st.id])} divider={isGroupStart(si)}
                                active={isOpen("matrix", r.key, st.id)} onClick={drillFor(st.id, st.name, { stage: st.id })}
                                hint={`${r.full_name} · ${st.name}: ${fmtNum(v)} ta — uning sdelkalarining ${fmtShare(pct(v, r.total))}%`} />
                            );
                          })}
                        </tr>
                        {open && <tr>{framedDrill(3 + matrixStages.length)}</tr>}
                      </Fragment>
                    );
                  })}
                  <tr className="sd-total">
                    <td style={{ ...OT_TD, position: "sticky", left: 0, background: "var(--bg2)", zIndex: 2 }} />
                    <td style={{ ...OT_TD, position: "sticky", left: 44, background: "var(--bg2)", zIndex: 2, fontSize: 11, fontWeight: 700, color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.06em" }}>Jami</td>
                    <OtCell total value={colTotal.total} max={colTotal.total} color="#2196F3" active={isOpen("matrix", "__total__", "all")}
                      onClick={() => toggle({ table: "matrix", row: "__total__", col: "all", title: `${pipelineLabel} · barcha sdelkalar`, filter: {} })} />
                    {matrixStages.map((st, si) => {
                      const v = colTotal[`s:${st.id}`] ?? 0;
                      return (
                        <OtCell key={st.id} total value={v} max={v} color={stageColorById[st.id]} divider={isGroupStart(si)}
                          active={isOpen("matrix", "__total__", st.id)}
                          onClick={() => toggle({ table: "matrix", row: "__total__", col: st.id, title: `${pipelineLabel} · ${st.name}`, filter: { stage: st.id } })}
                          hint={`${st.name}: ${fmtNum(v)} ta — jamidan ${fmtShare(pct(v, colTotal.total))}%`} />
                      );
                    })}
                  </tr>
                  {rowOpen("matrix", "__total__") && <tr>{framedDrill(3 + matrixStages.length)}</tr>}
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
          title="Sdelka va Konversiya">
          {managersQ.isLoading ? <Loading /> : mgrRows.length === 0 ? <Empty /> : (
            <div style={{ overflowX: "auto", padding: "14px 8px 6px" }}>
              <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0 }}>
                <thead>
                  <tr>
                    <th style={{ ...OT_TH, width: "1%", textAlign: "center" }}>#</th>
                    <th style={{ ...OT_TH, width: "1%" }}>Menejer</th>
                    <th style={{ ...OT_TH, width: "17%" }}>Jami sdelka</th>
                    <th style={{ ...OT_TH, width: "17%" }}>Jarayonda</th>
                    <th style={{ ...OT_TH, width: "17%" }}>{wonLabel}</th>
                    <th style={{ ...OT_TH, width: "17%" }}>{lostLabel}</th>
                    <th style={{ ...OT_TH, width: "14%", textAlign: "right" }}>Konversiya</th>
                  </tr>
                </thead>
                <tbody>
                  {mgrRows.map((r, i) => {
                    const open = rowOpen("conv", r.key);
                    const rank = r.key === "__system__" ? null : i;
                    const drillFor = (col: string, title: string, f: Partial<PipelineDealsFilter>) =>
                      r.ids ? () => toggle({ table: "conv", row: r.key, col, title: `${r.full_name} · ${title}`, filter: { responsible_id: r.ids, ...f } }) : undefined;
                    return (
                      <Fragment key={r.key}>
                        <tr className={`sd-op${open ? " sd-open" : ""}`} style={{ cursor: r.ids ? "pointer" : "default" }} onClick={drillFor("all", "barcha sdelkalar", {})}>
                          <td style={{ ...OT_TD, textAlign: "center" }}>
                            <span style={{ fontSize: rank != null && rank < 3 ? 17 : 12.5, fontWeight: 700, color: "var(--text3)" }}>{rankLabel(rank)}</span>
                          </td>
                          {nameCell(r, false)}
                          <OtCell value={r.total} max={colMax.total} color={rowColor(r, "#2196F3")} active={isOpen("conv", r.key, "all")} onClick={drillFor("all", "barcha sdelkalar", {})} />
                          <OtCell value={r.in_process} max={colMax.in_process} color={rowColor(r, "#FF9800")} active={isOpen("conv", r.key, "process")} onClick={drillFor("process", "jarayonda", { kind: "process" })} />
                          <OtCell value={r.won} max={colMax.won} color={rowColor(r, "#4CAF50")} active={isOpen("conv", r.key, "won")} onClick={drillFor("won", wonLabel, { kind: "won" })} />
                          <OtCell value={r.lost} max={colMax.lost} color={rowColor(r, "#F44336")} active={isOpen("conv", r.key, "lost")} onClick={drillFor("lost", lostLabel, { kind: "lost" })} />
                          <KonvCell value={pct(r.won, r.total)} max={konvMaxMgr} />
                        </tr>
                        {open && <tr>{framedDrill(7)}</tr>}
                      </Fragment>
                    );
                  })}
                  <tr className="sd-total">
                    <td style={OT_TD} />
                    <td style={{ ...OT_TD, fontSize: 11, fontWeight: 700, color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.06em" }}>Jami</td>
                    {([["all", "total", "#2196F3", "barcha sdelkalar", {}],
                       ["process", "in_process", "#FF9800", "jarayonda", { kind: "process" }],
                       ["won", "won", "#4CAF50", wonLabel, { kind: "won" }],
                       ["lost", "lost", "#F44336", lostLabel, { kind: "lost" }]] as const).map(([col, key, color, title, f]) => (
                      <OtCell key={col} total value={colTotal[key]} max={colTotal[key]} color={color} active={isOpen("conv", "__total__", col)}
                        onClick={() => toggle({ table: "conv", row: "__total__", col, title: `${pipelineLabel} · ${title}`, filter: f })} />
                    ))}
                    <KonvCell total value={pct(colTotal.won, colTotal.total)} max={konvMaxMgr} />
                  </tr>
                  {rowOpen("conv", "__total__") && <tr>{framedDrill(7)}</tr>}
                </tbody>
              </table>
            </div>
          )}
        </Section>

        {/* ══════════════════════════════════════════════════════════
            Bekor bo'lish sabablari
        ══════════════════════════════════════════════════════════ */}
        <Section
          icon={<Info size={16} style={{ color: "#FFC107" }} />}
          title="Bekor bo'lish sabablari"
          right={
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <Segmented value={reasonScope} onChange={(s) => { setReasonScope(s); setShownReasons(REASONS_PAGE); setDrill(d => d?.table === "reasons" ? null : d); }}
                options={[
                  { value: "lost", label: "Bekor bo'lganlar", color: "#F44336" },
                  { value: "all",  label: "Barcha sdelkalar", color: "#6366f1" },
                ]} />
              <span style={{ fontSize: 20, fontWeight: 800, color: "#FFC107" }}>{fmtNum(reasonTotal)}</span>
            </div>
          }>
          {reasonsQ.isLoading ? <Loading /> : reasonItems.length === 0 ? <Empty /> : (
            // Same layout as the Lidlar page's reasons panel (ReasonsCard): label column sized to the
            // longest reason, the bar right after it, count and share in fixed columns so they line up.
            <div style={{ padding: "6px 0 10px" }}>
              {reasonItems.slice(0, shownReasons).map((r) => {
                const open = rowOpen("reasons", r.reason_id);
                const unspecified = r.reason_id === NONE_KEY;
                const barColor = unspecified ? "#9E9E9E" : "#FFC107";
                // One counted stage (YANGI: Bekor bo'ldi) → pin it, so the list skips a Bosqich column that would repeat it.
                const onlyStage = reasonScope === "lost" && reasons?.available && reasons.scope_stages?.length === 1 ? reasons.scope_stages[0].id : undefined;
                const go = () => toggle({ table: "reasons", row: r.reason_id, col: "n", title: `Причина · ${r.reason}`, filter: { reason: r.reason_id, reason_scope: reasonScope, ...(onlyStage ? { stage: onlyStage } : {}) } });
                return (
                  <Fragment key={r.reason_id}>
                    <div role="button" tabIndex={0} onClick={go} onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } }}
                      className="sd-reason" title={`${r.reason}: ${fmtNum(r.total)} ta — bosing, sdelkalar ro'yxati`}
                      style={{
                        display: "grid", gridTemplateColumns: reasonGrid, gap: 14, alignItems: "center",
                        padding: "9px 20px", cursor: "pointer", background: open ? "rgba(255,193,7,0.07)" : undefined,
                        borderTop: unspecified && reasonItems.length > 1 ? "1px solid var(--border)" : undefined,
                      }}>
                      <span style={{
                        fontSize: 12.5, lineHeight: 1.25, wordBreak: "break-word",
                        color: unspecified ? "var(--text3)" : open ? "var(--text)" : "var(--text2)",
                        fontStyle: unspecified ? "italic" : "normal", fontWeight: open ? 600 : 500,
                      }}>{r.reason}</span>
                      <div style={{ position: "relative", height: 18 }}>
                        <div style={{ position: "absolute", left: 0, right: 0, top: "50%", transform: "translateY(-50%)", height: 8, borderRadius: 5, background: "var(--bg4)" }} />
                        <div style={{ position: "absolute", left: 0, top: "50%", transform: "translateY(-50%)", width: `${Math.min(100, (r.total / reasonMax) * 100)}%`, minWidth: r.total > 0 ? 6 : 0, height: 8, borderRadius: 5, background: barColor, transition: "width 0.3s" }} />
                      </div>
                      <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", textAlign: "right", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{fmtNum(r.total)}</span>
                      <span style={{ fontSize: 12, color: "var(--text2)", textAlign: "right", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{fmtShare(pct(r.total, reasonTotal))}%</span>
                      <ChevronDown size={12} style={{ color: "var(--text3)", transform: open ? "rotate(180deg)" : "none", transition: "transform 0.15s" }} />
                    </div>
                    {open && drillPanel()}
                  </Fragment>
                );
              })}
              {shownReasons < reasonItems.length && (
                <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 20px 2px" }}>
                  <button type="button" onClick={() => setShownReasons(n => n + REASONS_PAGE)} style={moreBtn}>
                    Yana {Math.min(REASONS_PAGE, reasonItems.length - shownReasons)} ta <ChevronDown size={12} />
                  </button>
                  <button type="button" onClick={() => setShownReasons(reasonItems.length)} style={moreBtn}>Barchasi ({reasonItems.length})</button>
                  <span style={{ fontSize: 11, color: "var(--text3)", marginLeft: "auto" }}>{shownReasons} / {reasonItems.length}</span>
                </div>
              )}
            </div>
          )}
        </Section>

        {/* ══════════════════════════════════════════════════════════
            Manba bo'yicha (Источник)
        ══════════════════════════════════════════════════════════ */}
        <Section
          icon={<Users size={16} style={{ color: "#9C27B0" }} />}
          title="Manba bo'yicha">
          {sourcesQ.isLoading ? <Loading /> : srcRows.length === 0 ? <Empty /> : (
            <div style={{ overflowX: "auto", padding: "14px 8px 6px" }}>
              <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0 }}>
                <thead>
                  <tr>
                    <th style={{ ...OT_TH, width: "1%", textAlign: "center" }}>#</th>
                    <th style={{ ...OT_TH, width: "1%" }}>Manba</th>
                    <th style={{ ...OT_TH, width: "17%" }}>Umumiy</th>
                    <th style={{ ...OT_TH, width: "17%" }}>Jarayonda</th>
                    <th style={{ ...OT_TH, width: "17%" }}>{wonLabel}</th>
                    <th style={{ ...OT_TH, width: "17%" }}>{lostLabel}</th>
                    <th style={{ ...OT_TH, width: "14%", textAlign: "right" }}>Konversiya</th>
                  </tr>
                </thead>
                <tbody>
                  {srcRows.map((r, i) => {
                    const open = rowOpen("src", r.source_id);
                    const drillFor = (col: string, title: string, f: Partial<PipelineDealsFilter>) =>
                      () => toggle({ table: "src", row: r.source_id, col, title: `${r.source_name} · ${title}`, filter: { source: r.source_id, ...f } });
                    return (
                      <Fragment key={r.source_id}>
                        <tr className={`sd-op${open ? " sd-open" : ""}`} style={{ cursor: "pointer" }} onClick={drillFor("all", "barcha sdelkalar", {})}>
                          <td style={{ ...OT_TD, textAlign: "center" }}>
                            <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text3)" }}>{rankLabel(i, false)}</span>
                          </td>
                          <td style={{ ...OT_TD, whiteSpace: "nowrap" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                              <span style={{ fontSize: 13.5, fontWeight: 600, color: "var(--text)", fontStyle: r.source_id === NONE_KEY ? "italic" : "normal" }}>{r.source_name}</span>
                              {r.source_id !== NONE_KEY && (
                                <span title="Bitrix SOURCE_ID" style={{ fontSize: 10, fontFamily: "monospace", color: "var(--text3)", background: "var(--bg3)", border: "1px solid var(--border)", borderRadius: 4, padding: "0 5px" }}>
                                  {r.source_id}
                                </span>
                              )}
                            </div>
                          </td>
                          <OtCell value={r.total} max={srcMax.total} color="#2196F3" active={isOpen("src", r.source_id, "all")} onClick={drillFor("all", "barcha sdelkalar", {})} />
                          <OtCell value={r.in_process} max={srcMax.in_process} color="#FF9800" active={isOpen("src", r.source_id, "process")} onClick={drillFor("process", "jarayonda", { kind: "process" })} />
                          <OtCell value={r.won} max={srcMax.won} color="#4CAF50" active={isOpen("src", r.source_id, "won")} onClick={drillFor("won", wonLabel, { kind: "won" })} />
                          <OtCell value={r.lost} max={srcMax.lost} color="#F44336" active={isOpen("src", r.source_id, "lost")} onClick={drillFor("lost", lostLabel, { kind: "lost" })} />
                          <KonvCell value={pct(r.won, r.total)} max={konvMaxSrc} />
                        </tr>
                        {open && <tr>{framedDrill(7)}</tr>}
                      </Fragment>
                    );
                  })}
                  <tr className="sd-total">
                    <td style={OT_TD} />
                    <td style={{ ...OT_TD, fontSize: 11, fontWeight: 700, color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.06em" }}>Jami</td>
                    <OtCell total value={srcTotal.total} max={srcTotal.total} color="#2196F3" />
                    <OtCell total value={srcTotal.in_process} max={srcTotal.in_process} color="#FF9800" />
                    <OtCell total value={srcTotal.won} max={srcTotal.won} color="#4CAF50" />
                    <OtCell total value={srcTotal.lost} max={srcTotal.lost} color="#F44336" />
                    <KonvCell total value={pct(srcTotal.won, srcTotal.total)} max={konvMaxSrc} />
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

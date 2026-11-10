/**
 * The lead funnel by one grouping (Manba, Sabab, Manba 1, Hudud): one compact row per group —
 * leads, sifatli, tashrif belgilandi / uspeshniy lid, sifatsiz, bekor, and the two rates — sized to
 * the screen instead of scrolling sideways. A row opens its leads (the page owns the panel).
 */
import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { fmtNum } from "@/lib/utils";
import { InfoTip } from "@/components/InfoTip";
import { EmptyState, ErrorState, LoadingRows } from "@/components/DataState";

export type FunnelRow = {
  key: string;
  name: string;
  umumiy: number;
  sifatli: number;
  konsB: number;
  konsO: number;
  sifatsiz: number;
  bekor: number;
};

const COLS = [
  { k: "umumiy",   label: "Lidlar",          full: "Umumiy lidlar",                          color: "#2563EB" },
  { k: "sifatli",  label: "Sifatli",         full: "Sifatli lidlar",                         color: "#0891B2" },
  { k: "konsB",    label: "Tashrif belg.",   full: "Tashrif belgilandi",                     color: "#7C3AED" },
  { k: "konsO",    label: "Uspeshniy lid",   full: "Uspeshniy lid (Успешный лид bosqichi)",  color: "#16A34A" },
  { k: "sifatsiz", label: "Sifatsiz",        full: "Sifatsiz",                               color: "#DC2626" },
  { k: "bekor",    label: "Bekor",           full: "Bekor bo'ldi",                           color: "#D97706" },
] as const;

const CSS = `
  .ft-row { cursor: pointer; }
  .ft-row td { transition: background .12s; }
  .ft-row:hover td { background: var(--bg3); }
  .ft-row[data-sel] td { background: rgba(37,99,235,.07); }
`;

const pct = (a: number, b: number) => (b > 0 ? (a / b) * 100 : 0);
const fmtPct = (p: number) => (p >= 10 || p === 0 ? p.toFixed(0) : p.toFixed(1)) + "%";

/** A rate as coloured text: deeper green the higher it is, a faint dash at zero. */
function Rate({ p }: { p: number }) {
  if (!p) return <span style={{ color: "var(--text3)" }}>—</span>;
  const tone = p >= 50 ? "#15803D" : p >= 20 ? "#16A34A" : p >= 5 ? "#65A30D" : "#A3A3A3";
  return <span style={{ fontWeight: 700, color: tone, fontVariantNumeric: "tabular-nums" }}>{fmtPct(p)}</span>;
}

export function FunnelTable({ title, info, nameLabel, rows, loading, error, onRetry, selectedKey, onSelect, showTotal = true, pageSize = 12 }: {
  title: string;
  info: React.ReactNode;
  /** Header of the first column (MANBA, SABAB, ...). */
  nameLabel: string;
  rows: FunnelRow[];
  loading?: boolean;
  error?: boolean;
  onRetry?: () => void;
  selectedKey?: string | null;
  onSelect?: (key: string) => void;
  showTotal?: boolean;
  pageSize?: number;
}) {
  const [shown, setShown] = useState(pageSize);
  const max = Object.fromEntries(COLS.map((c) => [c.k, Math.max(1, ...rows.map((r) => r[c.k]))])) as Record<string, number>;
  const total = COLS.reduce((t, c) => ({ ...t, [c.k]: rows.reduce((s, r) => s + r[c.k], 0) }), {} as Record<string, number>);

  const TH: React.CSSProperties = { padding: "10px 12px", fontSize: 11, fontWeight: 600, letterSpacing: "0.04em", textTransform: "uppercase", color: "var(--text3)", textAlign: "left", borderBottom: "1px solid var(--border)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" };
  const TD: React.CSSProperties = { padding: "9px 12px", borderBottom: "1px solid var(--border)", verticalAlign: "middle" };

  const metric = (v: number, m: number, color: string, bold = false) =>
    v ? (
      <div>
        <span style={{ fontSize: 13.5, fontWeight: bold ? 700 : 600, color: "var(--text)", fontVariantNumeric: "tabular-nums" }}>{fmtNum(v)}</span>
        <div style={{ height: 3, borderRadius: 2, background: "var(--bg4)", marginTop: 4, maxWidth: 96, overflow: "hidden" }}>
          <div style={{ height: "100%", width: `${Math.max(3, (v / m) * 100)}%`, background: color, borderRadius: 2 }} />
        </div>
      </div>
    ) : <span style={{ color: "var(--text3)" }}>—</span>;

  return (
    <div style={{ background: "var(--bg2)", borderRadius: 12, overflow: "hidden", marginBottom: 16, border: "1px solid var(--border)" }}>
      <style>{CSS}</style>
      <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 16, fontWeight: 700, color: "var(--text)" }}>{title}</span>
        <InfoTip text={info} label={`${title} — izoh`} size={14} />
        {!loading && rows.length > 0 && <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--text3)" }}>{rows.length} ta</span>}
      </div>
      {loading ? (
        <LoadingRows />
      ) : error ? (
        <ErrorState onRetry={onRetry} />
      ) : !rows.length ? (
        <EmptyState title="Bu davrda ma'lumot yo'q" />
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
          <colgroup>
            <col style={{ width: "22%" }} />
            {COLS.map((c) => <col key={c.k} style={{ width: "10.5%" }} />)}
            <col style={{ width: "7.5%" }} /><col style={{ width: "7.5%" }} />
          </colgroup>
          <thead>
            <tr>
              <th style={TH}>{nameLabel}</th>
              {COLS.map((c) => (
                <th key={c.k} title={c.full} style={TH}>
                  <span style={{ display: "inline-block", width: 7, height: 7, borderRadius: "50%", background: c.color, marginRight: 6, verticalAlign: "middle" }} />{c.label}
                </th>
              ))}
              <th title="Uspeshniy lid ÷ umumiy lidlar" style={{ ...TH, textAlign: "right" }}>Konv.</th>
              <th title="Sifatli ÷ umumiy lidlar" style={{ ...TH, textAlign: "right" }}>Sifatli %</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, shown).map((r) => (
              <tr key={r.key} className="ft-row" data-sel={selectedKey === r.key || undefined} onClick={() => onSelect?.(r.key)}>
                <td style={{ ...TD, fontSize: 13.5, fontWeight: 600, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.name}>{r.name}</td>
                {COLS.map((c) => <td key={c.k} style={TD}>{metric(r[c.k], max[c.k], c.color)}</td>)}
                <td style={{ ...TD, textAlign: "right", fontSize: 13 }}><Rate p={pct(r.konsO, r.umumiy)} /></td>
                <td style={{ ...TD, textAlign: "right", fontSize: 13 }}><Rate p={pct(r.sifatli, r.umumiy)} /></td>
              </tr>
            ))}
            {showTotal && (
              <tr style={{ background: "var(--bg3)" }}>
                <td style={{ ...TD, fontSize: 12, fontWeight: 700, letterSpacing: "0.06em", color: "var(--text2)" }}>JAMI</td>
                {COLS.map((c) => (
                  <td key={c.k} style={TD}>
                    {total[c.k] ? <span style={{ fontSize: 13.5, fontWeight: 700, color: "var(--text)", fontVariantNumeric: "tabular-nums" }}>{fmtNum(total[c.k])}</span> : <span style={{ color: "var(--text3)" }}>—</span>}
                  </td>
                ))}
                <td style={{ ...TD, textAlign: "right", fontSize: 13 }}><Rate p={pct(total.konsO, total.umumiy)} /></td>
                <td style={{ ...TD, textAlign: "right", fontSize: 13 }}><Rate p={pct(total.sifatli, total.umumiy)} /></td>
              </tr>
            )}
          </tbody>
        </table>
      )}
      {!loading && rows.length > shown && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px" }}>
          <button onClick={() => setShown((n) => n + pageSize)}
            style={{ display: "inline-flex", alignItems: "center", gap: 5, background: "var(--bg3)", border: "1px solid var(--border)", borderRadius: 7, color: "var(--text2)", fontSize: 12, fontWeight: 600, padding: "5px 12px", cursor: "pointer" }}>
            Yana {Math.min(pageSize, rows.length - shown)} ta <ChevronDown size={12} />
          </button>
          <button onClick={() => setShown(rows.length)}
            style={{ background: "transparent", border: "1px solid var(--border)", borderRadius: 7, color: "var(--text2)", fontSize: 12, fontWeight: 600, padding: "5px 12px", cursor: "pointer" }}>
            Barchasi ({rows.length})
          </button>
          <span style={{ fontSize: 11.5, color: "var(--text3)", marginLeft: "auto" }}>{Math.min(shown, rows.length)} / {rows.length}</span>
        </div>
      )}
    </div>
  );
}

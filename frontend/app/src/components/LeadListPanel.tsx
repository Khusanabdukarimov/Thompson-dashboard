/**
 * The leads behind a number, as shown inside a SidePanel: stage chips with counts (click to
 * narrow), a search, and one clean list — lead, created date, stage. Every Lidlar table that
 * opens "its leads" uses this, so they all read the same.
 */
import { useMemo, useState } from "react";
import { ExternalLink, Search } from "lucide-react";
import { fmtNum } from "@/lib/utils";
import { useBitrixPortal } from "@/lib/api/config";
import { leadStageColor, leadStageLabel } from "@/lib/leadStages";
import { EmptyState, ErrorState, LoadingRows } from "@/components/DataState";
import { Dot } from "@/components/StatusMark";
import { openLead } from "@/lib/status";

export type PanelLead = { id: number; title?: string | null; name?: string | null; last_name?: string | null; stage_bid?: string | null; date_create?: string | null };

const PAGE = 200;
const fmtDay = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "2-digit" }) : "—");

export function LeadListPanel({ leads, loading, error, onRetry }: {
  leads?: PanelLead[];
  loading?: boolean;
  error?: boolean;
  onRetry?: () => void;
}) {
  const portal = useBitrixPortal();
  const [stage, setStage] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [shown, setShown] = useState(PAGE);

  const all = leads ?? [];
  const stages = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of all) if (l.stage_bid) m.set(l.stage_bid, (m.get(l.stage_bid) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [all]);
  const needle = search.trim().toLowerCase();
  const rows = all.filter((l) =>
    (!stage || l.stage_bid === stage) &&
    (!needle || [l.title, l.name, l.last_name, String(l.id)].some((v) => (v ?? "").toLowerCase().includes(needle))));

  if (loading) return <LoadingRows rows={8} />;
  if (error) return <ErrorState onRetry={onRetry} />;
  if (!all.length) return <EmptyState title="Lid topilmadi" />;

  const chip = (active: boolean, color: string): React.CSSProperties => ({
    display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 600, padding: "5px 11px", borderRadius: 999, cursor: "pointer", whiteSpace: "nowrap",
    border: `1px solid ${active ? color : "var(--border)"}`, background: active ? `${color}14` : "var(--bg2)", color: active ? color : "var(--text2)",
  });
  const TH: React.CSSProperties = { position: "sticky", top: 56, zIndex: 1, padding: "9px 16px", textAlign: "left", fontSize: 11, fontWeight: 600, letterSpacing: "0.04em", textTransform: "uppercase", color: "var(--text3)", background: "var(--bg2)", borderBottom: "1px solid var(--border)", whiteSpace: "nowrap" };
  const TD: React.CSSProperties = { padding: "10px 16px", borderBottom: "1px solid var(--border)", verticalAlign: "middle" };

  return (
    <div>
      <style>{`
        .ll-row { cursor: pointer; }
        .ll-row td { transition: background .12s; }
        .ll-row:hover td { background: var(--bg3); }
        .ll-go { flex-shrink: 0; color: var(--text3); opacity: 0; transition: opacity .12s; }
        .ll-row:hover .ll-go { opacity: 1; }
      `}</style>
      <div style={{ position: "sticky", top: 0, zIndex: 3, height: 56, boxSizing: "border-box", display: "flex", alignItems: "center", gap: 8, padding: "0 16px", borderBottom: "1px solid var(--border)", background: "var(--bg2)" }}>
        <div style={{ display: "flex", gap: 8, overflowX: "auto", flex: 1, minWidth: 0, scrollbarWidth: "none" }}>
          <button style={chip(!stage, "#64748B")} onClick={() => setStage(null)}>Hammasi <b style={{ opacity: 0.75 }}>{fmtNum(all.length)}</b></button>
          {stages.map(([bid, n]) => (
            <button key={bid} style={chip(stage === bid, leadStageColor(bid))} onClick={() => setStage(stage === bid ? null : bid)}>
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: leadStageColor(bid) }} />
              {leadStageLabel(bid)} <b style={{ opacity: 0.75 }}>{fmtNum(n)}</b>
            </button>
          ))}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, border: "1px solid var(--border)", borderRadius: 8, padding: "4px 10px", background: "var(--bg)", flexShrink: 0 }}>
          <Search size={13} style={{ color: "var(--text3)" }} />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Lid yoki telefon"
            style={{ border: 0, outline: "none", background: "transparent", color: "var(--text)", fontSize: 12.5, width: 140 }} />
        </div>
      </div>

      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr>
            <th style={{ ...TH, width: 48, textAlign: "center" }}>#</th>
            <th style={TH}>Lid</th>
            <th style={{ ...TH, width: 110 }}>Yaratilgan</th>
            <th style={{ ...TH, width: 200 }}>Bosqich</th>
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, shown).map((l, i) => {
            const color = leadStageColor(l.stage_bid);
            const title = l.title || [l.name, l.last_name].filter(Boolean).join(" ") || `Lid #${l.id}`;
            return (
              // The whole row opens the lead in Bitrix.
              <tr key={l.id} className="ll-row" title="Bosing — lidni Bitrix'da ochish" onClick={() => openLead(portal, l.id)}>
                <td style={{ ...TD, textAlign: "center", color: "var(--text3)", fontSize: 12, fontVariantNumeric: "tabular-nums" }}>{i + 1}</td>
                <td style={{ ...TD, maxWidth: 420 }}>
                  <span title={title} style={{ display: "inline-flex", alignItems: "center", gap: 6, maxWidth: "100%", color: "var(--text)", fontWeight: 500 }}>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</span>
                    <ExternalLink size={12} className="ll-go" />
                  </span>
                </td>
                <td style={{ ...TD, color: "var(--text2)", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{fmtDay(l.date_create)}</td>
                <td style={TD}>
                  {l.stage_bid ? <Dot color={color}><span style={{ color: "var(--text)" }}>{leadStageLabel(l.stage_bid)}</span></Dot> : "—"}
                </td>
              </tr>
            );
          })}
          {!rows.length && <tr><td colSpan={4} style={{ padding: 24, textAlign: "center", color: "var(--text3)" }}>Bu filtr bo'yicha lid yo'q</td></tr>}
        </tbody>
      </table>
      {rows.length > shown && (
        <div style={{ padding: 14, textAlign: "center" }}>
          <button onClick={() => setShown((n) => n + PAGE)} style={{ fontSize: 12.5, fontWeight: 600, padding: "7px 16px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg2)", color: "var(--text)", cursor: "pointer" }}>
            Yana {fmtNum(Math.min(PAGE, rows.length - shown))} ta ko'rsatish
          </button>
        </div>
      )}
    </div>
  );
}

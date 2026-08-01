// Bekor bo'lish / Sifatsiz reason panel — ported from the Jahonschool dashboard
// so both products read the same way. Each reason expands to the leads behind
// it, paged 8 at a time, with a link straight into the CRM.
import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { fmtNum } from "@/lib/utils";
import { useBitrixPortal } from "@/lib/api/config";
import { getReasonLeads, type ReasonLeadRow, type DashFilter } from "@/lib/api/leads";

type ReasonItem = { reason: string; total: number };

/** One shared label width per panel — a per-row fit-content column would make
 *  every bar start at a different x. */
function labelColumn(labels: string[]) {
  const longest = labels.reduce((m, l) => Math.max(m, (l ?? "").length), 0);
  return `${Math.min(26, Math.max(3, longest))}ch`;
}

export function ReasonsCard({ title, items, loading, barColor, kind, filter }: {
  title: string;
  items: ReasonItem[];
  loading: boolean;
  barColor: string;
  kind: "cancel" | "junk";
  filter: DashFilter;
}) {
  const PAGE = 8;
  const portal = useBitrixPortal();
  const grandTotal = items.reduce((s, r) => s + r.total, 0);
  const max = Math.max(1, ...items.map(r => r.total));
  const GRID = `${labelColumn(items.map(i => i.reason))} 1fr 68px 18px`;
  const GAP = 14;

  const [openReason, setOpenReason] = useState<string | null>(null);
  const [leads, setLeads] = useState<ReasonLeadRow[]>([]);
  const [leadsLoading, setLeadsLoading] = useState(false);
  const [leadsError, setLeadsError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);

  const fetchPage = async (reason: string, offset: number) => {
    setLeadsLoading(true); setLeadsError(null);
    try {
      const resp = await getReasonLeads({
        kind, reason,
        start_date: filter.start_date, end_date: filter.end_date,
        responsible_ids: filter.responsible_ids, proekts: filter.proekts, mode: filter.mode,
        limit: PAGE, offset,
      });
      const rows = Array.isArray(resp?.items) ? resp.items : [];
      setLeads(prev => (offset === 0 ? rows : [...prev, ...rows]));
      setHasMore(rows.length === PAGE);
    } catch {
      setLeadsError("Ro'yxatni yuklab bo'lmadi");
    } finally { setLeadsLoading(false); }
  };

  const toggle = (reason: string) => {
    if (openReason === reason) { setOpenReason(null); setLeads([]); setHasMore(false); return; }
    setOpenReason(reason); setLeads([]); setHasMore(false); void fetchPage(reason, 0);
  };

  return (
    <div style={{ background: "var(--bg2)", borderRadius: 12, overflow: "hidden", display: "flex", flexDirection: "column" }}>
      <div style={{ padding: "16px 22px 14px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text)" }}>{title}</div>
        </div>
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <div style={{ fontSize: 22, fontWeight: 800, color: barColor, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>{fmtNum(grandTotal)}</div>
          <div style={{ fontSize: 10, color: "var(--text3)", letterSpacing: "0.06em", textTransform: "uppercase", marginTop: 3 }}>jami</div>
        </div>
      </div>

      {loading ? (
        <div style={{ padding: 24, color: "var(--text3)", fontSize: 13 }}>Yuklanmoqda…</div>
      ) : items.length === 0 ? (
        <div style={{ padding: 24, color: "var(--text3)", fontSize: 13 }}>Ma'lumot yo'q</div>
      ) : (
        <div style={{ padding: "6px 0 10px" }}>
          {items.map((r) => {
            const isOpen = openReason === r.reason;
            return (
              <div key={r.reason}>
                <div onClick={() => toggle(r.reason)} title={`${r.reason}: ${fmtNum(r.total)}`}
                  style={{ display: "grid", gridTemplateColumns: GRID, gap: GAP, alignItems: "center", padding: "9px 20px", cursor: "pointer", background: isOpen ? "rgba(59,130,246,0.06)" : "transparent" }}
                  onMouseEnter={e => { if (!isOpen) (e.currentTarget as HTMLElement).style.background = "var(--bg3)"; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = isOpen ? "rgba(59,130,246,0.06)" : "transparent"; }}>
                  <span style={{ fontSize: 12.5, color: isOpen ? "var(--text)" : "var(--text2)", fontWeight: isOpen ? 600 : 500, textAlign: "left", lineHeight: 1.25, wordBreak: "break-word" }}>{r.reason}</span>
                  <div style={{ position: "relative", height: 18 }}>
                    <div style={{ position: "absolute", left: 0, right: 0, top: "50%", transform: "translateY(-50%)", height: 8, borderRadius: 5, background: "var(--bg4)" }} />
                    <div style={{ position: "absolute", left: 0, top: "50%", transform: "translateY(-50%)", width: `${(r.total / max) * 100}%`, minWidth: r.total > 0 ? 6 : 0, height: 8, borderRadius: 5, background: barColor, transition: "width 0.3s" }} />
                  </div>
                  {/* Fixed column — a value floated at the bar end lands at a
                      different x on every row and becomes unscannable. */}
                  <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", fontVariantNumeric: "tabular-nums", textAlign: "right", whiteSpace: "nowrap" }}>{fmtNum(r.total)}</span>
                  <ChevronDown size={12} style={{ color: "var(--text3)", transform: isOpen ? "rotate(180deg)" : "none", transition: "transform 0.15s" }} />
                </div>

                {isOpen && (
                  <div style={{ padding: "4px 0 10px", borderBottom: "1px solid var(--border)" }}>
                    {leads.map(l => (
                      <div key={l.id} style={{ display: "grid", gridTemplateColumns: GRID, gap: GAP, padding: "5px 20px" }}>
                        <span />
                        <div style={{ gridColumn: "2 / span 3", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, minWidth: 0 }}>
                          <a href={`${portal}/crm/lead/details/${l.id}/`} target="_blank" rel="noopener noreferrer"
                             style={{ fontSize: 12, color: "#2196F3", textDecoration: "underline", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
                            {l.title || [l.name, l.last_name].filter(Boolean).join(" ") || `Lid #${l.id}`}
                          </a>
                          <span style={{ fontSize: 11, color: "var(--text3)", flexShrink: 0 }}>
                            {l.date_create ? String(l.date_create).slice(0, 10) : ""}
                          </span>
                        </div>
                      </div>
                    ))}
                    <div style={{ display: "grid", gridTemplateColumns: GRID, gap: GAP, padding: "0 20px" }}>
                      <span />
                      <div style={{ gridColumn: "2 / span 3" }}>
                        {leadsError && <div style={{ fontSize: 11.5, color: "var(--text3)", padding: "6px 0" }}>{leadsError}</div>}
                        {leadsLoading && <div style={{ fontSize: 11.5, color: "var(--text3)", padding: "6px 0" }}>Yuklanmoqda…</div>}
                        {!leadsLoading && !leadsError && hasMore && (
                          <button onClick={() => void fetchPage(r.reason, leads.length)}
                                  style={{ marginTop: 6, background: "var(--bg3)", border: "1px solid var(--border)", borderRadius: 7, color: "var(--text2)", fontSize: 11.5, fontWeight: 600, padding: "5px 12px", cursor: "pointer" }}>
                            Yana {PAGE} ta ko'rsatish
                          </button>
                        )}
                        {!leadsLoading && !leadsError && !hasMore && leads.length > 0 && (
                          <div style={{ fontSize: 11, color: "var(--text3)", paddingTop: 6 }}>Hammasi ko'rsatildi ({leads.length} ta)</div>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

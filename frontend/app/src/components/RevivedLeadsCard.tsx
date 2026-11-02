/**
 * "Qayta tiklangan lidlar" — leads an operator won back: Muvaffaqiyatli after having been
 * Bekor bo'ldi, Sifatsiz or Arxiv 30+. One row per operator, split by where the lead came
 * back from; a row opens that operator's leads.
 */
import { Fragment, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ExternalLink, RotateCcw } from "lucide-react";
import { EmptyState, ErrorState, LoadingRows } from "@/components/DataState";
import { fmtNum } from "@/lib/utils";
import { InfoTip } from "@/components/InfoTip";
import { useBitrixPortal } from "@/lib/api/config";
import { getRevivedLeads, type DashFilter, type RevivedLead } from "@/lib/api/leads";

const FROM_STAGES = [
  { bid: "UC_L8G2B9", label: "Bekor bo'ldidan", short: "Bekor bo'ldi", color: "#D97706" },
  { bid: "JUNK",      label: "Sifatsizdan",     short: "Sifatsiz",     color: "#DC2626" },
  { bid: "UC_GSPVUS", label: "Arxivdan",        short: "Arxiv 30+",    color: "#78716C" },
] as const;
const WON = "#16A34A";

type OpRow = { key: string; name: string; byStage: Record<string, number>; total: number; leads: RevivedLead[] };

const fmtDay = (iso: string) => new Date(iso).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "2-digit" });
const daysBetween = (a: string, b: string) => Math.max(0, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86_400_000));

export function RevivedLeadsCard({ filter }: { filter: DashFilter }) {
  const portal = useBitrixPortal();
  const q = useQuery({ queryKey: ["stats/revived-leads", filter], queryFn: () => getRevivedLeads(filter) });
  const [open, setOpen] = useState<string | null>(null);

  const { ops, totals, all } = useMemo(() => {
    const items = q.data?.items ?? [];
    const m = new Map<string, OpRow>();
    for (const it of items) {
      const key = String(it.responsible_id ?? "none");
      if (!m.has(key)) m.set(key, { key, name: it.full_name || "Mas'ulsiz", byStage: {}, total: 0, leads: [] });
      const r = m.get(key)!;
      r.byStage[it.dead_stage] = (r.byStage[it.dead_stage] ?? 0) + 1;
      r.total += 1;
      r.leads.push(it);
    }
    const totals: Record<string, number> = {};
    for (const it of items) totals[it.dead_stage] = (totals[it.dead_stage] ?? 0) + 1;
    return { ops: [...m.values()].sort((a, b) => b.total - a.total), totals, all: items.length };
  }, [q.data]);
  const max = Math.max(1, ...ops.map((o) => o.total));

  const TH: React.CSSProperties = { padding: "9px 16px", fontSize: 11, fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase", color: "var(--text3)", textAlign: "left", borderBottom: "1px solid var(--border)", whiteSpace: "nowrap" };
  const TD: React.CSSProperties = { padding: "11px 16px", borderBottom: "1px solid var(--border)", verticalAlign: "middle" };

  return (
    <div style={{ background: "var(--bg2)", borderRadius: 12, overflow: "hidden", marginBottom: 16 }}>
      <div style={{ padding: "16px 20px 14px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
        <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 18, fontWeight: 700, color: "var(--text)" }}>
          <RotateCcw size={18} style={{ color: WON }} />
          Qayta tiklangan lidlar
          <InfoTip
            text="Bekor bo‘ldi, Sifatsiz yoki Arxiv 30+ bosqichida bo‘lgan, keyin Muvaffaqiyatli bo‘lgan leadlar — operator qaytarib olgan mijozlar. Davr — lead Muvaffaqiyatli bo‘lgan sana bo‘yicha (yaratilgan sana emas). Lead hozirgi mas’uliga yoziladi. “Qayerdan” — Muvaffaqiyatlidan oldin oxirgi turgan o‘sha bosqich. Ma’lumot 2026-yil iyuldan beri bor. Qatorni bossangiz, leadlar ro‘yxati ochiladi."
            label="Qayta tiklangan lidlar — izoh" size={15} />
        </span>
        {/* Totals by where the leads came back from */}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginLeft: "auto" }}>
          <span style={{ fontSize: 12.5, fontWeight: 700, color: WON, background: `${WON}14`, borderRadius: 999, padding: "4px 12px" }}>Jami {fmtNum(all)}</span>
          {FROM_STAGES.map((s) => (
            <span key={s.bid} style={{ fontSize: 12.5, color: "var(--text2)", border: "1px solid var(--border)", borderRadius: 999, padding: "3px 11px", display: "inline-flex", alignItems: "center", gap: 6 }}>
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: s.color }} />
              {s.label} <b style={{ color: "var(--text)" }}>{fmtNum(totals[s.bid] ?? 0)}</b>
            </span>
          ))}
        </div>
      </div>

      {q.isLoading ? (
        <LoadingRows />
      ) : q.isError ? (
        <ErrorState onRetry={() => q.refetch()} />
      ) : !ops.length ? (
        <EmptyState title="Bu davrda qayta tiklangan lid yo'q" />
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr>
                <th style={{ ...TH, width: 40, textAlign: "center" }}>#</th>
                <th style={TH}>Operator</th>
                {FROM_STAGES.map((s) => <th key={s.bid} style={{ ...TH, textAlign: "right" }}>{s.label}</th>)}
                <th style={{ ...TH, width: "32%" }}>Jami qayta tiklangan</th>
              </tr>
            </thead>
            <tbody>
              {ops.map((o, i) => {
                const isOpen = open === o.key;
                return (
                  <Fragment key={o.key}>
                    <tr onClick={() => setOpen(isOpen ? null : o.key)} style={{ cursor: "pointer", background: isOpen ? `${WON}0D` : "transparent" }}
                      onMouseEnter={(e) => { if (!isOpen) e.currentTarget.style.background = "var(--bg3)"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = isOpen ? `${WON}0D` : "transparent"; }}>
                      <td style={{ ...TD, textAlign: "center", color: "var(--text3)", fontWeight: 600 }}>{i + 1}</td>
                      <td style={{ ...TD, fontWeight: 600, color: "var(--text)", whiteSpace: "nowrap" }}>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                          {o.name}
                          <ChevronDown size={14} style={{ color: "var(--text3)", transform: isOpen ? "rotate(180deg)" : "none", transition: "transform .18s" }} />
                        </span>
                      </td>
                      {FROM_STAGES.map((s) => (
                        <td key={s.bid} style={{ ...TD, textAlign: "right", fontVariantNumeric: "tabular-nums", color: o.byStage[s.bid] ? "var(--text)" : "var(--text3)", fontWeight: o.byStage[s.bid] ? 600 : 400 }}>
                          {o.byStage[s.bid] ?? "—"}
                        </td>
                      ))}
                      <td style={TD}>
                        {/* One bar per operator, split by where the leads came back from */}
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <div style={{ flex: 1, height: 8, borderRadius: 4, background: "var(--bg4)", overflow: "hidden", display: "flex" }}>
                            {FROM_STAGES.map((s) => (o.byStage[s.bid] ? (
                              <div key={s.bid} title={`${s.label}: ${o.byStage[s.bid]}`} style={{ width: `${(o.byStage[s.bid] / max) * 100}%`, background: s.color }} />
                            ) : null))}
                          </div>
                          <span style={{ minWidth: 28, textAlign: "right", fontWeight: 800, color: WON, fontVariantNumeric: "tabular-nums" }}>{o.total}</span>
                        </div>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr>
                        <td colSpan={6} style={{ padding: 0, borderBottom: "1px solid var(--border)", background: "var(--bg)" }}>
                          <div style={{ maxHeight: 360, overflowY: "auto" }}>
                            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
                              <thead>
                                <tr>
                                  {["Lid", "Qayerdan", "O'sha bosqichga tushgan", "Muvaffaqiyatli bo'lgan", "Oraliq"].map((h) => (
                                    <th key={h} style={{ ...TH, position: "sticky", top: 0, background: "var(--bg)", fontSize: 10.5 }}>{h}</th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {o.leads.map((l) => {
                                  const st = FROM_STAGES.find((s) => s.bid === l.dead_stage);
                                  return (
                                    <tr key={l.lead_id}>
                                      <td style={{ ...TD, maxWidth: 340, padding: "8px 16px" }}>
                                        <a href={portal ? `${portal}/crm/lead/details/${l.lead_id}/` : undefined} target="_blank" rel="noreferrer" title={l.title ?? undefined}
                                          style={{ display: "inline-flex", alignItems: "center", gap: 5, maxWidth: "100%", color: "#2563EB", textDecoration: "none" }}>
                                          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.title || `Lid #${l.lead_id}`}</span>
                                          <ExternalLink size={11} style={{ flexShrink: 0 }} />
                                        </a>
                                      </td>
                                      <td style={{ ...TD, padding: "8px 16px" }}>
                                        {st && <span style={{ fontSize: 11.5, fontWeight: 600, color: st.color, background: `${st.color}14`, border: `1px solid ${st.color}33`, borderRadius: 6, padding: "2px 8px", whiteSpace: "nowrap" }}>{st.short}</span>}
                                      </td>
                                      <td style={{ ...TD, padding: "8px 16px", color: "var(--text2)", whiteSpace: "nowrap" }}>{fmtDay(l.dead_at)}</td>
                                      <td style={{ ...TD, padding: "8px 16px", color: WON, fontWeight: 600, whiteSpace: "nowrap" }}>{fmtDay(l.converted_at)}</td>
                                      <td style={{ ...TD, padding: "8px 16px", color: "var(--text3)", whiteSpace: "nowrap" }}>{daysBetween(l.dead_at, l.converted_at)} kun</td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

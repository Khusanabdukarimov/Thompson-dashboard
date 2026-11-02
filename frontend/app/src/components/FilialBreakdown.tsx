/**
 * "Filiallar bo'yicha" on Sdelkalar: one bar per filial (or per viloyat), split into
 * Muvaffaqiyatli / Jarayonda / Yo'qotilgan, with the share won on the right. Readable at a
 * glance: the longest bar is the busiest branch, the green part is what it closed.
 * Clicking a bar filters the whole page to that filial (or viloyat); clicking again clears it.
 */
import { useMemo, useState } from "react";
import { MapPin } from "lucide-react";
import { EmptyState, LoadingRows } from "@/components/DataState";
import { fmtNum } from "@/lib/utils";
import { InfoTip } from "@/components/InfoTip";
import { NONE_KEY, type PipelineFilialRow } from "@/lib/api/pipelineDeals";

const C = { won: "#16A34A", process: "#3B82F6", lost: "#F87171" };
const TOP = 10;

type Bar = { id: string; name: string; sub?: string; total: number; won: number; in_process: number; lost: number };

export function FilialBreakdown({ rows, loading, selectedFilials, selectedRegions, onFilial, onRegion }: {
  rows: PipelineFilialRow[];
  loading: boolean;
  selectedFilials: string[];
  selectedRegions: string[];
  onFilial: (id: string) => void;
  onRegion: (id: string) => void;
}) {
  const [view, setView] = useState<"filial" | "region">("filial");
  const [all, setAll] = useState(false);

  const bars: Bar[] = useMemo(() => {
    if (view === "filial") {
      return rows.map((r) => ({ id: r.filial_id, name: r.name, sub: r.region_name ?? undefined, total: r.total, won: r.won, in_process: r.in_process, lost: r.lost }));
    }
    const m = new Map<string, Bar>();
    for (const r of rows) {
      const id = r.region_id ?? NONE_KEY;
      const name = r.region_name ?? "Filial ko'rsatilmagan";
      if (!m.has(id)) m.set(id, { id, name, total: 0, won: 0, in_process: 0, lost: 0 });
      const b = m.get(id)!;
      b.total += r.total; b.won += r.won; b.in_process += r.in_process; b.lost += r.lost;
    }
    return [...m.values()].sort((a, b) => b.total - a.total);
  }, [rows, view]);

  const max = Math.max(1, ...bars.map((b) => b.total));
  const grand = bars.reduce((s, b) => s + b.total, 0);
  const shown = all ? bars : bars.slice(0, TOP);
  const selected = view === "filial" ? selectedFilials : selectedRegions;
  const pick = view === "filial" ? onFilial : onRegion;

  const tab = (active: boolean): React.CSSProperties => ({
    fontSize: 12, fontWeight: 600, padding: "5px 12px", borderRadius: 7, border: 0, cursor: "pointer",
    background: active ? "var(--bg2)" : "transparent", color: active ? "var(--text)" : "var(--text3)",
    boxShadow: active ? "0 1px 3px rgba(0,0,0,0.12)" : "none",
  });

  return (
    <div style={{ background: "var(--bg2)", borderRadius: 12, overflow: "hidden", marginBottom: 16, border: "1px solid var(--border)" }}>
      <div style={{ padding: "16px 20px 12px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <MapPin size={18} style={{ color: "#6366F1" }} />
        <span style={{ fontSize: 18, fontWeight: 700, color: "var(--text)" }}>{view === "filial" ? "Filiallar bo'yicha" : "Viloyatlar bo'yicha"}</span>
        <InfoTip
          text="Sdelkalar Bitrix’dagi “Filial” maydoni bo‘yicha. Chiziq uzunligi — sdelkalar soni; yashil — muvaffaqiyatli, ko‘k — jarayonda, qizil — yo‘qotilgan. O‘ngdagi foiz — muvaffaqiyatli ÷ jami. Chiziqni bossangiz, butun sahifa shu filial bo‘yicha filtrlanadi; yana bossangiz — filtr olib tashlanadi."
          label="Filiallar bo'yicha — izoh" size={15} />
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
          {/* Legend */}
          {([["won", "Muvaffaqiyatli"], ["process", "Jarayonda"], ["lost", "Yo'qotilgan"]] as const).map(([k, l]) => (
            <span key={k} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text2)" }}>
              <span style={{ width: 10, height: 10, borderRadius: 3, background: C[k] }} />{l}
            </span>
          ))}
          <div style={{ display: "flex", gap: 2, padding: 3, borderRadius: 9, background: "var(--bg4)" }}>
            <button style={tab(view === "filial")} onClick={() => setView("filial")}>Filial</button>
            <button style={tab(view === "region")} onClick={() => setView("region")}>Viloyat</button>
          </div>
        </div>
      </div>

      {loading && !rows.length ? (
        <LoadingRows />
      ) : !bars.length ? (
        <EmptyState title="Bu davrda sdelka yo'q" />
      ) : (
        <div style={{ padding: "14px 20px 16px", display: "flex", flexDirection: "column", gap: 4 }}>
          {shown.map((b) => {
            const on = selected.includes(b.id);
            const dim = selected.length > 0 && !on;
            const wonPct = b.total ? Math.round((b.won / b.total) * 100) : 0;
            const seg = (n: number, color: string) => (n ? <div style={{ width: `${(n / b.total) * 100}%`, background: color }} /> : null);
            return (
              <button key={b.id} onClick={() => pick(b.id)}
                title={`${b.name}: ${fmtNum(b.total)} ta — muvaffaqiyatli ${fmtNum(b.won)}, jarayonda ${fmtNum(b.in_process)}, yo'qotilgan ${fmtNum(b.lost)}`}
                style={{
                  display: "grid", gridTemplateColumns: "minmax(140px, 220px) 1fr 64px 52px", alignItems: "center", gap: 14,
                  padding: "7px 10px", borderRadius: 8, border: `1px solid ${on ? "#6366F1" : "transparent"}`,
                  background: on ? "rgba(99,102,241,0.08)" : "transparent", cursor: "pointer", textAlign: "left",
                  opacity: dim ? 0.45 : 1, transition: "background .15s, opacity .15s",
                }}
                onMouseEnter={(e) => { if (!on) e.currentTarget.style.background = "var(--bg3)"; }}
                onMouseLeave={(e) => { if (!on) e.currentTarget.style.background = "transparent"; }}>
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: "block", fontSize: 13, fontWeight: 600, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{b.name}</span>
                  {b.sub && <span style={{ display: "block", fontSize: 11, color: "var(--text3)" }}>{b.sub}</span>}
                </span>
                {/* Bar length = share of the biggest; inside, the won / in process / lost split */}
                <span style={{ display: "block", height: 12, borderRadius: 6, background: "var(--bg4)", overflow: "hidden" }}>
                  <span style={{ display: "flex", height: "100%", width: `${Math.max(2, (b.total / max) * 100)}%`, borderRadius: 6, overflow: "hidden" }}>
                    {seg(b.won, C.won)}{seg(b.in_process, C.process)}{seg(b.lost, C.lost)}
                  </span>
                </span>
                <span style={{ fontSize: 14, fontWeight: 800, color: "var(--text)", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmtNum(b.total)}</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: C.won, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{wonPct}%</span>
              </button>
            );
          })}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 8, fontSize: 12, color: "var(--text3)" }}>
            <span>Jami {fmtNum(grand)} ta sdelka · {bars.length} ta {view === "filial" ? "filial" : "viloyat"}</span>
            {bars.length > TOP && (
              <button onClick={() => setAll(!all)} style={{ border: 0, background: "transparent", color: "#6366F1", fontWeight: 600, fontSize: 12, cursor: "pointer" }}>
                {all ? "Kamroq ko'rsatish" : `Yana ${bars.length - TOP} ta ko'rsatish`}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

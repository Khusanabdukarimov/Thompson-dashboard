// Operator comparison table.
//
// Every column is a CRM value we already reconcile against Bitrix — there is no
// composite "performance" score, because a number nobody can derive is a number
// nobody trusts. Ranking, trend and the leaderboard are all read off those same
// values; the only thing computed here is the comparison against the previous
// period of equal length.
import { useMemo, useState } from "react";
import { ExternalLink, Phone, User } from "lucide-react";
import { fmtNum } from "@/lib/utils";
import { useBitrixPortal } from "@/lib/api/config";
import type { ConversionStatsResponse } from "@/lib/api/leads";

type Row = ConversionStatsResponse["conversion"][number];

/** Shared palette — same meaning for a colour on every surface of the dashboard. */
export const METRIC_COLORS = {
  total:     "#2196F3", // blue   — total leads
  sifatli:   "#00BCD4", // cyan   — qualified
  jarayonda: "#FF9800", // orange — in progress
  belgilandi:"#26C6DA", // teal   — visits scheduled
  tashrif:   "#4CAF50", // green  — visits conducted
  konversiya:"#9C27B0", // purple — conversion
  sifatsiz:  "#F44336", // red    — unqualified / lost
  bekor:     "#FFC107", // gold   — cancelled
} as const;

const conversionOf = (r: Row) => (r.total > 0 ? (r.tashrif_buyurdi / r.total) * 100 : 0);

/** Bullet bar: a thin track with the value filled to its share of the column max.
 *  Compact enough to sit beside the number instead of replacing it. */
function Bullet({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div style={{ height: 3, borderRadius: 2, background: "var(--bg4)", marginTop: 4, overflow: "hidden" }}>
      <div style={{ width: `${pct}%`, height: "100%", borderRadius: 2, background: color, transition: "width .45s cubic-bezier(.4,0,.2,1)" }} />
    </div>
  );
}

const RANK_MEDAL = ["🥇", "🥈", "🥉"];

function Avatar({ name, color }: { name: string; color: string }) {
  const initials = name.trim().split(/\s+/).slice(0, 2).map(w => w[0]).join("").toUpperCase();
  return (
    <div style={{ width: 30, height: 30, borderRadius: "50%", background: color, color: "#fff", fontSize: 11.5, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
      {initials}
    </div>
  );
}
const AVATAR_COLORS = ["#7C4DFF", "#2196F3", "#00BCD4", "#4CAF50", "#FF9800", "#E91E63", "#9C27B0", "#607D8B"];
const avatarColor = (id: number) => AVATAR_COLORS[id % AVATAR_COLORS.length];

export function OperatorTable({ rows, loading }: {
  rows: Row[];
  loading: boolean;
}) {
  const portal = useBitrixPortal();
  const [hovered, setHovered] = useState<number | null>(null);

  // Ranked by conversion — the metric the business actually optimises for.
  const ranked = useMemo(
    () => [...rows].sort((a, b) => conversionOf(b) - conversionOf(a) || b.total - a.total),
    [rows]
  );

  const maxes = useMemo(() => ({
    total:     Math.max(1, ...rows.map(r => r.total)),
    sifatli:   Math.max(1, ...rows.map(r => r.sifatli_lid ?? 0)),
    jarayonda: Math.max(1, ...rows.map(r => r.jarayonda)),
    sifatsiz:  Math.max(1, ...rows.map(r => r.sifatsiz_lid)),
    bekor:     Math.max(1, ...rows.map(r => r.bekor_boldi ?? 0)),
    belgilandi: Math.max(1, ...rows.map(r => r.tashrif_belgilandi ?? 0)),
    tashrif:   Math.max(1, ...rows.map(r => r.tashrif_buyurdi)),
  }), [rows]);

  // Each podium slot celebrates a different real metric, so three different
  // people can lead and the manager sees three distinct strengths.
  const leaders = useMemo(() => {
    const best = (pick: (r: Row) => number) => rows.reduce<Row | null>((b, r) => (!b || pick(r) > pick(b) ? r : b), null);
    return [
      { medal: "🥇", label: "Eng ko'p tashrif o'tkazildi", row: best(r => r.tashrif_buyurdi),    val: (r: Row) => fmtNum(r.tashrif_buyurdi),    color: METRIC_COLORS.tashrif },
      { medal: "🥈", label: "Eng ko'p tashrif belgilandi", row: best(r => r.tashrif_belgilandi ?? 0), val: (r: Row) => fmtNum(r.tashrif_belgilandi ?? 0), color: METRIC_COLORS.belgilandi },
      { medal: "🥉", label: "Eng yuqori konversiya",       row: best(conversionOf),               val: (r: Row) => `${conversionOf(r).toFixed(1)}%`, color: METRIC_COLORS.konversiya },
    ].filter(l => l.row);
  }, [rows]);


  // Column totals. The old table carried a JAMI row and the rebuild lost it;
  // without it there is nothing to check the KPI cards above against.
  const totals = useMemo(() => rows.reduce((a, r) => ({
    total:      a.total      + r.total,
    sifatli:    a.sifatli    + (r.sifatli_lid ?? 0),
    jarayonda:  a.jarayonda  + r.jarayonda,
    sifatsiz:   a.sifatsiz   + r.sifatsiz_lid,
    bekor:      a.bekor      + (r.bekor_boldi ?? 0),
    belgilandi: a.belgilandi + (r.tashrif_belgilandi ?? 0),
    tashrif:    a.tashrif    + r.tashrif_buyurdi,
  }), { total: 0, sifatli: 0, jarayonda: 0, sifatsiz: 0, bekor: 0, belgilandi: 0, tashrif: 0 }), [rows]);

  if (loading) return <div style={{ padding: 24, color: "var(--text3)", fontSize: 13 }}>Yuklanmoqda…</div>;
  if (!rows.length) return <div style={{ padding: 24, color: "var(--text3)", fontSize: 13 }}>Ma'lumot yo'q</div>;

  const TH: React.CSSProperties = { fontSize: 10.5, fontWeight: 700, color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.05em", textAlign: "left", padding: "0 12px 10px", whiteSpace: "nowrap" };
  const TD: React.CSSProperties = { padding: "11px 12px", verticalAlign: "middle" };

  const cell = (value: number, max: number, color: string) => (
    <td style={TD}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
        <span style={{ fontSize: 13.5, fontWeight: 600, color: "var(--text)", fontVariantNumeric: "tabular-nums" }}>{fmtNum(value)}</span>
      </div>
      <Bullet value={value} max={max} color={color} />
    </td>
  );

  return (
    <div>
      {/* Podium — who leads, before any numbers are read */}
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${leaders.length}, 1fr)`, gap: 12, padding: "0 20px 16px" }}>
        {leaders.map(l => (
          <div key={l.label} style={{ display: "flex", alignItems: "center", gap: 12, background: "var(--bg3)", border: "1px solid var(--border)", borderRadius: 12, padding: "12px 16px" }}>
            <span style={{ fontSize: 22, lineHeight: 1 }}>{l.medal}</span>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 13.5, fontWeight: 700, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {l.row!.full_name || `User ${l.row!.responsible_id}`}
              </div>
              <div style={{ fontSize: 10.5, color: "var(--text3)", marginTop: 1 }}>{l.label}</div>
            </div>
            <div style={{ fontSize: 17, fontWeight: 800, color: l.color, fontVariantNumeric: "tabular-nums" }}>{l.val(l.row!)}</div>
          </div>
        ))}
      </div>

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0 }}>
          <thead>
            <tr>
              <th style={{ ...TH, width: "1%", textAlign: "center" }}>#</th>
              <th style={{ ...TH, width: "1%" }}>Operator</th>
              <th style={{ ...TH, width: "12%" }}>Umumiy lidlar</th>
              <th style={{ ...TH, width: "12%" }}>Sifatli lid</th>
              <th style={{ ...TH, width: "12%" }}>Jarayonda</th>
              <th style={{ ...TH, width: "12%" }}>Sifatsiz</th>
              <th style={{ ...TH, width: "12%" }}>Bekor bo'ldi</th>
              <th style={{ ...TH, width: "13%" }}>Tashrif belgilandi</th>
              <th style={{ ...TH, width: "13%" }}>Tashrif o'tkazildi</th>
              <th style={{ ...TH, width: "12%", textAlign: "right" }}>Konversiya</th>
            </tr>
          </thead>
          <tbody>
            {ranked.map((r, i) => {
              const conv = conversionOf(r);
              const isHot = hovered === r.responsible_id;
              return (
                <tr key={r.responsible_id}
                    onMouseEnter={() => setHovered(r.responsible_id)}
                    onMouseLeave={() => setHovered(null)}
                    style={{
                      background: isHot ? "var(--bg3)" : "transparent",
                      boxShadow: isHot ? "0 4px 18px rgba(0,0,0,0.28)" : "none",
                      transition: "background .18s ease, box-shadow .18s ease",
                    }}>
                  <td style={{ ...TD, textAlign: "center" }}>
                    <span style={{ fontSize: i < 3 ? 17 : 12.5, fontWeight: 700, color: "var(--text3)" }}>
                      {i < 3 ? RANK_MEDAL[i] : `#${i + 1}`}
                    </span>
                  </td>
                  <td style={{ ...TD, whiteSpace: "nowrap" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                      <Avatar name={r.full_name || `U${r.responsible_id}`} color={avatarColor(r.responsible_id)} />
                      <span style={{ fontSize: 13.5, fontWeight: 600, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {r.full_name || `User ${r.responsible_id}`}
                      </span>
                      {/* Quick actions appear on hover so the row stays calm at rest */}
                      <span style={{ display: "flex", gap: 4, flexShrink: 0, opacity: isHot ? 1 : 0, transition: "opacity .18s ease" }}>
                        <a href={`${portal}/company/personal/user/${r.responsible_id}/`} target="_blank" rel="noreferrer"
                           title="Profil" onClick={e => e.stopPropagation()} style={iconBtn}><User size={12} /></a>
                        <a href={`${portal}/crm/lead/list/?apply_filter=Y&ASSIGNED_BY_ID=${r.responsible_id}`} target="_blank" rel="noreferrer"
                           title="CRM da ochish" onClick={e => e.stopPropagation()} style={iconBtn}><ExternalLink size={12} /></a>
                        <a href={`${portal}/telephony/detail.php?ASSIGNED_BY_ID=${r.responsible_id}`} target="_blank" rel="noreferrer"
                           title="Qo'ng'iroqlar tarixi" onClick={e => e.stopPropagation()} style={iconBtn}><Phone size={12} /></a>
                      </span>
                    </div>
                  </td>
                  {cell(r.total, maxes.total, METRIC_COLORS.total)}
                  {cell(r.sifatli_lid ?? 0, maxes.sifatli, METRIC_COLORS.sifatli)}
                  {cell(r.jarayonda, maxes.jarayonda, METRIC_COLORS.jarayonda)}
                  {cell(r.sifatsiz_lid, maxes.sifatsiz, METRIC_COLORS.sifatsiz)}
                  {cell(r.bekor_boldi ?? 0, maxes.bekor, METRIC_COLORS.bekor)}
                  {cell(r.tashrif_belgilandi ?? 0, maxes.belgilandi, METRIC_COLORS.belgilandi)}
                  {cell(r.tashrif_buyurdi, maxes.tashrif, METRIC_COLORS.tashrif)}
                  <td style={{ ...TD, textAlign: "right" }}>
                    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "flex-end", gap: 6 }}>
                      <span style={{ fontSize: 15, fontWeight: 800, color: METRIC_COLORS.konversiya, fontVariantNumeric: "tabular-nums" }}>
                        {conv.toFixed(1)}%
                      </span>
                    </div>
                    <Bullet value={conv} max={Math.max(1, ...rows.map(conversionOf))} color={METRIC_COLORS.konversiya} />
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr style={{ background: "var(--bg3)", borderTop: "2px solid var(--border)" }}>
              <td style={{ ...TD, textAlign: "center", fontSize: 11, fontWeight: 800, color: "var(--text3)" }}>—</td>
              <td style={{ ...TD, fontSize: 12, fontWeight: 800, color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.06em", whiteSpace: "nowrap" }}>
                JAMI · {rows.length} operator
              </td>
              {([
                [totals.total, METRIC_COLORS.total], [totals.sifatli, METRIC_COLORS.sifatli],
                [totals.jarayonda, METRIC_COLORS.jarayonda], [totals.sifatsiz, METRIC_COLORS.sifatsiz],
                [totals.bekor, METRIC_COLORS.bekor], [totals.belgilandi, METRIC_COLORS.belgilandi],
                [totals.tashrif, METRIC_COLORS.tashrif],
              ] as [number, string][]).map(([v, c], i) => (
                <td key={i} style={TD}>
                  <span style={{ fontSize: 14, fontWeight: 800, color: "var(--text)", fontVariantNumeric: "tabular-nums" }}>{fmtNum(v)}</span>
                  <div style={{ height: 3, borderRadius: 2, background: c, marginTop: 4 }} />
                </td>
              ))}
              <td style={{ ...TD, textAlign: "right" }}>
                <span style={{ fontSize: 15, fontWeight: 800, color: METRIC_COLORS.konversiya, fontVariantNumeric: "tabular-nums" }}>
                  {(totals.total > 0 ? (totals.tashrif / totals.total) * 100 : 0).toFixed(1)}%
                </span>
                <div style={{ height: 3, borderRadius: 2, background: METRIC_COLORS.konversiya, marginTop: 4 }} />
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

const iconBtn: React.CSSProperties = {
  width: 22, height: 22, borderRadius: 6, display: "inline-flex", alignItems: "center", justifyContent: "center",
  background: "var(--bg2)", border: "1px solid var(--border)", color: "var(--text2)", textDecoration: "none",
};

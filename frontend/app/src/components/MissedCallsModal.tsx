import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PhoneMissed, ChevronDown, Clock } from "lucide-react";
import { getMissedCalls, getNotRecalledCalls, getReactionCalls, type CallDashboardFilter, type MissedCallItem } from "@/lib/api/leads";
import { fmtNum } from "@/lib/utils";
import { describeWorkHours } from "@/lib/workHours";
import { leadStageLabel } from "@/lib/leadStages";
import { fmtSecs } from "@/lib/duration";
import { SidePanel, PanelStats } from "@/components/SidePanel";
import { InfoTip } from "@/components/InfoTip";
import { EmptyState, ErrorState, LoadingRows } from "@/components/DataState";

/**
 * The lists behind three cards of the call page, one dialog for all:
 *   "not_recalled"  Ne perezvonili — the missed calls nobody talked to the customer about within 24h;
 *   "all"           Propushenniy   — every missed call, with whether and when it was called back;
 *   "reaction"      Reaksiya vaqti — the missed calls reached within 24h: how fast, and by whom.
 * Each row: who it rang, how long the customer waited, why it ended, and the lead /
 * responsible / stage it belongs to. The backend computes them with the cards' own code,
 * so JAMI always equals the card.
 */
export type MissedCallsVariant = "not_recalled" | "all" | "reaction";

/** Rows fetched per click. The server pages the list, so a page is cheap however long the list is. */
const PAGE = 20;
/** The server caps one request at this many rows. */
const MAX_REQUEST = 1000;

/** "998901234567" / "901234567" → "90 123 45 67", the way people read numbers here. */
const fmtPhone = (p?: string | null) => {
  const d = (p ?? "").replace(/\D/g, "");
  if (d.length < 9) return p || "—";
  const n = d.slice(-9);
  return `${n.slice(0, 2)} ${n.slice(2, 5)} ${n.slice(5, 7)} ${n.slice(7)}`;
};

const TZ = "Asia/Tashkent";
/** "14.10.26, 13:51:53" in Tashkent time, whatever the browser's own zone is. */
const fmtWhen = (iso: string) => new Date(iso).toLocaleString("ru-RU", {
  timeZone: TZ, day: "2-digit", month: "2-digit", year: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
});
const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString("ru-RU", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false });
const fmtDay = (iso: string) => new Date(iso).toLocaleDateString("ru-RU", { timeZone: TZ, day: "2-digit", month: "2-digit" });

const pill = (color: string): React.CSSProperties => ({
  display: "inline-block", padding: "2px 9px", borderRadius: 6, fontSize: 11, fontWeight: 700,
  color, background: `${color}1f`, border: `1px solid ${color}44`, whiteSpace: "nowrap",
});

/** 540 → "9 daq", 7500 → "2 soat 5 daq", 108005 → "30 soat". */
const fmtDelay = (s: number): string => {
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} daq`;
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h < 24 && m > 0 ? `${h} soat ${m} daq` : `${h} soat`;
};

/** Why a call was missed (reason_kind from the API), in words; the PBX's raw code goes in the tooltip. */
const REASONS: Record<string, { label: string; color: string; desc: string }> = {
  rang: { label: "Operatorlar javob bermadi", color: "#F44336", desc: "Operatorlarning telefoni jiringladi, hech kim ko'tarmadi — mijoz kutib, qo'ng'iroqni uzdi" },
  queue: { label: "Operatorgacha yetmay uzdi", color: "#FF9800", desc: "Mijoz menyu yoki navbatda turib, birorta operatorning telefoni jiringlamasdan qo'ng'iroqni uzdi" },
  after_hours: { label: "Ish vaqtidan tashqari", color: "#607D8B", desc: "Ish kunidan tashqari (08:00 dan oldin yoki 20:00 dan keyin) qilingan qo'ng'iroq" },
  no_answer: { label: "Operator ko'tarmadi", color: "#E91E63", desc: "To'g'ridan-to'g'ri bitta operatorga qilingan qo'ng'iroq javobsiz qoldi" },
  cancel: { label: "Mijoz darhol uzdi", color: "#9E9E9E", desc: "Mijoz ulanish bilanoq qo'ng'iroqni uzdi" },
  tech: { label: "Aloqa xatosi", color: "#795548", desc: "Telefon tarmog'i yoki yo'naltirish (marshrut) xatosi" },
  unknown: { label: "PBX'da yozuv yo'q", color: "#9E9E9E", desc: "Bitrix24 bu qo'ng'iroqni ko'rgan, telefoniyada esa yozuvi topilmadi" },
};

function ReasonCell({ it }: { it: MissedCallItem }) {
  const r = REASONS[it.reason_kind ?? (it.matched ? "" : "unknown")];
  if (!r) return <span style={{ fontSize: 11.5, color: "var(--text3)" }}>{it.reason || "—"}</span>;
  return <span style={pill(r.color)} title={`${r.desc}${it.reason ? ` · PBX kodi: ${it.reason}` : ""}`}>{r.label}</span>;
}

/** Delay bands of the Reaksiya vaqti list (ids from the API), slow ones in warmer colours. */
const BANDS: Record<string, { label: string; color: string }> = {
  lt5m: { label: "5 daq gacha", color: "#4CAF50" },
  lt15m: { label: "5–15 daq", color: "#8BC34A" },
  lt1h: { label: "15–60 daq", color: "#FFB300" },
  lt4h: { label: "1–4 soat", color: "#FF9800" },
  gte4h: { label: "4 soatdan ko'p", color: "#F44336" },
};
const bandColor = (s: number) =>
  s < 300 ? BANDS.lt5m.color : s < 900 ? BANDS.lt15m.color : s < 3600 ? BANDS.lt1h.color : s < 4 * 3600 ? BANDS.lt4h.color : BANDS.gte4h.color;
const pctStr = (n: number, of: number) => (of ? `${Math.round((n / of) * 100)}%` : "0%");

/** Who made the contact that counted: an operator's callback, or the customer's own redial. */
function ContactCell({ it }: { it: MissedCallItem }) {
  const via = it.callback_source === "moizvonki" ? " · Moizvonki" : "";
  if (it.callback_dir === "outbound") {
    const noPick = it.callback_answered === false;
    return (
      <div title={noPick ? `Operator qayta qo'ng'iroq qilgan, mijoz ko'tarmagan${via}` : `Operator qayta qo'ng'iroq qilgan${via}`}>
        <div style={{ color: "var(--text)", fontWeight: 600 }}>{it.callback_by ?? "Operator"}</div>
        <div style={{ fontSize: 11.5, marginTop: 3, color: noPick ? "#B45309" : "var(--text3)" }}>{noPick ? "qo'ng'iroq qildi · mijoz ko'tarmadi" : "operator qo'ng'iroq qildi"}</div>
      </div>
    );
  }
  if (it.callback_dir === "inbound") return (
    <div title={`Mijoz o'zi qayta qo'ng'iroq qilgan va javob olgan${via}`}>
      <div style={{ color: "#9333EA", fontWeight: 600 }}>Mijoz o'zi</div>
      {it.callback_by && <div style={{ fontSize: 11.5, marginTop: 3, color: "var(--text3)" }}>javob berdi: {it.callback_by}</div>}
    </div>
  );
  return <span style={{ color: "var(--text3)" }}>—</span>;
}

function RecalledCell({ it }: { it: MissedCallItem }) {
  if ((it.status === "recalled" || it.status === "late") && it.callback_at) {
    // Working time (what "Reaksiya vaqti" averages); the real elapsed time is in the tooltip.
    const after = fmtDelay(it.work_delay_s ?? it.delay_s ?? 0);
    const real = it.delay_s != null && it.work_delay_s != null && it.delay_s !== it.work_delay_s ? `, haqiqatda ${fmtDelay(it.delay_s)}` : "";
    return (
      <div title={`${fmtWhen(it.callback_at)} — ish vaqti bo'yicha ${after} o'tgach${real}`}>
        <div style={{ color: "#16A34A", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{fmtTime(it.callback_at)} <span style={{ fontWeight: 400, color: "var(--text3)" }}>{fmtDay(it.callback_at)}</span></div>
        <div style={{ fontSize: 11.5, marginTop: 3, color: "var(--text3)" }}>{after} dan keyin</div>
      </div>
    );
  }
  if (it.status === "open") return <span style={pill("#FF9800")} title="24 soat hali tugamagan: qayta qo'ng'iroq bo'lishi mumkin">Kutilmoqda</span>;
  return <span style={pill("#F44336")}>Yo'q</span>;
}

export function MissedCallsModal({ variant, filter, portal, onClose, embedded = false }: {
  variant: MissedCallsVariant; filter: CallDashboardFilter; portal: string; onClose: () => void;
  /** Render just the content (summary + list), for a tab of another panel. */
  embedded?: boolean;
}) {
  const all = variant === "all";
  const reaction = variant === "reaction";
  const [sort, setSort] = useState<"new" | "slow">("new");    // reaction list only: newest or slowest first
  const fetchPage = (f: CallDashboardFilter, page: { offset: number; limit: number }) =>
    reaction ? getReactionCalls(f, page, sort) : all ? getMissedCalls(f, page) : getNotRecalledCalls(f, page);
  const title = reaction ? "Reaksiya vaqti — qayta bog'lanish tezligi" : all ? "Propushenniy — javobsiz qo'ng'iroqlar" : "Ne perezvonili — qayta chiqilmagan";
  const q = useQuery({ queryKey: [reaction ? "call-reaction-list" : all ? "call-missed-list" : "call-not-recalled", filter, reaction ? sort : null], queryFn: () => fetchPage(filter, { offset: 0, limit: PAGE }) });
  const [more, setMore] = useState<MissedCallItem[]>([]);     // pages loaded after the first
  useEffect(() => { setMore([]); setMoreError(null); }, [sort]);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);

  const d = q.data;
  const s = d?.summary;
  const items = useMemo(() => [...(d?.items ?? []), ...more], [d, more]);
  const total = s?.total ?? 0;
  const hours = d?.window_hours ?? 24;

  /** Loads the next `count` rows (the first page came with the query). */
  const loadMore = async (count: number) => {
    if (loadingMore) return;
    setLoadingMore(true); setMoreError(null);
    try {
      let have = items.length, want = Math.min(count, total - items.length);
      const got: MissedCallItem[] = [];
      while (want > 0) {
        const r = await fetchPage(filter, { offset: have, limit: Math.min(want, MAX_REQUEST) });
        if (r.items.length === 0) break;
        got.push(...r.items); have += r.items.length; want -= r.items.length;
      }
      // The list can shift between requests (new calls arrive): never show a row twice.
      setMore(prev => {
        const seen = new Set([...(d?.items ?? []), ...prev].map(i => i.key));
        return [...prev, ...got.filter(i => !seen.has(i.key))];
      });
    } catch (e) {
      setMoreError((e as Error).message || "noma'lum xato");
    } finally {
      setLoadingMore(false);
    }
  };

  const r = reaction ? s?.reaction : undefined;
  const helpText = reaction ? (
    <>Har bir javobsiz kirish qo'ng'irog'idan keyin o'sha raqam bilan <b>birinchi bog'lanish</b> ({hours} soat ichida): operatorning qayta qo'ng'irog'i (mijoz ko'tarmagan bo'lsa ham) yoki mijozning o'zi qayta qilib javob olgani.
      <b> Reaksiya</b> — shu bog'lanishgacha o'tgan vaqt, ish vaqti bo'yicha{d?.work_hours && <> ({describeWorkHours(d.work_hours)})</>}; haqiqiy vaqt sichqoncha ustida.
      <b> Mediana</b> — qo'ng'iroqlarning yarmi shundan tezroq bog'lanilgan. {hours} soat ichida bog'lanilmaganlar "Ne perezvonili"da.</>
  ) : (
    <>Bitrix24'dagi har bir javobsiz kirish qo'ng'irog'i. {hours} soat ichida operator o'sha raqamga qo'ng'iroq qilgan bo'lsa (mijoz ko'tarmagan bo'lsa ham) yoki mijoz o'zi qayta qilib javob olgan bo'lsa — qayta chiqilgan.
      <b> Kutilmoqda</b> — {hours} soat hali tugamagan. <b>4×</b> — shu raqam ro'yxatda necha marta uchraydi. <b>Sabab</b> — telefoniya yozuvidan (asl PBX kodi sichqoncha ustida).</>
  );

  const stats = !s ? null : reaction && r ? [
    { label: "Bog'lanilgan", value: fmtNum(s.total), color: "#16A34A" },
    { label: "O'rtacha (ish vaqti)", value: fmtSecs(r.avg_work_s) },
    { label: "Mediana", value: fmtSecs(r.median_work_s), color: "#2563EB" },
    { label: "Operator qayta chiqqan", value: <>{fmtNum(r.by_operator)} <small style={{ fontSize: 12, fontWeight: 500, color: "var(--text3)" }}>{pctStr(r.by_operator, s.total)}</small></>, color: "#2563EB" },
    { label: "Mijoz o'zi qilgan", value: <>{fmtNum(r.by_customer)} <small style={{ fontSize: 12, fontWeight: 500, color: "var(--text3)" }}>{pctStr(r.by_customer, s.total)}</small></>, color: "#9333EA" },
  ] : [
    { label: "Jami", value: fmtNum(s.total), color: "#DC2626" },
    { label: "Unikal raqam", value: fmtNum(s.unique_numbers) },
    { label: "Qayta chiqilgan", value: fmtNum(all ? s.recalled : s.late), color: "#16A34A" },
    { label: "Chiqilmagan", value: fmtNum(all ? s.not_recalled : s.not_reached), color: "#DC2626" },
    { label: "O'rt. kutish", value: fmtSecs(s.avg_wait_s) },
  ];

  const TH2: React.CSSProperties = { position: "sticky", top: 0, zIndex: 2, padding: "10px 16px", textAlign: "left", fontSize: 11, fontWeight: 600, letterSpacing: "0.04em", textTransform: "uppercase", color: "var(--text3)", background: "var(--bg2)", borderBottom: "1px solid var(--border)", whiteSpace: "nowrap" };
  const TD2: React.CSSProperties = { padding: "10px 16px", borderBottom: "1px solid var(--border)", verticalAlign: "top", fontSize: 13 };
  const sub: React.CSSProperties = { fontSize: 11.5, color: "var(--text3)", marginTop: 3, whiteSpace: "nowrap" };

  const header = stats && (
        <>
          <PanelStats items={stats} />
          {reaction && r && r.bands.some((b) => b.count > 0) && (
            <div style={{ marginTop: 14 }}>
              {/* how the delays spread: one bar, one segment per band */}
              <div style={{ display: "flex", height: 8, borderRadius: 4, overflow: "hidden", background: "var(--bg3)" }}>
                {r.bands.map((b) => b.count > 0 && (
                  <div key={b.id} title={`${BANDS[b.id]?.label ?? b.id}: ${fmtNum(b.count)} ta (${pctStr(b.count, s!.total)})`}
                    style={{ width: pctStr(b.count, s!.total), background: BANDS[b.id]?.color ?? "#999" }} />
                ))}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 14px", marginTop: 7, fontSize: 12, color: "var(--text2)" }}>
                {r.bands.map((b) => (
                  <span key={b.id} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                    <span style={{ width: 8, height: 8, borderRadius: 2, background: BANDS[b.id]?.color ?? "#999" }} />
                    {BANDS[b.id]?.label ?? b.id} <b style={{ color: "var(--text)" }}>{fmtNum(b.count)}</b>
                  </span>
                ))}
              </div>
            </div>
          )}
          {!reaction && s?.reasons && Object.keys(s.reasons).length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 12 }}>
              {Object.entries(s.reasons).sort((a, b) => b[1] - a[1]).map(([k, n]) => {
                const rs = REASONS[k] ?? { label: k, color: "#9E9E9E", desc: "" };
                return (
                  <span key={k} title={rs.desc} style={{ ...pill(rs.color), fontSize: 11.5, padding: "3px 10px", fontWeight: 600 }}>
                    {rs.label} {fmtNum(n)}
                  </span>
                );
              })}
            </div>
          )}
        </>
  );

  const body = (
    <>
      {q.isLoading ? (
        <LoadingRows rows={8} />
      ) : q.isError || !d || !s ? (
        <ErrorState onRetry={() => q.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState title={reaction ? "Bog'lanilgan qo'ng'iroq yo'q" : all ? "Javobsiz qo'ng'iroq yo'q" : "Qayta chiqilmagan qo'ng'iroq yo'q"} />
      ) : (
        <>
          {reaction && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 16px", borderBottom: "1px solid var(--border)", fontSize: 12, color: "var(--text3)" }}>
              <span>Soat bo'yicha (tun bilan) o'rtacha {r ? fmtSecs(r.avg_clock_s) : "—"} · bog'lanilmagan {fmtNum(s.not_recalled)} ta "Ne perezvonili"da</span>
              <span style={{ marginLeft: "auto", display: "inline-flex", gap: 2, padding: 3, borderRadius: 8, background: "var(--bg3)" }}>
                {([["new", "Yangilari"], ["slow", "Eng sekinlari"]] as const).map(([k, label]) => (
                  <button key={k} type="button" onClick={() => setSort(k)} aria-pressed={sort === k}
                    style={{ padding: "4px 12px", fontSize: 12, fontWeight: 600, border: 0, borderRadius: 6, cursor: "pointer", background: sort === k ? "var(--bg)" : "transparent", color: sort === k ? "var(--text)" : "var(--text3)", boxShadow: sort === k ? "0 1px 3px rgba(0,0,0,.12)" : "none" }}>
                    {label}
                  </button>
                ))}
              </span>
            </div>
          )}
          <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0 }}>
            <thead>
              <tr>
                {(reaction
                  ? ["Mijoz", "Javobsiz qo'ng'iroq", "Bog'lanildi", "Kim bog'landi", "Mas'ul"]
                  : ["Mijoz", "Javobsiz qo'ng'iroq", "Qayta chiqilgan", "Sabab", "Mas'ul"]).map((h) => <th key={h} style={TH2}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.key}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg3)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
                  {/* Mijoz: the number, then its lead and stage */}
                  <td style={TD2}>
                    <div style={{ fontWeight: 700, color: "var(--text)", fontVariantNumeric: "tabular-nums", letterSpacing: "0.01em" }}>{fmtPhone(it.phone)}</div>
                    <div style={sub}>
                      {it.lead_id ? (portal
                        ? <a href={`${portal}/crm/lead/details/${it.lead_id}/`} target="_blank" rel="noreferrer" style={{ color: "#2563EB", textDecoration: "none" }}>Lid #{it.lead_id} ↗</a>
                        : <>Lid #{it.lead_id}</>)
                        : <i>Bitrix24 da yo'q</i>}
                      {it.stage_name && <> · {leadStageLabel(null, it.stage_name)}</>}
                    </div>
                  </td>
                  {/* the missed call: when, how long they waited, how many times */}
                  <td style={TD2}>
                    <div style={{ color: "var(--text)", fontVariantNumeric: "tabular-nums" }}>
                      <b>{fmtTime(it.call_start)}</b> <span style={{ color: "var(--text3)" }}>{fmtDay(it.call_start)}</span>
                    </div>
                    <div style={sub}>
                      {it.wait_s != null && <>kutdi {fmtSecs(it.wait_s)}</>}
                      {it.attempts > 1 && <> · <b style={{ color: "#DC2626" }}>{it.attempts} marta</b></>}
                      {it.matched && it.operator && <> · {it.operator}</>}
                    </div>
                  </td>
                  {reaction ? <>
                    <td style={TD2} title={it.delay_s != null ? `Haqiqatda (soat bo'yicha): ${fmtSecs(it.delay_s)}` : undefined}>
                      {it.callback_at ? <>
                        <div style={{ color: "var(--text)", fontVariantNumeric: "tabular-nums" }}><b>{fmtTime(it.callback_at)}</b></div>
                        <div style={{ ...sub, fontWeight: 700, color: bandColor(it.work_delay_s ?? 0) }}>{fmtSecs(it.work_delay_s)} dan keyin</div>
                      </> : "—"}
                    </td>
                    <td style={TD2}><ContactCell it={it} /></td>
                  </> : <>
                    <td style={TD2}><RecalledCell it={it} /></td>
                    <td style={TD2}><ReasonCell it={it} /></td>
                  </>}
                  <td style={{ ...TD2, color: "var(--text)" }}>{it.responsible || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 16px" }}>
            {items.length < total && (
              <>
                <button type="button" disabled={loadingMore} onClick={() => loadMore(PAGE)}
                  style={{ display: "inline-flex", alignItems: "center", gap: 5, background: "var(--bg3)", border: "1px solid var(--border)", borderRadius: 7, color: "var(--text2)", fontSize: 12, fontWeight: 600, padding: "6px 14px", cursor: loadingMore ? "default" : "pointer", opacity: loadingMore ? 0.6 : 1 }}>
                  {loadingMore ? "Yuklanmoqda…" : <>Yana {Math.min(PAGE, total - items.length)} ta <ChevronDown size={12} /></>}
                </button>
                <button type="button" disabled={loadingMore} onClick={() => loadMore(total - items.length)}
                  style={{ background: "transparent", border: "1px solid var(--border)", borderRadius: 7, color: "var(--text2)", fontSize: 12, fontWeight: 600, padding: "6px 14px", cursor: loadingMore ? "default" : "pointer", opacity: loadingMore ? 0.6 : 1 }}>
                  Barchasi ({fmtNum(total)})
                </button>
              </>
            )}
            {moreError && <span style={{ fontSize: 12, color: "#DC2626" }}>Xatolik: {moreError}</span>}
            <span style={{ fontSize: 11.5, color: "var(--text3)", marginLeft: "auto" }}>{fmtNum(items.length)} / {fmtNum(total)} ta</span>
          </div>
        </>
      )}
    </>
  );

  // Inside the Reaksiya vaqti panel (a tab), the list shows without a panel of its own.
  if (embedded) return <>{header && <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)" }}>{header}</div>}{body}</>;

  return (
    <SidePanel
      open
      onClose={onClose}
      width={1080}
      title={<span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
        {reaction ? <Clock size={18} color="#607D8B" /> : <PhoneMissed size={18} color={all ? "#E8890C" : "#DC2626"} />}
        {title}
        <InfoTip text={helpText} label="Qanday hisoblanadi" size={15} />
      </span>}
      subtitle={`${filter.start_date ?? "…"} → ${filter.end_date ?? "…"}`}
      headerExtra={header}>
      {body}
    </SidePanel>
  );
}

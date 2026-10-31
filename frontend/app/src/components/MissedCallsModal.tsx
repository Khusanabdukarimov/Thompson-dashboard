import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PhoneMissed, HelpCircle, X, ChevronDown, Clock } from "lucide-react";
import { getMissedCalls, getNotRecalledCalls, getReactionCalls, type CallDashboardFilter, type MissedCallItem } from "@/lib/api/leads";
import { fmtNum } from "@/lib/utils";
import { describeWorkHours } from "@/lib/workHours";
import { leadStageLabel } from "@/lib/leadStages";

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

/** 3725 → "01:02:05" (hours may exceed 24: "56:23:11"). */
const fmtHMS = (secs: number | null | undefined): string => {
  if (secs == null) return "—";
  const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60), s = secs % 60;
  return [h, m, s].map(v => String(v).padStart(2, "0")).join(":");
};

const TZ = "Asia/Tashkent";
/** "14.10.26, 13:51:53" in Tashkent time, whatever the browser's own zone is. */
const fmtWhen = (iso: string) => new Date(iso).toLocaleString("ru-RU", {
  timeZone: TZ, day: "2-digit", month: "2-digit", year: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
});
const fmtShort = (iso: string) => new Date(iso).toLocaleString("ru-RU", {
  timeZone: TZ, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
});

const pill = (color: string): React.CSSProperties => ({
  display: "inline-block", padding: "2px 9px", borderRadius: 6, fontSize: 11, fontWeight: 700,
  color, background: `${color}1f`, border: `1px solid ${color}44`, whiteSpace: "nowrap",
});

const TH: React.CSSProperties = {
  position: "sticky", top: 0, zIndex: 2, padding: "11px 14px", textAlign: "left", fontSize: 11, fontWeight: 700,
  color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.05em", whiteSpace: "nowrap",
  background: "var(--bg2)", borderBottom: "1px solid var(--border)",
};
const TD: React.CSSProperties = { padding: "10px 14px", fontSize: 12.5, borderBottom: "1px solid var(--border)", verticalAlign: "middle", whiteSpace: "nowrap" };

function Stat({ label, value, color }: { label: string; value: React.ReactNode; color: string }) {
  return (
    <div style={{ flex: "1 1 150px", minWidth: 130, padding: "12px 16px", borderRadius: 10, border: `1px solid ${color}44`, background: `${color}12` }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, color, fontFamily: typeof value === "string" && value.includes(":") ? "monospace" : undefined }}>{value}</div>
    </div>
  );
}

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
  if (it.callback_dir === "outbound") return <span title={`Operator qayta qo'ng'iroq qilgan${via}`}><span style={pill("#2196F3")}>Operator</span> <span style={{ color: "var(--text)" }}>{it.callback_by ?? "—"}</span></span>;
  if (it.callback_dir === "inbound") return <span title={`Mijoz o'zi qayta qo'ng'iroq qilgan va javob olgan${via}`}><span style={pill("#9C27B0")}>Mijoz o'zi</span> <span style={{ color: "var(--text2)" }}>{it.callback_by ?? ""}</span></span>;
  return <span style={{ color: "var(--text3)" }}>—</span>;
}

function RecalledCell({ it }: { it: MissedCallItem }) {
  if ((it.status === "recalled" || it.status === "late") && it.callback_at) {
    // Working time (what "Reaksiya vaqti" averages); the real elapsed time is in the tooltip.
    const after = fmtDelay(it.work_delay_s ?? it.delay_s ?? 0);
    const real = it.delay_s != null && it.work_delay_s != null && it.delay_s !== it.work_delay_s ? `, haqiqatda ${fmtDelay(it.delay_s)}` : "";
    return <span style={pill("#4CAF50")} title={`${fmtWhen(it.callback_at)} — ish vaqti bo'yicha ${after} o'tgach${real}`}>{fmtShort(it.callback_at)} · {after}</span>;
  }
  if (it.status === "open") return <span style={pill("#FF9800")} title="24 soat hali tugamagan: qayta qo'ng'iroq bo'lishi mumkin">Kutilmoqda</span>;
  return <span style={pill("#F44336")}>Yo'q</span>;
}

export function MissedCallsModal({ variant, filter, portal, onClose }: {
  variant: MissedCallsVariant; filter: CallDashboardFilter; portal: string; onClose: () => void;
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
  const [help, setHelp] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

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

  return (
    <div role="dialog" aria-modal="true" aria-label={title}
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: "3vh 2vw" }}>
      <div style={{ width: "min(1320px, 100%)", maxHeight: "94vh", display: "flex", flexDirection: "column", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 14, overflow: "hidden", boxShadow: "0 20px 60px rgba(0,0,0,0.5)" }}>
        {/* header */}
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "16px 22px", borderBottom: "1px solid var(--border)" }}>
          {reaction
            ? <Clock size={20} color="#607D8B" style={{ marginTop: 3, flexShrink: 0 }} />
            : <PhoneMissed size={20} color={all ? "#FF9800" : "#F44336"} style={{ marginTop: 3, flexShrink: 0 }} />}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 17, fontWeight: 700, color: "var(--text)" }}>{title}</div>
            <div style={{ fontSize: 12.5, color: "var(--text3)", marginTop: 3 }}>
              {reaction
                ? <>{hours} soat ichida bog'lanilgan javobsiz qo'ng'iroqlar: qancha vaqtda va kim bog'langan</>
                : all
                ? <>Bitrix24 bo'yicha javobsiz qolgan kiruvchi qo'ng'iroqlar</>
                : <>Javobsiz qolgan va {hours} soat ichida qayta chiqilmagan raqamlar</>}
              {" "}· {filter.start_date ?? "…"} → {filter.end_date ?? "…"}
            </div>
          </div>
          <button type="button" onClick={() => setHelp(h => !h)} aria-label="Qanday hisoblanadi" aria-pressed={help} title="Qanday hisoblanadi?"
            style={{ width: 30, height: 30, borderRadius: "50%", border: "1px solid var(--border)", background: help ? "rgba(33,150,243,0.12)" : "var(--bg2)", color: "var(--text2)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <HelpCircle size={16} />
          </button>
          <button type="button" onClick={onClose}
            style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 14px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg2)", color: "var(--text2)", fontSize: 13, cursor: "pointer" }}>
            <X size={14} /> Yopish
          </button>
        </div>

        {help && reaction && (
          <div style={{ padding: "12px 22px", fontSize: 12.5, lineHeight: 1.6, color: "var(--text2)", background: "rgba(33,150,243,0.06)", borderBottom: "1px solid var(--border)" }}>
            Bitrix24'dagi har bir javobsiz kirish qo'ng'irog'idan keyin o'sha raqam bilan <b>birinchi javob berilgan suhbat</b> ({hours} soat ichida) olinadi —
            bu <b>Operator</b> qayta qo'ng'irog'i yoki <b>Mijoz o'zi</b> qayta qilib javob olgani bo'lishi mumkin. Javob berilmagan urinishlar hisobga kirmaydi.
            <b> Reaksiya</b> — javobsiz qo'ng'iroqdan shu suhbatgacha o'tgan vaqt, <b>ish vaqti bo'yicha</b>{d?.work_hours && <> ({describeWorkHours(d.work_hours)})</>};
            haqiqiy (soat bo'yicha) vaqt sichqonchani ustiga olib borganda ko'rinadi. <b>O'rtacha</b> — kartadagi Reaksiya vaqti;
            <b> Mediana</b> — qo'ng'iroqlarning yarmi shundan tezroq bog'lanilgan (bir nechta juda kech qo'ng'iroq o'rtachani oshirib yuboradi).
            {hours} soat ichida bog'lanilmaganlar bu ro'yxatda yo'q — ular "Ne perezvonili"da.
          </div>
        )}

        {help && !reaction && (
          <div style={{ padding: "12px 22px", fontSize: 12.5, lineHeight: 1.6, color: "var(--text2)", background: "rgba(33,150,243,0.06)", borderBottom: "1px solid var(--border)" }}>
            Bitrix24'dagi har bir javobsiz kirish qo'ng'irog'i alohida sanaladi. O'sha raqam bilan <b>javob berilgan suhbat</b> (istalgan yo'nalish va operator,
            PBX va Moizvonki) {hours} soat ichida bo'lsa — qayta chiqilgan{all ? "; bo'lmasa chiqilmagan" : ", aks holda bu ro'yxatga tushadi"}.
            {all && <> <b>Qayta chiqilgan</b> ustunida qachon va necha daqiqa/soatdan keyin bog'lanilgani yoziladi. </>}
            <b> Yo'q</b> — undan keyin ham suhbat bo'lmagan; {all ? <><b>vaqt</b> — bog'lanilgan payt va undan oldin o'tgan vaqt</> : <><b>vaqt</b> — {hours} soatdan keyin bog'lanilgan (qachon va necha soatdan keyin)</>};
            <b> Kutilmoqda</b> — {hours} soat hali tugamagan. <b>Urinish</b> — shu raqam ro'yxatda necha marta uchraydi.
            Kutgan — mijoz qo'ng'iroqda necha soniya kutgan.
            <b> Sabab</b> — telefoniya yozuvidan: operatorlarning telefoni jiringladimi, mijoz qachon uzdi, ish vaqtimi (asl PBX kodi sichqoncha ustida ko'rinadi).
            {d?.work_hours && <> Bog'lanishgacha o'tgan vaqt <b>ish vaqti bo'yicha</b> hisoblanadi ({describeWorkHours(d.work_hours)}): kechasi yoki ish soatidan tashqarida o'tkazib yuborilgan qo'ng'iroq ish boshlanganidan sanaladi.</>}
          </div>
        )}

        <div style={{ overflow: "auto", flex: 1, minHeight: 0 }}>
          {q.isLoading ? (
            <div style={{ padding: 48, textAlign: "center", color: "var(--text2)" }}>Yuklanmoqda…</div>
          ) : q.isError || !d || !s ? (
            <div style={{ padding: 48, textAlign: "center", color: "#F44336", fontSize: 13 }}>Xatolik: {String((q.error as Error)?.message ?? "noma'lum xato")}</div>
          ) : (
            <>
              {/* summary */}
              {reaction && s.reaction ? (() => {
                const r = s.reaction;
                return (
                  <>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 12, padding: "16px 22px" }}>
                      <Stat label="Bog'lanilgan" value={fmtNum(s.total)} color="#4CAF50" />
                      <Stat label="O'rtacha (ish vaqti)" value={fmtHMS(r.avg_work_s)} color="#607D8B" />
                      <Stat label="Mediana" value={fmtHMS(r.median_work_s)} color="#2196F3" />
                      <Stat label="Operator qayta chiqqan" value={<>{fmtNum(r.by_operator)} <span style={{ fontSize: 14, fontWeight: 500 }}>{pctStr(r.by_operator, s.total)}</span></>} color="#2196F3" />
                      <Stat label="Mijoz o'zi qayta qilgan" value={<>{fmtNum(r.by_customer)} <span style={{ fontSize: 14, fontWeight: 500 }}>{pctStr(r.by_customer, s.total)}</span></>} color="#9C27B0" />
                    </div>
                    {/* how the delays spread: one bar, one segment per band */}
                    <div style={{ padding: "0 22px 6px" }}>
                      <div style={{ display: "flex", height: 10, borderRadius: 5, overflow: "hidden", background: "var(--bg3)" }}>
                        {r.bands.map(b => b.count > 0 && (
                          <div key={b.id} title={`${BANDS[b.id]?.label ?? b.id}: ${fmtNum(b.count)} ta (${pctStr(b.count, s.total)})`}
                            style={{ width: pctStr(b.count, s.total), background: BANDS[b.id]?.color ?? "#999" }} />
                        ))}
                      </div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 16px", marginTop: 8, fontSize: 12, color: "var(--text2)" }}>
                        {r.bands.map(b => (
                          <span key={b.id} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                            <span style={{ width: 9, height: 9, borderRadius: 2, background: BANDS[b.id]?.color ?? "#999" }} />
                            {BANDS[b.id]?.label ?? b.id}: <b style={{ color: "var(--text)" }}>{fmtNum(b.count)}</b> <span style={{ color: "var(--text3)" }}>({pctStr(b.count, s.total)})</span>
                          </span>
                        ))}
                      </div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "8px 22px 12px", fontSize: 11.5, color: "var(--text3)" }}>
                      <span>
                        Soat bo'yicha (tun ham hisobga olinsa) o'rtacha: {fmtHMS(r.avg_clock_s)}. {hours} soat ichida bog'lanilmagan {fmtNum(s.not_recalled)} ta — "Ne perezvonili"da.
                      </span>
                      <span style={{ marginLeft: "auto", display: "inline-flex", border: "1px solid var(--border)", borderRadius: 7, overflow: "hidden" }}>
                        {([["new", "Yangilari"], ["slow", "Eng sekinlari"]] as const).map(([k, label]) => (
                          <button key={k} type="button" onClick={() => setSort(k)} aria-pressed={sort === k}
                            style={{ padding: "5px 12px", fontSize: 12, fontWeight: 600, border: "none", cursor: "pointer", background: sort === k ? "rgba(33,150,243,0.14)" : "var(--bg2)", color: sort === k ? "#2196F3" : "var(--text2)" }}>
                            {label}
                          </button>
                        ))}
                      </span>
                    </div>
                  </>
                );
              })() : (<>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 12, padding: "16px 22px" }}>
                <Stat label="Jami" value={fmtNum(s.total)} color="#F44336" />
                <Stat label="Unikal raqam" value={fmtNum(s.unique_numbers)} color="#2196F3" />
                <Stat label="Qayta chiqilgan" value={fmtNum(all ? s.recalled : s.late)} color="#4CAF50" />
                <Stat label="Chiqilmagan" value={fmtNum(all ? s.not_recalled : s.not_reached)} color="#F44336" />
                <Stat label="O'rt. kutish" value={fmtHMS(s.avg_wait_s)} color="#9C27B0" />
              </div>
              <div style={{ padding: "0 22px 12px", fontSize: 11.5, color: "var(--text3)" }}>
                {all ? <>
                  "Qayta chiqilgan" — {hours} soat ichida bog'lanilganlar. "Chiqilmagan" — {hours} soat ichida bog'lanilmaganlar
                  {(s.late > 0 || s.still_open > 0) && <> (shundan {fmtNum(s.late)} tasi keyinroq bog'lanilgan, {fmtNum(s.still_open)} tasi uchun {hours} soat hali tugamagan)</>}.
                </> : <>
                  "Qayta chiqilgan" — {hours} soatdan keyin bog'lanilganlar.
                  {s.still_open > 0 && <> "Chiqilmagan" ichida {fmtNum(s.still_open)} ta uchun {hours} soat hali tugamagan.</>}
                  {" "}Davrdagi barcha javobsiz qo'ng'iroq: {fmtNum(s.missed_total)} ta.
                </>}
              </div>
              {s.reasons && Object.keys(s.reasons).length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, padding: "0 22px 14px" }}>
                  <span style={{ fontSize: 11.5, fontWeight: 600, color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Sabablar:</span>
                  {Object.entries(s.reasons).sort((a, b) => b[1] - a[1]).map(([k, n]) => {
                    const r = REASONS[k] ?? { label: k, color: "#9E9E9E", desc: "" };
                    return (
                      <span key={k} title={r.desc} style={{ ...pill(r.color), fontSize: 11.5, padding: "3px 10px" }}>
                        {r.label}: {fmtNum(n)} <span style={{ fontWeight: 500, opacity: 0.8 }}>({pctStr(n, s.total)})</span>
                      </span>
                    );
                  })}
                </div>
              )}
              </>)}

              {items.length === 0 ? (
                <div style={{ padding: 48, textAlign: "center", color: "var(--text2)" }}>{reaction ? "Bog'lanilgan qo'ng'iroq yo'q" : all ? "Javobsiz qo'ng'iroq yo'q" : "Qayta chiqilmagan qo'ng'iroq yo'q"}</div>
              ) : (
                <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0 }}>
                  <thead>
                    <tr>
                      {(reaction
                        ? ["#", "Telefon", "Javobsiz qo'ng'iroq", "Kim / navbat", "Kutgan", "Urinish", "Bog'lanildi", "Reaksiya", "Kim bog'landi", "Lead", "Mas'ul", "Bosqich"]
                        : ["#", "Telefon", "Sana va vaqt", "Kim / navbat", "Kutgan", "Urinish", "Qayta chiqilgan", "Sabab", "Lead", "Mas'ul", "Bosqich"]).map(h => (
                        <th key={h} style={TH}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((it, i) => (
                      <tr key={it.key} style={{ background: i % 2 ? "var(--bg2)" : "transparent" }}>
                        <td style={{ ...TD, color: "var(--text3)" }}>{i + 1}</td>
                        <td style={{ ...TD, fontWeight: 700, fontFamily: "monospace", fontSize: 13, color: "var(--text)" }}>{it.phone || "—"}</td>
                        <td style={{ ...TD, color: "var(--text2)" }}>{fmtWhen(it.call_start)}</td>
                        <td style={{ ...TD, color: "var(--text)" }}>{!it.matched ? "—" : it.operator ?? "Navbat (queue)"}</td>
                        <td style={{ ...TD, fontFamily: "monospace", fontWeight: 600, color: "#FF9800" }}>{fmtHMS(it.wait_s)}</td>
                        <td style={TD}>{it.attempts > 1 ? <span style={pill("#F44336")}>{it.attempts}×</span> : <span style={{ color: "var(--text3)" }}>1×</span>}</td>
                        {reaction ? <>
                          <td style={{ ...TD, color: "var(--text2)" }}>{it.callback_at ? fmtWhen(it.callback_at) : "—"}</td>
                          <td style={TD} title={it.delay_s != null ? `Haqiqatda (soat bo'yicha): ${fmtHMS(it.delay_s)}` : undefined}>
                            <span style={{ fontFamily: "monospace", fontWeight: 700, color: bandColor(it.work_delay_s ?? 0) }}>{fmtHMS(it.work_delay_s)}</span>
                            {it.delay_s != null && it.work_delay_s != null && it.delay_s - it.work_delay_s >= 60 && (
                              <span style={{ marginLeft: 6, fontSize: 11, color: "var(--text3)" }}>({fmtDelay(it.delay_s)})</span>
                            )}
                          </td>
                          <td style={TD}><ContactCell it={it} /></td>
                        </> : <>
                          <td style={TD}><RecalledCell it={it} /></td>
                          <td style={TD}><ReasonCell it={it} /></td>
                        </>}
                        <td style={TD}>
                          {it.lead_id ? (portal
                            ? <a href={`${portal}/crm/lead/details/${it.lead_id}/`} target="_blank" rel="noreferrer" style={{ color: "#2196F3", textDecoration: "none", fontWeight: 600 }}>#{it.lead_id} →</a>
                            : <span style={{ color: "#2196F3", fontWeight: 600 }}>#{it.lead_id}</span>)
                            : <i style={{ color: "var(--text3)" }}>Bitrix24 da yo'q</i>}
                        </td>
                        <td style={{ ...TD, color: "var(--text)" }}>{it.responsible || "—"}</td>
                        <td style={TD}>{it.stage_name ? <span style={pill("#9C27B0")}>{leadStageLabel(null, it.stage_name)}</span> : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {items.length > 0 && (
                <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 22px" }}>
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
                  {moreError && <span style={{ fontSize: 12, color: "#F44336" }}>Xatolik: {moreError}</span>}
                  <span style={{ fontSize: 11.5, color: "var(--text3)", marginLeft: "auto" }}>
                    {fmtNum(items.length)} / {fmtNum(total)} ta
                  </span>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

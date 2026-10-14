import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PhoneMissed, HelpCircle, X, ChevronDown } from "lucide-react";
import { getNotRecalledCalls, type CallDashboardFilter, type NotRecalledItem } from "@/lib/api/leads";
import { fmtNum } from "@/lib/utils";

/**
 * The list behind the call page's "Ne perezvonili" card: every missed call nobody
 * talked to the customer about within 24h, with who it rang, how long the customer
 * waited, why it ended, and the lead / responsible / stage it belongs to.
 * The backend computes it with the card's own code, so JAMI always equals the card.
 */

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

function RecalledCell({ it }: { it: NotRecalledItem }) {
  if (it.status === "late" && it.callback_at) {
    const hours = Math.floor((it.delay_s ?? 0) / 3600);
    return <span style={pill("#4CAF50")} title={`${fmtWhen(it.callback_at)} — ${hours} soatdan keyin`}>{fmtShort(it.callback_at)} · {hours} soat</span>;
  }
  if (it.status === "open") return <span style={pill("#FF9800")} title="24 soat hali tugamagan: qayta qo'ng'iroq bo'lishi mumkin">Kutilmoqda</span>;
  return <span style={pill("#F44336")}>Yo'q</span>;
}

export function NotRecalledModal({ filter, portal, onClose }: {
  filter: CallDashboardFilter; portal: string; onClose: () => void;
}) {
  const q = useQuery({ queryKey: ["call-not-recalled", filter], queryFn: () => getNotRecalledCalls(filter, { offset: 0, limit: PAGE }) });
  const [more, setMore] = useState<NotRecalledItem[]>([]);     // pages loaded after the first
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
      const got: NotRecalledItem[] = [];
      while (want > 0) {
        const r = await getNotRecalledCalls(filter, { offset: have, limit: Math.min(want, MAX_REQUEST) });
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
    <div role="dialog" aria-modal="true" aria-label="Ne perezvonili — qayta chiqilmagan"
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: "3vh 2vw" }}>
      <div style={{ width: "min(1320px, 100%)", maxHeight: "94vh", display: "flex", flexDirection: "column", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 14, overflow: "hidden", boxShadow: "0 20px 60px rgba(0,0,0,0.5)" }}>
        {/* header */}
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "16px 22px", borderBottom: "1px solid var(--border)" }}>
          <PhoneMissed size={20} color="#F44336" style={{ marginTop: 3, flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 17, fontWeight: 700, color: "var(--text)" }}>Ne perezvonili — qayta chiqilmagan</div>
            <div style={{ fontSize: 12.5, color: "var(--text3)", marginTop: 3 }}>
              Javobsiz qolgan va {hours} soat ichida qayta chiqilmagan raqamlar · {filter.start_date ?? "…"} → {filter.end_date ?? "…"}
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

        {help && (
          <div style={{ padding: "12px 22px", fontSize: 12.5, lineHeight: 1.6, color: "var(--text2)", background: "rgba(33,150,243,0.06)", borderBottom: "1px solid var(--border)" }}>
            Bitrix24'dagi har bir javobsiz kirish qo'ng'irog'i alohida sanaladi. O'sha raqam bilan <b>javob berilgan suhbat</b> (istalgan yo'nalish va operator,
            PBX va Moizvonki) {hours} soat ichida bo'lsa — qayta chiqilgan, aks holda bu ro'yxatga tushadi.
            <b> Yo'q</b> — undan keyin ham suhbat bo'lmagan; <b>vaqt</b> — {hours} soatdan keyin bog'lanilgan (qachon va necha soatdan keyin);
            <b> Kutilmoqda</b> — {hours} soat hali tugamagan. <b>Urinish</b> — shu raqam ro'yxatda necha marta uchraydi.
            Kutgan — mijoz qo'ng'iroqda necha soniya kutgan.
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
              <div style={{ display: "flex", flexWrap: "wrap", gap: 12, padding: "16px 22px" }}>
                <Stat label="Jami" value={fmtNum(s.total)} color="#F44336" />
                <Stat label="Unikal raqam" value={fmtNum(s.unique_numbers)} color="#2196F3" />
                <Stat label="Qayta chiqilgan" value={fmtNum(s.late)} color="#4CAF50" />
                <Stat label="Chiqilmagan" value={fmtNum(s.not_reached)} color="#F44336" />
                <Stat label="O'rt. kutish" value={fmtHMS(s.avg_wait_s)} color="#9C27B0" />
                <Stat label="O'rt. javob vaqti" value={fmtHMS(s.avg_delay_s)} color="#607D8B" />
              </div>
              <div style={{ padding: "0 22px 12px", fontSize: 11.5, color: "var(--text3)" }}>
                "Qayta chiqilgan" — {hours} soatdan keyin bog'lanilganlar (o'rt. javob vaqti shularniki).
                {s.still_open > 0 && <> "Chiqilmagan" ichida {fmtNum(s.still_open)} ta uchun {hours} soat hali tugamagan.</>}
                {" "}Davrdagi barcha javobsiz qo'ng'iroq: {fmtNum(s.missed_total)} ta.
              </div>

              {items.length === 0 ? (
                <div style={{ padding: 48, textAlign: "center", color: "var(--text2)" }}>Qayta chiqilmagan qo'ng'iroq yo'q</div>
              ) : (
                <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0 }}>
                  <thead>
                    <tr>
                      {["#", "Telefon", "Sana va vaqt", "Kim / navbat", "Kutgan", "Urinish", "Qayta chiqilgan", "Sabab", "Lead", "Mas'ul", "Bosqich"].map(h => (
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
                        <td style={TD}><RecalledCell it={it} /></td>
                        <td style={{ ...TD, fontSize: 11.5, color: "var(--text3)" }}>{it.reason || "—"}</td>
                        <td style={TD}>
                          {it.lead_id ? (portal
                            ? <a href={`${portal}/crm/lead/details/${it.lead_id}/`} target="_blank" rel="noreferrer" style={{ color: "#2196F3", textDecoration: "none", fontWeight: 600 }}>#{it.lead_id} →</a>
                            : <span style={{ color: "#2196F3", fontWeight: 600 }}>#{it.lead_id}</span>)
                            : <i style={{ color: "var(--text3)" }}>Bitrix24 da yo'q</i>}
                        </td>
                        <td style={{ ...TD, color: "var(--text)" }}>{it.responsible || "—"}</td>
                        <td style={TD}>{it.stage_name ? <span style={pill("#9C27B0")}>{it.stage_name}</span> : "—"}</td>
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

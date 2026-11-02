/**
 * The Reaksiya vaqti card opens this: three speeds, one tab each.
 *   1. Javob berish   — a customer calls: how long until an operator picks up
 *   2. Propushenniy   — a call was missed: how long until we called back (the existing list)
 *   3. Yangi lid      — a lead from an ad / form / site (not a call): how long until the first call
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Clock, ExternalLink } from "lucide-react";
import { fmtNum } from "@/lib/utils";
import { fmtSecs } from "@/lib/duration";
import { SidePanel, PanelStats } from "@/components/SidePanel";
import { InfoTip } from "@/components/InfoTip";
import { EmptyState, ErrorState, LoadingRows } from "@/components/DataState";
import { MissedCallsModal } from "@/components/MissedCallsModal";
import { getAnswerSpeed, getLeadFirstCall, type CallDashboardFilter, type SpeedBand } from "@/lib/api/leads";

export type ReactionTab = "answer" | "callback" | "lead";

const ANSWER_BANDS: Record<string, { label: string; color: string }> = {
  lt10s: { label: "10 s gacha", color: "#16A34A" }, lt20s: { label: "10–20 s", color: "#65A30D" },
  lt40s: { label: "20–40 s", color: "#F59E0B" }, lt60s: { label: "40–60 s", color: "#EA580C" }, gte60s: { label: "1 daq dan ko'p", color: "#DC2626" },
};
const LEAD_BANDS: Record<string, { label: string; color: string }> = {
  lt5m: { label: "5 daq gacha", color: "#16A34A" }, lt15m: { label: "5–15 daq", color: "#65A30D" },
  lt1h: { label: "15–60 daq", color: "#F59E0B" }, lt4h: { label: "1–4 soat", color: "#EA580C" }, gte4h: { label: "4 soatdan ko'p", color: "#DC2626" },
};
const tone = (s: number | null | undefined, slow: number[]) =>
  s == null ? "var(--text3)" : s < slow[0] ? "#16A34A" : s < slow[1] ? "#F59E0B" : "#DC2626";
const pct = (n: number, of: number) => (of ? `${Math.round((n / of) * 100)}%` : "0%");
const TZ = "Asia/Tashkent";
const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString("ru-RU", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false });
const fmtDay = (iso: string) => new Date(iso).toLocaleDateString("ru-RU", { timeZone: TZ, day: "2-digit", month: "2-digit" });

/** One bar split by speed bands, with the legend under it. */
function BandBar({ bands, defs }: { bands: SpeedBand[]; defs: Record<string, { label: string; color: string }> }) {
  const total = bands.reduce((s, b) => s + b.count, 0);
  if (!total) return null;
  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ display: "flex", height: 8, borderRadius: 4, overflow: "hidden", background: "var(--bg3)" }}>
        {bands.map((b) => b.count > 0 && (
          <div key={b.id} title={`${defs[b.id]?.label}: ${fmtNum(b.count)} (${pct(b.count, total)})`} style={{ width: pct(b.count, total), background: defs[b.id]?.color }} />
        ))}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 14px", marginTop: 7, fontSize: 12, color: "var(--text2)" }}>
        {bands.map((b) => (
          <span key={b.id} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: defs[b.id]?.color }} />
            {defs[b.id]?.label} <b style={{ color: "var(--text)" }}>{fmtNum(b.count)}</b>
            <span style={{ color: "var(--text3)" }}>{pct(b.count, total)}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

const TH: React.CSSProperties = { position: "sticky", top: 0, zIndex: 1, padding: "9px 16px", textAlign: "left", fontSize: 11, fontWeight: 600, letterSpacing: "0.04em", textTransform: "uppercase", color: "var(--text3)", background: "var(--bg2)", borderBottom: "1px solid var(--border)", whiteSpace: "nowrap" };
const TD: React.CSSProperties = { padding: "9px 16px", borderBottom: "1px solid var(--border)", fontSize: 13, verticalAlign: "top" };
const sub: React.CSSProperties = { fontSize: 11.5, color: "var(--text3)", marginTop: 3 };

/** A small "who / how many / how fast" table (per operator, per source). */
function SpeedTable({ title, rows, slow }: { title: string; rows: { name: string; count: number; extra?: React.ReactNode; avg_s: number | null; median_s: number | null }[]; slow: number[] }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <div style={{ flex: "1 1 380px", minWidth: 0, border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
      <div style={{ padding: "10px 14px", fontSize: 13, fontWeight: 700, color: "var(--text)", background: "var(--bg2)", borderBottom: "1px solid var(--border)" }}>{title}</div>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead><tr>{["", "Soni", "Mediana", "O'rtacha"].map((h, i) => <th key={i} style={{ ...TH, position: "static", textAlign: i ? "right" : "left" }}>{h}</th>)}</tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.name}>
              <td style={{ ...TD, maxWidth: 200 }}>
                <div style={{ fontWeight: 600, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name}</div>
                <div style={{ height: 3, borderRadius: 2, background: "var(--bg4)", marginTop: 5, maxWidth: 140 }}>
                  <div style={{ height: "100%", width: `${(r.count / max) * 100}%`, background: "#2563EB", borderRadius: 2 }} />
                </div>
              </td>
              <td style={{ ...TD, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmtNum(r.count)}{r.extra}</td>
              <td style={{ ...TD, textAlign: "right", fontWeight: 700, color: tone(r.median_s, slow) }}>{fmtSecs(r.median_s)}</td>
              <td style={{ ...TD, textAlign: "right", color: "var(--text2)" }}>{fmtSecs(r.avg_s)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AnswerTab({ filter }: { filter: CallDashboardFilter }) {
  const q = useQuery({ queryKey: ["call-answer-speed", filter], queryFn: () => getAnswerSpeed(filter), staleTime: 5 * 60_000 });
  if (q.isLoading) return <LoadingRows rows={8} />;
  if (q.isError || !q.data) return <ErrorState onRetry={() => q.refetch()} />;
  const { summary: s, by_operator } = q.data;
  if (!s.count) return <EmptyState title="Bu davrda javob berilgan kiruvchi qo'ng'iroq yo'q" />;
  return (
    <div style={{ padding: "16px 20px" }}>
      <PanelStats items={[
        { label: "Javob berilgan", value: fmtNum(s.count) },
        { label: "O'rtacha kutish", value: fmtSecs(s.avg_s), color: tone(s.avg_s, [20, 40]) },
        { label: "Mediana", value: fmtSecs(s.median_s), color: tone(s.median_s, [20, 40]) },
        { label: "20 s ichida", value: pct(s.within_20s, s.count), color: "#16A34A" },
      ]} />
      <BandBar bands={s.bands} defs={ANSWER_BANDS} />
      <div style={{ marginTop: 18 }}>
        <SpeedTable title="Operatorlar bo'yicha" slow={[20, 40]}
          rows={by_operator.map((o) => ({ name: o.name, count: o.count, avg_s: o.avg_s, median_s: o.median_s }))} />
      </div>
    </div>
  );
}

type LeadView = "all" | "not_called" | "slow";

function LeadTab({ filter, portal }: { filter: CallDashboardFilter; portal: string }) {
  const q = useQuery({ queryKey: ["call-lead-first-call", filter], queryFn: () => getLeadFirstCall(filter), staleTime: 5 * 60_000 });
  const [view, setView] = useState<LeadView>("all");
  const [shown, setShown] = useState(100);
  const items = useMemo(() => {
    const all = q.data?.items ?? [];
    if (view === "not_called") return all.filter((i) => i.first_call_at == null);
    if (view === "slow") return all.filter((i) => (i.work_delay_s ?? 0) >= 3600).sort((a, b) => (b.work_delay_s ?? 0) - (a.work_delay_s ?? 0));
    return all;
  }, [q.data, view]);
  if (q.isLoading) return <LoadingRows rows={8} />;
  if (q.isError || !q.data) return <ErrorState onRetry={() => q.refetch()} />;
  const { summary: s, by_source, by_operator } = q.data;
  if (!s.total) return <EmptyState title="Bu davrda reklama / formadan kelgan lid yo'q" />;
  const slowCount = (q.data.items ?? []).filter((i) => (i.work_delay_s ?? 0) >= 3600).length;
  const chip = (active: boolean, color: string): React.CSSProperties => ({
    display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 600, padding: "5px 11px", borderRadius: 999, cursor: "pointer",
    border: `1px solid ${active ? color : "var(--border)"}`, background: active ? `${color}14` : "var(--bg2)", color: active ? color : "var(--text2)",
  });
  return (
    <div>
      <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)" }}>
        <PanelStats items={[
          { label: "Yangi lidlar", value: fmtNum(s.total) },
          { label: "Qo'ng'iroq qilingan", value: <>{fmtNum(s.called)} <small style={{ fontSize: 12, fontWeight: 500, color: "var(--text3)" }}>{pct(s.called, s.total)}</small></>, color: "#16A34A" },
          { label: "Qo'ng'iroq qilinmagan", value: fmtNum(s.not_called), color: s.not_called ? "#DC2626" : undefined },
          { label: "Mediana (ish vaqti)", value: fmtSecs(s.median_work_s), color: tone(s.median_work_s, [900, 3600]) },
          { label: "O'rtacha (ish vaqti)", value: fmtSecs(s.avg_work_s), color: tone(s.avg_work_s, [900, 3600]) },
        ]} />
        <BandBar bands={s.bands} defs={LEAD_BANDS} />
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginTop: 18 }}>
          <SpeedTable title="Manba bo'yicha" slow={[900, 3600]}
            rows={by_source.map((g) => ({ name: g.name, count: g.total, extra: g.total > g.called ? <span style={{ color: "#DC2626", fontSize: 11.5 }}> · {g.total - g.called} qilinmagan</span> : null, avg_s: g.avg_s, median_s: g.median_s }))} />
          <SpeedTable title="Kim birinchi qo'ng'iroq qildi" slow={[900, 3600]}
            rows={by_operator.slice(0, 12).map((g) => ({ name: g.name, count: g.called, avg_s: g.avg_s, median_s: g.median_s }))} />
        </div>
      </div>

      <div style={{ position: "sticky", top: 0, zIndex: 2, display: "flex", gap: 8, padding: "10px 16px", background: "var(--bg2)", borderBottom: "1px solid var(--border)" }}>
        <button style={chip(view === "all", "#64748B")} onClick={() => { setView("all"); setShown(100); }}>Hammasi {fmtNum(s.total)}</button>
        <button style={chip(view === "not_called", "#DC2626")} onClick={() => { setView("not_called"); setShown(100); }}>Qo'ng'iroq qilinmagan {fmtNum(s.not_called)}</button>
        <button style={chip(view === "slow", "#EA580C")} onClick={() => { setView("slow"); setShown(100); }}>1 soatdan sekin {fmtNum(slowCount)}</button>
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead><tr>{["Lid", "Yaratildi", "Birinchi qo'ng'iroq", "Kim qildi", "Mas'ul"].map((h) => <th key={h} style={{ ...TH, top: 53 }}>{h}</th>)}</tr></thead>
        <tbody>
          {items.slice(0, shown).map((i) => (
            <tr key={i.lead_id}
              onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg3)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
              <td style={{ ...TD, maxWidth: 280 }}>
                <a href={portal ? `${portal}/crm/lead/details/${i.lead_id}/` : undefined} target="_blank" rel="noreferrer"
                  style={{ display: "inline-flex", alignItems: "center", gap: 5, maxWidth: "100%", color: "#2563EB", textDecoration: "none", fontWeight: 600 }}>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{i.title || `Lid #${i.lead_id}`}</span>
                  <ExternalLink size={11} style={{ flexShrink: 0, opacity: 0.6 }} />
                </a>
                <div style={sub}>{i.source}</div>
              </td>
              <td style={{ ...TD, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
                <b>{fmtTime(i.created_at)}</b> <span style={{ color: "var(--text3)" }}>{fmtDay(i.created_at)}</span>
              </td>
              <td style={{ ...TD, whiteSpace: "nowrap" }} title={i.delay_s != null ? `Haqiqatda (soat bo'yicha): ${fmtSecs(i.delay_s)}` : undefined}>
                {i.first_call_at ? <>
                  <div style={{ fontVariantNumeric: "tabular-nums" }}><b>{fmtTime(i.first_call_at)}</b> <span style={{ color: "var(--text3)" }}>{fmtDay(i.first_call_at)}</span></div>
                  <div style={{ ...sub, fontWeight: 700, color: tone(i.work_delay_s, [900, 3600]) }}>{fmtSecs(i.work_delay_s)} dan keyin</div>
                </> : <span style={{ color: "#DC2626", fontWeight: 600 }}>Qo'ng'iroq qilinmagan</span>}
              </td>
              <td style={TD}>
                {i.caller ? <>
                  <div style={{ color: "var(--text)" }}>{i.caller}</div>
                  {i.answered === false && <div style={{ ...sub, color: "#B45309" }}>mijoz ko'tarmadi</div>}
                </> : <span style={{ color: "var(--text3)" }}>—</span>}
              </td>
              <td style={{ ...TD, color: "var(--text)" }}>{i.responsible || "—"}</td>
            </tr>
          ))}
          {!items.length && <tr><td colSpan={5} style={{ padding: 24, textAlign: "center", color: "var(--text3)" }}>Bu filtr bo'yicha lid yo'q</td></tr>}
        </tbody>
      </table>
      {items.length > shown && (
        <div style={{ padding: 14, textAlign: "center" }}>
          <button onClick={() => setShown((n) => n + 200)} style={{ fontSize: 12.5, fontWeight: 600, padding: "7px 16px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg2)", color: "var(--text)", cursor: "pointer" }}>
            Yana {fmtNum(Math.min(200, items.length - shown))} ta ko'rsatish
          </button>
        </div>
      )}
    </div>
  );
}

const TABS: { id: ReactionTab; label: string; hint: string }[] = [
  { id: "answer", label: "Javob berish", hint: "Mijoz qo'ng'iroq qilganda operator qancha vaqtda ko'taradi" },
  { id: "callback", label: "Propushenniy'ga qayta qo'ng'iroq", hint: "Javobsiz qolgan qo'ng'iroqqa qancha vaqtda qayta qo'ng'iroq qilinadi" },
  { id: "lead", label: "Yangi lidga qo'ng'iroq", hint: "Reklama, forma yoki saytdan kelgan lidga qancha vaqtda birinchi qo'ng'iroq qilinadi" },
];

export function ReactionPanel({ filter, portal, onClose, initialTab = "callback" }: {
  filter: CallDashboardFilter; portal: string; onClose: () => void; initialTab?: ReactionTab;
}) {
  const [tab, setTab] = useState<ReactionTab>(initialTab);
  const help = (
    <>
      <b>Javob berish</b> — javob berilgan kiruvchi qo'ng'iroqda mijoz operator ko'targunicha kutgan vaqt (salomlashish va menyu ham kiradi).
      <br /><b>Propushenniy'ga qayta qo'ng'iroq</b> — javobsiz qo'ng'iroqdan keyin o'sha raqam bilan birinchi bog'lanishgacha, ish vaqti bo'yicha.
      <br /><b>Yangi lidga qo'ng'iroq</b> — qo'ng'iroqdan emas (Instagram, Kids, sayt, Telegram...) kelgan lid yaratilganidan operatorning birinchi qo'ng'irog'igacha (ko'tarilmagan bo'lsa ham), ish vaqti bo'yicha, 7 kun ichida.
      Qo'ng'iroq orqali yaratilgan lidlar (manba "Call" yoki nomi "Входящий / Пропущенный / Клиент не ответил / Исходящий") bu yerga kirmaydi.
    </>
  );
  return (
    <SidePanel open onClose={onClose} width={1080}
      title={<span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}><Clock size={18} color="#607D8B" /> Reaksiya vaqti <InfoTip text={help} label="Qanday hisoblanadi" size={15} /></span>}
      subtitle={`${filter.start_date ?? "…"} → ${filter.end_date ?? "…"}`}
      headerExtra={
        <div role="tablist" style={{ display: "flex", gap: 4, padding: 4, borderRadius: 12, background: "var(--bg3)", width: "fit-content", maxWidth: "100%", flexWrap: "wrap" }}>
          {TABS.map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} title={t.hint} onClick={() => setTab(t.id)}
              style={{ padding: "7px 14px", fontSize: 13, fontWeight: 600, border: 0, borderRadius: 9, cursor: "pointer",
                background: tab === t.id ? "var(--bg)" : "transparent", color: tab === t.id ? "var(--text)" : "var(--text3)",
                boxShadow: tab === t.id ? "0 1px 3px rgba(0,0,0,.12)" : "none" }}>
              {t.label}
            </button>
          ))}
        </div>
      }>
      {tab === "answer" && <AnswerTab filter={filter} />}
      {tab === "callback" && <MissedCallsModal variant="reaction" filter={filter} portal={portal} onClose={onClose} embedded />}
      {tab === "lead" && <LeadTab filter={filter} portal={portal} />}
    </SidePanel>
  );
}

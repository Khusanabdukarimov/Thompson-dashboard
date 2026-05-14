import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  RefreshCw, Calendar, Users, Star, TrendingUp, Filter,
  Percent, ArrowLeftRight, Target, XCircle, ChevronDown, Search,
} from "lucide-react";
import { Topbar } from "@/components/Topbar";
import { Button } from "@/components/Button";
import { getDashboardStats, getResponsiblesStats, getConversionStats } from "@/lib/api/leads";
import { fmtNum, fmtPct } from "@/lib/utils";
import { useLocalStorage } from "@/hooks/useLocalStorage";

const localISO = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const todayISO = () => localISO(new Date());
const daysAgoISO = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return localISO(d);
};

type PeriodId = "today" | "7d" | "30d" | "90d" | "all";

const DATE_OPTIONS: { id: PeriodId; label: string; start: () => string; end: () => string }[] = [
  { id: "today", label: "Bugun",          start: todayISO,             end: todayISO },
  { id: "7d",    label: "Oxirgi 7 kun",   start: () => daysAgoISO(7),  end: todayISO },
  { id: "30d",   label: "Oxirgi 30 kun",  start: () => daysAgoISO(30), end: todayISO },
  { id: "90d",   label: "Oxirgi 90 kun",  start: () => daysAgoISO(90), end: todayISO },
  { id: "all",   label: "Barchasi",       start: () => "",              end: () => "" },
];

const RESPONSIBLE_COLS = [
  { key: "qongiroqlar",             label: "Qo'ng'iroqlar",            color: "#9E9E9E" },
  { key: "yangi_lid",               label: "Yangi lid",                color: "#2196F3" },
  { key: "propushenniy",            label: "Propushenniy",             color: "#B0BEC5" },
  { key: "javob_bermadi",           label: "Javob bermadi",            color: "#FF9800" },
  { key: "qayta_aloqa",             label: "Qayta aloqa",              color: "#00BCD4" },
  { key: "oylab_koradi",            label: "O'ylab ko'radi",           color: "#E91E63" },
  { key: "konsultatsiya",           label: "Konsultatsiya belgilandi", color: "#9C27B0" },
  { key: "otkazilmadi",             label: "O'tkazilmadi",             color: "#FF00FF" },
  { key: "konsultatsiya_otkazildi", label: "Konsultatsiya o'tkazildi", color: "#4CAF50" },
  { key: "sandiq",                  label: "Sandiq",                   color: "#90CAF9" },
  { key: "sifatsiz",                label: "Sifatsiz",                 color: "#F44336" },
  { key: "bekor_boldi",             label: "Bekor bo'ldi",             color: "#FFC107" },
] as const;

type RespColKey = typeof RESPONSIBLE_COLS[number]["key"];

// ── Decorative sparkline ──────────────────────────────────────────
function Sparkline({ color, variant = 0 }: { color: string; variant?: number }) {
  const variants: [number, number][][] = [
    [[0,50],[25,42],[50,48],[80,35],[110,38],[140,22],[165,28],[190,12],[200,15]],
    [[0,45],[30,38],[60,44],[90,32],[120,36],[150,20],[175,26],[195,10],[200,12]],
    [[0,48],[35,40],[65,46],[95,28],[125,34],[150,18],[175,24],[195,14],[200,16]],
    [[0,52],[30,44],[60,48],[90,36],[120,40],[150,24],[170,30],[190,16],[200,18]],
  ];
  const pts = variants[variant % variants.length];
  const poly = pts.map(([x, y]) => `${x},${y}`).join(" ");
  const area = `0,60 ${poly} 200,60`;
  const gid  = `spk${variant}${color.replace(/[^a-z0-9]/gi, "")}`;
  const last = pts[pts.length - 1];
  return (
    <svg viewBox="0 0 200 60" preserveAspectRatio="none" style={{ width: "100%", height: 60, display: "block" }}>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor={color} stopOpacity="0.25" />
          <stop offset="100%" stopColor={color} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <polygon  points={area} fill={`url(#${gid})`} />
      <polyline points={poly}  fill="none" stroke={color} strokeWidth="2"
                strokeLinecap="round" strokeLinejoin="round" opacity="0.7" />
      <circle cx={last[0]} cy={last[1]} r="3" fill={color} />
    </svg>
  );
}

// ── Gradient card shell ───────────────────────────────────────────
type GradCardProps = {
  gradient: string;
  border: string;
  shadow: string;
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
  sparkColor: string;
  sparkVariant?: number;
};
function GradCard({ gradient, border, shadow, icon, title, children, sparkColor, sparkVariant = 0 }: GradCardProps) {
  return (
    <div style={{
      background: gradient,
      border: `1px solid ${border}`,
      boxShadow: shadow,
      borderRadius: 16,
      padding: "24px 24px 0 24px",
      display: "flex",
      flexDirection: "column",
      overflow: "hidden",
      minHeight: 200,
    }}>
      <div style={{
        width: 48, height: 48, borderRadius: "50%",
        background: border.replace(/[\d.]+\)$/, "0.18)"),
        display: "flex", alignItems: "center", justifyContent: "center",
        marginBottom: 12, flexShrink: 0,
      }}>
        {icon}
      </div>
      <div style={{ fontSize: 14, fontWeight: 600, color: "#fff", marginBottom: 4 }}>{title}</div>
      {children}
      <div style={{ marginTop: "auto", marginLeft: -24, marginRight: -24 }}>
        <Sparkline color={sparkColor} variant={sparkVariant} />
      </div>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────
export default function LidlarPage() {
  const [period, setPeriod] = useLocalStorage<PeriodId>("lidlar.period", "30d");
  const [search, setSearch] = useState("");

  const opt = DATE_OPTIONS.find((o) => o.id === period) ?? DATE_OPTIONS[2];
  const apiFilter = useMemo(() => ({
    start_date: opt.start() || undefined,
    end_date:   opt.end()   || undefined,
  }), [period]); // eslint-disable-line react-hooks/exhaustive-deps

  const statsQ = useQuery({
    queryKey: ["stats/dashboard",    apiFilter],
    queryFn:  () => getDashboardStats(apiFilter),
  });
  const respQ = useQuery({
    queryKey: ["stats/responsibles", apiFilter],
    queryFn:  () => getResponsiblesStats(apiFilter),
  });
  const conversionQ = useQuery({
    queryKey: ["stats/conversion",   apiFilter],
    queryFn:  () => getConversionStats(apiFilter),
  });

  const header       = statsQ.data?.header;
  const responsibles = respQ.data?.responsibles ?? [];

  const total             = header?.total_leads                    ?? 0;
  const sifatsizBekor     = header?.sifatsiz_bekor_count           ?? 0;
  const sifatliLid        = header?.sifatli_lid_count              ?? 0;
  const konsultBelgilandi = header?.konsultatsiya_belgilandi_count  ?? 0;
  const konsultOtkazildi  = header?.konsultatsiya_otkazildi_count   ?? 0;

  const sifatliKonvPct   = total > 0 ? (sifatliLid        / total) * 100 : 0;
  const leadToConsultPct = total > 0 ? (konsultBelgilandi / total) * 100 : 0;
  const overallConvPct   = total > 0 ? (konsultOtkazildi  / total) * 100 : 0;

  const byUserFiltered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return s ? responsibles.filter((u) => u.full_name.toLowerCase().includes(s)) : responsibles;
  }, [responsibles, search]);

  const colMaxes = useMemo(() => {
    const m: Partial<Record<RespColKey, number>> = {};
    for (const col of RESPONSIBLE_COLS)
      m[col.key] = Math.max(1, ...responsibles.map((u) => (u as unknown as Record<string, number>)[col.key] ?? 0));
    return m;
  }, [responsibles]);

  const totalsRow = useMemo(() => {
    const bs: Partial<Record<RespColKey, number>> = {};
    for (const u of responsibles)
      for (const col of RESPONSIBLE_COLS)
        bs[col.key] = (bs[col.key] ?? 0) + ((u as unknown as Record<string, number>)[col.key] ?? 0);
    return bs;
  }, [responsibles]);

  const isLoading = statsQ.isLoading;

  return (
    <>
      <Topbar
        title="Lidlar analitika"
        actions={
          <Button onClick={() => { statsQ.refetch(); respQ.refetch(); conversionQ.refetch(); }}>
            <RefreshCw className="w-3.5 h-3.5" /> Yangilash
          </Button>
        }
      />

      <div className="flex-1 overflow-y-auto px-[22px] py-[18px]" style={{ background: "#0a0a1a" }}>

        {/* ── Date filter dropdown ── */}
        <div style={{ display: "flex", alignItems: "center", marginBottom: 20 }}>
          <div style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
            <Calendar size={16} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "#9E9E9E", pointerEvents: "none" }} />
            <select
              value={period}
              onChange={(e) => setPeriod(e.target.value as PeriodId)}
              style={{
                background: "#111827",
                border: "1px solid #2a2a4a",
                color: "#fff",
                borderRadius: 10,
                padding: "8px 36px 8px 36px",
                fontSize: 13,
                fontWeight: 500,
                appearance: "none",
                cursor: "pointer",
                outline: "none",
              }}
            >
              {DATE_OPTIONS.map((o) => (
                <option key={o.id} value={o.id}>{o.label}</option>
              ))}
            </select>
            <ChevronDown size={16} style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", color: "#9E9E9E", pointerEvents: "none" }} />
          </div>
        </div>

        {/* ── Row 1 — 4 gradient KPI cards ── */}
        {isLoading ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 16 }}>
            {[0,1,2,3].map((i) => (
              <div key={i} style={{ height: 200, borderRadius: 16, background: "#111827", animation: "pulse 1.5s ease-in-out infinite" }} />
            ))}
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 16 }}
               className="grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">

            {/* Card 1 – Total Leads */}
            <GradCard
              gradient="linear-gradient(135deg, #0d1b4a 0%, #1a3a7a 100%)"
              border="rgba(33,150,243,0.3)"
              shadow="0 4px 20px rgba(33,150,243,0.15)"
              icon={<Users size={24} style={{ color: "#2196F3" }} />}
              title="Total Leads"
              sparkColor="#2196F3"
              sparkVariant={0}
            >
              <div style={{ fontSize: 46, fontWeight: 800, color: "#fff", lineHeight: 1.1, marginBottom: 6 }}>
                {fmtNum(total)}
              </div>
              <div style={{ fontSize: 12, color: "#9E9E9E" }}>Umumiy Lid</div>
            </GradCard>

            {/* Card 2 – Qualified Leads */}
            <GradCard
              gradient="linear-gradient(135deg, #002a2a 0%, #005555 100%)"
              border="rgba(0,188,212,0.3)"
              shadow="0 4px 20px rgba(0,188,212,0.15)"
              icon={<Star size={24} style={{ color: "#00BCD4" }} />}
              title="Qualified Leads"
              sparkColor="#00BCD4"
              sparkVariant={1}
            >
              <div style={{ fontSize: 46, fontWeight: 800, color: "#00BCD4", lineHeight: 1.1, marginBottom: 6 }}>
                {fmtNum(sifatliLid)}
              </div>
              <div style={{ fontSize: 12, color: "#9E9E9E" }}>Sifatli Lid</div>
            </GradCard>

            {/* Card 3 – Consultations */}
            <GradCard
              gradient="linear-gradient(135deg, #1a0033 0%, #3d1a6e 100%)"
              border="rgba(156,39,176,0.3)"
              shadow="0 4px 20px rgba(156,39,176,0.15)"
              icon={<Calendar size={24} style={{ color: "#9C27B0" }} />}
              title="Consultations"
              sparkColor="#9C27B0"
              sparkVariant={2}
            >
              <div style={{ display: "flex", alignItems: "baseline", gap: 6, lineHeight: 1.1, marginBottom: 4 }}>
                <span style={{ fontSize: 46, fontWeight: 800, color: "#4CAF50" }}>{fmtNum(konsultBelgilandi)}</span>
                <span style={{ fontSize: 32, fontWeight: 700, color: "#fff"   }}>/</span>
                <span style={{ fontSize: 46, fontWeight: 800, color: "#fff"   }}>{fmtNum(konsultOtkazildi)}</span>
              </div>
              <div style={{ fontSize: 11, marginBottom: 2 }}>
                <span style={{ color: "#4CAF50" }}>Scheduled</span>
                <span style={{ color: "#9E9E9E" }}> / </span>
                <span style={{ color: "#4CAF50" }}>Conducted</span>
              </div>
              <div style={{ fontSize: 11, color: "#9E9E9E" }}>Konsultatsiya Belgilandi / O'tkazildi</div>
            </GradCard>

            {/* Card 4 – Final Conversion */}
            <GradCard
              gradient="linear-gradient(135deg, #0a2e0a 0%, #1b5e20 100%)"
              border="rgba(76,175,80,0.3)"
              shadow="0 4px 20px rgba(76,175,80,0.15)"
              icon={<TrendingUp size={24} style={{ color: "#4CAF50" }} />}
              title="Final Conversion"
              sparkColor="#4CAF50"
              sparkVariant={3}
            >
              <div style={{ fontSize: 46, fontWeight: 800, color: "#fff", lineHeight: 1.1, marginBottom: 6 }}>
                {overallConvPct.toFixed(1)}%
              </div>
              <div style={{ fontSize: 12, color: "#9E9E9E" }}>Konversiya</div>
            </GradCard>
          </div>
        )}

        {/* ── Row 2 — Funnel Efficiency + Discarded ── */}
        {!isLoading && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: 16, marginBottom: 20 }}
               className="grid-cols-1 lg:grid-cols-[1fr_320px]">

            {/* Funnel Efficiency */}
            <div style={{
              background: "#111827",
              border: "1px solid #2a2a4a",
              borderRadius: 16,
              padding: 28,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 28 }}>
                <Filter size={18} style={{ color: "#9E9E9E" }} />
                <span style={{ fontSize: 16, fontWeight: 700, color: "#fff" }}>Funnel Efficiency</span>
                <span style={{ fontSize: 12, color: "#9E9E9E", marginLeft: 4 }}>Konversiya ko'rsatkichlari</span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 24 }}>

                {/* Metric 1 */}
                <div style={{ display: "flex", alignItems: "flex-start", gap: 16 }}>
                  <div style={{
                    width: 56, height: 56, borderRadius: "50%", flexShrink: 0,
                    background: "rgba(0,188,212,0.15)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}>
                    <Percent size={24} style={{ color: "#00BCD4" }} />
                  </div>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "#fff", marginBottom: 6 }}>Sifatli Konversiya</div>
                    <div style={{ fontSize: 32, fontWeight: 800, color: "#00BCD4", lineHeight: 1.1, marginBottom: 8 }}>
                      {sifatliKonvPct.toFixed(1)}%
                    </div>
                    <div style={{ fontSize: 11, color: "#9E9E9E" }}>Qualified / Total Leads</div>
                  </div>
                </div>

                {/* Metric 2 */}
                <div style={{ display: "flex", alignItems: "flex-start", gap: 16 }}>
                  <div style={{
                    width: 56, height: 56, borderRadius: "50%", flexShrink: 0,
                    background: "rgba(76,175,80,0.15)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}>
                    <ArrowLeftRight size={24} style={{ color: "#4CAF50" }} />
                  </div>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "#fff", marginBottom: 6 }}>Lead to Consultation</div>
                    <div style={{ fontSize: 32, fontWeight: 800, color: "#4CAF50", lineHeight: 1.1, marginBottom: 8 }}>
                      {leadToConsultPct.toFixed(1)}%
                    </div>
                    <div style={{ fontSize: 11, color: "#9E9E9E" }}>Umumiy → K.Belgilandi</div>
                  </div>
                </div>

                {/* Metric 3 */}
                <div style={{ display: "flex", alignItems: "flex-start", gap: 16 }}>
                  <div style={{
                    width: 56, height: 56, borderRadius: "50%", flexShrink: 0,
                    background: "rgba(76,175,80,0.15)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}>
                    <Target size={24} style={{ color: "#4CAF50" }} />
                  </div>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "#fff", marginBottom: 6 }}>Overall Conversion</div>
                    <div style={{ fontSize: 32, fontWeight: 800, color: "#4CAF50", lineHeight: 1.1, marginBottom: 8 }}>
                      {overallConvPct.toFixed(1)}%
                    </div>
                    <div style={{ fontSize: 11, color: "#9E9E9E" }}>Umumiy → K.O'tkazildi</div>
                  </div>
                </div>
              </div>
            </div>

            {/* Discarded / Cancelled */}
            <div style={{
              background: "linear-gradient(135deg, #2a0000 0%, #6e1a1a 100%)",
              border: "1px solid rgba(244,67,54,0.3)",
              boxShadow: "0 4px 20px rgba(244,67,54,0.15)",
              borderRadius: 16,
              padding: "24px 24px 0 24px",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
            }}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 18 }}>
                <div style={{
                  width: 60, height: 60, borderRadius: "50%", flexShrink: 0,
                  background: "rgba(244,67,54,0.2)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  <XCircle size={30} style={{ color: "#F44336" }} />
                </div>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: "#fff" }}>Discarded / Cancelled</div>
                  <div style={{ fontSize: 52, fontWeight: 800, color: "#F44336", lineHeight: 1.1, marginTop: 6 }}>
                    {fmtNum(sifatsizBekor)}
                  </div>
                  <div style={{ fontSize: 12, color: "#9E9E9E", marginTop: 4 }}>Sifatsiz / Bekor</div>
                </div>
              </div>
              <div style={{ marginTop: "auto", marginLeft: -24, marginRight: -24 }}>
                <Sparkline color="#F44336" variant={0} />
              </div>
            </div>
          </div>
        )}

        {/* ── Lid va Konversiya table ── */}
        <div className="bg-bg2 border border-border rounded-lg shadow mb-4 overflow-hidden">
          <div className="px-4 py-3 border-b border-border">
            <span className="text-[13px] font-semibold">Lid va Konversiya</span>
          </div>
          {conversionQ.isLoading ? (
            <div className="p-6 text-text3 text-[12px]">Yuklanmoqda…</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[11.5px] border-collapse">
                <thead>
                  <tr className="border-b border-border bg-bg">
                    <th className="px-4 py-2.5 text-left font-medium text-text3 uppercase tracking-wider text-[10px] min-w-[160px]">Mas'ul</th>
                    <th className="px-3 py-2.5 text-right font-medium text-[10px] uppercase tracking-wider min-w-[80px]" style={{ color: "#60a5fa" }}>Jami lid</th>
                    <th className="px-3 py-2.5 text-right font-medium text-[10px] uppercase tracking-wider min-w-[80px]" style={{ color: "#f59e0b" }}>Jarayonda</th>
                    <th className="px-3 py-2.5 text-right font-medium text-[10px] uppercase tracking-wider min-w-[80px]" style={{ color: "#f87171" }}>Sifatsiz lid</th>
                    <th className="px-3 py-2.5 text-right font-medium text-[10px] uppercase tracking-wider min-w-[120px]" style={{ color: "#34d399" }}>Konsultatsiya o'tkazildi</th>
                    <th className="px-3 py-2.5 text-right font-medium text-[10px] uppercase tracking-wider min-w-[80px]" style={{ color: "#4ade80" }}>Konversiya</th>
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    const rows = conversionQ.data?.conversion ?? [];
                    const maxTotal     = Math.max(1, ...rows.map((r) => r.total));
                    const totTotal     = rows.reduce((s, r) => s + r.total,           0);
                    const totJarayonda = rows.reduce((s, r) => s + r.jarayonda,        0);
                    const totSifatsiz  = rows.reduce((s, r) => s + r.sifatsiz_lid,     0);
                    const totTashrif   = rows.reduce((s, r) => s + r.tashrif_buyurdi,  0);
                    return (
                      <>
                        {rows.map((r) => {
                          const konv = r.total > 0 ? (r.tashrif_buyurdi / r.total) * 100 : 0;
                          return (
                            <tr key={r.responsible_id} className="border-b border-border hover:bg-bg3 transition-colors">
                              <td className="px-4 py-2.5">
                                <div className="flex items-center gap-2">
                                  <div className="w-6 h-6 rounded-full bg-blue-bg text-blue text-[9px] font-bold flex items-center justify-center shrink-0">
                                    {(r.full_name || "?").split(" ").filter(Boolean).slice(0,2).map((s) => s[0]).join("").toUpperCase() || "?"}
                                  </div>
                                  <span className="font-medium text-[12px] whitespace-nowrap">{r.full_name}</span>
                                </div>
                              </td>
                              <td className="px-3 py-2.5 text-right">
                                <span className="mono font-semibold text-[12px]">{fmtNum(r.total)}</span>
                                <div className="h-[3px] rounded mt-1 bg-bg4 overflow-hidden">
                                  <div className="h-full rounded" style={{ width: `${(r.total / maxTotal) * 100}%`, background: "#60a5fa" }} />
                                </div>
                              </td>
                              <td className="px-3 py-2.5 text-right">
                                <span className="mono text-[12px]">{fmtNum(r.jarayonda)}</span>
                                <div className="h-[3px] rounded mt-1 bg-bg4 overflow-hidden">
                                  <div className="h-full rounded" style={{ width: r.total > 0 ? `${(r.jarayonda / r.total) * 100}%` : "0%", background: "#f59e0b" }} />
                                </div>
                              </td>
                              <td className="px-3 py-2.5 text-right">
                                <span className="mono text-[12px]">{fmtNum(r.sifatsiz_lid)}</span>
                                <div className="h-[3px] rounded mt-1 bg-bg4 overflow-hidden">
                                  <div className="h-full rounded" style={{ width: r.total > 0 ? `${(r.sifatsiz_lid / r.total) * 100}%` : "0%", background: "#f87171" }} />
                                </div>
                              </td>
                              <td className="px-3 py-2.5 text-right">
                                <span className="mono text-[12px]">{fmtNum(r.tashrif_buyurdi)}</span>
                                <div className="h-[3px] rounded mt-1 bg-bg4 overflow-hidden">
                                  <div className="h-full rounded" style={{ width: r.total > 0 ? `${(r.tashrif_buyurdi / r.total) * 100}%` : "0%", background: "#34d399" }} />
                                </div>
                              </td>
                              <td className="px-3 py-2.5 text-right">
                                <span className="mono font-semibold text-[12px]" style={{ color: "#4ade80" }}>
                                  {konv > 0 ? fmtPct(konv, 1) : "—"}
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                        <tr className="bg-bg3 border-t-2 border-border">
                          <td className="px-4 py-2.5 text-[10px] text-text3 uppercase tracking-wider font-semibold">Итого</td>
                          <td className="px-3 py-2.5 text-right"><span className="mono font-bold text-[13px]">{fmtNum(totTotal)}</span></td>
                          <td className="px-3 py-2.5 text-right"><span className="mono font-semibold text-[12px]">{fmtNum(totJarayonda)}</span></td>
                          <td className="px-3 py-2.5 text-right"><span className="mono font-semibold text-[12px]">{fmtNum(totSifatsiz)}</span></td>
                          <td className="px-3 py-2.5 text-right"><span className="mono font-semibold text-[12px]">{fmtNum(totTashrif)}</span></td>
                          <td className="px-3 py-2.5 text-right">
                            <span className="mono font-semibold text-[12px]" style={{ color: "#4ade80" }}>
                              {totTotal > 0 ? fmtPct((totTashrif / totTotal) * 100, 1) : "—"}
                            </span>
                          </td>
                        </tr>
                      </>
                    );
                  })()}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ── Lid mas'ullar kesimida ── */}
        <div className="bg-bg2 border border-border rounded-lg shadow mb-4 overflow-hidden">
          <div className="px-4 py-3 border-b border-border flex justify-between items-center flex-wrap gap-2">
            <div className="flex items-center gap-3">
              <span className="text-[13px] font-semibold">Lid mas'ullar kesimida</span>
              <span className="text-[11px] text-text3">{byUserFiltered.length} ta xodim</span>
            </div>
            {/* Search bar (Qidirish) */}
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text3 pointer-events-none" />
              <input
                type="text"
                placeholder="Qidirish…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8 pr-3 py-1.5 bg-bg border border-border rounded-lg text-[12px] text-text placeholder-text3 outline-none focus:border-blue w-[180px]"
              />
            </div>
          </div>
          {respQ.isLoading && !responsibles.length ? (
            <div className="p-6 text-text3 text-[12px]">Yuklanmoqda…</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[11.5px] border-collapse">
                <thead>
                  <tr className="border-b border-border bg-bg">
                    <th className="sticky left-0 bg-bg px-4 py-2.5 text-left font-medium text-text3 uppercase tracking-wider text-[10px] min-w-[160px] z-10">
                      Mas'ul
                    </th>
                    <th className="px-3 py-2.5 text-right font-medium text-text3 uppercase tracking-wider text-[10px] min-w-[56px]">
                      Jami
                    </th>
                    {RESPONSIBLE_COLS.map((col) => (
                      <th key={col.key} className="px-3 py-2.5 text-left font-medium text-[10px] uppercase tracking-wider min-w-[88px]" style={{ color: col.color }}>
                        {col.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {byUserFiltered.map((u) => (
                    <tr key={u.responsible_id} className="border-b border-border hover:bg-bg3 transition-colors">
                      <td className="sticky left-0 bg-bg2 px-4 py-2.5 z-10">
                        <div className="flex items-center gap-2">
                          <div className="w-6 h-6 rounded-full bg-blue-bg text-blue text-[9px] font-bold flex items-center justify-center shrink-0">
                            {(u.full_name || `U${u.responsible_id}`).split(" ").filter(Boolean).slice(0,2).map((s) => s[0]).join("").toUpperCase() || "?"}
                          </div>
                          <span className="font-medium text-[12px] whitespace-nowrap">{u.full_name || `User ${u.responsible_id}`}</span>
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <span className="mono font-semibold text-[13px]">{fmtNum(u.total)}</span>
                      </td>
                      {RESPONSIBLE_COLS.map((col) => {
                        const cnt = (u as unknown as Record<string, number>)[col.key] ?? 0;
                        const max = colMaxes[col.key] ?? 1;
                        return (
                          <td key={col.key} className="px-3 py-2.5">
                            {cnt > 0 ? (
                              <div>
                                <span className="mono text-[12px]">{fmtNum(cnt)}</span>
                                <div className="h-[3px] rounded mt-1 bg-bg4 overflow-hidden">
                                  <div className="h-full rounded" style={{ width: `${(cnt / max) * 100}%`, background: col.color }} />
                                </div>
                              </div>
                            ) : (
                              <span className="text-text3">—</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                  <tr className="bg-bg3 border-t-2 border-border">
                    <td className="sticky left-0 bg-bg3 px-4 py-2.5 text-[10px] text-text3 uppercase tracking-wider font-semibold z-10">Jami</td>
                    <td className="px-3 py-2.5 text-right"><span className="mono font-bold text-[13px]">{fmtNum(responsibles.reduce((s, u) => s + u.total, 0))}</span></td>
                    {RESPONSIBLE_COLS.map((col) => (
                      <td key={col.key} className="px-3 py-2.5"><span className="mono text-[12px] font-semibold">{fmtNum(totalsRow[col.key] ?? 0)}</span></td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </div>

        {statsQ.error && (
          <div className="mt-4 p-3 bg-red-bg border border-red-bd text-red rounded-lg text-[12.5px]">
            Xatolik: {(statsQ.error as Error).message}
          </div>
        )}
      </div>
    </>
  );
}

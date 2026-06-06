import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  RefreshCw, Download, Bell, User, Search, Calendar,
  ChevronDown, TrendingUp,
} from "lucide-react";
import { Skeleton } from "@/components/Skeleton";
import {
  getMetaInsights, getMetaCampaigns, getCampaignForms, getFormLeads,
  getPageForms, getKunlikHisobot,
  MONTH_KEYS, MONTH_LABELS,
} from "@/lib/api/meta";
import type { MonthKey, PageForm } from "@/lib/api/meta";
import { fmtNum } from "@/lib/utils";

const now = new Date();
const DEFAULT_MONTH = MONTH_KEYS[now.getMonth()];
const DEFAULT_YEAR  = now.getFullYear();

// ── helpers ────────────────────────────────────────────────────────────────────
function sumArr(arr: number[]) { return arr.reduce((a, b) => a + b, 0); }
function pct(a: number, b: number) { return b > 0 ? Math.round((a / b) * 100) : 0; }

function DeltaTag({ val }: { val: number }) {
  if (val === 0) return null;
  const pos = val > 0;
  return (
    <span className={`text-[11px] font-semibold px-1.5 py-0.5 rounded ${pos ? "bg-green/10 text-green" : "bg-red/10 text-red"}`}>
      {pos ? "+" : ""}{val}%
    </span>
  );
}

type Tab = "kampaniyalar" | "formalar" | "lidlar" | "tasdiqlash";

// ── Lead sub-table ─────────────────────────────────────────────────────────────
function LeadsSubTable({ formId, campaignId, from, to }: { formId: string; campaignId: string; from: string; to: string }) {
  const q = useQuery({
    queryKey: ["form-leads", formId, campaignId, from, to],
    queryFn: () => getFormLeads(formId, campaignId, from, to),
    staleTime: 5 * 60_000,
  });
  if (q.isLoading) return <div className="px-5 py-3 text-[11px] text-text3 italic">Yuklanmoqda…</div>;
  if (!q.data?.leads?.length) return <div className="px-5 py-3 text-[11px] text-text3 italic">Lidlar yo'q.</div>;
  return (
    <div className="border-t border-border/30">
      <table className="w-full text-[11px]">
        <thead>
          <tr className="text-text3 border-b border-border/20">
            {["Lid nomi", "Telefon", "UTM Source", "UTM Campaign", "Sana"].map(h => (
              <th key={h} className="text-left px-4 py-1.5 font-medium">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {q.data.leads.map(l => (
            <tr key={l.id} className="border-b border-border/10 hover:bg-bg3/50">
              <td className="px-4 py-2 text-text font-medium">{l.name || "—"}</td>
              <td className="px-4 py-2 text-text2">{l.phone || "—"}</td>
              <td className="px-4 py-2 text-text3">{l.utm_source || "—"}</td>
              <td className="px-4 py-2 text-text3 max-w-[150px] truncate">{l.utm_campaign || "—"}</td>
              <td className="px-4 py-2 text-text3">
                {l.created_at ? new Date(l.created_at).toLocaleDateString("ru-RU") : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Leaderboard mini bar ───────────────────────────────────────────────────────
function MiniBar({ label, pct: p, color }: { label: string; pct: number; color: string }) {
  return (
    <div className="mb-2.5">
      <div className="flex justify-between text-[11px] mb-1">
        <span className="text-[#94a3b8] truncate max-w-[140px]">{label}</span>
        <span className="font-bold text-white ml-2">{p}%</span>
      </div>
      <div className="h-1.5 rounded-full bg-white/10">
        <div className="h-full rounded-full transition-all" style={{ width: `${p}%`, background: color }} />
      </div>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function KampaniyalarPage() {
  const [month, setMonth]           = useState<MonthKey>(DEFAULT_MONTH);
  const [year, setYear]             = useState(DEFAULT_YEAR);
  const [tab, setTab]               = useState<Tab>("formalar");
  const [search, setSearch]         = useState("");
  const [expandedForm, setExpandedForm]   = useState<string | null>(null);
  const [expandedCamp, setExpandedCamp]   = useState<string | null>(null);

  const insightsQ  = useQuery({ queryKey: ["meta-insights",  month, year], queryFn: () => getMetaInsights(month, year),  staleTime: 60_000 });
  const campaignsQ = useQuery({ queryKey: ["meta-campaigns", month, year], queryFn: () => getMetaCampaigns(month, year), staleTime: 60_000 });
  const formsQ     = useQuery({ queryKey: ["campaign-forms", month, year], queryFn: () => getCampaignForms(month, year), staleTime: 60_000 });
  const pageFormsQ = useQuery({ queryKey: ["page-forms"],                  queryFn: getPageForms,                        staleTime: 5 * 60_000 });
  const kunlikQ    = useQuery({ queryKey: ["kunlik-hisobot", month, year], queryFn: () => getKunlikHisobot(month, year), staleTime: 60_000 });

  const ins  = insightsQ.data?.data;
  const rows = campaignsQ.data?.rows ?? [];

  // ── aggregate KPIs ──────────────────────────────────────────────────────────
  const fbSpend  = ins ? sumArr(ins.target.budget)        : 0;
  const igSpend  = ins ? sumArr(ins.instagram.budget)     : 0;
  const fbLeads  = ins ? sumArr(ins.target.leads)         : 0;
  const igLeads  = ins ? sumArr(ins.instagram.leads)      : 0;
  const fbClicks = ins ? sumArr(ins.target.clicks)        : 0;
  const igClicks = ins ? sumArr(ins.instagram.clicks)     : 0;
  const fbImpr   = ins ? sumArr(ins.target.impressions)   : 0;
  const igImpr   = ins ? sumArr(ins.instagram.impressions): 0;

  const totalSpend  = fbSpend + igSpend;
  const totalLeads  = fbLeads + igLeads;
  const totalClicks = fbClicks + igClicks;
  const totalImpr   = fbImpr + igImpr;
  const avgCTR      = totalImpr  > 0 ? (totalClicks / totalImpr)  * 100 : 0;
  const avgCPC      = totalClicks > 0 ? totalSpend  / totalClicks       : 0;
  const formConv    = totalClicks > 0 ? (totalLeads / totalClicks) * 100 : 0;
  const avgCPL      = totalLeads  > 0 ? totalSpend  / totalLeads        : 0;

  // ── Bitrix CRM cross-channel metrics ────────────────────────────────────────
  const kData = kunlikQ.data?.data;
  // Sum FB + IG channel data for monthly totals
  const totalSalesUSD = kData
    ? sumArr(kData.target.sales_sum) + sumArr(kData.instagram.sales_sum)
    : 0;
  const totalDeals = kData
    ? sumArr(kData.target.deals) + sumArr(kData.instagram.deals)
    : 0;
  const totalQualLids = kData
    ? sumArr(kData.target.qual_leads) + sumArr(kData.instagram.qual_leads)
    : 0;

  const roas             = totalSpend > 0 && totalSalesUSD > 0 ? totalSalesUSD / totalSpend : 0;
  const maqsadliLidNarxi = totalQualLids > 0 ? totalSpend / totalQualLids : 0;
  const mijozNarxi       = totalDeals    > 0 ? totalSpend / totalDeals    : 0;

  // ── leaderboard ─────────────────────────────────────────────────────────────
  const leaderboard = useMemo(() => {
    const map = new Map<string, { name: string; spend: number; leads: number; clicks: number }>();
    for (const r of rows) {
      const cur = map.get(r.campaign_name) ?? { name: r.campaign_name, spend: 0, leads: 0, clicks: 0 };
      cur.spend  += r.spend;
      cur.leads  += r.leads;
      cur.clicks += r.clicks;
      map.set(r.campaign_name, cur);
    }
    return [...map.values()]
      .sort((a, b) => (b.leads / Math.max(b.spend, 1)) - (a.leads / Math.max(a.spend, 1)))
      .slice(0, 3);
  }, [rows]);

  // ── campaign rows ────────────────────────────────────────────────────────────
  const campRows = useMemo(() => {
    const map = new Map<string, { name: string; plat: string; spend: number; clicks: number; leads: number; impr: number }>();
    for (const r of rows) {
      const k = `${r.campaign_name}:${r.platform}`;
      const c = map.get(k) ?? { name: r.campaign_name, plat: r.platform, spend: 0, clicks: 0, leads: 0, impr: 0 };
      c.spend += r.spend; c.clicks += r.clicks; c.leads += r.leads; c.impr += r.impressions;
      map.set(k, c);
    }
    return [...map.values()]
      .filter(r => !search || r.name.toLowerCase().includes(search.toLowerCase()))
      .sort((a, b) => b.spend - a.spend);
  }, [rows, search]);

  // ── deduplicated unique forms (ACTIVE only) with real leads_count ───────────
  const uniqueForms = useMemo<PageForm[]>(() => {
    // Build a map of page-level forms (has real leads_count)
    const pageMap = new Map<string, PageForm>(
      (pageFormsQ.data?.forms ?? []).map(f => [f.form_id, f]),
    );

    // Collect all unique ACTIVE form IDs from campaign-forms response
    const seen = new Map<string, PageForm>();
    for (const camp of formsQ.data?.campaigns ?? []) {
      for (const f of camp.forms) {
        if (f.status !== "ACTIVE" || seen.has(f.form_id)) continue;
        // Prefer page-level data (real leads_count); fall back to campaign-forms data
        const pf = pageMap.get(f.form_id);
        seen.set(f.form_id, {
          form_id:      f.form_id,
          form_name:    pf?.form_name ?? f.form_name,
          status:       "ACTIVE",
          leads_count:  pf?.leads_count ?? f.leads_count ?? 0,
          created_time: pf?.created_time ?? f.created_time ?? "",
          page_name:    pf?.page_name ?? "",
        });
      }
    }

    // If page-forms loaded but campaign-forms didn't yet, fall back to page-only list
    if (seen.size === 0 && pageMap.size > 0) {
      return [...pageMap.values()].filter(f => f.status === "ACTIVE");
    }

    return [...seen.values()]
      .filter(f => !search || f.form_name.toLowerCase().includes(search.toLowerCase()))
      .sort((a, b) => (b.leads_count ?? 0) - (a.leads_count ?? 0));
  }, [formsQ.data, pageFormsQ.data, search]);

  const pendingLeads = uniqueForms.reduce((a, f) => a + (f.leads_count ?? 0), 0);

  // ── trend (last 7 data points, separate scales) ──────────────────────────────
  const trendSpend = ins
    ? ins.target.budget.slice(-7).map((v, i) => v + (ins.instagram.budget.slice(-7)[i] ?? 0))
    : [];
  const trendLeads = ins
    ? ins.target.leads.slice(-7).map((v, i) => v + (ins.instagram.leads.slice(-7)[i] ?? 0))
    : [];
  const trendSpendMax = Math.max(...trendSpend, 0.01);
  const trendLeadsMax = Math.max(...trendLeads, 0.01);

  // date strings for sub-queries
  const fromDate = `${year}-${String(MONTH_KEYS.indexOf(month) + 1).padStart(2, "0")}-01`;
  const toDate   = now.toISOString().slice(0, 10);

  function refresh() {
    insightsQ.refetch();
    campaignsQ.refetch();
    formsQ.refetch();
  }

  const isLoading = insightsQ.isLoading || campaignsQ.isLoading;

  return (
    <div className="flex flex-col h-full bg-bg overflow-hidden">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 px-5 py-3 border-b border-border bg-bg2 shrink-0">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text3" />
          <input
            placeholder="Forma nomi, telefon raqami yoki ID orqali qidiring..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 rounded-lg border border-border bg-bg text-[13px] text-text placeholder:text-text3 focus:outline-none focus:border-blue"
          />
        </div>

        <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-bg text-[13px] text-text">
          <Calendar className="w-4 h-4 text-text3 shrink-0" />
          <select
            value={month}
            onChange={e => setMonth(e.target.value as MonthKey)}
            className="bg-transparent text-[13px] focus:outline-none cursor-pointer"
          >
            {MONTH_KEYS.map(m => <option key={m} value={m}>{MONTH_LABELS[m]}</option>)}
          </select>
          <select
            value={year}
            onChange={e => setYear(Number(e.target.value))}
            className="bg-transparent text-[13px] focus:outline-none cursor-pointer"
          >
            {[DEFAULT_YEAR, DEFAULT_YEAR - 1].map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>

        <div className="flex items-center gap-2 ml-auto">
          <button onClick={refresh} className="p-2 rounded-lg border border-border hover:bg-bg3 text-text3 hover:text-text transition-colors">
            <RefreshCw className="w-4 h-4" />
          </button>
          <button className="p-2 rounded-lg border border-border hover:bg-bg3 text-text3">
            <Bell className="w-4 h-4" />
          </button>
          <button className="p-2 rounded-lg border border-border hover:bg-bg3 text-text3">
            <User className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* ── Filter row ─────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-6 px-5 py-2.5 border-b border-border bg-bg2 shrink-0">
        {["KAMPANIYA", "PLATFORMA", "FORMALAR", "UTM CAMPAIGN"].map(label => (
          <div key={label} className="flex flex-col gap-0.5">
            <span className="text-[9px] font-bold text-text3 tracking-wider uppercase">{label}</span>
            <div className="flex items-center gap-1 cursor-pointer">
              <span className="text-[13px] font-semibold text-text">Hammasi</span>
              <ChevronDown className="w-3.5 h-3.5 text-text3" />
            </div>
          </div>
        ))}
        <button className="ml-auto flex items-center gap-2 px-4 py-2 rounded-lg border border-border bg-bg text-[13px] font-semibold text-text2 hover:bg-bg3 transition-colors">
          <Download className="w-3.5 h-3.5" /> Ma'lumotlarni yuklash
        </button>
      </div>

      {/* ── Scrollable body ────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">

        {/* KPI row 1 */}
        <div className="grid grid-cols-4 gap-3">
          {isLoading ? Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          )) : ([
            { label: "JAMI SARF", value: `$${fmtNum(Math.round(totalSpend))}`, sub: "Meta Ads sarfi", delta: 5 },
            { label: "JAMI LIDLAR", value: fmtNum(totalLeads), sub: "Meta formalar", delta: 12 },
            { label: "FORMA KONVERSIYASI", value: `${formConv.toFixed(1)}%`, sub: "Clicks → Leads", delta: 2 },
            { label: "O'RTACHA TASDIQLASH", value: "68.5%", sub: "Tasdiqlangan/Jami", delta: -3 },
          ] as const).map(c => (
            <div key={c.label} className="bg-bg2 border border-border rounded-xl p-4">
              <div className="text-[10px] font-bold text-text3 tracking-wider mb-2">{c.label}</div>
              <div className="flex items-end gap-2">
                <span className="text-[22px] font-bold text-text leading-none">{c.value}</span>
                <DeltaTag val={c.delta} />
              </div>
              <div className="text-[11px] text-text3 mt-1">{c.sub}</div>
            </div>
          ))}
        </div>

        {/* KPI row 2 */}
        <div className="grid grid-cols-4 gap-3">
          {isLoading ? Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          )) : ([
            { label: "IMPRESSIONS", value: fmtNum(totalImpr), sub: "Jami ko'rishlar", delta: -1 },
            { label: "CTR", value: `${avgCTR.toFixed(2)}%`, sub: "Click-through rate", delta: 0 },
            { label: "CPC ($)", value: `$${avgCPC.toFixed(2)}`, sub: "Cost per click", delta: 0 },
            { label: "CPL ($)", value: totalLeads > 0 ? `$${avgCPL.toFixed(2)}` : "—", sub: "Cost per lead", delta: 0 },
          ] as const).map(c => (
            <div key={c.label} className="bg-bg2 border border-border rounded-xl p-4">
              <div className="text-[10px] font-bold text-text3 tracking-wider mb-2">{c.label}</div>
              <div className="flex items-end gap-2">
                <span className="text-[22px] font-bold text-text leading-none">{c.value}</span>
                <DeltaTag val={c.delta} />
              </div>
              <div className="text-[11px] text-text3 mt-1">{c.sub}</div>
            </div>
          ))}
        </div>

        {/* KPI row 3 — cross-channel metrics */}
        <div className="grid grid-cols-3 gap-3">
          {(isLoading || kunlikQ.isLoading) ? Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          )) : ([
            {
              label: "ROAS",
              value: roas > 0 ? `${roas.toFixed(2)}x` : "—",
              sub: "Sotuvlar summasi ÷ Byudjet",
              formula: `$${fmtNum(Math.round(totalSalesUSD))} ÷ $${fmtNum(Math.round(totalSpend))}`,
              color: "text-green",
            },
            {
              label: "MAQSADLI LID NARXI",
              value: maqsadliLidNarxi > 0 ? `$${maqsadliLidNarxi.toFixed(2)}` : "—",
              sub: "Byudjet ÷ Maqsadli lidlar soni",
              formula: `$${fmtNum(Math.round(totalSpend))} ÷ ${fmtNum(totalQualLids)}`,
              color: "text-blue",
            },
            {
              label: "MIJOZ NARXI",
              value: mijozNarxi > 0 ? `$${mijozNarxi.toFixed(2)}` : "—",
              sub: "Byudjet ÷ Sotuvlar soni",
              formula: `$${fmtNum(Math.round(totalSpend))} ÷ ${totalDeals}`,
              color: "text-amber",
            },
          ]).map(c => (
            <div key={c.label} className="bg-bg2 border border-border rounded-xl p-4">
              <div className="text-[10px] font-bold text-text3 tracking-wider mb-2">{c.label}</div>
              <div className="flex items-end gap-2 mb-1">
                <span className={`text-[22px] font-bold leading-none ${c.color}`}>{c.value}</span>
              </div>
              <div className="text-[10.5px] text-text3">{c.sub}</div>
              <div className="text-[10px] text-text3/60 mt-0.5 font-mono">{c.formula}</div>
            </div>
          ))}
        </div>

        {/* Charts row */}
        <div className="grid grid-cols-2 gap-4">

          {/* Platform split */}
          <div className="bg-bg2 border border-border rounded-xl p-4">
            <div className="text-[12px] font-bold text-text uppercase tracking-wider mb-4">
              Platformalar ulushi (FB vs IG)
            </div>
            <div className="grid grid-cols-2 gap-6">
              {([
                { title: "SARF ULUSHI",  fb: pct(fbSpend,  totalSpend),  ig: pct(igSpend,  totalSpend)  },
                { title: "LIDLAR ULUSHI", fb: pct(fbLeads,  totalLeads),  ig: pct(igLeads,  totalLeads)  },
              ] as const).map(col => (
                <div key={col.title}>
                  <div className="text-[10px] font-bold text-text3 tracking-wider mb-2">{col.title}</div>
                  <div className="h-2 rounded-full overflow-hidden flex mb-2">
                    <div className="bg-blue   h-full" style={{ width: `${col.fb}%` }} />
                    <div className="bg-[#e91e8c] h-full" style={{ width: `${col.ig}%` }} />
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-text2">
                    <span className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-blue inline-block" />
                      FB {col.fb}%
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-[#e91e8c] inline-block" />
                      IG {col.ig}%
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Trend chart */}
          <div className="bg-bg2 border border-border rounded-xl p-4">
            <div className="flex items-center justify-between mb-4">
              <div>
                <div className="text-[12px] font-bold text-text uppercase tracking-wider">Trend: Sarf va Lidlar</div>
                <div className="text-[10.5px] text-text3 mt-0.5">Oxirgi 7 kunlik dinamika</div>
              </div>
              <div className="flex items-center gap-3 text-[11px] text-text3">
                <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-blue   inline-block rounded" /> Sarf</span>
                <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-green  inline-block rounded" /> Lidlar</span>
              </div>
            </div>
            {insightsQ.isLoading
              ? <Skeleton className="h-28 w-full rounded-lg" />
              : trendSpend.length === 0 ? (
                <div className="h-28 flex items-center justify-center text-text3 text-[12px]">Ma'lumot yo'q</div>
              ) : (() => {
                const W = 100; const H = 112; const pad = 8;
                const iW = W - pad * 2; const iH = H - pad * 2;
                const n7 = trendSpend.length;
                function pts(vals: number[], vmax: number) {
                  return vals.map((v, i) => {
                    const x = pad + (i / Math.max(n7 - 1, 1)) * iW;
                    const y = pad + iH - (v / vmax) * iH;
                    return `${x},${y}`;
                  }).join(" ");
                }
                return (
                  <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full h-28">
                    {/* grid lines */}
                    {[0.25, 0.5, 0.75].map(f => (
                      <line key={f} x1={pad} x2={W - pad} y1={pad + iH * (1 - f)} y2={pad + iH * (1 - f)}
                        stroke="currentColor" strokeWidth="0.3" className="text-border" />
                    ))}
                    {/* spend area fill */}
                    <defs>
                      <linearGradient id="sGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.3" />
                        <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.02" />
                      </linearGradient>
                      <linearGradient id="lGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#22c55e" stopOpacity="0.3" />
                        <stop offset="100%" stopColor="#22c55e" stopOpacity="0.02" />
                      </linearGradient>
                    </defs>
                    <polygon
                      points={`${pad},${pad + iH} ${pts(trendSpend, trendSpendMax)} ${W - pad},${pad + iH}`}
                      fill="url(#sGrad)" />
                    <polyline points={pts(trendSpend, trendSpendMax)} fill="none" stroke="#3b82f6" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
                    <polygon
                      points={`${pad},${pad + iH} ${pts(trendLeads, trendLeadsMax)} ${W - pad},${pad + iH}`}
                      fill="url(#lGrad)" />
                    <polyline points={pts(trendLeads, trendLeadsMax)} fill="none" stroke="#22c55e" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
                    {/* dots */}
                    {trendSpend.map((v, i) => {
                      const x = pad + (i / Math.max(n7 - 1, 1)) * iW;
                      const y = pad + iH - (v / trendSpendMax) * iH;
                      return <circle key={i} cx={x} cy={y} r="1.5" fill="#3b82f6" />;
                    })}
                    {trendLeads.map((v, i) => {
                      const x = pad + (i / Math.max(n7 - 1, 1)) * iW;
                      const y = pad + iH - (v / trendLeadsMax) * iH;
                      return <circle key={i} cx={x} cy={y} r="1.5" fill="#22c55e" />;
                    })}
                  </svg>
                );
              })()}
          </div>
        </div>

        {/* Tabs + 2-column body */}
        <div>
          {/* Tab bar */}
          <div className="flex border-b border-border">
            {([
              { key: "kampaniyalar", label: "Kampaniyalar" },
              { key: "formalar",     label: "Faol formalar ☆" },
              { key: "lidlar",       label: "Lidlar ro'yxati", badge: pendingLeads > 0 ? pendingLeads : null },
              { key: "tasdiqlash",   label: "Lidlarni tasdiqlash" },
            ] as { key: Tab; label: string; badge?: number | null }[]).map(t => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`px-5 py-2.5 text-[13px] font-semibold border-b-2 transition-colors flex items-center gap-2 ${
                  tab === t.key ? "border-blue text-blue" : "border-transparent text-text3 hover:text-text"
                }`}
              >
                {t.label}
                {t.badge != null && (
                  <span className="px-2 py-0.5 rounded-full bg-amber text-white text-[10px] font-bold">
                    {t.badge} kutilmoqda
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* 2-column layout */}
          <div className="grid grid-cols-[1fr_320px] gap-4 mt-4">

            {/* LEFT: content table */}
            <div className="bg-bg2 border border-border rounded-xl overflow-hidden">
              <div className="px-5 py-3.5 border-b border-border flex items-center justify-between">
                <div>
                  <div className="text-[14px] font-bold text-text">
                    {tab === "formalar"     && "Lead Form Performance"}
                    {tab === "kampaniyalar" && "Kampaniyalar"}
                    {tab === "lidlar"       && "Lidlar ro'yxati"}
                    {tab === "tasdiqlash"   && "Lidlarni tasdiqlash"}
                  </div>
                  <div className="text-[11.5px] text-text3 mt-0.5">
                    {tab === "formalar" ? "Faol formalar bo'yicha real vaqtdagi ko'rsatkichlar" : "Meta Ads ma'lumotlari"}
                  </div>
                </div>
                <button onClick={refresh} className="p-1.5 rounded-lg border border-border text-text3 hover:bg-bg3 transition-colors">
                  <RefreshCw className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* ── Formalar tab ── */}
              {tab === "formalar" && (
                <>
                  <table className="w-full text-[12.5px]">
                    <thead>
                      <tr className="bg-bg3 border-b border-border">
                        {["FORMA NOMI", "HOLAT", "SARF", "KLIKLAR", "CPC", "LIDLAR (jami)"].map(h => (
                          <th key={h} className="px-4 py-2.5 text-left text-[10px] font-bold text-text3 tracking-wider">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {(formsQ.isLoading && pageFormsQ.isLoading) ? (
                        Array.from({ length: 5 }).map((_, i) => (
                          <tr key={i} className="border-b border-border">
                            {Array.from({ length: 6 }).map((__, j) => (
                              <td key={j} className="px-4 py-3"><Skeleton className="h-3.5 w-20" /></td>
                            ))}
                          </tr>
                        ))
                      ) : uniqueForms.length === 0 ? (
                        <tr><td colSpan={6} className="px-4 py-10 text-center text-text3">
                          Faol formalar topilmadi
                        </td></tr>
                      ) : uniqueForms.map(form => {
                          const isExp = expandedForm === form.form_id;
                          // Sum spend + clicks across all campaigns that reference this form
                          const fCamps = (formsQ.data?.campaigns ?? []).filter(c =>
                            c.forms.some(f => f.form_id === form.form_id),
                          );
                          const fSpend  = fCamps.reduce((acc, c) => {
                            const campRow = rows.filter(r => r.campaign_name === c.campaign_name);
                            const n = Math.max(c.forms.filter(f => f.status === "ACTIVE").length, 1);
                            return acc + campRow.reduce((s, r) => s + r.spend,  0) / n;
                          }, 0);
                          const fClicks = fCamps.reduce((acc, c) => {
                            const campRow = rows.filter(r => r.campaign_name === c.campaign_name);
                            const n = Math.max(c.forms.filter(f => f.status === "ACTIVE").length, 1);
                            return acc + campRow.reduce((s, r) => s + r.clicks, 0) / n;
                          }, 0);
                          const cpc = fClicks > 0 ? fSpend / fClicks : 0;
                          return (
                            <tr
                              key={form.form_id}
                              className={`border-b border-border hover:bg-bg3/50 cursor-pointer transition-colors ${isExp ? "bg-bg3/30" : ""}`}
                              onClick={() => setExpandedForm(isExp ? null : form.form_id)}
                            >
                              <td className="px-4 py-3">
                                <div className="flex items-center gap-2">
                                  <span className="w-2 h-2 rounded-full bg-blue shrink-0" />
                                  <div>
                                    <div className="font-medium text-text" title={form.form_name}>
                                      {form.form_name.length > 28 ? form.form_name.slice(0, 28) + "…" : form.form_name}
                                    </div>
                                    <div className="text-[10px] text-text3">ID: …{form.form_id.slice(-7)}</div>
                                  </div>
                                </div>
                              </td>
                              <td className="px-4 py-3">
                                <span className="px-2 py-0.5 rounded text-[10.5px] font-bold bg-green/10 text-green">
                                  FAOL
                                </span>
                              </td>
                              <td className="px-4 py-3 font-semibold text-text">${Math.round(fSpend)}</td>
                              <td className="px-4 py-3 text-text2">{Math.round(fClicks)}</td>
                              <td className="px-4 py-3 text-text2">${cpc.toFixed(2)}</td>
                              <td className="px-4 py-3 font-semibold text-blue">
                                {form.leads_count > 0 ? fmtNum(form.leads_count) : "0"}
                              </td>
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                  {expandedForm && (
                    <LeadsSubTable formId={expandedForm} campaignId="" from={fromDate} to={toDate} />
                  )}
                </>
              )}

              {/* ── Kampaniyalar tab ── */}
              {tab === "kampaniyalar" && (
                <table className="w-full text-[12.5px]">
                  <thead>
                    <tr className="bg-bg3 border-b border-border">
                      {["#", "KAMPANIYA", "PLATFORMA", "SARF", "KLIKLAR", "LIDLAR", "CPL"].map(h => (
                        <th key={h} className="px-4 py-2.5 text-left text-[10px] font-bold text-text3 tracking-wider">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {campaignsQ.isLoading ? (
                      Array.from({ length: 5 }).map((_, i) => (
                        <tr key={i} className="border-b border-border">
                          {Array.from({ length: 7 }).map((__, j) => (
                            <td key={j} className="px-4 py-3"><Skeleton className="h-3.5 w-16" /></td>
                          ))}
                        </tr>
                      ))
                    ) : campRows.map((r, i) => (
                      <tr key={`${r.name}:${r.plat}`} className="border-b border-border hover:bg-bg3/50">
                        <td className="px-4 py-3 text-text3 font-mono text-[11px]">{String(i + 1).padStart(2, "0")}</td>
                        <td className="px-4 py-3 font-medium text-text max-w-[200px] truncate" title={r.name}>{r.name}</td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            r.plat === "facebook" ? "bg-blue/10 text-blue" : "bg-[#e91e8c]/10 text-[#e91e8c]"
                          }`}>
                            {r.plat === "facebook" ? "FB" : "IG"}
                          </span>
                        </td>
                        <td className="px-4 py-3 font-semibold text-text">${Math.round(r.spend)}</td>
                        <td className="px-4 py-3 text-text2">{fmtNum(r.clicks)}</td>
                        <td className="px-4 py-3 font-semibold text-blue">{r.leads}</td>
                        <td className="px-4 py-3 text-text2">{r.leads > 0 ? `$${(r.spend / r.leads).toFixed(2)}` : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {/* ── Lidlar tab ── */}
              {tab === "lidlar" && (
                <div>
                  {(formsQ.isLoading && pageFormsQ.isLoading) ? (
                    <div className="p-6"><Skeleton className="h-40 w-full" /></div>
                  ) : uniqueForms.length === 0 ? (
                    <div className="py-12 text-center text-text3 text-[12.5px]">Formalar topilmadi</div>
                  ) : uniqueForms.map(form => (
                    <div key={form.form_id} className="border-b border-border">
                      <button
                        onClick={() => setExpandedCamp(expandedCamp === form.form_id ? null : form.form_id)}
                        className="w-full flex items-center gap-3 px-5 py-3 hover:bg-bg3 text-left"
                      >
                        <span className="w-2 h-2 rounded-full bg-blue shrink-0" />
                        <span className="text-[13px] font-semibold text-text flex-1">{form.form_name}</span>
                        <span className="text-[11.5px] text-blue font-bold">{fmtNum(form.leads_count)} lid</span>
                        <ChevronDown className={`w-4 h-4 text-text3 transition-transform ${expandedCamp === form.form_id ? "rotate-180" : ""}`} />
                      </button>
                      {expandedCamp === form.form_id && (
                        <LeadsSubTable formId={form.form_id} campaignId="" from={fromDate} to={toDate} />
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* ── Tasdiqlash tab ── */}
              {tab === "tasdiqlash" && (
                <div className="py-12 text-center text-text3 text-[12.5px]">
                  Tasdiqlash funksiyasi tez orada qo'shiladi
                </div>
              )}
            </div>

            {/* RIGHT: dark leaderboard */}
            <div className="rounded-xl overflow-hidden flex flex-col" style={{ background: "#0d1b2a" }}>
              <div className="px-4 py-4 border-b border-white/10">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-green/20 flex items-center justify-center shrink-0">
                    <TrendingUp className="w-4 h-4 text-green" />
                  </div>
                  <div>
                    <div className="text-[13px] font-bold text-white">Budget Efficiency Leaderboard</div>
                    <div className="text-[10.5px] text-[#64748b]">Sarf va sifat nazorati bo'yicha saralash</div>
                  </div>
                </div>
              </div>

              <div className="p-4 space-y-3 flex-1">
                {campaignsQ.isLoading ? (
                  Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} className="h-24 rounded-xl animate-pulse" style={{ background: "rgba(255,255,255,0.05)" }} />
                  ))
                ) : leaderboard.length === 0 ? (
                  <div className="text-[12px] text-[#64748b] text-center py-8">Ma'lumot yo'q</div>
                ) : leaderboard.map((c, i) => {
                  const lidPct = c.clicks > 0 ? Math.round((c.leads / c.clicks) * 100) : 0;
                  const badgeMap = [
                    { label: "YUQORI ROI",   color: "#f59e0b", bg: "rgba(245,158,11,0.15)" },
                    { label: "SARF XAVFI",   color: "#ef4444", bg: "rgba(239,68,68,0.15)"  },
                    { label: "REAL NATIJA",  color: "#3b82f6", bg: "rgba(59,130,246,0.15)" },
                  ];
                  const badge = badgeMap[i] ?? badgeMap[0];
                  return (
                    <div key={c.name} className="rounded-xl p-3.5" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-[11px] font-bold text-[#94a3b8] truncate max-w-[160px]">
                          #{i + 1} {c.name}
                        </span>
                        <span className="text-[9.5px] font-bold px-2 py-0.5 rounded shrink-0 ml-1"
                          style={{ background: badge.bg, color: badge.color }}>
                          {badge.label}
                        </span>
                      </div>
                      <div className="text-[11px] text-[#64748b] mb-2">${Math.round(c.spend)} sarflandi</div>
                      <div className="text-[12px] font-semibold text-green mb-0.5">● {lidPct}% Lid kelganlari</div>
                      <div className="text-[10px] text-[#64748b]">
                        Kelgan liddan {lidPct}% i muvaffaqiyatli o'tdi
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* CPL Rating */}
              <div className="px-4 pb-4">
                <div className="rounded-xl p-3.5" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
                  <div className="text-[10px] font-bold text-[#64748b] tracking-wider uppercase mb-3">
                    CPL Rating (Cost per Verified Lead)
                  </div>
                  {leaderboard.length === 0 ? (
                    <div className="text-[11px] text-[#64748b]">—</div>
                  ) : (() => {
                    const maxCpl = Math.max(
                      ...leaderboard.map(x => x.leads > 0 ? x.spend / x.leads : 0),
                      1,
                    );
                    const colors = ["#22c55e", "#ef4444", "#f59e0b"];
                    return leaderboard.map((c, i) => {
                      const cpl = c.leads > 0 ? c.spend / c.leads : 0;
                      return (
                        <MiniBar
                          key={c.name}
                          label={c.name.length > 14 ? c.name.slice(0, 14) + "…" : c.name}
                          pct={Math.round((cpl / maxCpl) * 100)}
                          color={colors[i] ?? colors[0]}
                        />
                      );
                    });
                  })()}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  RefreshCw, Search, ChevronDown, TrendingUp,
} from "lucide-react";
import { Skeleton } from "@/components/Skeleton";
import {
  getMetaInsights, getMetaCampaigns, getCampaignForms, getFormLeads,
  getPageForms, getKunlikHisobot, getCampaignCreatives, getCreativeLeads, getCreativeDeals,
  MONTH_KEYS,
} from "@/lib/api/meta";
import type { MonthKey, PageForm } from "@/lib/api/meta";
import { fmtNum } from "@/lib/utils";



// ── helpers ────────────────────────────────────────────────────────────────────
function sumArr(arr: number[]) { return arr.reduce((a, b) => a + b, 0); }

type Tab = "kampaniyalar" | "formalar" | "lidlar" | "creative";

// ── Creative leads sub-table ──────────────────────────────────────────────────
const BX_URL = "https://mountain.bitrix24.kz/crm/lead/details";

const STAGE_COLOR: Record<string, string> = {
  UC_F8K4GI: "#ef4444",
  UC_NAZK5J: "#f59e0b",
  JUNK:      "#6b7280",
  CONVERTED: "#22c55e",
  UC_L28G68: "#3b82f6",
};

function phoneDigits(p: string) { return (p || '').replace(/[^0-9]/g, ''); }
function notInBitrixReason(phone: string, isDuplicate: boolean): string {
  const digits = phoneDigits(phone);
  if (digits.length < 9) return 'Telefon noto\'g\'ri';
  if (isDuplicate) return 'Duplikat';
  return 'Bitrix24 da yo\'q';
}

function CreativeLeadsPanel({ adsetName, month, year, from, to }: { adsetName: string; month: MonthKey; year: number; from: string; to: string }) {
  const q = useQuery({
    queryKey: ["creative-leads", adsetName, month, year, from, to],
    queryFn: () => getCreativeLeads(adsetName, month, year, from, to),
    staleTime: 2 * 60_000,
  });
  if (q.isLoading) return <tr><td colSpan={10} className="px-6 py-4"><div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-3 w-full" />)}</div></td></tr>;
  if (!q.data?.leads?.length) return <tr><td colSpan={10} className="px-6 py-4 text-[12px] text-text3 italic">Bu adset uchun lidlar topilmadi</td></tr>;
  const leads = q.data.leads;
  return (
    <tr><td colSpan={10} className="p-0">
      <div className="border-t border-border/40 bg-bg3/30">
        <table className="w-full text-[11.5px]">
          <thead><tr className="border-b border-border/30 bg-bg3/50">
            {["ISM","TELEFON","PLATFORMA","SANA","BOSQICH","BITRIX24"].map(h => <th key={h} className="px-4 py-2 text-left text-[10px] font-bold text-text3 tracking-wider">{h}</th>)}
          </tr></thead>
          <tbody>
            {leads.map(l => {
              const stageColor = l.stage_code ? (STAGE_COLOR[l.stage_code] ?? "#94a3b8") : "#64748b";
              const isSifatli = l.stage_code && !["UC_F8K4GI","UC_NAZK5J","JUNK"].includes(l.stage_code);
              const reason = !l.bitrix_id ? notInBitrixReason(l.phone, l.is_duplicate) : null;
              const reasonColor = reason === 'Telefon noto\'g\'ri' ? '#ef4444' : reason === 'Duplikat' ? '#f59e0b' : '#64748b';
              return (
                <tr key={l.fb_id} className="border-b border-border/20 hover:bg-bg3/40">
                  <td className="px-4 py-2.5 font-medium text-text">{l.full_name}</td>
                  <td className="px-4 py-2.5 text-text2 font-mono">{l.phone}</td>
                  <td className="px-4 py-2.5"><span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${l.platform === "instagram" ? "bg-[#e91e8c]/15 text-[#e91e8c]" : "bg-blue/15 text-blue"}`}>{l.platform === "instagram" ? "IG" : "FB"}</span></td>
                  <td className="px-4 py-2.5 text-text3">{l.created_time ? new Date(l.created_time).toLocaleDateString("ru-RU") : "—"}</td>
                  <td className="px-4 py-2.5">
                    {l.stage_name ? <span className="text-[10.5px] font-semibold px-1.5 py-0.5 rounded" style={{ color: stageColor, background: stageColor + "22" }}>{l.stage_name}</span>
                      : <div className="flex flex-col gap-0.5"><span className="text-[10.5px] text-text3 italic">Bitrix24 da yo'q</span>{reason !== "Bitrix24 da yo'q" && <span className="text-[10px] font-semibold px-1 py-0.5 rounded w-fit" style={{ color: reasonColor, background: reasonColor + "22" }}>{reason}</span>}</div>}
                  </td>
                  <td className="px-4 py-2.5">
                    {l.bitrix_id ? <a href={`${BX_URL}/${l.bitrix_id}/`} target="_blank" rel="noopener noreferrer" className={`text-[11px] font-semibold underline underline-offset-2 ${isSifatli ? "text-green" : "text-blue"} hover:opacity-80`}>#{l.bitrix_id} →</a> : <span className="text-[11px] text-text3/60">—</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </td></tr>
  );
}

function SotuvDealsPanel({ adsetName, month, year, from, to }: { adsetName: string; month: MonthKey; year: number; from: string; to: string }) {
  const q = useQuery({
    queryKey: ["creative-deals", adsetName, month, year, from, to],
    queryFn: () => getCreativeDeals(adsetName, month, year, from, to),
    staleTime: 2 * 60_000,
  });
  if (q.isLoading) return <tr><td colSpan={10} className="px-6 py-4"><div className="space-y-2">{Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-3 w-full" />)}</div></td></tr>;
  if (!q.data?.deals?.length) return <tr><td colSpan={10} className="px-6 py-4 text-[12px] text-text3 italic">Bu adset uchun sotuv sdelkalari topilmadi</td></tr>;
  return (
    <tr><td colSpan={10} className="p-0">
      <div className="border-t border-border/40 bg-[#22c55e]/5">
        <table className="w-full text-[11.5px]">
          <thead><tr className="border-b border-border/30 bg-[#22c55e]/10">
            {["SDELKA","TELEFON","MAS'UL","SUMMA","SANA","BOSQICH"].map(h => <th key={h} className="px-4 py-2 text-left text-[10px] font-bold text-text3 tracking-wider">{h}</th>)}
          </tr></thead>
          <tbody>
            {q.data.deals.map(d => (
              <tr key={d.id} className="border-b border-border/20 hover:bg-[#22c55e]/10">
                <td className="px-4 py-2.5"><a href={`https://mountain.bitrix24.kz/crm/deal/details/${d.id}/`} target="_blank" rel="noopener noreferrer" className="text-[11px] font-semibold text-[#22c55e] underline underline-offset-2 hover:opacity-80">#{d.id} →</a></td>
                <td className="px-4 py-2.5 font-mono text-text2">{d.phone}</td>
                <td className="px-4 py-2.5 text-text2">{d.responsible}</td>
                <td className="px-4 py-2.5 font-semibold text-text">{d.opportunity > 0 ? `$${d.opportunity.toLocaleString()}` : '—'}</td>
                <td className="px-4 py-2.5 text-text3">{d.date || '—'}</td>
                <td className="px-4 py-2.5"><span className="text-[10.5px] font-semibold px-1.5 py-0.5 rounded bg-[#22c55e]/20 text-[#22c55e]">{d.stage}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </td></tr>
  );
}

// ── Lead sub-table ─────────────────────────────────────────────────────────────
function LeadsSubTable({ formId, campaignId, from, to }: { formId: string; campaignId: string; from: string; to: string }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
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
            {["Lid nomi", "Telefon", "Bosqich", "Sana", "Bitrix24"].map(h => (
              <th key={h} className="text-left px-4 py-1.5 font-medium">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {q.data.leads.map(l => {
            const isOpen = expandedId === l.id;
            const fieldEntries = Object.entries(l.field_data || {});
            const stageColor = l.stage_code ? (STAGE_COLOR[l.stage_code] ?? "#94a3b8") : "#64748b";
            return (
              <>
                <tr
                  key={l.id}
                  onClick={() => setExpandedId(isOpen ? null : l.id)}
                  className="border-b border-border/10 hover:bg-bg3/50 cursor-pointer select-none"
                >
                  <td className="px-4 py-2 text-text font-medium">{l.name || "—"}</td>
                  <td className="px-4 py-2 text-text2 font-mono">{l.phone || "—"}</td>
                  <td className="px-4 py-2">
                    {l.stage_name ? (
                      <span className="text-[10.5px] font-semibold px-1.5 py-0.5 rounded" style={{ color: stageColor, background: stageColor + "22" }}>
                        {l.stage_name}
                      </span>
                    ) : (
                      <span className="text-text3 italic text-[10.5px]">Bitrix24 da yo'q</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-text3">
                    {l.created_at ? new Date(l.created_at).toLocaleDateString("ru-RU") : "—"}
                  </td>
                  <td className="px-4 py-2" onClick={e => e.stopPropagation()}>
                    {l.bitrix_id ? (
                      <a
                        href={`${BX_URL}/${l.bitrix_id}/`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[11px] font-semibold text-blue underline underline-offset-2 hover:opacity-80"
                      >
                        #{l.bitrix_id} →
                      </a>
                    ) : (
                      <span className="text-text3/50 text-[11px]">—</span>
                    )}
                  </td>
                </tr>
                {isOpen && (
                  <tr key={`${l.id}-detail`} className="bg-bg3/30 border-b border-border/20">
                    <td colSpan={5} className="px-6 py-3">
                      {fieldEntries.length === 0 ? (
                        <span className="text-text3 italic">Ma'lumot yo'q</span>
                      ) : (
                        <div className="grid grid-cols-2 gap-x-8 gap-y-1.5">
                          {fieldEntries.map(([k, v]) => (
                            <div key={k} className="flex gap-2">
                              <span className="text-text3 shrink-0 min-w-[120px]">{k}:</span>
                              <span className="text-text break-all">{v || "—"}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </td>
                  </tr>
                )}
              </>
            );
          })}
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
function getTodayIso() { return new Date().toISOString().slice(0, 10); }
function getFirstOfMonth() {
  const t = new Date();
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-01`;
}

const KAMP_PRESETS = [
  { label: "Bugun",    f: () => getTodayIso(),      t: () => getTodayIso() },
  { label: "7 kun",    f: () => { const d = new Date(); d.setDate(d.getDate() - 7); return d.toISOString().slice(0, 10); }, t: () => getTodayIso() },
  { label: "30 kun",   f: () => { const d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString().slice(0, 10); }, t: () => getTodayIso() },
  { label: "Bu oy",    f: () => getFirstOfMonth(),  t: () => getTodayIso() },
];

export default function KampaniyalarPage() {
  const [fromDate, setFromDate]     = useState(getFirstOfMonth);
  const [toDate,   setToDate]       = useState(getTodayIso);
  const [filterOpen, setFilterOpen] = useState(false);
  const [tab, setTab]               = useState<Tab>("formalar");
  const [search, setSearch]         = useState("");
  const [expandedForm, setExpandedForm]   = useState<string | null>(null);
  const [expandedCamp, setExpandedCamp]   = useState<string | null>(null);
  const [refreshing, setRefreshing]       = useState(false);
  const [filterCampaign,  setFilterCampaign]  = useState("");
  const [filterPlatform,  setFilterPlatform]  = useState("");
  const [filterForm,      setFilterForm]      = useState("");
  const [filterAdset,     setFilterAdset]     = useState("");
  const [filterCreative,  setFilterCreative]  = useState("");
  const [expandedCreative, setExpandedCreative] = useState<string | null>(null);
  const [expandedSotuv,   setExpandedSotuv]   = useState<string | null>(null);

  // Derive month/year from fromDate for API calls
  const fromD = new Date(fromDate + "T00:00:00");
  const month = MONTH_KEYS[fromD.getMonth()] as MonthKey;
  const year  = fromD.getFullYear();

  const AUTO_REFRESH = 60_000; // 1 minute — meta_ad_daily syncs every minute
  const insightsQ   = useQuery({ queryKey: ["meta-insights",   month, year, fromDate, toDate], queryFn: () => getMetaInsights(month, year, undefined, false, fromDate, toDate),  staleTime: 30_000, refetchInterval: AUTO_REFRESH });
  const campaignsQ  = useQuery({ queryKey: ["meta-campaigns",  month, year, fromDate, toDate], queryFn: () => getMetaCampaigns(month, year, false, fromDate, toDate),             staleTime: 30_000, refetchInterval: AUTO_REFRESH });
  const formsQ      = useQuery({ queryKey: ["campaign-forms",  month, year, fromDate, toDate], queryFn: () => getCampaignForms(month, year, fromDate, toDate),                    staleTime: 30_000, refetchInterval: AUTO_REFRESH });
  const pageFormsQ  = useQuery({ queryKey: ["page-forms", month, year, fromDate, toDate], queryFn: () => getPageForms(month, year, fromDate, toDate), staleTime: 30_000, refetchInterval: AUTO_REFRESH });
  const kunlikQ     = useQuery({ queryKey: ["kunlik-hisobot",  month, year],                   queryFn: () => getKunlikHisobot(month, year),                                      staleTime: 60_000, refetchInterval: AUTO_REFRESH });
  const creativesQ  = useQuery({ queryKey: ["creatives",       month, year, fromDate, toDate], queryFn: () => getCampaignCreatives(month, year, fromDate, toDate),                staleTime: 30_000, refetchInterval: AUTO_REFRESH });

  const allRows = campaignsQ.data?.rows ?? [];

  // ── filter options (unique values) ─────────────────────────────────────────
  const optCampaigns = useMemo(() => [...new Set(allRows.map(r => r.campaign_name))].sort(), [allRows]);

  // Sub-filter hierarchy: Campaign → Platform → Adset
  const optPlatforms = useMemo(() => [...new Set(allRows
    .filter(r => !filterCampaign || r.campaign_name === filterCampaign)
    .map(r => r.platform)
  )].sort(), [allRows, filterCampaign]);

  const optAdsets = useMemo(() => [...new Set(allRows
    .filter(r => !filterCampaign || r.campaign_name === filterCampaign)
    .filter(r => !filterPlatform || r.platform === filterPlatform)
    .map(r => r.adset_name)
  )].sort(), [allRows, filterCampaign, filterPlatform]);

  const optForms = useMemo(() => {
    const names: string[] = [];
    for (const camp of formsQ.data?.campaigns ?? []) {
      if (filterCampaign && camp.campaign_name !== filterCampaign) continue;
      for (const f of camp.forms) {
        if (f.status === "ACTIVE" && !names.includes(f.form_name)) names.push(f.form_name);
      }
    }
    return names.sort();
  }, [formsQ.data, filterCampaign]);

  const optCreatives = useMemo(() => {
    const creatives = creativesQ.data?.creatives ?? [];
    return [...new Set(
      creatives
        .filter(r => !filterCampaign || r.campaign_name === filterCampaign)
        .filter(r => !filterAdset    || r.adset_name    === filterAdset)
        .map(r => r.ad_name)
        .filter(Boolean) as string[]
    )].sort();
  }, [creativesQ.data, filterCampaign, filterAdset]);

  // ── filtered rows (apply campaign / platform / adset filters) ──────────────
  const rows = useMemo(() => allRows
    .filter(r => !filterCampaign || r.campaign_name === filterCampaign)
    .filter(r => !filterPlatform || r.platform === filterPlatform)
    .filter(r => !filterAdset    || r.adset_name  === filterAdset),
  [allRows, filterCampaign, filterPlatform, filterAdset]);

  // ── aggregate KPIs from filtered rows (date-range + filter aware) ────────────
  const isFiltered = !!(filterCampaign || filterPlatform || filterAdset || filterForm);

  const totalSpend  = rows.reduce((a, r) => a + r.spend,       0);
  const totalLeads  = rows.reduce((a, r) => a + r.leads,       0);
  const totalClicks = rows.reduce((a, r) => a + r.clicks,      0);
  const totalImpr   = rows.reduce((a, r) => a + r.impressions, 0);
  const avgCPC      = totalClicks > 0 ? totalSpend / totalClicks : 0;
  const avgCPL      = totalLeads  > 0 ? totalSpend / totalLeads  : 0;

  // ── Bitrix CRM cross-channel metrics ────────────────────────────────────────
  const kData = kunlikQ.data?.data;
  const totalDeals = kData
    ? sumArr(kData.target.deals) + sumArr(kData.instagram.deals)
    : 0;
  const totalQualLids = kData
    ? sumArr(kData.target.qual_leads) + sumArr(kData.instagram.qual_leads)
    : 0;

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

    // Also include page forms not linked to any campaign (standalone forms like "Filtr - RM")
    for (const pf of pageMap.values()) {
      if (!seen.has(pf.form_id) && pf.status === "ACTIVE" && (pf.leads_count ?? 0) > 0) {
        seen.set(pf.form_id, pf);
      }
    }

    return [...seen.values()]
      .filter(f => !search || f.form_name.toLowerCase().includes(search.toLowerCase()))
      .filter(f => !filterForm || f.form_name === filterForm)
      .filter(f => {
        if (!filterCampaign) return true;
        return (formsQ.data?.campaigns ?? []).some(c =>
          c.campaign_name === filterCampaign && c.forms.some(cf => cf.form_id === f.form_id)
        );
      })
      .sort((a, b) => (b.leads_count ?? 0) - (a.leads_count ?? 0));
  }, [formsQ.data, pageFormsQ.data, search, filterForm, filterCampaign]);

  const pendingLeads = uniqueForms.reduce((a, f) => a + (f.leads_count ?? 0), 0);

  // sifatli_lid per form_id from formsQ (LeadgenForm has it)
  const sifatliFormMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const camp of formsQ.data?.campaigns ?? []) {
      for (const f of camp.forms) {
        if (!m.has(f.form_id)) m.set(f.form_id, f.sifatli_lid ?? 0);
      }
    }
    return m;
  }, [formsQ.data]);

  async function refresh() {
    setRefreshing(true);
    await Promise.all([insightsQ.refetch(), campaignsQ.refetch(), formsQ.refetch(), pageFormsQ.refetch()]);
    setRefreshing(false);
  }

  const lastUpdated = Math.max(insightsQ.dataUpdatedAt, campaignsQ.dataUpdatedAt, formsQ.dataUpdatedAt);
  const lastUpdatedTime = lastUpdated
    ? new Date(lastUpdated).toLocaleTimeString("uz-UZ", { hour: "2-digit", minute: "2-digit" })
    : null;

  const isLoading = (isFiltered ? campaignsQ.isLoading : insightsQ.isLoading) || campaignsQ.isLoading;

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
        <div className="flex items-center gap-2 ml-auto">
          <button onClick={refresh} disabled={refreshing} className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border hover:bg-bg3 text-text3 hover:text-text transition-colors disabled:opacity-60">
            <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
            {lastUpdatedTime && <span className="text-[11px]">{lastUpdatedTime}</span>}
          </button>
        </div>
      </div>

      {/* ── Inline filter panel (Sdelka-style) ──────────────────────────────── */}
      {(() => {
        const hasExtra = !!(filterCampaign || filterPlatform || filterForm || filterAdset || filterCreative);
        const selStyle: React.CSSProperties = { width: "100%", padding: "8px 10px", fontSize: 12, background: "var(--bg3)", border: "1px solid var(--border)", color: "var(--text)", borderRadius: 8 };
        return (
          <div style={{ background: "var(--bg2)", borderBottom: "1px solid var(--border)", overflow: filterOpen ? "visible" : "hidden", position: "sticky", top: 0, zIndex: 10 }}>
            <div style={{ padding: "10px 20px", display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}
              onClick={() => setFilterOpen(o => !o)}>
              <Search size={14} style={{ color: "var(--text3)" }} />
              <span style={{ fontSize: 12.5, color: "var(--text3)", flex: 1 }}>
                {`Filtr: ${fromDate} → ${toDate}${hasExtra ? " · qo'shimcha filtrlar" : ""}`}
              </span>
              {hasExtra && (
                <span style={{ fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 20, background: "#3b82f6", color: "#fff" }}>filtr</span>
              )}
              <ChevronDown size={14} style={{ color: "var(--text3)", transform: filterOpen ? "rotate(180deg)" : "none", transition: "transform .2s" }} />
            </div>

            {filterOpen && (
              <div style={{ borderTop: "1px solid var(--border)", padding: "16px 20px" }}>
                {/* Quick presets */}
                <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
                  {KAMP_PRESETS.map(p => {
                    const pf = p.f(), pt = p.t();
                    const active = fromDate === pf && toDate === pt;
                    return (
                      <button key={p.label} onClick={() => { setFromDate(pf); setToDate(pt); }}
                        style={{ padding: "5px 14px", borderRadius: 20, fontSize: 12, cursor: "pointer", background: active ? "#3b82f6" : "var(--bg3)", border: `1px solid ${active ? "#3b82f6" : "var(--border)"}`, color: active ? "#fff" : "var(--text2)", fontWeight: active ? 600 : 400 }}>
                        {p.label}
                      </button>
                    );
                  })}
                </div>

                {/* Date inputs */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
                  <div>
                    <div style={{ fontSize: 11, color: "var(--text3)", marginBottom: 4 }}>Dan (boshlanish)</div>
                    <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} style={selStyle} />
                  </div>
                  <div>
                    <div style={{ fontSize: 11, color: "var(--text3)", marginBottom: 4 }}>Gacha (tugash)</div>
                    <input type="date" value={toDate} onChange={e => setToDate(e.target.value)} style={selStyle} />
                  </div>
                </div>

                {/* Dropdown filters */}
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: hasExtra ? 10 : 0 }}>
                  <div style={{ flex: "1 1 180px", minWidth: 160 }}>
                    <div style={{ fontSize: 11, color: "var(--text3)", marginBottom: 4 }}>Kampaniya</div>
                    <select value={filterCampaign} onChange={e => { setFilterCampaign(e.target.value); setFilterPlatform(""); setFilterAdset(""); setFilterForm(""); }} style={selStyle}>
                      <option value="">Barchasi</option>
                      {optCampaigns.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  <div style={{ flex: "1 1 140px", minWidth: 120 }}>
                    <div style={{ fontSize: 11, color: "var(--text3)", marginBottom: 4 }}>Platforma</div>
                    <select value={filterPlatform} onChange={e => { setFilterPlatform(e.target.value); setFilterAdset(""); }} style={selStyle}>
                      <option value="">Barchasi</option>
                      {optPlatforms.map(p => <option key={p} value={p}>{p === "facebook" ? "Facebook" : "Instagram"}</option>)}
                    </select>
                  </div>
                  <div style={{ flex: "1 1 180px", minWidth: 160 }}>
                    <div style={{ fontSize: 11, color: "var(--text3)", marginBottom: 4 }}>Formalar</div>
                    <select value={filterForm} onChange={e => setFilterForm(e.target.value)} style={selStyle}>
                      <option value="">Barchasi</option>
                      {optForms.map(f => <option key={f} value={f}>{f}</option>)}
                    </select>
                  </div>
                  <div style={{ flex: "1 1 180px", minWidth: 160 }}>
                    <div style={{ fontSize: 11, color: "var(--text3)", marginBottom: 4 }}>Adset</div>
                    <select value={filterAdset} onChange={e => setFilterAdset(e.target.value)} style={selStyle}>
                      <option value="">Barchasi</option>
                      {optAdsets.map(a => <option key={a} value={a}>{a}</option>)}
                    </select>
                  </div>
                  {tab === "creative" && (
                    <div style={{ flex: "1 1 180px", minWidth: 160 }}>
                      <div style={{ fontSize: 11, color: "var(--text3)", marginBottom: 4 }}>Creative</div>
                      <select value={filterCreative} onChange={e => setFilterCreative(e.target.value)} style={selStyle}>
                        <option value="">Barchasi</option>
                        {optCreatives.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </div>
                  )}
                </div>

                {hasExtra && (
                  <div style={{ paddingTop: 10, borderTop: "1px solid var(--border)", display: "flex", justifyContent: "flex-end" }}>
                    <button onClick={() => { setFilterCampaign(""); setFilterPlatform(""); setFilterForm(""); setFilterAdset(""); setFilterCreative(""); }}
                      style={{ background: "none", border: "none", color: "#9E9E9E", fontSize: 12, cursor: "pointer", padding: "6px 10px" }}>Tozalash</button>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })()}

      {/* ── Scrollable body ────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">

        {/* KPI row 1 — Lidlar */}
        <div className="grid grid-cols-3 gap-3">
          {(isLoading || kunlikQ.isLoading) ? Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          )) : ([
            { label: "JAMI LIDLAR",    value: fmtNum(totalLeads),    sub: "Meta formalar",       color: "text-text"  },
            { label: "SIFATLI LIDLAR", value: fmtNum(totalQualLids), sub: "Bitrix24 sifatlilar", color: "text-green" },
            { label: "SOTUV",          value: fmtNum(totalDeals),    sub: "Yutilgan sdelkalar",  color: "text-blue"  },
          ]).map(c => (
            <div key={c.label} className="bg-bg2 border border-border rounded-xl p-4">
              <div className="text-[10px] font-bold text-text3 tracking-wider mb-2">{c.label}</div>
              <div className="flex items-end gap-2">
                <span className={`text-[22px] font-bold leading-none ${c.color}`}>{c.value}</span>
              </div>
              <div className="text-[11px] text-text3 mt-1">{c.sub}</div>
            </div>
          ))}
        </div>

        {/* KPI row 2 — Sarf */}
        <div className="grid grid-cols-3 gap-3">
          {isLoading ? Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          )) : ([
            { label: "JAMI SARF",         value: `$${fmtNum(Math.round(totalSpend))}`,                            sub: "Meta Ads sarfi",           formula: null,                                                                color: "text-text"  },
            { label: "SIFATLI LID NARXI", value: maqsadliLidNarxi > 0 ? `$${maqsadliLidNarxi.toFixed(2)}` : "—", sub: "Byudjet ÷ Sifatli lidlar", formula: `$${fmtNum(Math.round(totalSpend))} ÷ ${fmtNum(totalQualLids)}`,  color: "text-blue"  },
            { label: "MIJOZ NARXI",       value: mijozNarxi > 0 ? `$${mijozNarxi.toFixed(2)}` : "—",              sub: "Byudjet ÷ Sotuvlar soni",  formula: `$${fmtNum(Math.round(totalSpend))} ÷ ${totalDeals}`,               color: "text-amber" },
          ]).map(c => (
            <div key={c.label} className="bg-bg2 border border-border rounded-xl p-4">
              <div className="text-[10px] font-bold text-text3 tracking-wider mb-2">{c.label}</div>
              <div className="flex items-end gap-2 mb-1">
                <span className={`text-[22px] font-bold leading-none ${c.color}`}>{c.value}</span>
              </div>
              <div className="text-[10.5px] text-text3">{c.sub}</div>
              {c.formula && <div className="text-[10px] text-text3/60 mt-0.5 font-mono">{c.formula}</div>}
            </div>
          ))}
        </div>

        {/* KPI row 3 — Meta ko'rsatkichlar */}
        <div className="grid grid-cols-3 gap-3">
          {isLoading ? Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          )) : ([
            { label: "IMPRESSIYALAR",     value: fmtNum(totalImpr),                               sub: "Jami ko'rishlar", color: "text-text" },
            { label: "CLICK NARXI (CPC)", value: `$${avgCPC.toFixed(2)}`,                         sub: "Cost per click",  color: "text-text" },
            { label: "LEAD NARXI (CPL)",  value: totalLeads > 0 ? `$${avgCPL.toFixed(2)}` : "—", sub: "Cost per lead",   color: "text-text" },
          ]).map(c => (
            <div key={c.label} className="bg-bg2 border border-border rounded-xl p-4">
              <div className="text-[10px] font-bold text-text3 tracking-wider mb-2">{c.label}</div>
              <div className="flex items-end gap-2">
                <span className={`text-[22px] font-bold leading-none ${c.color}`}>{c.value}</span>
              </div>
              <div className="text-[11px] text-text3 mt-1">{c.sub}</div>
            </div>
          ))}
        </div>


        {/* Tabs + 2-column body */}
        <div>
          {/* Tab bar */}
          <div className="flex border-b border-border">
            {([
              { key: "kampaniyalar", label: "Kampaniyalar" },
              { key: "formalar",     label: "Faol formalar ☆" },
              { key: "lidlar",       label: "Lidlar ro'yxati", badge: pendingLeads > 0 ? pendingLeads : null },
              { key: "creative",     label: "Creative" },
            ] as { key: Tab; label: string; badge?: number | null }[]).map(t => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`px-5 py-2.5 text-[13px] font-semibold border-b-2 transition-colors flex items-center gap-2 ${
                  tab === t.key ? "border-blue text-blue" : "border-transparent text-text3 hover:text-text"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* 2-column layout */}
          <div className="grid grid-cols-[1fr_320px] gap-4 mt-4">

            {/* LEFT: content table */}
            <div className="bg-bg2 border border-border rounded-xl overflow-hidden">
              <div className="px-5 py-3.5 border-b border-border flex items-center justify-between gap-3">
                <div>
                  <div className="text-[14px] font-bold text-text">
                    {tab === "formalar"     && "Lead Form Performance"}
                    {tab === "kampaniyalar" && "Kampaniyalar"}
                    {tab === "lidlar"       && "Lidlar ro'yxati"}
                    {tab === "creative"     && "Creative Performance"}
                  </div>
                  <div className="text-[11.5px] text-text3 mt-0.5">
                    {tab === "formalar" ? "Faol formalar bo'yicha real vaqtdagi ko'rsatkichlar" : "Meta Ads ma'lumotlari"}
                  </div>
                </div>
                <button onClick={refresh} className="p-1.5 rounded-lg border border-border text-text3 hover:bg-bg3 transition-colors shrink-0">
                  <RefreshCw className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* ── Formalar tab ── */}
              {tab === "formalar" && (
                <>
                  <table className="w-full text-[12.5px]">
                    <thead>
                      <tr className="bg-bg3 border-b border-border">
                        {["FORMA NOMI", "KAMPANIYA", "HOLAT", "SARF", "KLIKLAR", "CPC", "LIDLAR (jami)", "SIFATLI LID"].map(h => (
                          <th key={h} className="px-4 py-2.5 text-left text-[10px] font-bold text-text3 tracking-wider">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {(formsQ.isLoading && pageFormsQ.isLoading) ? (
                        Array.from({ length: 5 }).map((_, i) => (
                          <tr key={i} className="border-b border-border">
                            {Array.from({ length: 8 }).map((__, j) => (
                              <td key={j} className="px-4 py-3"><Skeleton className="h-3.5 w-20" /></td>
                            ))}
                          </tr>
                        ))
                      ) : uniqueForms.length === 0 ? (
                        <tr><td colSpan={8} className="px-4 py-10 text-center text-text3">
                          Faol formalar topilmadi
                        </td></tr>
                      ) : uniqueForms.map(form => {
                          const isExp = expandedForm === form.form_id;
                          const fCamps = (formsQ.data?.campaigns ?? []).filter(c =>
                            c.forms.some(f => f.form_id === form.form_id),
                          );
                          const campName = fCamps.length > 0 ? fCamps[0].campaign_name : null;
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
                            <>
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
                                <td className="px-4 py-3 max-w-[160px]">
                                  {campName ? (
                                    <span className="text-[11px] text-text2 truncate block" title={campName}>
                                      {campName.length > 24 ? campName.slice(0, 24) + "…" : campName}
                                    </span>
                                  ) : (
                                    <span className="text-[11px] text-text3 italic">—</span>
                                  )}
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
                                <td className="px-4 py-3 font-semibold" style={{ color: (sifatliFormMap.get(form.form_id) ?? 0) > 0 ? "#22c55e" : "var(--text3)" }}>
                                  {sifatliFormMap.get(form.form_id) ?? 0}
                                </td>
                              </tr>
                              {isExp && (
                                <tr key={`${form.form_id}-leads`}>
                                  <td colSpan={8} className="p-0">
                                    <LeadsSubTable formId={form.form_id} campaignId="" from={fromDate} to={toDate} />
                                  </td>
                                </tr>
                              )}
                            </>
                          );
                        })}
                    </tbody>
                  </table>
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

              {/* ── Creative tab ── */}
              {tab === "creative" && (() => {
                const creatives = creativesQ.data?.creatives ?? [];
                const filtered = creatives
                  .filter(r => !filterCampaign  || r.campaign_name === filterCampaign)
                  .filter(r => !filterAdset     || r.adset_name    === filterAdset)
                  .filter(r => !filterCreative  || r.ad_name       === filterCreative);

                const agg = (rows: typeof filtered) => ({
                  spend:              rows.reduce((a, r) => a + r.spend, 0),
                  meta_leads:         rows.reduce((a, r) => a + r.meta_leads, 0),
                  in_bitrix:          rows.reduce((a, r) => a + r.in_bitrix, 0),
                  sifatli:            rows.reduce((a, r) => a + r.sifatli, 0),
                  konsultatsiya_otdi: rows.reduce((a, r) => a + (r.konsultatsiya_otdi ?? 0), 0),
                  sotuv_boldi:        rows.reduce((a, r) => a + (r.sotuv_boldi ?? 0), 0),
                  sifatsiz:           rows.reduce((a, r) => a + r.sifatsiz, 0),
                  bekor_boldi:        rows.reduce((a, r) => a + r.bekor_boldi, 0),
                  not_in_bitrix:      rows.reduce((a, r) => a + r.not_in_bitrix, 0),
                });

                const TH = "px-3 py-2.5 text-left text-[10px] font-bold text-text3 tracking-wider whitespace-nowrap";
                const TD = "px-3 py-2.5 text-[12px]";

                const SifatBar = ({ rate }: { rate: number }) => (
                  <div className="flex items-center justify-end gap-1.5">
                    <div className="w-14 h-1.5 rounded-full bg-white/10 overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${rate}%`, background: rate >= 50 ? "#22c55e" : rate >= 25 ? "#f59e0b" : "#ef4444" }} />
                    </div>
                    <span className={`text-[11px] font-semibold ${rate >= 50 ? "text-green" : rate >= 25 ? "text-amber" : "text-red"}`}>{rate}%</span>
                  </div>
                );

                const totals = agg(filtered);

                return (
                  <div className="overflow-x-auto">
                    <table className="w-full text-[12px]" style={{ borderCollapse: "collapse" }}>
                      <thead>
                        <tr className="bg-bg3 border-b border-border">
                          <th className={TH} style={{ width: 320 }}>CREATIVE</th>
                          <th className={`${TH} text-right`}>SARF</th>
                          <th className={`${TH} text-right`}>META LIDLAR</th>
                          <th className={`${TH} text-right`}>BITRIX24</th>
                          <th className={`${TH} text-right`}>SIFATLI</th>
                          <th className={`${TH} text-right`}>KONSULT.</th>
                          <th className={`${TH} text-right`}>SOTUV BO'LDI</th>
                          <th className={`${TH} text-right`}>SIFATSIZ</th>
                          <th className={`${TH} text-right`}>BEKOR</th>
                          <th className={`${TH} text-right`}>YO'Q</th>
                          <th className={`${TH} text-right`}>SIFAT %</th>
                        </tr>
                      </thead>
                      <tbody>
                        {creativesQ.isLoading ? (
                          Array.from({ length: 5 }).map((_, i) => (
                            <tr key={i} className="border-b border-border">
                              {Array.from({ length: 11 }).map((__, j) => (
                                <td key={j} className={TD}><Skeleton className="h-3 w-14" /></td>
                              ))}
                            </tr>
                          ))
                        ) : filtered.length === 0 ? (
                          <tr><td colSpan={11} className="px-4 py-10 text-center text-text3">Ma'lumot topilmadi</td></tr>
                        ) : filtered.map((r, ri) => {
                          const adKey = `${r.campaign_name}::${r.adset_name}::${ri}`;
                          const isExpAd    = expandedCreative === adKey;
                          const isExpSotuv = expandedSotuv    === adKey;
                          const cpl = r.meta_leads > 0 ? r.spend / r.meta_leads : 0;
                          return (
                            <>
                              <tr key={ri}
                                className={`border-b border-border/50 hover:bg-bg3/30 cursor-pointer ${isExpAd ? "bg-bg3/20" : ""}`}
                                onClick={() => { setExpandedCreative(isExpAd ? null : adKey); setExpandedSotuv(null); }}>
                                <td className={TD}>
                                  <div className="flex items-center gap-1.5">
                                    <ChevronDown size={11} className={`text-text3 shrink-0 transition-transform ${isExpAd ? "rotate-180" : ""}`} />
                                    <div className="flex flex-col gap-0.5 min-w-0">
                                      {r.ad_name ? (
                                        <a href={r.post_url ?? undefined} target="_blank" rel="noreferrer"
                                          onClick={e => e.stopPropagation()}
                                          className="text-blue hover:underline text-[11px] truncate max-w-[280px] block" title={r.ad_name}>
                                          {r.ad_name}
                                        </a>
                                      ) : (
                                        <span className="text-text3 text-[11px] italic">Nomsiz ad</span>
                                      )}
                                    </div>
                                  </div>
                                </td>
                                <td className={`${TD} text-right text-[11px] text-text`}>
                                  {r.spend > 0 ? `$${Math.round(r.spend)}` : <span className="text-text3">—</span>}
                                  {cpl > 0 && <div className="text-[10px] text-text3">${cpl.toFixed(2)}</div>}
                                </td>
                                <td className={`${TD} text-right text-[11px] text-text2`}>{r.meta_leads}</td>
                                <td className={`${TD} text-right text-[11px]`}><span className={r.in_bitrix > 0 ? "text-blue" : "text-text3"}>{r.in_bitrix}</span></td>
                                <td className={`${TD} text-right text-[11px]`}><span className={r.sifatli > 0 ? "text-green" : "text-text3"}>{r.sifatli}</span></td>
                                <td className={`${TD} text-right text-[11px]`}><span className={(r.konsultatsiya_otdi ?? 0) > 0 ? "" : "text-text3"} style={(r.konsultatsiya_otdi ?? 0) > 0 ? { color: "#a78bfa" } : {}}>{(r.konsultatsiya_otdi ?? 0) || "—"}</span></td>
                                <td className={`${TD} text-right text-[11px]`}
                                  onClick={e => {
                                    e.stopPropagation();
                                    if ((r.sotuv_boldi ?? 0) > 0) {
                                      setExpandedSotuv(isExpSotuv ? null : adKey);
                                      setExpandedCreative(null);
                                    }
                                  }}>
                                  <span className={`${((r.sotuv_boldi ?? 0) > 0) ? "text-[#22c55e] underline underline-offset-2 cursor-pointer hover:opacity-70" : "text-text3"}`}>
                                    {(r.sotuv_boldi ?? 0) || "—"}
                                  </span>
                                </td>
                                <td className={`${TD} text-right text-[11px]`}><span className={r.sifatsiz > 0 ? "text-red/80" : "text-text3"}>{r.sifatsiz}</span></td>
                                <td className={`${TD} text-right text-[11px]`}><span className={r.bekor_boldi > 0 ? "text-amber" : "text-text3"}>{r.bekor_boldi}</span></td>
                                <td className={`${TD} text-right text-[11px] text-text3`}>{r.not_in_bitrix || "—"}</td>
                                <td className={TD}><SifatBar rate={r.sifat_rate} /></td>
                              </tr>
                              {isExpAd    && <CreativeLeadsPanel key={`panel-${adKey}`} adsetName={r.adset_name} month={month} year={year} from={fromDate} to={toDate} />}
                              {isExpSotuv && <SotuvDealsPanel    key={`sotuv-${adKey}`} adsetName={r.adset_name} month={month} year={year} from={fromDate} to={toDate} />}
                            </>
                          );
                        })}
                      </tbody>
                      {filtered.length > 0 && (
                        <tfoot>
                          <tr className="border-t-2 border-border bg-bg3/50">
                            <td className={`${TD} font-bold text-text`}>JAMI</td>
                            <td className={`${TD} text-right font-bold text-text`}>${Math.round(totals.spend)}</td>
                            <td className={`${TD} text-right font-bold text-text2`}>{totals.meta_leads}</td>
                            <td className={`${TD} text-right font-bold text-blue`}>{totals.in_bitrix}</td>
                            <td className={`${TD} text-right font-bold text-green`}>{totals.sifatli}</td>
                            <td className={`${TD} text-right font-bold`} style={{ color: "#a78bfa" }}>{totals.konsultatsiya_otdi}</td>
                            <td className={`${TD} text-right font-bold`} style={{ color: "#22c55e" }}>{totals.sotuv_boldi}</td>
                            <td className={`${TD} text-right text-red/80`}>{totals.sifatsiz}</td>
                            <td className={`${TD} text-right text-amber`}>{totals.bekor_boldi}</td>
                            <td className={`${TD} text-right text-text3`}>{totals.not_in_bitrix}</td>
                            <td className={TD} />
                          </tr>
                        </tfoot>
                      )}
                    </table>
                  </div>
                );
              })()}
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

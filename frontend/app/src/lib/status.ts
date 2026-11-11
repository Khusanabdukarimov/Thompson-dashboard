/**
 * Status colours and row actions shared by the list components (see components/StatusMark).
 */
import { getBitrixOwner } from "@/lib/api/leads";

export type Tone = "good" | "warning" | "serious" | "critical" | "neutral" | "info";

export const TONE: Record<Tone, string> = {
  good: "#0ca30c",
  warning: "#e0a000",
  serious: "#ec835a",
  critical: "#d03b3b",
  neutral: "#898781",
  info: "#3b82f6",
};

/** Seconds → tone, against two limits (fine below the first, bad from the second). */
export const speedTone = (s: number | null | undefined, [ok, slow]: [number, number]): Tone =>
  s == null ? "neutral" : s < ok ? "good" : s < slow ? "warning" : "critical";

/** The CRM records Bitrix24 files a call under: its own word for each, its URL segment, a colour. */
export const CRM_KINDS: Record<string, { label: string; path: string; color: string }> = {
  LEAD:    { label: "Лид",      path: "lead",    color: "#2563EB" },
  CONTACT: { label: "Контакт",  path: "contact", color: "#7C3AED" },
  DEAL:    { label: "Сделка",   path: "deal",    color: "#16A34A" },
  COMPANY: { label: "Компания", path: "company", color: "#D97706" },
};
export const crmKind = (type?: string | null) => (type ? CRM_KINDS[type] ?? null : null);

/** Opens the CRM record a call is filed under (lead / contact / deal / company) in Bitrix24. */
export const openCrm = (portal: string, type?: string | null, id?: number | null) => {
  const k = crmKind(type);
  if (portal && k && id) window.open(`${portal}/crm/${k.path}/details/${id}/`, "_blank", "noopener");
};

/** Opens a lead in Bitrix — rows of lead lists are links as a whole. */
export const openLead = (portal: string, leadId?: number | null) => {
  if (portal && leadId) window.open(`${portal}/crm/lead/details/${leadId}/`, "_blank", "noopener");
};

/**
 * A row with no lead of ours: ask Bitrix who owns the number (usually a CONTACT — an existing
 * client) and open that. The tab is opened right away, before the lookup, because a window
 * opened after an await is blocked as a pop-up.
 */
export async function openByPhone(portal: string, phone?: string | null) {
  if (!portal || !phone) return;
  const w = window.open("about:blank", "_blank");
  if (!w) return;
  w.opener = null;
  w.document.title = "Bitrix24…";
  w.document.body.innerHTML = '<p style="font:15px system-ui;padding:24px;color:#555">Bitrix24\'da qidirilmoqda…</p>';
  try {
    const r = await getBitrixOwner(phone);
    if (r.type && r.id) w.location.href = `${portal}/crm/${r.type}/details/${r.id}/`;
    else w.document.body.innerHTML = '<p style="font:15px system-ui;padding:24px;color:#555">Bu raqam Bitrix24\'da topilmadi (lid, kontakt yoki kompaniya yo\'q).</p>';
  } catch {
    w.document.body.innerHTML = '<p style="font:15px system-ui;padding:24px;color:#b00">Bitrix24 bilan bog\'lanib bo\'lmadi. Keyinroq urinib ko\'ring.</p>';
  }
}

import { crmKind } from "@/lib/status";

/**
 * The CRM record a call is filed under, written the way Bitrix24's "Детализация звонков" writes it:
 * "Лид: Пропущенный 999455236", "Контакт: Nodira", "Сделка: …", "Компания: …". Bitrix's own words, so
 * the dashboard row and the Bitrix row read the same.
 */
export function CrmTag({ type, id, title }: { type?: string | null; id?: number | null; title?: string | null }) {
  const k = crmKind(type);
  if (!k) return null;
  return (
    <span title={`${k.label}${title ? `: ${title}` : ""} (#${id})`}
      style={{ display: "inline-flex", alignItems: "baseline", gap: 5, maxWidth: 280, minWidth: 0 }}>
      <b style={{ color: k.color, fontWeight: 700, flexShrink: 0 }}>{k.label}:</b>
      <span style={{ color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title || `#${id}`}</span>
    </span>
  );
}

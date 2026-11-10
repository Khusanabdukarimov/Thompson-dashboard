/**
 * Lead stage names exactly as Bitrix24 writes them ("Успешный лид", "Закрыт", "Визит назначен", ...) —
 * nothing is translated. Every place that shows a lead stage goes through leadStageLabel().
 *
 * The live name (the one the stage list / an endpoint sends) wins, so a rename in Bitrix shows up with
 * no code change. BY_ID, keyed by STATUS_ID, covers the places that only have the id (a lead list row,
 * a stage chip); it mirrors crm.status.list for the lead pipeline.
 */
const BY_ID: Record<string, string> = {
  NEW:       "Звонки",
  UC_IX1SKS: "Новый лид",
  UC_O7Y5NT: "Пропущенный",
  "7":       "DPU 1 (11:00-13:00)",
  UC_S5YC0D: "DPU 2 (14:00-16:00)",
  UC_X316SW: "DPU 3 (17:00-19:00)",
  UC_63QL7L: "Обратная связь",
  "1":       "Думает (1-30)",
  UC_N0PI5R: "Визит назначен",
  UC_SWPARQ: "Не пришёл",
  UC_QJUDCL: "Ожидается регистрация",
  CONVERTED: "Успешный лид",
  JUNK:      "Горячие звонки (NO)",
  UC_GSPVUS: "Архив 30+",
  UC_L8G2B9: "Закрыт",
  UC_W02434: "Cтудент | Жалоба | HR",   // Bitrix spells the first letter with a Latin C
};

const clean = (name?: string | null) => name?.replace(/\s+/g, " ").trim() || "";

// Stage id from a stage's name (for endpoints that send only the name); both spellings of the Студент stage.
const ID_BY_NAME = new Map<string, string>([
  ...Object.entries(BY_ID).map(([id, n]) => [n, id] as [string, string]),
  ["Студент | Жалоба | HR", "UC_W02434"],
]);

/** Bitrix STATUS_ID from a stage's name (for endpoints that send only the name). */
export function leadStageId(name?: string | null): string | null {
  const n = clean(name);
  return n ? ID_BY_NAME.get(n) ?? null : null;
}

/** The stage's name as Bitrix24 writes it. */
export function leadStageLabel(id?: string | null, name?: string | null): string {
  return clean(name) || (id && BY_ID[id]) || id || "—";
}

/** Badge colour per lead stage (same hues the Lidlar tables use). */
const COLOR: Record<string, string> = {
  NEW: "#9E9E9E", UC_IX1SKS: "#03A9F4", UC_O7Y5NT: "#78909C", "7": "#FF5722", UC_S5YC0D: "#FF7043",
  UC_X316SW: "#FF8A65", UC_63QL7L: "#26C6DA", "1": "#607D8B", UC_N0PI5R: "#FF9800", UC_SWPARQ: "#E040FB",
  UC_QJUDCL: "#7E57C2", CONVERTED: "#16A34A", JUNK: "#DC2626", UC_GSPVUS: "#8D6E63", UC_L8G2B9: "#D97706",
  UC_W02434: "#FFC107",
};
export const leadStageColor = (id?: string | null) => (id && COLOR[id]) || "#9E9E9E";

/**
 * Uzbek names for the lead stages. Bitrix names them in Russian ("Горячие
 * звонки (NO)", "Закрыт", ...) and the API passes those through, so every
 * place that shows a lead stage goes through leadStageLabel().
 *
 * Keyed by Bitrix STATUS_ID first; the Russian name is a second key for the
 * endpoints that send only stage_name. A stage missing from both (a new one
 * added in Bitrix) shows its Bitrix name.
 */
const BY_ID: Record<string, string> = {
  NEW:       "Qo‘ng‘iroqlar",
  UC_IX1SKS: "Yangi lid",
  UC_O7Y5NT: "O‘tkazib yuborilgan",
  UC_63QL7L: "Qayta aloqa",
  "1":       "O‘ylab ko‘radi (1-30)",
  UC_N0PI5R: "Tashrif belgilandi",
  UC_SWPARQ: "Kelmadi",
  UC_QJUDCL: "Ro‘yxatdan o‘tish kutilmoqda",
  CONVERTED: "Muvaffaqiyatli",
  JUNK:      "Sifatsiz",
  UC_GSPVUS: "Arxiv 30+",
  UC_L8G2B9: "Bekor bo‘ldi",
  UC_W02434: "Student | Shikoyat | HR",
};

const BY_RU: Record<string, string> = {
  "Звонки": BY_ID.NEW,
  "Новый лид": BY_ID.UC_IX1SKS,
  "Пропущенный": BY_ID.UC_O7Y5NT,
  "Обратная связь": BY_ID.UC_63QL7L,
  "Думает (1-30)": BY_ID["1"],
  "Визит назначен": BY_ID.UC_N0PI5R,
  "Не пришёл": BY_ID.UC_SWPARQ,
  "Ожидается регистрация": BY_ID.UC_QJUDCL,
  "Успешный лид": BY_ID.CONVERTED,
  "Горячие звонки (NO)": BY_ID.JUNK,
  "Архив 30+": BY_ID.UC_GSPVUS,
  "Закрыт": BY_ID.UC_L8G2B9,
  "Cтудент | Жалоба | HR": BY_ID.UC_W02434,
  "Студент | Жалоба | HR": BY_ID.UC_W02434,
};

export function leadStageLabel(id?: string | null, name?: string | null): string {
  if (id && BY_ID[id]) return BY_ID[id];
  const n = name?.replace(/\s+/g, " ").trim();
  if (n && BY_RU[n]) return BY_RU[n];
  return n || id || "—";
}

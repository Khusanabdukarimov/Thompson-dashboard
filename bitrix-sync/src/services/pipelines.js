/**
 * Deal pipelines (Bitrix "воронки") shown on the Sdelkalar page.
 *
 * A deal's pipeline is not stored on the deal row — it is encoded in its stage
 * id: the default pipeline (category 0) uses bare ids ("NEW", "WON", "1"),
 * every other one prefixes them ("C25:NEW"). So pipeline scoping is a
 * condition on stages.bitrix_id.
 *
 * Stage names, order and grouping are read live from Bitrix and cached, because
 * the `stages` table only holds raw ids for most deal stages (the sync that
 * would name them runs only when the Reja page is opened). Renaming or adding a
 * stage in Bitrix therefore shows up here within STAGE_TTL_MS. If Bitrix is
 * unreachable the snapshot below keeps the page working.
 */
const { bitrixCall } = require('./bitrix');

const PIPELINES = {
  uc: {
    key: 'uc', categoryId: 0, label: 'Учебный центр',
    // Причина (enumeration) — the only reason field this pipeline has.
    reasonField: 'UF_CRM_6075517B5CAD2',
    // Стадия (для отчетов) — free text kept in deals.uf_report_stage; filterable.
    reportStage: true,
  },
  yangi: {
    key: 'yangi', categoryId: 25, label: 'Школа | YANGI',
    // No cancellation-reason field exists on this pipeline in Bitrix yet.
    reasonField: null,
    reportStage: false,
  },
};

// Snapshot of crm.dealcategory.stage.list taken 2026-10-07 — fallback only.
const STAGE_SNAPSHOT = {
  0: [
    ['NEW', 'Визит в офис Тошкент', 10], ['UC_CWBI6N', 'Визит в офис Фаргона', 20],
    ['UC_AJMT1E', 'Визит в офис Навои', 30], ['UC_2KIASX', 'Визит в офис Наманган', 40],
    ['UC_T9V650', 'Замонавий касблар', 50], ['UC_W1EVCC', 'filial kiritmadi', 60],
    ['1', 'Пробный урок', 70], ['4', 'В процессе-1', 80],
    ['WON', 'Оплата (+)', 90], ['LOSE', 'Не успешные звонки (NO)', 100],
  ],
  25: [
    ['C25:NEW', 'Tashrif buyurdi', 10], ['C25:PREPARATION', 'Konsultatsiya', 20],
    ['C25:PREPAYMENT_INVOIC', 'Demo darsga yozildi', 30], ['C25:EXECUTING', 'Shartnoma tuzildi', 40],
    ['C25:WON', "To'lov | O'qimoqda", 50], ['C25:LOSE', "Bekor bo'ldi", 60],
    ['C25:APOLOGY', "To'lovdan so'ng yo'q", 70],
  ],
};

// Snapshot of the Причина enumeration (crm.deal.fields) — fallback only.
const PRICHINA_SNAPSHOT = {
  936: 'Время', 940: 'Локация', 938: 'Неверный номер', 962: 'Не оставлял', 948: 'Не дозвон',
  946: 'Сотрудничество', 950: 'Course (Курс)', 984: 'Томсон онлайн(Курс)', 952: 'Дубликат',
  958: 'Возраст', 964: 'Events', 934: 'Цена', 2332: 'Локация инфо', 992: 'Не дозвон инфо',
  942: 'Другой центр', 944: 'Информация', 2954: 'Нет подходящей группы', 3550: 'Нет свободной группы',
  954: 'Другие причины', 966: 'Личные причины', 3398: 'Время инфо', 972: 'Другой садик', 986: 'School',
  980: 'Land', 976: 'Kids', 988: 'Другая школа', 2302: 'UZB класс', 2318: '0 класс', 2424: 'Eng класс',
  2574: 'Лондон', 3050: 'Нет класс', 3202: 'Малайзия', 3210: 'Обращение к директору',
  3224: 'Рабочая Виза', 3282: 'Прайс инфо', 3316: 'Вебинар школа', 3334: 'Грант',
  3384: 'Филиал киритмади', 3426: 'Online IH', 3558: "Ingliz tili darajasi to'g'ri kelmadi",
  5131: 'Наш студент', 5133: 'HR',
};

const STAGE_TTL_MS = 10 * 60_000;
const ENUM_TTL_MS = 60 * 60_000;

/**
 * Bitrix kanban semantics: the WON stage is the success column, every stage
 * sorted after it is a failure column, everything before it is in progress.
 * (SEMANTICS comes back empty on this portal, so it cannot be used.)
 */
function classify(rawStages) {
  const stages = [...rawStages].sort((a, b) => a.sort - b.sort);
  const won = stages.find(s => s.id === 'WON' || s.id.endsWith(':WON'));
  return stages.map(s => ({
    ...s,
    kind: s === won ? 'won' : (won && s.sort > won.sort ? 'lost' : 'process'),
  }));
}

const stageCache = new Map(); // categoryId -> { at, stages }

async function getStages(categoryId) {
  const hit = stageCache.get(categoryId);
  if (hit && Date.now() - hit.at < STAGE_TTL_MS) return hit.stages;
  let stages;
  try {
    const res = await bitrixCall('crm.dealcategory.stage.list', { id: categoryId });
    const list = res.result || [];
    if (!list.length) throw new Error('empty stage list');
    stages = classify(list.map(s => ({
      id: s.STATUS_ID, name: s.NAME || s.STATUS_ID, sort: parseInt(s.SORT, 10) || 0,
      color: s.COLOR || s.EXTRA?.COLOR || null,
    })));
  } catch (err) {
    console.warn(`[pipelines] stage list for category ${categoryId} failed, using snapshot:`, err.message);
    // Serve a stale cache before the snapshot — it reflects Bitrix more recently.
    if (hit) return hit.stages;
    stages = classify((STAGE_SNAPSHOT[categoryId] || []).map(([id, name, sort]) => ({ id, name, sort, color: null })));
  }
  stageCache.set(categoryId, { at: Date.now(), stages });
  return stages;
}

const enumCache = new Map(); // fieldCode -> { at, labels }

async function getEnumLabels(fieldCode) {
  const hit = enumCache.get(fieldCode);
  if (hit && Date.now() - hit.at < ENUM_TTL_MS) return hit.labels;
  let labels;
  try {
    const res = await bitrixCall('crm.deal.fields', {});
    const items = res.result?.[fieldCode]?.items || [];
    if (!items.length) throw new Error(`no enum items for ${fieldCode}`);
    labels = Object.fromEntries(items.map(i => [String(i.ID), i.VALUE]));
  } catch (err) {
    console.warn(`[pipelines] enum labels for ${fieldCode} failed, using snapshot:`, err.message);
    if (hit) return hit.labels;
    labels = fieldCode === PIPELINES.uc.reasonField ? { ...PRICHINA_SNAPSHOT } : {};
  }
  enumCache.set(fieldCode, { at: Date.now(), labels });
  return labels;
}

function getPipeline(key) {
  return PIPELINES[key] || null;
}

/** SQL condition restricting stage alias `s` to one pipeline. categoryId is a trusted int. */
function categoryCond(categoryId, alias = 's') {
  return categoryId === 0
    ? `${alias}.bitrix_id !~ '^C[0-9]+:'`
    : `${alias}.bitrix_id LIKE 'C${Number(categoryId)}:%'`;
}

module.exports = { PIPELINES, getPipeline, getStages, getEnumLabels, categoryCond };

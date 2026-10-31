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

// Источник 1 (enumeration) — same field and options on both pipelines; deals.uf_source1.
const SOURCE1_FIELD = 'UF_CRM_6180BEE07D2B3';
// Филиал (enumeration, 36 options) — same on both pipelines; deals.uf_filial.
const FILIAL_FIELD = 'UF_CRM_6075517B4499E';

const PIPELINES = {
  uc: {
    key: 'uc', categoryId: 0, label: 'Учебный центр',
    // Причина (enumeration) — the only reason field this pipeline has.
    reasonField: 'UF_CRM_6075517B5CAD2',
    // Стадия (для отчетов) — free text kept in deals.uf_report_stage; shown in drill-downs.
    reportStage: true,
  },
  yangi: {
    key: 'yangi', categoryId: 25, label: 'Школа | YANGI',
    // Причина is the only reason field with real values on YANGI cancelled deals
    // (27 of 491 in Oct 2026). "Nima sababdan kelmadi?" is filled on all of them,
    // but always with the placeholder ".", and "Bekor bo'lish sababi (School)" is empty.
    reasonField: 'UF_CRM_6075517B5CAD2',
    // Reasons are read for "Bekor bo'ldi" only, not "To'lovdan so'ng yo'q".
    reasonStages: ['C25:LOSE'],
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
// When Bitrix does not answer, the fallback is kept this long before Bitrix is asked again,
// and these lookups give up sooner than the default 30 s. Before, every page request waited
// out a fresh 30 s timeout per stage list and per field (2026-10-31: the portal stopped
// answering this server and Sdelkalar hung on "Yuklanmoqda…").
const RETRY_AFTER_FAIL_MS = 2 * 60_000;
const META_TIMEOUT_MS = 10_000;

/**
 * Cached read with a fallback: one Bitrix request at a time per key (concurrent callers share
 * it), the result kept for `ttl`; on failure the stale value (or `fallback()`) is served and
 * kept for RETRY_AFTER_FAIL_MS. Once a value exists, an expired one is served at once and
 * refreshed in the background, so only the very first read after a restart waits on Bitrix.
 */
function cachedLookup(cache, key, ttl, load, fallback, label) {
  const hit = cache.get(key);
  if (hit && Date.now() < hit.until) return Promise.resolve(hit.value);
  if (hit?.pending) return hit.value !== undefined ? Promise.resolve(hit.value) : hit.pending;
  const pending = load()
    .then((value) => {
      cache.set(key, { value, until: Date.now() + ttl });
      return value;
    })
    .catch((err) => {
      console.warn(`[pipelines] ${label} failed, using ${hit ? 'last good copy' : 'snapshot'}:`, err.message);
      // Serve a stale cache before the snapshot — it reflects Bitrix more recently.
      const value = hit ? hit.value : fallback();
      cache.set(key, { value, until: Date.now() + RETRY_AFTER_FAIL_MS });
      return value;
    });
  cache.set(key, { ...(hit || { value: undefined, until: 0 }), pending });
  return hit && hit.value !== undefined ? Promise.resolve(hit.value) : pending;
}

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

const stageCache = new Map(); // categoryId -> { value, until, pending? }

function getStages(categoryId) {
  return cachedLookup(stageCache, categoryId, STAGE_TTL_MS, async () => {
    const res = await bitrixCall('crm.dealcategory.stage.list', { id: categoryId }, META_TIMEOUT_MS);
    const list = res.result || [];
    if (!list.length) throw new Error('empty stage list');
    return classify(list.map(s => ({
      id: s.STATUS_ID, name: s.NAME || s.STATUS_ID, sort: parseInt(s.SORT, 10) || 0,
      color: s.COLOR || s.EXTRA?.COLOR || null,
    })));
  }, () => classify((STAGE_SNAPSHOT[categoryId] || []).map(([id, name, sort]) => ({ id, name, sort, color: null }))),
  `stage list for category ${categoryId}`);
}

const enumCache = new Map(); // fieldCode -> { value, until, pending? }

function getEnumLabels(fieldCode) {
  return cachedLookup(enumCache, fieldCode, ENUM_TTL_MS, async () => {
    const res = await bitrixCall('crm.deal.fields', {}, META_TIMEOUT_MS);
    const items = res.result?.[fieldCode]?.items || [];
    if (!items.length) throw new Error(`no enum items for ${fieldCode}`);
    return Object.fromEntries(items.map(i => [String(i.ID), i.VALUE]));
  }, () => (fieldCode === PIPELINES.uc.reasonField ? { ...PRICHINA_SNAPSHOT } : {}),
  `enum labels for ${fieldCode}`);
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

/** Fill the stage / field caches at startup, so no page request waits on Bitrix for them. */
function warmPipelineCaches() {
  const fields = new Set([SOURCE1_FIELD, FILIAL_FIELD]);
  const jobs = [];
  for (const p of Object.values(PIPELINES)) {
    jobs.push(getStages(p.categoryId));
    if (p.reasonField) fields.add(p.reasonField);
  }
  for (const f of fields) jobs.push(getEnumLabels(f));
  return Promise.allSettled(jobs);
}

module.exports = { PIPELINES, SOURCE1_FIELD, FILIAL_FIELD, getPipeline, getStages, getEnumLabels, categoryCond, warmPipelineCaches };

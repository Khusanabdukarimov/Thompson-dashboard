/**
 * CallStatistikasi payload, reconciled to match the OnlinePBX panel to the
 * second (verified against the live pbx37068 numbers for 2026-07-09).
 *
 * Definitions, all confirmed against OnlinePBX:
 *   direction        accountcode (inbound / outbound / local=internal)
 *   Все (all)        inbound + outbound. Internal calls (extension → extension,
 *                    e.g. 101 → 100) are NOT counted: not in the total, not in any
 *                    operator row, not in the callback map. OnlinePBX's own "Все"
 *                    does include them, so this total is lower than the panel's by
 *                    exactly `internal_calls`.
 *   answered/success talk_time > 0 — a connection, as Bitrix24 counts it (config/calls.js MIN_TALK_S).
 *                    The duration figures (avg_duration, median_duration) use only real conversations,
 *                    talk > MIN_CONVERSATION_S (10 s).
 *   Пропущенные      inbound not answered. WHOSE missed call it is comes from Bitrix24
 *                    (bx_missed_calls: the responsible of the CRM entity the call was
 *                    registered against), because the PBX attributes a call that rang
 *                    out in a queue to nobody — per-operator Propushenniy was 0. The
 *                    Propushenniy card, "Ne perezvonili", "Reaksiya vaqti" and the
 *                    per-operator columns all use those events; Muvaffaqiyatsiz /
 *                    success_calls stay PBX-based (they are derived from the PBX's own
 *                    answered/unanswered split), so the two missed counts can differ by
 *                    the few calls the PBX and Bitrix disagree on.
 *   НДЗ              outbound not answered
 *   Не перезвонили   a missed inbound with NO contact with that number within 24h.
 *                    A contact is any operator call to the number, picked up or not
 *                    (the operator did call back), or the customer calling again and
 *                    getting through. An unanswered redial by the customer is not one.
 *   Reaksiya vaqti   average wait for the first contact among the misses called back within 24h,
 *                    counted in WORKING time of the team that owns the lead (config/workHours.js:
 *                    TLC 09-20, TIS 09-19, TL 08-18, unknown 08-20): a miss at 22:00 called back
 *                    at 09:05 waited 5 minutes. The 24h window itself is still plain clock time.
 *   разговоров       Σ talk_time   ·   длительность   Σ duration
 *   avg_duration     average TALK time per ANSWERED call (Σ talk_time / answered). It used to be
 *                    Σ duration / ALL external calls: 68% of calls are unanswered and only ring
 *                    (~25 s), so that mixed ringing with conversations and read 56 s against a
 *                    real 108 s per answered call.
 * Operator attribution follows OnlinePBX's own (see config/calls.js): inbound by
 * destination extension, so queue-missed calls belong to the queue, not a person.
 *
 * Rows must be fetched for [from, to+1 day] with an `in_range` flag so a call
 * missed on the last day can still see its next-day callback.
 */

const { teamOf, operatorNameRank, operatorDisplayName, MIN_CALLBACK_DIAL_S, MIN_CONVERSATION_S } = require('../config/calls');
const { scheduleOf, workSeconds, describeSchedules } = require('../config/workHours');

const RECALL_WINDOW_MS = 24 * 60 * 60 * 1000;

/** A call that ends "waiting for a callback": the operator called the number (answered or
 *  not — they did call; a dial must have rung, MIN_CALLBACK_DIAL_S), or the customer called again
 *  and got through. */
const isContact = (r) =>
  !!r.customer_norm && !r.internal && r.direction !== 'local'
  && (r.answered || (r.direction === 'outbound' && Number(r.duration || 0) >= MIN_CALLBACK_DIAL_S));
const pctOf = (part, whole) => (whole ? Math.round((part / whole) * 1000) / 10 : 0);
/** The middle value (the mean of the two middle ones for an even count) — every median on the page uses this. */
const median = (xs) => {
  if (!xs.length) return 0;
  const a = [...xs].sort((x, y) => x - y), m = a.length >> 1;
  return Math.round(a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2);
};
const sourceOf = (r) => (String(r.uuid || '').startsWith('moizvonki:') ? 'moizvonki' : 'onlinepbx');
const ms = (v) => {
  if (v == null) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.getTime();
};

/**
 * @param rows { responsible_id, full_name, direction, customer_norm,
 *               start_stamp, duration, talk, answered, in_range }[]
 * @param rows        … plus `internal` (extension-to-extension, see config/calls.js)
 * @param filterOpId  one id or an array of ids; when set, totals + rows are scoped
 *                    to those operators, but the callback map stays global (a
 *                    colleague's callback to the same customer still counts as reached).
 * @param bxMissed    Bitrix24 missed inbound calls { call_start, phone_norm, responsible_id }[]
 *                    already limited to the date range. An array (even empty) switches the
 *                    Propushenniy figures to them; null/undefined keeps the PBX's own missed
 *                    calls (used when the table is unavailable, or for the Moizvonki source).
 *                    responsible_id is a Bitrix user id, matched to the operator row with the
 *                    same id; an owner without a row (a non-call-centre manager, Data365)
 *                    lands on the "Call Centre — javobsiz" row.
 * @param opts        { detail: true } also returns `missed_detail` — every missed call, split
 *                    into those called back within 24h (`recalled_events`, with when) and
 *                    those that were NOT (`not_recalled`, with why). These are the lists
 *                    behind the "Propushenniy" and "Ne perezvonili" cards, so a list and its
 *                    card can never disagree. `now` (ms) pins the clock for the "24h not
 *                    over yet" test.
 *                    { teamByRid } team tag of every Bitrix user with a line (from pbx_users, so it
 *                    does not depend on which rows the filters left); { ownerNames } names of the
 *                    Bitrix owners of missed calls, so an owner with no calls in range still gets a row.
 *                    { source } 'onlinepbx' | 'moizvonki': only that system's calls are COUNTED, while
 *                    the callback map keeps both (a Moizvonki callback still reaches the customer).
 *                    { filter } the page's Holat / Qo'ng'iroq turi / Davomiylik filters:
 *                    { status, kind, durFrom, durTo } — see passRow / passMiss below.
 */
function computeCallStatsFull(rows, dateFrom, dateTo, filterOpId = null, bxMissed = null, opts = {}) {
  const useBx = Array.isArray(bxMissed);
  const only = filterOpId == null ? null : [].concat(filterOpId).map(Number);
  const keep = (r) => !only || only.length === 0 || only.includes(Number(r.responsible_id));
  const source = opts.source || null;
  const f = opts.filter || {};
  const status = f.status || null, kind = f.kind || null;
  const durFrom = Number.isFinite(f.durFrom) ? f.durFrom : null, durTo = Number.isFinite(f.durTo) ? f.durTo : null;
  const durOk = (d) => (durFrom == null || d >= durFrom) && (durTo == null || d <= durTo);
  // Contact times per number (see isContact), for callback detection.
  const contact = new Map();
  for (const r of rows) {
    if (!isContact(r)) continue;
    const t = ms(r.start_stamp);
    if (t == null) continue;
    if (!contact.has(r.customer_norm)) contact.set(r.customer_norm, []);
    contact.get(r.customer_norm).push(t);
  }
  // The client's rule (2026-11-10): a missed call is "Ne perezvonili" only if NOBODY touched that number —
  // no operator call to it (any length, any time after the miss) and no answered call from it, and none in
  // the 24h before the miss either (the customer had just been talked to). Late callbacks still count as
  // reached; Reaksiya vaqti shows how late they were.
  const firstContactAfter = (num, missMs) => {
    const c = (contact.get(num) || []).filter((t) => t > missMs);
    return c.length ? Math.min(...c) : null;
  };
  const lastContactBefore = (num, missMs) => {
    const c = (contact.get(num) || []).filter((t) => t < missMs && t >= missMs - RECALL_WINDOW_MS);
    return c.length ? Math.max(...c) : null;
  };
  const contactedWithin = (num, missMs) => firstContactAfter(num, missMs) != null || lastContactBefore(num, missMs) != null;

  // Missed inbound times per number — an operator's outbound call within 24h after one is a callback
  // (the "Callback" call type and the callback_calls column).
  const missTimes = new Map();
  const addMiss = (num, t) => { if (!num || t == null) return; if (!missTimes.has(num)) missTimes.set(num, []); missTimes.get(num).push(t); };
  // From the PBX records on both bases, so the card and the operator's call list (which can only read
  // pbx_calls) agree; misses before the period's first day are not looked at by either.
  for (const r of rows) if (r.in_range && r.direction === 'inbound' && !r.answered && !r.internal) addMiss(r.customer_norm, ms(r.start_stamp));
  const isCallback = (r) => {
    if (r.direction !== 'outbound' || !r.customer_norm) return false;
    if (!r.answered && Number(r.duration || 0) < MIN_CALLBACK_DIAL_S) return false;
    const t = ms(r.start_stamp);
    return t != null && (missTimes.get(r.customer_norm) || []).some((m) => m < t && t <= m + RECALL_WINDOW_MS);
  };

  // The page filters, per counted call. Holat: success = answered, failed = not answered, missed =
  // inbound not answered, ndz = outbound not answered, recalled / unrecalled = a missed inbound that
  // was / was not reached within 24h. Davomiylik is the whole call in seconds (ringing included —
  // the same number Bitrix's "Qo'ng'iroq davomiyligi" shows).
  const passRow = (r) => {
    if (source && sourceOf(r) !== source) return false;
    if (kind === 'inbound' && r.direction !== 'inbound') return false;
    if (kind === 'outbound' && r.direction !== 'outbound') return false;
    if (kind === 'callback' && !isCallback(r)) return false;
    if (!durOk(Number(r.duration || 0))) return false;
    if (!status) return true;
    const missedIn = r.direction === 'inbound' && !r.answered;
    switch (status) {
      case 'success': return !!r.answered;
      case 'failed': return !r.answered;
      case 'missed': return missedIn;
      case 'ndz': return r.direction === 'outbound' && !r.answered;
      case 'recalled': return missedIn && !!r.customer_norm && contactedWithin(r.customer_norm, ms(r.start_stamp));
      case 'unrecalled': return missedIn && !(r.customer_norm && contactedWithin(r.customer_norm, ms(r.start_stamp)));
      default: return true;
    }
  };
  // ...and per missed call (Propushenniy / Ne perezvonili / Reaksiya). A Bitrix event has no duration
  // of its own: it takes the one of the PBX record it matches (±2 min); none = left out under a
  // Davomiylik filter.
  const pbxMissByNum = new Map();
  for (const r of rows) {
    if (r.direction !== 'inbound' || r.answered || r.internal || !r.customer_norm) continue;
    if (!pbxMissByNum.has(r.customer_norm)) pbxMissByNum.set(r.customer_norm, []);
    pbxMissByNum.get(r.customer_norm).push(r);
  }
  const pbxMissOf = (num, at) => {
    let best = null, gap = 120_001;
    for (const r of pbxMissByNum.get(num) || []) { const g = Math.abs(ms(r.start_stamp) - at); if (g < gap) { gap = g; best = r; } }
    return best;
  };
  const pbxDurOf = (num, at) => { const r = pbxMissOf(num, at); return r ? Number(r.duration || 0) : null; };
  const passMiss = (ev) => {
    if (kind === 'outbound' || kind === 'callback') return false;
    if (status === 'success' || status === 'ndz') return false;
    if (durFrom != null || durTo != null) {
      const d = ev.dur != null ? ev.dur : pbxDurOf(ev.num, ev.at);
      if (d == null || !durOk(d)) return false;
    }
    if (status === 'recalled' || status === 'unrecalled') {
      const reached = !!ev.num && ev.at != null && contactedWithin(ev.num, ev.at);
      return status === 'recalled' ? reached : !reached;
    }
    return true;
  };

  // Team tag (TLC / TIS / TL) of each Bitrix user that has a PBX extension, from the extension's
  // name: it decides whose working hours a missed call is measured against.
  const teamByRid = new Map(opts.teamByRid || []);
  for (const r of rows) {
    if (r.responsible_id == null || !r.full_name) continue;
    const key = String(r.responsible_id);
    if (teamByRid.has(key)) continue;
    const team = teamOf(r.full_name);
    if (team) teamByRid.set(key, team);
  }

  const ops = new Map();
  // One row per Bitrix user, whichever of their lines the call was on (OnlinePBX extension,
  // Moizvonki account). A line linked to no Bitrix user keeps its own row, keyed by extension —
  // before, they all shared the "queue" row, which then took its name from whichever call
  // happened to come first. Only calls
  // that rang out with NO operator (and Bitrix owners without a row) share the queue row.
  // A Moizvonki account's name (typed in Sozlamalar or taken from Bitrix) never beats the PBX's own.
  const nameRank = (r) => (String(r.operator_ext || '').startsWith('mz:') ? Math.min(2, operatorNameRank(r.full_name)) : operatorNameRank(r.full_name));
  const getOp = (r) => {
    const key = r.responsible_id != null ? String(r.responsible_id)
      : r.operator_ext ? `ext:${r.operator_ext}` : 'queue';
    if (!ops.has(key)) {
      ops.set(key, {
        responsible_id: r.responsible_id != null ? Number(r.responsible_id) : null,
        // the line of an operator Bitrix does not know (a Moizvonki manager, "mz:3"): their call list is asked for by it
        operator_ext: r.responsible_id == null && r.operator_ext ? r.operator_ext : null,
        full_name: operatorDisplayName(r.full_name) || 'Call Centre — javobsiz', _nameRank: nameRank(r), photo_url: r.photo_url || null,
        inbound_calls: 0, outbound_calls: 0, callback_calls: 0,
        success_calls: 0, failed_calls: 0, ndz_calls: 0,
        missed_inbound: 0, missed_recalled: 0, missed_unrecalled: 0,
        talk_in: 0, talk_out: 0, dur_in: 0, dur_out: 0, conv_n: 0, conv_talk: 0,
        _in: new Set(), _out: new Set(), _all: new Set(), _missed: [],
      });
    }
    const op = ops.get(key);
    const rank = nameRank(r);
    if (rank > op._nameRank) { op.full_name = operatorDisplayName(r.full_name); op._nameRank = rank; }
    return op;
  };

  let inbound = 0, outbound = 0, internal = 0, ndz = 0, talkExt = 0, durExt = 0, callbacks = 0, convTalk = 0, successTotal = 0;
  // A missed call joins its owner's row as an inbound, unanswered call (+ its ringing time).
  const addMissed = (b, ev) => {
    b.missed_inbound += 1; b._missed.push(ev); missedEvents.push(ev);
    b.inbound_calls += 1; b.failed_calls += 1; inbound += 1;
    const d = ev.dur != null ? ev.dur : (ev.num && ev.at != null ? pbxDurOf(ev.num, ev.at) : null) || 0;
    b.dur_in += d; durExt += d;
    if (ev.num) { b._in.add(ev.num); b._all.add(ev.num); }
  };
  const answeredTalks = [];   // for the median next to avg_duration
  const missedEvents = [];

  for (const r of rows) {
    if (!r.in_range) continue;
    if (!keep(r)) continue;
    if (source && sourceOf(r) !== source) continue;
    if (r.direction === 'local' || r.internal) { internal += 1; continue; }
    if (r.direction !== 'inbound' && r.direction !== 'outbound') continue;
    if (!passRow(r)) continue;
    // An unanswered inbound is counted once, as a missed-call event below — on its OWNER's row (the lead's
    // responsible, as Bitrix does), together with its inbound count. Counting it here too, on the line
    // that rang (mostly the queue), made a person's "Javobsiz kiruvchi" bigger than their "Kiruvchi".
    if (r.direction === 'inbound' && !r.answered) continue;

    const dur = Number(r.duration || 0);
    const answered = !!r.answered;
    // Suhbat (total talk) is every connected second, as OnlinePBX sums it. O'rtacha davomiyligi and
    // its median use only real conversations (> MIN_CONVERSATION_S): a 3-second pick-up-and-hang-up
    // is answered, but not a conversation length.
    const talk = answered ? Number(r.talk || 0) : 0;
    const conv = talk > MIN_CONVERSATION_S;
    const b = getOp(r);
    talkExt += talk; durExt += dur;
    if (conv) { answeredTalks.push(talk); convTalk += talk; b.conv_n += 1; b.conv_talk += talk; }
    if (r.customer_norm) b._all.add(r.customer_norm);

    if (r.direction === 'inbound') {
      inbound += 1; b.inbound_calls += 1; b.talk_in += talk; b.dur_in += dur;
      if (r.customer_norm) b._in.add(r.customer_norm);
      b.success_calls += 1; successTotal += 1;          // only answered inbound reaches here
    } else {
      outbound += 1; b.outbound_calls += 1; b.talk_out += talk; b.dur_out += dur;
      if (r.customer_norm) b._out.add(r.customer_norm);
      if (answered) { b.success_calls += 1; successTotal += 1; }
      else { ndz += 1; b.ndz_calls += 1; b.failed_calls += 1; }
      if (isCallback(r)) { callbacks += 1; b.callback_calls += 1; }
    }
  }

  // The PBX's own missed calls (no Bitrix events: the Moizvonki source, ?basis=pbx, or the table
  // unavailable). Whose miss it is: opts.missOwner(row) → a Bitrix user id (the owner Bitrix
  // registered it to, else the newest lead's owner) — the same people the Bitrix-based card uses, so
  // an operator filter keeps them. Without it the miss stays on the line that took the call (a queue
  // call that rang out: the "Call Centre — javobsiz" row).
  if (!useBx) {
    for (const r of rows) {
      if (!r.in_range || r.internal || r.direction !== 'inbound' || r.answered) continue;
      if (source && sourceOf(r) !== source) continue;
      if (!passRow(r)) continue;
      const ownerRid = opts.missOwner ? opts.missOwner(r) : null;
      const rid = ownerRid != null && String(ownerRid) !== '1' ? String(ownerRid) : null;
      const ownerName = rid != null ? (opts.ownerNames && opts.ownerNames.get(rid)) || null : null;
      const b = rid != null ? (ops.get(rid) || (ownerName ? getOp({ responsible_id: rid, full_name: ownerName }) : getOp({ responsible_id: null })))
        : getOp(r);
      if (!keep({ responsible_id: b.responsible_id })) continue;
      const ev = {
        key: `pbx:${r.uuid}`, num: r.customer_norm, at: ms(r.start_stamp), phone: r.customer_number || null,
        rid: b.responsible_id, hint: 0, team: (rid != null && teamByRid.get(rid)) || teamOf(r.full_name), dur: Number(r.duration || 0),
      };
      if (!passMiss(ev)) continue;
      addMissed(b, ev);
    }
  }

  if (useBx) {
    for (const e of bxMissed) {
      const at = ms(e.call_start);
      if (at == null) continue;
      const rid = e.responsible_id != null ? String(e.responsible_id) : null;
      // The owner's own row — also for an owner with no calls in range (named from Bitrix), so
      // selecting them shows their missed calls. Only events with no owner (or the system
      // account, id 1) share the "Call Centre — javobsiz" row.
      const ownerName = rid != null && rid !== '1' ? (opts.ownerNames && opts.ownerNames.get(rid)) || e.owner_name || null : null;
      const b = (rid != null && ops.get(rid)) || (ownerName ? getOp({ responsible_id: rid, full_name: ownerName }) : getOp({ responsible_id: null }));
      if (!keep({ responsible_id: b.responsible_id })) continue;
      const ev = {
        key: `bx:${e.id}`, num: e.phone_norm, at, phone: e.phone || null,
        rid: e.responsible_id != null ? Number(e.responsible_id) : null,
        // the lead Bitrix itself linked the call to (0 = none: a contact, or nothing)
        hint: e.crm_entity_type === 'LEAD' ? Number(e.crm_entity_id) || 0 : 0,
        team: rid != null ? teamByRid.get(rid) || null : null,
      };
      if (!passMiss(ev)) continue;
      // Bitrix registers Moizvonki's missed calls too (line REST_APP:120): under a Manba filter an
      // event takes the system of the PBX record it matches (none = OnlinePBX, the main line).
      if (source) { const p = pbxMissOf(ev.num, at); if ((p ? sourceOf(p) : 'onlinepbx') !== source) continue; }
      addMissed(b, ev);
    }
  }

  let nePerezvonili = 0, recalledCount = 0;
  const reactions = [];
  const notRecalled = [];      // only filled when opts.detail
  const recalledEvents = [];   // ditto: the misses that WERE reached (after, or in the 24h before), with when
  const now = opts.now ?? Date.now();
  for (const ev of missedEvents) {
    if (!ev.num || ev.at == null) {
      nePerezvonili += 1;
      if (opts.detail) notRecalled.push({ ...ev, status: 'nophone', callback_at: null });
      continue;
    }
    const fc = firstContactAfter(ev.num, ev.at);
    if (fc) {
      // reached after the miss: within 24h ("recalled") or later ("late") — both are callbacks
      const work = workSeconds(ev.at, fc, scheduleOf(ev.team));   // working time only
      reactions.push(work); recalledCount += 1;
      if (opts.detail) recalledEvents.push({ ...ev, status: fc - ev.at <= RECALL_WINDOW_MS ? 'recalled' : 'late', callback_at: fc, work_delay_s: work });
      continue;
    }
    const before = lastContactBefore(ev.num, ev.at);
    if (before) {
      // touched in the 24h before the miss (an operator called, or the customer got through): not owed a
      // callback. Not a callback either, so it has no reaction time.
      recalledCount += 1;
      if (opts.detail) recalledEvents.push({ ...ev, status: 'before', callback_at: before, work_delay_s: null });
      continue;
    }
    nePerezvonili += 1;
    if (opts.detail) {
      // open: the 24h are not over, a callback may still come. never: nobody has touched this number.
      notRecalled.push({ ...ev, status: ev.at + RECALL_WINDOW_MS > now ? 'open' : 'never', callback_at: null, work_delay_s: null });
    }
  }

  const responsibles = [...ops.values()]
    .filter((b) => b.inbound_calls + b.outbound_calls + b.missed_inbound > 0)
    .map((b) => {
      for (const m of b._missed) {
        if (m.num && m.at != null && contactedWithin(m.num, m.at)) b.missed_recalled += 1;
        else b.missed_unrecalled += 1;
      }
      const total = b.inbound_calls + b.outbound_calls;
      const talkTotal = b.talk_in + b.talk_out;
      const out = {
        responsible_id: b.responsible_id, operator_ext: b.operator_ext, full_name: b.full_name, photo_url: b.photo_url,
        inbound_calls: b.inbound_calls, outbound_calls: b.outbound_calls, total_calls: total,
        callback_calls: b.callback_calls, success_calls: b.success_calls, failed_calls: b.failed_calls, ndz_calls: b.ndz_calls,
        missed_inbound: b.missed_inbound, missed_recalled: b.missed_recalled, missed_unrecalled: b.missed_unrecalled,
        unique_inbound: b._in.size, unique_outbound: b._out.size, unique_total: b._all.size,
        // Duration columns carry TALK time (разговоров) to match the OnlinePBX panel.
        inbound_duration: b.talk_in, outbound_duration: b.talk_out, total_duration: talkTotal,
        // Call length (длительность) kept separately for anyone who needs it.
        call_dur_in: b.dur_in, call_dur_out: b.dur_out, call_dur_total: b.dur_in + b.dur_out,
        avg_duration: b.conv_n ? Math.round(b.conv_talk / b.conv_n) : 0,   // per real conversation (> 10 s)
      };
      return out;
    })
    .sort((a, b) => b.total_calls - a.total_calls);

  const external = inbound + outbound;
  const success = successTotal;
  const missed = missedEvents.length;
  const result = {
    date_from: dateFrom || '', date_to: dateTo || '',
    total_calls: external,                      // Все, without internal calls
    external_calls: external,
    inbound_calls: inbound, outbound_calls: outbound, internal_calls: internal, callback_calls: callbacks,
    success_calls: success, failed_calls: missed + ndz, ndz_calls: ndz, missed_inbound: missedEvents.length,
    total_duration: talkExt,                    // разговоров (talk) — shown by the total card
    call_duration_total: durExt,                // длительность (call length)
    avg_duration: answeredTalks.length ? Math.round(convTalk / answeredTalks.length) : 0, // talk per real conversation (> 10 s)
    conversations: answeredTalks.length,        // answered calls with talk > 10 s (what the average is over)
    // the middle answered call: a few very long conversations pull the average up
    median_duration: median(answeredTalks),
    success_pct: pctOf(success, external), failed_pct: pctOf(missed + ndz, external),
    ne_perezvonili: nePerezvonili,
    work_hours: describeSchedules(),            // what reaksiya_vaqti was measured against
    reaksiya_vaqti: reactions.length ? Math.round(reactions.reduce((s, n) => s + n, 0) / reactions.length) : 0,
    // the card's headline: the middle callback (a few very late ones pull the average far up)
    reaksiya_median: median(reactions),
    responsibles,
  };
  if (opts.detail) result.missed_detail = { total: missedEvents.length, recalled: recalledCount, not_recalled: notRecalled, recalled_events: recalledEvents };
  return result;
}

module.exports = { computeCallStatsFull, isContact, median };

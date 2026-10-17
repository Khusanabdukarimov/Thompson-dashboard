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
 *   answered/success talk_time > 0 (a real conversation)
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
 *   Не перезвонили   a missed inbound with NO answered contact (either
 *                    direction) to that number within 24h — NOT just an outbound
 *                    callback; a customer who calls again and gets through counts
 *   Reaksiya vaqti   average wait for the callback among the misses called back within 24h,
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

const { teamOf } = require('../config/calls');
const { scheduleOf, workSeconds, describeSchedules } = require('../config/workHours');

const RECALL_WINDOW_MS = 24 * 60 * 60 * 1000;
const pctOf = (part, whole) => (whole ? Math.round((part / whole) * 1000) / 10 : 0);
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
 */
function computeCallStatsFull(rows, dateFrom, dateTo, filterOpId = null, bxMissed = null, opts = {}) {
  const useBx = Array.isArray(bxMissed);
  const only = filterOpId == null ? null : [].concat(filterOpId).map(Number);
  const keep = (r) => !only || only.length === 0 || only.includes(Number(r.responsible_id));
  // Answered-contact times per number (any direction), for callback detection.
  const contact = new Map();
  for (const r of rows) {
    if (!r.answered || !r.customer_norm || r.internal) continue;
    const t = ms(r.start_stamp);
    if (t == null) continue;
    if (!contact.has(r.customer_norm)) contact.set(r.customer_norm, []);
    contact.get(r.customer_norm).push(t);
  }
  const contactedWithin = (num, missMs) =>
    (contact.get(num) || []).some((t) => t > missMs && t <= missMs + RECALL_WINDOW_MS);
  const firstContactAfter = (num, missMs) => {
    const c = (contact.get(num) || []).filter((t) => t > missMs && t <= missMs + RECALL_WINDOW_MS);
    return c.length ? Math.min(...c) : null;
  };

  // Team tag (TLC / TIS / TL) of each Bitrix user that has a PBX extension, from the extension's
  // name: it decides whose working hours a missed call is measured against.
  const teamByRid = new Map();
  for (const r of rows) {
    if (r.responsible_id == null || !r.full_name) continue;
    const key = String(r.responsible_id);
    if (teamByRid.has(key)) continue;
    const team = teamOf(r.full_name);
    if (team) teamByRid.set(key, team);
  }

  const ops = new Map();
  // One row per Bitrix user. An operator the PBX knows but Bitrix does not (a Moizvonki
  // manager) keeps their own row, keyed by extension — before, they all shared the "queue"
  // row, which then took its name from whichever call happened to come first. Only calls
  // that rang out with NO operator (and Bitrix owners without a row) share the queue row.
  const getOp = (r) => {
    const key = r.responsible_id != null ? String(r.responsible_id)
      : r.operator_ext ? `ext:${r.operator_ext}` : 'queue';
    if (!ops.has(key)) {
      ops.set(key, {
        responsible_id: r.responsible_id != null ? Number(r.responsible_id) : null,
        full_name: r.full_name || 'Call Centre — javobsiz', photo_url: r.photo_url || null,
        inbound_calls: 0, outbound_calls: 0, callback_calls: 0,
        success_calls: 0, failed_calls: 0, ndz_calls: 0,
        missed_inbound: 0, missed_recalled: 0, missed_unrecalled: 0,
        talk_in: 0, talk_out: 0, dur_in: 0, dur_out: 0,
        _in: new Set(), _out: new Set(), _all: new Set(), _missed: [],
      });
    }
    return ops.get(key);
  };

  let inbound = 0, outbound = 0, internal = 0, missed = 0, ndz = 0, talkExt = 0, durExt = 0;
  const missedEvents = [];

  for (const r of rows) {
    if (!r.in_range) continue;
    if (!keep(r)) continue;
    if (r.direction === 'local' || r.internal) { internal += 1; continue; }
    if (r.direction !== 'inbound' && r.direction !== 'outbound') continue;

    const dur = Number(r.duration || 0);
    const talk = Number(r.talk || 0);
    const answered = !!r.answered;
    const b = getOp(r);
    talkExt += talk; durExt += dur;
    if (r.customer_norm) b._all.add(r.customer_norm);

    if (r.direction === 'inbound') {
      inbound += 1; b.inbound_calls += 1; b.talk_in += talk; b.dur_in += dur;
      if (r.customer_norm) b._in.add(r.customer_norm);
      if (answered) b.success_calls += 1;
      else {
        missed += 1; b.failed_calls += 1;
        if (!useBx) {
          b.missed_inbound += 1;
          const ev = { key: `pbx:${r.uuid}`, num: r.customer_norm, at: ms(r.start_stamp), phone: r.customer_number || null, rid: null, hint: 0, team: teamOf(r.full_name) };
          b._missed.push(ev); missedEvents.push(ev);
        }
      }
    } else {
      outbound += 1; b.outbound_calls += 1; b.talk_out += talk; b.dur_out += dur;
      if (r.customer_norm) b._out.add(r.customer_norm);
      if (answered) b.success_calls += 1;
      else { ndz += 1; b.ndz_calls += 1; b.failed_calls += 1; }
    }
  }

  if (useBx) {
    for (const e of bxMissed) {
      const at = ms(e.call_start);
      if (at == null) continue;
      const rid = e.responsible_id != null ? String(e.responsible_id) : null;
      // Rows exist only for people with PBX calls in range; anyone else is nobody's row.
      const b = (rid != null && ops.get(rid)) || getOp({ responsible_id: null });
      if (!keep({ responsible_id: b.responsible_id })) continue;
      const ev = {
        key: `bx:${e.id}`, num: e.phone_norm, at, phone: e.phone || null,
        rid: e.responsible_id != null ? Number(e.responsible_id) : null,
        // the lead Bitrix itself linked the call to (0 = none: a contact, or nothing)
        hint: e.crm_entity_type === 'LEAD' ? Number(e.crm_entity_id) || 0 : 0,
        team: rid != null ? teamByRid.get(rid) || null : null,
      };
      b.missed_inbound += 1; b._missed.push(ev); missedEvents.push(ev);
    }
  }

  let nePerezvonili = 0, recalledCount = 0;
  const reactions = [];
  const notRecalled = [];      // only filled when opts.detail
  const recalledEvents = [];   // ditto: the misses that WERE called back within 24h, with when
  const now = opts.now ?? Date.now();
  for (const ev of missedEvents) {
    if (!ev.num || ev.at == null) {
      nePerezvonili += 1;
      if (opts.detail) notRecalled.push({ ...ev, status: 'nophone', callback_at: null });
      continue;
    }
    const fc = firstContactAfter(ev.num, ev.at);
    if (fc) {
      const work = workSeconds(ev.at, fc, scheduleOf(ev.team));   // working time only
      reactions.push(work); recalledCount += 1;
      if (opts.detail) recalledEvents.push({ ...ev, status: 'recalled', callback_at: fc, work_delay_s: work });
      continue;
    }
    nePerezvonili += 1;
    if (opts.detail) {
      // open: the 24h are not over, a callback may still come. late: reached, but after
      // the 24h. never: nobody has talked to this number since.
      let status = 'never', callbackAt = null;
      if (ev.at + RECALL_WINDOW_MS > now) status = 'open';
      else {
        const later = (contact.get(ev.num) || []).filter((t) => t > ev.at);
        if (later.length) { status = 'late'; callbackAt = Math.min(...later); }
      }
      notRecalled.push({ ...ev, status, callback_at: callbackAt, work_delay_s: callbackAt ? workSeconds(ev.at, callbackAt, scheduleOf(ev.team)) : null });
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
        responsible_id: b.responsible_id, full_name: b.full_name, photo_url: b.photo_url,
        inbound_calls: b.inbound_calls, outbound_calls: b.outbound_calls, total_calls: total,
        callback_calls: 0, success_calls: b.success_calls, failed_calls: b.failed_calls, ndz_calls: b.ndz_calls,
        missed_inbound: b.missed_inbound, missed_recalled: b.missed_recalled, missed_unrecalled: b.missed_unrecalled,
        unique_inbound: b._in.size, unique_outbound: b._out.size, unique_total: b._all.size,
        // Duration columns carry TALK time (разговоров) to match the OnlinePBX panel.
        inbound_duration: b.talk_in, outbound_duration: b.talk_out, total_duration: talkTotal,
        // Call length (длительность) kept separately for anyone who needs it.
        call_dur_in: b.dur_in, call_dur_out: b.dur_out, call_dur_total: b.dur_in + b.dur_out,
        avg_duration: b.success_calls ? Math.round(talkTotal / b.success_calls) : 0,
      };
      return out;
    })
    .sort((a, b) => b.total_calls - a.total_calls);

  const external = inbound + outbound;
  const success = external - missed - ndz;
  const result = {
    date_from: dateFrom || '', date_to: dateTo || '',
    total_calls: external,                      // Все, without internal calls
    external_calls: external,
    inbound_calls: inbound, outbound_calls: outbound, internal_calls: internal, callback_calls: 0,
    success_calls: success, failed_calls: missed + ndz, ndz_calls: ndz, missed_inbound: missedEvents.length,
    total_duration: talkExt,                    // разговоров (talk) — shown by the total card
    call_duration_total: durExt,                // длительность (call length)
    avg_duration: success ? Math.round(talkExt / success) : 0, // talk per answered call
    success_pct: pctOf(success, external), failed_pct: pctOf(missed + ndz, external),
    ne_perezvonili: nePerezvonili,
    work_hours: describeSchedules(),            // what reaksiya_vaqti was measured against
    reaksiya_vaqti: reactions.length ? Math.round(reactions.reduce((s, n) => s + n, 0) / reactions.length) : 0,
    responsibles,
  };
  if (opts.detail) result.missed_detail = { total: missedEvents.length, recalled: recalledCount, not_recalled: notRecalled, recalled_events: recalledEvents };
  return result;
}

module.exports = { computeCallStatsFull };

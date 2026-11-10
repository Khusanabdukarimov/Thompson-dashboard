/**
 * OnlinePBX call model — semantics derived from the live pbx37068 CDR feed.
 *
 * A record from mongo_history/search.json looks like:
 *   { uuid, caller_id_name, caller_id_number, destination_number,
 *     start_stamp, end_stamp, duration, user_talk_time, hangup_cause,
 *     accountcode: 'inbound'|'outbound'|'local', contacted?, gateway,
 *     quality_score, events: [{type:'transfer'|'user', number, ...}] }
 *
 * These helpers turn that into the fields the dashboard reports on. They are
 * pure functions of one record so they can be unit-tested without a PBX.
 */

/** accountcode is the direction of the call. */
const DIRECTIONS = ['inbound', 'outbound', 'local'];

/**
 * "Answered" = a connection happened: user_talk_time > 0 — the same rule Bitrix24 uses (its call log
 * code 200, "Разговор согласен" in the Qo'ng'iroq tab), so answered / missed / Ne perezvonili match
 * Bitrix call for call. Client's decision of 2026-11-10 (replacing the "talk > 10 s" rule of
 * 2026-11-02, which made the dashboard ~30 answered calls a day lower than Bitrix).
 * hangup_cause NORMAL_CLEARING and a "user" ring event both include calls that rang an extension
 * but were never picked up, so talk time is the only field that means a connection.
 */
const MIN_TALK_S = 0;

/**
 * A REAL conversation, for the duration figures only (O'rtacha davomiyligi, its median): a connection
 * of up to this many seconds is the customer picking up and hanging up, or a voicemail / network
 * message — counted as answered, shown as "Qisqa ulanish", but it would pull the average talk down.
 */
const MIN_CONVERSATION_S = 10;

/**
 * An operator's outbound call counts as touching the customer (answered or not, any length — the client's
 * rule of 2026-11-10: "if a person was contacted at least once, it is not Ne perezvonili").
 * Kept as a constant so a minimum ring time can be brought back in one place.
 */
const MIN_CALLBACK_DIAL_S = 0;

function isAnswered(rec) {
  return (rec.user_talk_time || 0) > MIN_TALK_S;
}

/**
 * A missed inbound: the customer called and no agent talked to them. These are
 * the call-backs owed — the number worth surfacing on the dashboard.
 */
function isMissedInbound(rec) {
  return rec.accountcode === 'inbound' && !isAnswered(rec);
}

/**
 * The extension the call belongs to, matching how OnlinePBX itself attributes
 * calls when you filter its call log by extension (verified against the live
 * panel for 2026-07-09):
 *
 *   outbound / local → the extension that dialed (caller_id_number)
 *   inbound          → destination_number when it is an extension. OnlinePBX
 *                      rewrites destination_number to the ANSWERING extension
 *                      even for calls that arrived through a queue, so this
 *                      covers answered queue calls too. A missed queue call
 *                      keeps the queue number (e.g. 5200) as its destination and
 *                      therefore belongs to nobody — it is the queue's, not a
 *                      person's. Only a missed call dialled DIRECTLY to an
 *                      extension is attributed to that extension.
 *
 * The answered-user fallback covers the rare answered call whose destination
 * stayed a queue number.
 *
 * `knownExts` is the set of real extension numbers; a destination that isn't one
 * (a queue, an IVR) yields null. Pass it from pbx_users so the rule needs no
 * hardcoded extension list.
 */
function operatorExt(rec, knownExts) {
  const isExt = (n) => (knownExts ? knownExts.has(String(n)) : /^\d{2,4}$/.test(String(n || '')));

  if (rec.accountcode === 'outbound' || rec.accountcode === 'local') {
    return isExt(rec.caller_id_number) ? String(rec.caller_id_number) : null;
  }
  // inbound
  if (isExt(rec.destination_number)) return String(rec.destination_number);
  // whoever picked up owns the call, even for a connection too short to count as answered
  if ((rec.user_talk_time || 0) > 0) {
    const userEvents = (rec.events || []).filter((e) => e.type === 'user' && e.number);
    if (userEvents.length) return String(userEvents[userEvents.length - 1].number);
  }
  return null; // queue-missed → belongs to the queue, not an operator
}

/**
 * The external party's phone number (the customer), independent of direction:
 *   outbound → who we called (destination_number)
 *   inbound  → who called us (caller_id_number)
 */
function customerNumber(rec) {
  if (rec.accountcode === 'outbound') return rec.destination_number || null;
  if (rec.accountcode === 'inbound') return rec.caller_id_number || null;
  return null; // local call — both parties internal
}

/**
 * Last N digits of a phone, for matching against lead phones stored in another
 * format (+998 90 123 45 67 vs 901234567). 9 covers Uzbek/Kazakh subscriber
 * numbers without the country code.
 */
function normalizePhone(num) {
  if (!num) return null;
  const digits = String(num).replace(/\D/g, '');
  if (digits.length < 7) return null;
  return digits.slice(-9);
}

/**
 * The team tag a PBX extension carries in its name: "Hosiyat | TLC", "Laylo l TLC"
 * (a mistyped separator), "Vakant | TLC ga" → "TLC". Last tag wins; null when the
 * name has none (IH Uzb, HR 205, Schoolify 1, ...). The call page groups its operator
 * picker by this.
 */
const TEAM_TAGS = /\b(TLC|TIS|TL)\b/gi;
function teamOf(name) {
  const found = [...String(name || '').matchAll(TEAM_TAGS)];
  return found.length ? found[found.length - 1][1].toUpperCase() : null;
}

/** hangup_cause values that mean the far end never answered (for reporting). */
const NO_ANSWER_CAUSES = new Set([
  'ORIGINATOR_CANCEL', 'NO_ANSWER', 'NO_USER_RESPONSE', 'USER_BUSY',
  'SUBSCRIBER_ABSENT', 'RECOVERY_ON_TIMER_EXPIRE',
]);

// One employee can own several lines (an OnlinePBX extension and a Moizvonki account), which share
// one row. Its name comes from the best line: a real PBX name, else the Moizvonki account's (without
// the tag), and a line still called "Vakant" only when there is nothing better.
const MOIZVONKI_TAG = ' · Moizvonki';
function operatorNameRank(name) {
  const n = String(name || '').trim();
  if (!n) return 0;
  if (/^(vakant|вакант)/i.test(n)) return 1;
  return n.endsWith(MOIZVONKI_TAG) ? 2 : 3;
}
const operatorDisplayName = (name) => String(name || '').replace(MOIZVONKI_TAG, '').trim();

module.exports = {
  DIRECTIONS,
  MOIZVONKI_TAG,
  operatorNameRank,
  operatorDisplayName,
  NO_ANSWER_CAUSES,
  MIN_TALK_S,
  MIN_CONVERSATION_S,
  MIN_CALLBACK_DIAL_S,
  isAnswered,
  isMissedInbound,
  operatorExt,
  customerNumber,
  normalizePhone,
  teamOf,
};

"""
GET /api/calls/stats?date_from=YYYY-MM-DD&date_to=YYYY-MM-DD

Fetches call data directly from Bitrix24 voximplant.statistic.get,
computes per-responsible and global stats, returns a single JSON object.
"""

from __future__ import annotations

import asyncio
import logging
import os
import re
from collections import defaultdict
from datetime import date, datetime, timedelta
from typing import Any, Optional

import httpx
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, field_validator

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/calls", tags=["calls"])

# ── CALL_TYPE constants (voximplant.statistic.get) ────────────────────────────
_OUTBOUND        = 1   # Chiquvchi
_INBOUND         = 2   # Kiruvchi
_INBOUND_REDIR   = 3   # Kiruvchi (redirect)
_CALLBACK        = 4   # Qayta qo'ng'iroq

_INBOUND_TYPES  = {_INBOUND, _INBOUND_REDIR}
_OUTBOUND_TYPES = {_OUTBOUND}
_SUCCESS_CODES  = {"0", "200"}
_MISSED_CODE    = "304"
_RECALL_WINDOW  = timedelta(hours=24)


# ── Credentials ───────────────────────────────────────────────────────────────
def _creds() -> tuple[str, str, str]:
    """
    Return (portal, user_id, webhook) from existing backend env vars:
      BITRIX24_PORTAL = "https://mountain.bitrix24.kz"
      BITRIX24_TOKEN  = "/rest/1/emohw3e3imd1egnr/"
    """
    portal_raw = os.environ.get("BITRIX24_PORTAL", "").rstrip("/")
    token_raw  = os.environ.get("BITRIX24_TOKEN",  "").strip("/")
    if not portal_raw or not token_raw:
        raise RuntimeError("BITRIX24_PORTAL or BITRIX24_TOKEN env var is missing")
    # portal_raw = "https://mountain.bitrix24.kz" → strip scheme
    portal = portal_raw.split("://")[-1]   # "mountain.bitrix24.kz"
    # token_raw = "rest/1/emohw3e3imd1egnr"
    parts = token_raw.split("/")           # ["rest", "1", "emohw3e3imd1egnr"]
    if len(parts) < 3:
        raise RuntimeError(f"BITRIX24_TOKEN format invalid: {token_raw!r}")
    user_id = parts[1]
    webhook = parts[2]
    return portal, user_id, webhook


# ── Bitrix24 HTTP client ───────────────────────────────────────────────────────
_PAGE_DELAY = 0.5
_MAX_TRIES  = 6


async def _post(client: httpx.AsyncClient, url: str, body: dict) -> dict:
    delay = _PAGE_DELAY
    last: Exception = RuntimeError("no attempts")
    for attempt in range(1, _MAX_TRIES + 1):
        try:
            r = await client.post(url, json=body, timeout=30.0)
            if r.status_code == 429:
                await asyncio.sleep(delay)
                delay = min(delay * 2, 30.0)
                continue
            r.raise_for_status()
            data = r.json()
            if "error" in data:
                raise ValueError(f"Bitrix24: {data['error']} — {data.get('error_description', '')}")
            return data
        except (httpx.TimeoutException, httpx.ConnectError) as e:
            last = e
            if attempt == _MAX_TRIES:
                break
            await asyncio.sleep(delay)
            delay = min(delay * 2, 30.0)
        except httpx.HTTPStatusError as e:
            if e.response.status_code < 500:
                raise
            last = e
            if attempt == _MAX_TRIES:
                break
            await asyncio.sleep(delay)
            delay = min(delay * 2, 30.0)
    raise last


async def _paginate(
    client: httpx.AsyncClient,
    url: str,
    first_body: dict[str, Any],
    make_body: "Callable[[int], dict[str, Any]]",
) -> list[dict[str, Any]]:
    """Generic paginator: fetches all pages using `start` offset."""
    all_records: list[dict] = []
    data = await _post(client, url, first_body)
    page: list[dict] = data.get("result") or []
    all_records.extend(page)
    total    = int(data.get("total") or 0)
    next_val = data.get("next")
    while next_val and len(all_records) < total:
        await asyncio.sleep(_PAGE_DELAY)
        data = await _post(client, url, make_body(int(next_val)))
        page = data.get("result") or []
        all_records.extend(page)
        next_val = data.get("next")
    return all_records


def _normalise_voximplant(records: list[dict]) -> list[dict]:
    """voximplant.statistic.get → canonical record dict."""
    out = []
    for r in records:
        out.append({
            "PORTAL_USER_ID":  r.get("PORTAL_USER_ID"),
            "PORTAL_USER":     r.get("PORTAL_USER"),
            "PHONE_NUMBER":    r.get("PHONE_NUMBER"),
            "CALL_CATEGORY":   r.get("CALL_CATEGORY"),
            # voximplant: CALL_TYPE 1=outbound, 2=inbound, 3=inbound_redir, 4=callback
            "CALL_TYPE":       r.get("CALL_TYPE"),
            "CALL_DURATION":   r.get("CALL_DURATION"),
            "CALL_START_TIME": r.get("CALL_START_DATE") or r.get("CALL_START_TIME"),
            "CALL_FAILED_CODE":r.get("CALL_FAILED_CODE"),
            "CALL_FAILED_REASON": r.get("CALL_FAILED_REASON"),
            "CALL_STATUS_CODE":r.get("CALL_STATUS_CODE"),
        })
    return out


def _normalise_activity(records: list[dict]) -> list[dict]:
    """
    crm.activity.list (TYPE_ID=2) → canonical record dict.

    crm.activity DIRECTION:  1 = inbound (Kiruvchi),  2 = outbound (Chiquvchi)
    voximplant   CALL_TYPE:  2 = inbound (Kiruvchi),  1 = outbound (Chiquvchi)
    → swap 1↔2 so the rest of the pipeline is uniform.
    """
    import re
    _phone_re = re.compile(r"[\d]{6,}")

    out = []
    for r in records:
        direction = _to_int(r.get("DIRECTION"))
        # Remap crm.activity direction → voximplant CALL_TYPE convention
        call_type = {1: 2, 2: 1}.get(direction)  # swap so 1=outbound, 2=inbound

        # Duration from START_TIME / END_TIME
        start_ms = _to_dt(r.get("START_TIME"))
        end_ms   = _to_dt(r.get("END_TIME"))
        duration = 0
        if start_ms and end_ms and end_ms > start_ms:
            duration = int((end_ms - start_ms).total_seconds())

        # Phone from subject e.g. "Исходящий на 998901234567"
        subj = r.get("SUBJECT") or ""
        m = _phone_re.search(subj)
        phone = m.group(0) if m else None

        # Status: COMPLETED='Y' → success (same meaning as Bitrix CALL_FAILED_CODE=200)
        failed_code = "200" if r.get("COMPLETED") == "Y" else None

        out.append({
            "PORTAL_USER_ID":   r.get("RESPONSIBLE_ID"),
            "PORTAL_USER":      None,
            "PHONE_NUMBER":     phone,
            "CALL_CATEGORY":    None,
            "CALL_TYPE":        call_type,
            "CALL_DURATION":    duration,
            "CALL_START_TIME":  r.get("START_TIME"),
            "CALL_FAILED_CODE": failed_code,
            "CALL_STATUS_CODE": 200 if failed_code == 0 else None,
        })
    return out


async def _fetch_active_users() -> list[dict[str, Any]]:
    """Fetch all active responsibles from the local Node.js dashboard service."""
    try:
        async with httpx.AsyncClient() as client:
            r = await client.get(
                "http://localhost:3001/api/dashboard/responsibles-list",
                timeout=5.0,
            )
            r.raise_for_status()
            # Returns [{id, full_name}, ...]
            return [{"ID": row["id"], "NAME": row.get("full_name", "")} for row in r.json()]
    except Exception as e:
        log.warning("responsibles-list fetch failed, skipping active-user merge: %s", e)
        return []


async def _fetch_all(date_from: str, date_to: str) -> list[dict[str, Any]]:
    portal, user_id, webhook = _creds()
    base = f"https://{portal}/rest/{user_id}/{webhook}"

    async with httpx.AsyncClient() as client:
        # ── Try voximplant.statistic.get ─────────────────────────────────────
        voxi_url = f"{base}/voximplant.statistic.get"
        voxi_filter = {
            ">=CALL_START_DATE": f"{date_from}T00:00:00",
            "<=CALL_START_DATE": f"{date_to}T23:59:59",
        }
        use_voxi = True
        try:
            test = await _post(client, voxi_url, {
                "FILTER": voxi_filter, "start": 0,
            })
            if isinstance(test.get("error"), str) and (
                "scope" in test["error"].lower() or
                "access" in test["error"].lower()
            ):
                use_voxi = False
                log.info("voximplant scope missing, falling back to crm.activity.list")
        except httpx.HTTPStatusError as e:
            if e.response.status_code in (401, 403):
                use_voxi = False
                log.info("voximplant 401/403, falling back to crm.activity.list")
            else:
                raise

        if use_voxi:
            records = await _paginate(
                client, voxi_url,
                {"FILTER": voxi_filter, "SORT": "CALL_START_DATE", "ORDER": "DESC", "start": 0},
                lambda s: {"FILTER": voxi_filter, "SORT": "CALL_START_DATE", "ORDER": "DESC", "start": s},
            )
            log.info("voximplant: fetched %d records", len(records))
            return _normalise_voximplant(records)

        # ── Fallback: crm.activity.list (TYPE_ID=2) ───────────────────────────
        act_url    = f"{base}/crm.activity.list"
        act_filter = {
            "TYPE_ID":       2,
            ">=START_TIME":  date_from,
            "<=START_TIME":  date_to,
        }
        try:
            records = await _paginate(
                client, act_url,
                {"FILTER": act_filter,
                 "SELECT": ["ID","RESPONSIBLE_ID","DIRECTION","COMPLETED",
                            "START_TIME","END_TIME","SUBJECT"],
                 "start": 0},
                lambda s: {"FILTER": act_filter,
                           "SELECT": ["ID","RESPONSIBLE_ID","DIRECTION","COMPLETED",
                                      "START_TIME","END_TIME","SUBJECT"],
                           "start": s},
            )
        except httpx.HTTPStatusError as e:
            if e.response.status_code in (401, 403):
                log.warning("crm.activity.list 401/403 — webhook scope missing; returning empty records")
                return []
            raise
        log.info("crm.activity fallback: fetched %d records", len(records))
        return _normalise_activity(records)


# ── Domain helpers ────────────────────────────────────────────────────────────

def _to_int(v: Any) -> Optional[int]:
    if v is None or v == "":
        return None
    try:
        return int(v)
    except (ValueError, TypeError):
        return None


def _to_code(v: Any) -> Optional[str]:
    if v is None or v == "":
        return None
    return str(v).strip().upper()


def _to_dt(v: Any) -> Optional[datetime]:
    if not v:
        return None
    try:
        return datetime.fromisoformat(str(v).replace("Z", "+00:00"))
    except ValueError:
        return None


def _phone_key(phone: Optional[str]) -> Optional[str]:
    if not phone:
        return None
    digits = re.sub(r"\D+", "", phone)
    if not digits:
        return None
    return digits[-9:] if len(digits) >= 9 else digits


class _Call:
    __slots__ = (
        "user_id", "user_name", "phone", "category", "call_type",
        "duration", "start_time", "failed_code", "status_code",
    )

    def __init__(self, r: dict) -> None:
        self.user_id    = r.get("PORTAL_USER_ID") or None
        self.user_name  = r.get("PORTAL_USER") or "Noma'lum"
        self.phone      = r.get("PHONE_NUMBER") or None
        self.category   = str(r.get("CALL_CATEGORY") or "").lower()
        self.call_type  = _to_int(r.get("CALL_TYPE"))
        self.duration   = _to_int(r.get("CALL_DURATION")) or 0
        self.start_time = _to_dt(r.get("CALL_START_TIME"))
        self.failed_code = _to_code(r.get("CALL_FAILED_CODE"))
        self.status_code = _to_int(r.get("CALL_STATUS_CODE"))

    @property
    def is_inbound(self) -> bool:
        return self.call_type in _INBOUND_TYPES

    @property
    def is_outbound(self) -> bool:
        return self.call_type in _OUTBOUND_TYPES

    @property
    def is_callback_type(self) -> bool:
        return self.call_type == _CALLBACK

    @property
    def is_internal(self) -> bool:
        return self.category == "internal"

    @property
    def is_success(self) -> bool:
        if self.failed_code is not None:
            return self.failed_code in _SUCCESS_CODES
        return (self.status_code == 200) or (self.duration >= 10)

    @property
    def is_missed(self) -> bool:
        if not self.is_inbound:
            return False
        if self.failed_code is not None:
            return self.failed_code == _MISSED_CODE
        return not self.is_success and self.duration < 10

    @property
    def is_ndz(self) -> bool:
        return self.is_outbound and not self.is_success


# ── Output models ─────────────────────────────────────────────────────────────

class ResponsibleCallStats(BaseModel):
    responsible_id:   Optional[int] = None
    full_name:        str
    photo_url:        Optional[str] = None   # always null (no DB access here)

    total_calls:      int = 0
    inbound_calls:    int = 0
    outbound_calls:   int = 0
    callback_calls:   int = 0

    success_calls:    int = 0
    failed_calls:     int = 0
    ndz_calls:        int = 0
    missed_inbound:   int = 0
    missed_recalled:   int = 0
    missed_unrecalled: int = 0

    total_duration:   int = 0
    avg_duration:     int = 0
    inbound_duration: int = 0
    outbound_duration:int = 0

    unique_inbound:   int = 0
    unique_outbound:  int = 0
    unique_total:     int = 0


class CallStatsResult(BaseModel):
    date_from: str
    date_to:   str

    total_calls:    int
    inbound_calls:  int
    outbound_calls: int
    callback_calls: int

    success_calls:  int
    failed_calls:   int
    ndz_calls:      int
    missed_inbound: int

    total_duration: int
    avg_duration:   int

    success_pct: float
    failed_pct:  float

    ne_perezvonili: int   # missed inbound with no outbound callback within 24h
    reaksiya_vaqti: int   # avg seconds from missed to first callback

    responsibles: list[ResponsibleCallStats]


# ── Stats computation ─────────────────────────────────────────────────────────

def _compute(
    records: list[dict],
    date_from: str,
    date_to: str,
    lookup_records: Optional[list[dict]] = None,
    active_users: Optional[list[dict]] = None,
) -> CallStatsResult:
    calls = [_Call(r) for r in records]
    lookup_calls = [_Call(r) for r in (lookup_records or records)]

    total = inbound = outbound = callback_t = ndz = missed = 0
    total_dur = 0

    Bucket = dict[str, Any]
    buckets: dict[str, Bucket] = defaultdict(lambda: {
        "uid": None, "name": "Noma'lum",
        "total": 0, "in": 0, "out": 0, "cb": 0,
        "ndz": 0, "miss": 0,
        "dur": 0, "in_dur": 0, "out_dur": 0,
        "in_phones": set(), "out_phones": set(), "all_phones": set(),
        "missed_events": [],
    })

    # For ne_perezvonili / reaksiya_vaqti:
    # missed_map[phone] = [missed_datetime, ...]
    # outbound_map[phone] = [outbound_datetime, ...]
    missed_map:   dict[str, list[datetime]] = defaultdict(list)
    outbound_map: dict[str, list[datetime]] = defaultdict(list)
    no_phone_missed = 0

    for c in calls:
        if c.is_internal:
            continue

        if c.is_callback_type:
            callback_t += 1
            uid = c.user_id or "unknown"
            b = buckets[uid]
            if c.user_id:
                b["uid"] = int(c.user_id)
            if c.user_name:
                b["name"] = c.user_name
            b["cb"] += 1

        if not (c.is_inbound or c.is_outbound):
            continue

        dur = c.duration
        total     += 1
        total_dur += dur

        if c.is_inbound:       inbound   += 1
        elif c.is_outbound:    outbound  += 1

        if c.is_ndz:     ndz    += 1
        if c.is_missed:  missed += 1

        # ne_perezvonili tracking
        phone_key = _phone_key(c.phone)
        if c.is_missed:
            if phone_key and c.start_time:
                missed_map[phone_key].append(c.start_time)
            else:
                no_phone_missed += 1

        # Per-responsible
        uid = c.user_id or "unknown"
        b   = buckets[uid]
        if c.user_id:  b["uid"]  = int(c.user_id)
        if c.user_name: b["name"] = c.user_name

        b["total"] += 1
        b["dur"]   += dur

        if c.is_inbound:
            b["in"]     += 1
            b["in_dur"] += dur
            if c.phone: b["in_phones"].add(c.phone)
        elif c.is_outbound:
            b["out"]     += 1
            b["out_dur"] += dur
            if c.phone: b["out_phones"].add(c.phone)

        if c.phone: b["all_phones"].add(c.phone)

        if c.is_ndz:    b["ndz"]  += 1
        if c.is_missed:
            b["miss"] += 1
            b["missed_events"].append((phone_key, c.start_time))

    for c in lookup_calls:
        if c.is_internal:
            continue

        phone_key = _phone_key(c.phone)
        if phone_key and c.start_time:
            if c.is_missed:
                continue
            if c.is_outbound:
                outbound_map[phone_key].append(c.start_time)

    # ── ne_perezvonili / reaksiya_vaqti ──────────────────────────────────────
    ne_perezv = no_phone_missed
    resp_times: list[float] = []

    for phone, missed_times in missed_map.items():
        out_times = sorted(outbound_map.get(phone, []))
        for mt in missed_times:
            window = mt + _RECALL_WINDOW
            callback_dt = next(
                (ot for ot in out_times if mt < ot <= window), None
            )
            if callback_dt:
                resp_times.append((callback_dt - mt).total_seconds())
            else:
                ne_perezv += 1

    reaksiya = round(sum(resp_times) / len(resp_times)) if resp_times else 0

    # ── build per-responsible list ────────────────────────────────────────────
    responsibles: list[ResponsibleCallStats] = []
    seen_uids: set[int] = set()
    for b in sorted(buckets.values(), key=lambda x: -x["total"]):
        t = b["total"]
        if not t:
            continue
        b_failed = b["ndz"] + b["miss"]
        missed_recalled = 0
        missed_unrecalled = 0
        for phone_key, missed_at in b["missed_events"]:
            if not phone_key or not missed_at:
                missed_unrecalled += 1
                continue
            window = missed_at + _RECALL_WINDOW
            out_times = sorted(outbound_map.get(phone_key, []))
            callback_dt = next(
                (ot for ot in out_times if missed_at < ot <= window), None
            )
            if callback_dt:
                missed_recalled += 1
            else:
                missed_unrecalled += 1

        responsibles.append(ResponsibleCallStats(
            responsible_id    = b["uid"],
            full_name         = b["name"],
            total_calls       = t,
            inbound_calls     = b["in"],
            outbound_calls    = b["out"],
            callback_calls    = b["cb"],
            success_calls     = max(t - b_failed, 0),
            failed_calls      = b_failed,
            ndz_calls         = b["ndz"],
            missed_inbound    = b["miss"],
            missed_recalled   = missed_recalled,
            missed_unrecalled = missed_unrecalled,
            total_duration    = b["dur"],
            avg_duration      = round(b["dur"] / t) if t else 0,
            inbound_duration  = b["in_dur"],
            outbound_duration = b["out_dur"],
            unique_inbound    = len(b["in_phones"]),
            unique_outbound   = len(b["out_phones"]),
            unique_total      = len(b["all_phones"]),
        ))
        if b["uid"]:
            seen_uids.add(b["uid"])

    # Append zero-stat rows for active users who had no calls in the period
    if active_users:
        for u in active_users:
            uid = _to_int(u.get("ID"))
            if not uid or uid in seen_uids:
                continue
            # NAME field holds the full_name string from the local DB mapping
            name = (u.get("NAME") or "").strip() or "Noma'lum"
            responsibles.append(ResponsibleCallStats(
                responsible_id = uid,
                full_name      = name,
            ))

    def pct(p: int, w: int) -> float:
        return round(p / w * 100, 1) if w else 0.0

    failed = ndz + missed
    success = max(total - failed, 0)

    return CallStatsResult(
        date_from      = date_from,
        date_to        = date_to,
        total_calls    = total,
        inbound_calls  = inbound,
        outbound_calls = outbound,
        callback_calls = callback_t,
        success_calls  = success,
        failed_calls   = failed,
        ndz_calls      = ndz,
        missed_inbound = missed,
        total_duration = total_dur,
        avg_duration   = round(total_dur / total) if total else 0,
        success_pct    = pct(success, total),
        failed_pct     = pct(failed,  total),
        ne_perezvonili = ne_perezv,
        reaksiya_vaqti = reaksiya,
        responsibles   = responsibles,
    )


# ── Endpoint ──────────────────────────────────────────────────────────────────

@router.get("/stats", response_model=CallStatsResult)
async def call_stats(
    date_from: str = Query(..., description="Boshlanish sanasi: YYYY-MM-DD"),
    date_to:   str = Query(..., description="Tugash sanasi:     YYYY-MM-DD"),
) -> CallStatsResult:
    try:
        d_from = date.fromisoformat(date_from)
        d_to   = date.fromisoformat(date_to)
    except ValueError:
        raise HTTPException(400, "Sana formati noto'g'ri, YYYY-MM-DD kerak")

    if d_from > d_to:
        raise HTTPException(400, "date_from > date_to")

    lookup_to = d_to + timedelta(days=1)
    try:
        records = await _fetch_all(str(d_from), str(d_to))
        lookup_records = (
            await _fetch_all(str(d_from), str(lookup_to))
            if lookup_to != d_to
            else records
        )
    except RuntimeError as e:
        raise HTTPException(500, str(e))
    except ValueError as e:
        raise HTTPException(502, str(e))

    active_users = await _fetch_active_users()
    return _compute(records, str(d_from), str(d_to), lookup_records, active_users)

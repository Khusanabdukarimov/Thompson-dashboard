"""
GET /api/calls/stats?date_from=YYYY-MM-DD&date_to=YYYY-MM-DD

Fetches call data directly from Bitrix24 voximplant.statistic.get,
computes per-responsible and global stats, returns a single JSON object.
"""

from __future__ import annotations

import asyncio
import logging
import os
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
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


async def _fetch_all(date_from: str, date_to: str) -> list[dict[str, Any]]:
    portal, user_id, webhook = _creds()
    url = f"https://{portal}/rest/{user_id}/{webhook}/voximplant.statistic.get"
    all_records: list[dict] = []
    start = 0
    async with httpx.AsyncClient() as client:
        while True:
            data = await _post(client, url, {
                "FILTER": {
                    ">=CALL_START_DATE": f"{date_from}T00:00:00",
                    "<=CALL_START_DATE": f"{date_to}T23:59:59",
                },
                "SORT": "CALL_START_DATE", "ORDER": "DESC",
                "start": start,
            })
            page: list[dict] = data.get("result") or []
            all_records.extend(page)
            total    = int(data.get("total") or 0)
            next_val = data.get("next")
            log.debug("calls fetch: %d/%d (start=%d)", len(all_records), total, start)
            if not next_val or len(all_records) >= total:
                break
            start = int(next_val)
            await asyncio.sleep(_PAGE_DELAY)
    log.info("Fetched %d call records [%s – %s]", len(all_records), date_from, date_to)
    return all_records


# ── Domain helpers ────────────────────────────────────────────────────────────

def _to_int(v: Any) -> Optional[int]:
    if v is None or v == "":
        return None
    try:
        return int(v)
    except (ValueError, TypeError):
        return None


def _to_dt(v: Any) -> Optional[datetime]:
    if not v:
        return None
    try:
        return datetime.fromisoformat(str(v).replace("Z", "+00:00"))
    except ValueError:
        return None


class _Call:
    __slots__ = (
        "user_id", "user_name", "phone", "call_type",
        "duration", "start_time", "failed_code", "status_code",
    )

    def __init__(self, r: dict) -> None:
        self.user_id    = r.get("PORTAL_USER_ID") or None
        self.user_name  = r.get("PORTAL_USER") or "Noma'lum"
        self.phone      = r.get("PHONE_NUMBER") or None
        self.call_type  = _to_int(r.get("CALL_TYPE"))
        self.duration   = _to_int(r.get("CALL_DURATION")) or 0
        self.start_time = _to_dt(r.get("CALL_START_TIME"))
        self.failed_code = _to_int(r.get("CALL_FAILED_CODE"))
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
    def is_success(self) -> bool:
        if self.failed_code is not None:
            return self.failed_code == 0
        return (self.status_code == 200) or (self.duration >= 10)

    @property
    def is_missed(self) -> bool:
        return self.is_inbound and not self.is_success and self.duration < 10


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
    missed_inbound:   int = 0

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
    missed_inbound: int

    total_duration: int
    avg_duration:   int

    success_pct: float
    failed_pct:  float

    ne_perezvonili: int   # missed inbound with no outbound callback within 72h
    reaksiya_vaqti: int   # avg seconds from missed to first callback

    responsibles: list[ResponsibleCallStats]


# ── Stats computation ─────────────────────────────────────────────────────────

def _compute(records: list[dict], date_from: str, date_to: str) -> CallStatsResult:
    calls = [_Call(r) for r in records]

    total = inbound = outbound = callback_t = success = failed = missed = 0
    total_dur = 0

    Bucket = dict[str, Any]
    buckets: dict[str, Bucket] = defaultdict(lambda: {
        "uid": None, "name": "Noma'lum",
        "total": 0, "in": 0, "out": 0, "cb": 0,
        "succ": 0, "fail": 0, "miss": 0,
        "dur": 0, "in_dur": 0, "out_dur": 0,
        "in_phones": set(), "out_phones": set(), "all_phones": set(),
    })

    # For ne_perezvonili / reaksiya_vaqti:
    # missed_map[phone] = [missed_datetime, ...]
    # outbound_map[phone] = [outbound_datetime, ...]
    missed_map:   dict[str, list[datetime]] = defaultdict(list)
    outbound_map: dict[str, list[datetime]] = defaultdict(list)

    for c in calls:
        dur = c.duration
        total     += 1
        total_dur += dur

        if c.is_inbound:       inbound   += 1
        elif c.is_outbound:    outbound  += 1
        elif c.is_callback_type: callback_t += 1

        if c.is_success: success += 1
        else:            failed  += 1
        if c.is_missed:  missed  += 1

        # ne_perezvonili tracking
        if c.phone and c.start_time:
            if c.is_missed:
                missed_map[c.phone].append(c.start_time)
            elif c.is_outbound:
                outbound_map[c.phone].append(c.start_time)

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
        elif c.is_callback_type:
            b["cb"] += 1

        if c.phone: b["all_phones"].add(c.phone)

        if c.is_success: b["succ"] += 1
        else:            b["fail"] += 1
        if c.is_missed:  b["miss"] += 1

    # ── ne_perezvonili / reaksiya_vaqti ──────────────────────────────────────
    ne_perezv = 0
    resp_times: list[float] = []
    _72h = timedelta(hours=72)

    for phone, missed_times in missed_map.items():
        out_times = sorted(outbound_map.get(phone, []))
        for mt in missed_times:
            window = mt + _72h
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
    for b in sorted(buckets.values(), key=lambda x: -x["total"]):
        t = b["total"]
        responsibles.append(ResponsibleCallStats(
            responsible_id    = b["uid"],
            full_name         = b["name"],
            total_calls       = t,
            inbound_calls     = b["in"],
            outbound_calls    = b["out"],
            callback_calls    = b["cb"],
            success_calls     = b["succ"],
            failed_calls      = b["fail"],
            missed_inbound    = b["miss"],
            total_duration    = b["dur"],
            avg_duration      = round(b["dur"] / t) if t else 0,
            inbound_duration  = b["in_dur"],
            outbound_duration = b["out_dur"],
            unique_inbound    = len(b["in_phones"]),
            unique_outbound   = len(b["out_phones"]),
            unique_total      = len(b["all_phones"]),
        ))

    def pct(p: int, w: int) -> float:
        return round(p / w * 100, 1) if w else 0.0

    return CallStatsResult(
        date_from      = date_from,
        date_to        = date_to,
        total_calls    = total,
        inbound_calls  = inbound,
        outbound_calls = outbound,
        callback_calls = callback_t,
        success_calls  = success,
        failed_calls   = failed,
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

    try:
        records = await _fetch_all(str(d_from), str(d_to))
    except RuntimeError as e:
        raise HTTPException(500, str(e))
    except ValueError as e:
        raise HTTPException(502, str(e))

    return _compute(records, str(d_from), str(d_to))

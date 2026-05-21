"""Pure business logic: compute StatsResult from raw voximplant records."""

from __future__ import annotations

from collections import defaultdict
from typing import Any

from .models import CallRecord, ResponsibleStats, StatsResult


def _pct(part: int, whole: int) -> float:
    return round(part / whole * 100, 1) if whole else 0.0


def compute_stats(
    records: list[dict[str, Any]],
    date_from: str,
    date_to: str,
) -> StatsResult:
    """
    Aggregate raw voximplant records into dashboard-ready StatsResult.

    Call type mapping (voximplant.statistic.get):
        1 = Outbound  (Chiquvchi)
        2 = Inbound   (Kiruvchi)
        3 = Inbound redirect (also treated as inbound)
        4 = Callback  (Qayta qo'ng'iroq)
    """
    calls = [CallRecord(**r) for r in records]

    # ── global counters ───────────────────────────────────────────────────────
    total = inbound = outbound = callback = success = failed = missed = total_dur = 0

    # ── per-responsible accumulators ─────────────────────────────────────────
    # key = PORTAL_USER_ID (str) or "unknown"
    buckets: dict[str, dict[str, Any]] = defaultdict(lambda: {
        "responsible_id": None,
        "full_name":       "Noma'lum",
        "total":    0, "inbound": 0, "outbound": 0, "callback": 0,
        "success":  0, "failed":  0, "missed":   0, "duration": 0,
        "in_phones":  set(),
        "out_phones": set(),
    })

    for c in calls:
        dur = c.duration
        total     += 1
        total_dur += dur

        if c.is_inbound:
            inbound  += 1
        elif c.is_outbound:
            outbound += 1
        elif c.is_callback:
            callback += 1

        if c.is_success:
            success += 1
        else:
            failed  += 1

        if c.is_missed:
            missed += 1

        # ── bucket update ─────────────────────────────────────────────────
        uid = c.PORTAL_USER_ID or "unknown"
        b = buckets[uid]

        if c.PORTAL_USER_ID:
            b["responsible_id"] = int(c.PORTAL_USER_ID)
        if c.PORTAL_USER:
            b["full_name"] = c.PORTAL_USER

        b["total"]    += 1
        b["duration"] += dur

        if c.is_inbound:
            b["inbound"] += 1
            if c.PHONE_NUMBER:
                b["in_phones"].add(c.PHONE_NUMBER)
        elif c.is_outbound:
            b["outbound"] += 1
            if c.PHONE_NUMBER:
                b["out_phones"].add(c.PHONE_NUMBER)
        elif c.is_callback:
            b["callback"] += 1

        if c.is_success:
            b["success"] += 1
        else:
            b["failed"]  += 1

        if c.is_missed:
            b["missed"] += 1

    # ── build ResponsibleStats list (sorted by total desc) ───────────────────
    responsibles: list[ResponsibleStats] = []
    for b in sorted(buckets.values(), key=lambda x: -x["total"]):
        t = b["total"]
        responsibles.append(
            ResponsibleStats(
                responsible_id  = b["responsible_id"],
                full_name       = b["full_name"],
                total_calls     = t,
                inbound_calls   = b["inbound"],
                outbound_calls  = b["outbound"],
                callback_calls  = b["callback"],
                success_calls   = b["success"],
                failed_calls    = b["failed"],
                missed_inbound  = b["missed"],
                total_duration  = b["duration"],
                avg_duration    = round(b["duration"] / t) if t else 0,
                unique_inbound  = len(b["in_phones"]),
                unique_outbound = len(b["out_phones"]),
            )
        )

    return StatsResult(
        date_from      = date_from,
        date_to        = date_to,
        total_calls    = total,
        inbound_calls  = inbound,
        outbound_calls = outbound,
        callback_calls = callback,
        success_calls  = success,
        failed_calls   = failed,
        missed_inbound = missed,
        total_duration = total_dur,
        avg_duration   = round(total_dur / total) if total else 0,
        success_pct    = _pct(success, total),
        failed_pct     = _pct(failed,  total),
        responsibles   = responsibles,
    )


async def get_call_stats(
    date_from: str,
    date_to: str,
    *,
    portal: str,
    user_id: str,
    webhook: str,
) -> StatsResult:
    """
    Public entry point: fetch from Bitrix24 and return computed StatsResult.

    Parameters
    ----------
    date_from : str   e.g. "2026-05-01"
    date_to   : str   e.g. "2026-05-21"
    portal    : str   e.g. "yourcompany.bitrix24.kz"
    user_id   : str   Bitrix24 user ID for the webhook
    webhook   : str   Webhook secret token
    """
    from .client import fetch_all_calls  # local import avoids circular deps

    records = await fetch_all_calls(
        portal    = portal,
        user_id   = user_id,
        webhook   = webhook,
        date_from = date_from,
        date_to   = date_to,
    )
    return compute_stats(records, date_from, date_to)

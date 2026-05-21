"""FastAPI app: GET /stats?date_from=YYYY-MM-DD&date_to=YYYY-MM-DD"""

from __future__ import annotations

import logging
import os
from datetime import date

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Query

from .models import StatsResult
from .stats import get_call_stats

load_dotenv()

logging.basicConfig(level=logging.INFO, format="%(levelname)s  %(name)s  %(message)s")

# ── config (fail fast if missing) ─────────────────────────────────────────────
_PORTAL  = os.environ["BITRIX_PORTAL"]    # e.g. "yourcompany.bitrix24.kz"
_USER_ID = os.environ["BITRIX_USER_ID"]   # e.g. "1"
_WEBHOOK = os.environ["BITRIX_WEBHOOK"]   # e.g. "abc123xyz"

# ── app ───────────────────────────────────────────────────────────────────────
app = FastAPI(
    title       = "Call Statistics API",
    description = "Bitrix24 voximplant.statistic.get → dashboard stats",
    version     = "1.0.0",
)


def _parse_date(value: str, name: str) -> date:
    try:
        return date.fromisoformat(value)
    except ValueError:
        raise HTTPException(
            status_code = 400,
            detail      = f"{name} formati noto'g'ri. YYYY-MM-DD formatida kiriting. Qabul qilindi: {value!r}",
        )


@app.get("/stats", response_model=StatsResult, summary="Qo'ng'iroq statistikasini qaytaradi")
async def stats(
    date_from: str = Query(..., description="Boshlanish sanasi: YYYY-MM-DD"),
    date_to:   str = Query(..., description="Tugash sanasi:     YYYY-MM-DD"),
) -> StatsResult:
    """
    Berilgan sana oralig'i uchun Bitrix24 qo'ng'iroq statistikasini qaytaradi.

    - **date_from**: boshlanish sanasi (YYYY-MM-DD)
    - **date_to**:   tugash sanasi     (YYYY-MM-DD)
    """
    d_from = _parse_date(date_from, "date_from")
    d_to   = _parse_date(date_to,   "date_to")

    if d_from > d_to:
        raise HTTPException(
            status_code = 400,
            detail      = "date_from date_to dan katta bo'lishi mumkin emas.",
        )

    return await get_call_stats(
        date_from = str(d_from),
        date_to   = str(d_to),
        portal    = _PORTAL,
        user_id   = _USER_ID,
        webhook   = _WEBHOOK,
    )

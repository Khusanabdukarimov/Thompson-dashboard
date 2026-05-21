from __future__ import annotations

from typing import Optional
from pydantic import BaseModel, field_validator


# ── CALL_TYPE constants (voximplant.statistic.get) ────────────────────────────
CALL_TYPE_OUTBOUND        = 1  # Chiquvchi (Исходящий)
CALL_TYPE_INBOUND         = 2  # Kiruvchi  (Входящий)
CALL_TYPE_INBOUND_REDIR   = 3  # Kiruvchi, redirect (Входящий, переадресация)
CALL_TYPE_CALLBACK        = 4  # Qayta qo'ng'iroq (Обратный звонок)

INBOUND_TYPES  = {CALL_TYPE_INBOUND, CALL_TYPE_INBOUND_REDIR}
OUTBOUND_TYPES = {CALL_TYPE_OUTBOUND}


class CallRecord(BaseModel):
    """Single raw record from voximplant.statistic.get."""

    CALL_ID:              str
    PORTAL_USER_ID:       Optional[str] = None
    PORTAL_USER:          Optional[str] = None
    PHONE_NUMBER:         Optional[str] = None
    CALL_TYPE:            Optional[int] = None
    CALL_DURATION:        Optional[int] = None
    CALL_START_TIME:      Optional[str] = None
    CALL_STATUS_CODE:     Optional[int] = None
    CALL_STATUS_CODE_NAME: Optional[str] = None
    CALL_FAILED_CODE:     Optional[int] = None
    CALL_FAILED_REASON:   Optional[str] = None
    CRM_ENTITY_ID:        Optional[str] = None
    CRM_ENTITY_TYPE:      Optional[str] = None

    @field_validator("CALL_DURATION", "CALL_STATUS_CODE", "CALL_FAILED_CODE",
                     "CALL_TYPE", mode="before")
    @classmethod
    def coerce_int(cls, v: object) -> Optional[int]:
        if v is None or v == "":
            return None
        try:
            return int(v)
        except (ValueError, TypeError):
            return None

    # ── derived properties ────────────────────────────────────────────────────

    @property
    def duration(self) -> int:
        return self.CALL_DURATION or 0

    @property
    def is_inbound(self) -> bool:
        return self.CALL_TYPE in INBOUND_TYPES

    @property
    def is_outbound(self) -> bool:
        return self.CALL_TYPE in OUTBOUND_TYPES

    @property
    def is_callback(self) -> bool:
        return self.CALL_TYPE == CALL_TYPE_CALLBACK

    @property
    def is_success(self) -> bool:
        """Connected = CALL_FAILED_CODE is 0, or duration >= 10 s as fallback."""
        if self.CALL_FAILED_CODE is not None:
            return self.CALL_FAILED_CODE == 0
        # Fallback when CALL_FAILED_CODE is absent
        return (self.CALL_STATUS_CODE == 200) or (self.duration >= 10)

    @property
    def is_missed(self) -> bool:
        """Inbound call that was not answered (short + failed)."""
        return self.is_inbound and not self.is_success and self.duration < 10


# ── Output models ─────────────────────────────────────────────────────────────

class ResponsibleStats(BaseModel):
    responsible_id:  Optional[int] = None
    full_name:       str

    total_calls:     int = 0
    inbound_calls:   int = 0
    outbound_calls:  int = 0
    callback_calls:  int = 0

    success_calls:   int = 0
    failed_calls:    int = 0
    missed_inbound:  int = 0

    total_duration:  int = 0   # seconds
    avg_duration:    int = 0   # seconds

    unique_inbound:  int = 0   # distinct inbound phone numbers
    unique_outbound: int = 0   # distinct outbound phone numbers


class StatsResult(BaseModel):
    date_from: str
    date_to:   str

    # Totals
    total_calls:    int
    inbound_calls:  int
    outbound_calls: int
    callback_calls: int

    success_calls:  int
    failed_calls:   int
    missed_inbound: int

    total_duration: int    # seconds
    avg_duration:   int    # seconds

    success_pct: float     # 0–100
    failed_pct:  float     # 0–100

    responsibles: list[ResponsibleStats]

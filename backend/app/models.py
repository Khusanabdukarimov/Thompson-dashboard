"""SQLModel tables for payroll system.

Source-of-truth split:
- Bitrix24 (`/api/users`) — employee identity (name, email, ID)
- This DB (employees_extra)  — payroll attributes (fix base, role, KPI rule, schedule)

Joined via `bitrix_user_id` foreign key to Bitrix.
"""
from datetime import datetime, date
from typing import Optional, List, Any
from sqlmodel import SQLModel, Field, Column
from sqlalchemy import JSON


# ────────────────────────────────────────────────────────────────────
# employees_extra — payroll metadata for each Bitrix user
# ────────────────────────────────────────────────────────────────────
class EmployeeExtra(SQLModel, table=True):
    __tablename__ = "employees_extra"

    bitrix_user_id: int = Field(primary_key=True)
    role: str = Field(default="closer")  # closer | hunter | assistant
    status: str = Field(default="active")  # active | leave | terminated
    fix_base_uzs: int = Field(default=0)  # monthly fix salary in UZS
    attendance_weekly_uzs: int = Field(default=0)  # weekly attendance component
    report_weekly_uzs: int = Field(default=0)  # weekly daily-report component
    schedule_start: str = Field(default="09:00")  # HH:MM
    schedule_end: str = Field(default="18:00")
    kpi_rule_id: Optional[int] = Field(default=None, foreign_key="kpi_rules.id")
    notes: Optional[str] = Field(default=None)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


# ────────────────────────────────────────────────────────────────────
# kpi_rules — tiered commission rules (single-tier mode by default)
# ────────────────────────────────────────────────────────────────────
class KpiRule(SQLModel, table=True):
    __tablename__ = "kpi_rules"

    id: Optional[int] = Field(default=None, primary_key=True)
    name: str
    role: str = Field(default="closer")
    entity: str = Field(default="deals")  # deals | leads
    period: str = Field(default="monthly")  # monthly | weekly
    currency: str = Field(default="USD")
    mode: str = Field(default="single_tier")  # single_tier (whole revenue × pct of matching tier)

    # tiers: List[{from: number, to: number|null, percent: number}]
    # "to: null" means open-ended upper bound
    tiers: List[Any] = Field(default_factory=list, sa_column=Column(JSON))

    is_active: bool = Field(default=True)
    created_at: datetime = Field(default_factory=datetime.utcnow)


# ────────────────────────────────────────────────────────────────────
# bonus_rules — what bonuses can be earned and how
# ────────────────────────────────────────────────────────────────────
class BonusRule(SQLModel, table=True):
    __tablename__ = "bonus_rules"

    id: Optional[int] = Field(default=None, primary_key=True)
    name: str
    trigger_text: str = Field(default="")  # human-readable trigger
    period: str = Field(default="monthly")  # monthly | weekly | quarterly
    target_role: str = Field(default="closer")
    rule_type: str = Field(default="auto")  # auto | manual

    # Either percent (of revenue) or fixed amount in USD
    value_kind: str = Field(default="percent")  # percent | fixed_usd
    value: float = Field(default=0.0)

    is_active: bool = Field(default=True)
    created_at: datetime = Field(default_factory=datetime.utcnow)


# ────────────────────────────────────────────────────────────────────
# bonus_awards — bonuses given to specific employees in a period
# ────────────────────────────────────────────────────────────────────
class BonusAward(SQLModel, table=True):
    __tablename__ = "bonus_awards"

    id: Optional[int] = Field(default=None, primary_key=True)
    bitrix_user_id: int = Field(index=True)
    rule_id: Optional[int] = Field(default=None, foreign_key="bonus_rules.id")
    rule_name: str = Field(default="")  # snapshot of rule name
    period_label: str  # e.g. "2026-04" or "2026-W17"
    amount_usd: float = Field(default=0.0)
    note: Optional[str] = Field(default=None)
    awarded_at: datetime = Field(default_factory=datetime.utcnow)


# ────────────────────────────────────────────────────────────────────
# monthly_targets — sales target per month with weekly distribution
# ────────────────────────────────────────────────────────────────────
class MonthlyTarget(SQLModel, table=True):
    __tablename__ = "monthly_targets"

    id: Optional[int] = Field(default=None, primary_key=True)
    year: int = Field(index=True)
    month: int = Field(index=True)  # 1..12
    target_usd: float = Field(default=0.0)
    # weekly_breakdown: [w1_usd, w2_usd, w3_usd, w4_usd, w5_usd?]
    weekly_breakdown: List[Any] = Field(default_factory=list, sa_column=Column(JSON))
    updated_at: datetime = Field(default_factory=datetime.utcnow)


# ────────────────────────────────────────────────────────────────────
# attendance_log — optional cache for daily attendance snapshots
# ────────────────────────────────────────────────────────────────────
class AttendanceLog(SQLModel, table=True):
    """Snapshot of daily attendance for an employee.

    Live status comes from Bitrix `timeman.status` realtime — this table
    persists the daily summary (start/end time, lateness flag) so we can
    compute monthly stats and penalties without re-querying Bitrix history.
    """
    __tablename__ = "attendance_log"

    id: Optional[int] = Field(default=None, primary_key=True)
    bitrix_user_id: int = Field(index=True)
    day: date = Field(index=True)
    start_time: Optional[str] = None  # HH:MM
    end_time: Optional[str] = None
    bucket: str = Field(default="absent")  # on-time | late-soft | late | penalty | absent
    note: Optional[str] = None

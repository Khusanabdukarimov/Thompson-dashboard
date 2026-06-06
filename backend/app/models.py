"""SQLModel tables for payroll system.

Source-of-truth split:
- Bitrix24 (`/api/users`) — employee identity (name, email, ID)
- This DB (employees_extra)  — payroll attributes (fix base, role, KPI rule, schedule)

Joined via `bitrix_user_id` foreign key to Bitrix.
"""
from datetime import date, datetime
from typing import Any, List, Optional

from sqlalchemy import JSON
from sqlmodel import Column, Field, SQLModel


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
    # Dashboard credentials
    login: Optional[str] = Field(default=None)
    password_hash: Optional[str] = Field(default=None)
    dashboard_role: str = Field(default="")  # "" | admin | owner | closer | marketolog | hunter
    avatar_url: Optional[str] = Field(default=None)  # e.g. /avatars/42.jpg


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


# ────────────────────────────────────────────────────────────────────
# report_log — daily report submission tracking (manual entry for now)
# ────────────────────────────────────────────────────────────────────
class ReportLog(SQLModel, table=True):
    """Daily report submission tracking per employee.

    `bucket` mirrors v2 design's discipline categories:
    - on-time     ≤ 19:00
    - late-soft   19:01–19:05
    - late        19:06–19:10
    - penalty     19:11–19:30 (⚡jarima)
    - missed      did not submit
    """
    __tablename__ = "report_log"

    id: Optional[int] = Field(default=None, primary_key=True)
    bitrix_user_id: int = Field(index=True)
    day: date = Field(index=True)
    submitted_at: Optional[str] = None  # HH:MM
    bucket: str = Field(default="missed")  # on-time | late-soft | late | penalty | missed
    note: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)


# ────────────────────────────────────────────────────────────────────
# penalty_config — configurable penalty rules (per bucket → amount UZS)
# ────────────────────────────────────────────────────────────────────
class PenaltyConfig(SQLModel, table=True):
    """Penalty rate per discipline bucket. Single row keyed by ID=1.

    Used by /api/payroll/calculate to compute deductions from
    attendance_log + report_log.
    """
    __tablename__ = "penalty_config"

    id: Optional[int] = Field(default=1, primary_key=True)
    # Per-incident penalty rates in UZS (so'm)
    attendance_late_soft_uzs: int = Field(default=0)
    attendance_late_uzs: int = Field(default=0)
    attendance_penalty_uzs: int = Field(default=0)
    attendance_absent_uzs: int = Field(default=0)
    report_late_soft_uzs: int = Field(default=0)
    report_late_uzs: int = Field(default=0)
    report_penalty_uzs: int = Field(default=0)
    report_missed_uzs: int = Field(default=0)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


# ────────────────────────────────────────────────────────────────────
# tariflar — service pricing tiers (dizayn | neyming)
# ────────────────────────────────────────────────────────────────────
class Tarif(SQLModel, table=True):
    __tablename__ = "tariflar"

    id: Optional[int] = Field(default=None, primary_key=True)
    service_type: str  # "dizayn" | "neyming"
    name: str  # "Light" | "Air" | "Marine" | "Premier" | "Premier (mahalliy)"
    loyiha_summasi: int = Field(default=0)  # UZS
    variant_klass: str = Field(default="")  # e.g. "3+3 / 1 klass"
    harf_oralighi: str = Field(default="")  # e.g. "6-8 harf"
    tekshiruvlar: int = Field(default=0)
    deadline_mijoz: str = Field(default="")  # e.g. "700k + 800k"
    hudud: str = Field(default="Mahalliy")  # "Mahalliy" | "Xalqaro"
    jami_summa: int = Field(default=0)  # UZS
    sort_order: int = Field(default=0)
    is_active: bool = Field(default=True)
    created_at: datetime = Field(default_factory=datetime.utcnow)


# ────────────────────────────────────────────────────────────────────
# payroll_approvals — finalized/approved monthly payroll per employee
# ────────────────────────────────────────────────────────────────────
# ────────────────────────────────────────────────────────────────────
# kunlik_plans — monthly plan targets per section/metric
# ────────────────────────────────────────────────────────────────────
class KunlikPlan(SQLModel, table=True):
    __tablename__ = "kunlik_plans"

    id: Optional[int] = Field(default=None, primary_key=True)
    section: str = Field(index=True)        # "target" | "instagram"
    metric_key: str = Field(index=True)     # e.g. "byudjet", "lidlar_soni"
    month: str = Field(index=True)          # "january" … "december"
    year: int = Field(index=True)
    value: float = Field(default=0.0)


# ────────────────────────────────────────────────────────────────────
# kunlik_overrides — daily cell overrides per section/metric/day
# ────────────────────────────────────────────────────────────────────
class KunlikOverride(SQLModel, table=True):
    __tablename__ = "kunlik_overrides"

    id: Optional[int] = Field(default=None, primary_key=True)
    section: str = Field(index=True)
    metric_key: str = Field(index=True)
    month: str = Field(index=True)
    year: int = Field(index=True)
    day: int                                # 1-31
    value: Optional[float] = Field(default=None)


# ────────────────────────────────────────────────────────────────────
# payroll_approvals — finalized/approved monthly payroll per employee
# ────────────────────────────────────────────────────────────────────
class PayrollApproval(SQLModel, table=True):
    __tablename__ = "payroll_approvals"

    id: Optional[int] = Field(default=None, primary_key=True)
    bitrix_user_id: int = Field(index=True)
    year: int = Field(index=True)
    month: int = Field(index=True)
    employee_name: str = Field(default="")
    fix_base_uzs: int = Field(default=0)
    attendance_bonus_uzs: int = Field(default=0)
    kpi_payout_usd: float = Field(default=0.0)
    bonus_total_usd: float = Field(default=0.0)
    penalty_uzs: int = Field(default=0)
    total_uzs: int = Field(default=0)
    total_usd: float = Field(default=0.0)
    note: Optional[str] = Field(default=None)
    approved_by: Optional[str] = Field(default=None)
    status: str = Field(default="approved")  # approved | paid | cancelled
    approved_at: datetime = Field(default_factory=datetime.utcnow)

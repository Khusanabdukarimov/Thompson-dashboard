"""Payroll routes — employee enrichment, KPI/Bonus rules, monthly targets, calculation."""
from datetime import datetime
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import Session, select

from app.db import get_session
from app.models import (
    EmployeeExtra, KpiRule, BonusRule, BonusAward, MonthlyTarget,
)
from app.services import bitrix


router = APIRouter(prefix="/api/payroll", tags=["payroll"])


def _session() -> Session:
    s = get_session()
    try:
        yield s
    finally:
        s.close()


# ────────────────────────────────────────────────────────────────────
# Employees — Bitrix users joined with EmployeeExtra
# ────────────────────────────────────────────────────────────────────
class EmployeeOut(BaseModel):
    id: int
    name: str
    email: Optional[str] = None
    work_position: Optional[str] = None
    bitrix_active: bool = True
    # extras
    role: str = "closer"
    status: str = "active"
    fix_base_uzs: int = 0
    attendance_weekly_uzs: int = 0
    report_weekly_uzs: int = 0
    schedule_start: str = "09:00"
    schedule_end: str = "18:00"
    kpi_rule_id: Optional[int] = None
    notes: Optional[str] = None
    has_extras: bool = False


@router.get("/employees")
def list_employees(s: Session = Depends(_session)) -> dict:
    """Return Bitrix users merged with payroll extras."""
    bitrix_users = bitrix.list_users()
    extras = {e.bitrix_user_id: e for e in s.exec(select(EmployeeExtra)).all()}

    out: list[EmployeeOut] = []
    for u in bitrix_users:
        try:
            uid = int(u.get("ID", 0))
        except Exception:
            continue
        if uid <= 0:
            continue
        name = f"{u.get('NAME','') or ''} {u.get('LAST_NAME','') or ''}".strip() or f"User {uid}"
        ex = extras.get(uid)
        out.append(EmployeeOut(
            id=uid,
            name=name,
            email=u.get("EMAIL") or None,
            work_position=u.get("WORK_POSITION") or None,
            bitrix_active=bool(u.get("ACTIVE", True)),
            role=ex.role if ex else "closer",
            status=ex.status if ex else "active",
            fix_base_uzs=ex.fix_base_uzs if ex else 0,
            attendance_weekly_uzs=ex.attendance_weekly_uzs if ex else 0,
            report_weekly_uzs=ex.report_weekly_uzs if ex else 0,
            schedule_start=ex.schedule_start if ex else "09:00",
            schedule_end=ex.schedule_end if ex else "18:00",
            kpi_rule_id=ex.kpi_rule_id if ex else None,
            notes=ex.notes if ex else None,
            has_extras=ex is not None,
        ))
    out.sort(key=lambda e: (not e.bitrix_active, e.name.lower()))
    return {"count": len(out), "employees": [e.model_dump() for e in out]}


class EmployeeExtraIn(BaseModel):
    role: Optional[str] = None
    status: Optional[str] = None
    fix_base_uzs: Optional[int] = None
    attendance_weekly_uzs: Optional[int] = None
    report_weekly_uzs: Optional[int] = None
    schedule_start: Optional[str] = None
    schedule_end: Optional[str] = None
    kpi_rule_id: Optional[int] = None
    notes: Optional[str] = None


@router.put("/employees/{bitrix_user_id}")
def upsert_employee_extra(
    bitrix_user_id: int,
    payload: EmployeeExtraIn,
    s: Session = Depends(_session),
) -> dict:
    ex = s.get(EmployeeExtra, bitrix_user_id)
    if ex is None:
        ex = EmployeeExtra(bitrix_user_id=bitrix_user_id)
    for k, v in payload.model_dump(exclude_unset=True).items():
        setattr(ex, k, v)
    ex.updated_at = datetime.utcnow()
    s.add(ex)
    s.commit()
    s.refresh(ex)
    return ex.model_dump()


# ────────────────────────────────────────────────────────────────────
# KPI rules — tiered commission rules
# ────────────────────────────────────────────────────────────────────
class KpiRuleIn(BaseModel):
    name: str
    role: str = "closer"
    entity: str = "deals"
    period: str = "monthly"
    currency: str = "USD"
    mode: str = "single_tier"
    tiers: list[Any] = []
    is_active: bool = True


@router.get("/kpi-rules")
def list_kpi_rules(s: Session = Depends(_session)) -> dict:
    rules = s.exec(select(KpiRule).order_by(KpiRule.id.desc())).all()
    return {"count": len(rules), "rules": [r.model_dump() for r in rules]}


@router.post("/kpi-rules")
def create_kpi_rule(payload: KpiRuleIn, s: Session = Depends(_session)) -> dict:
    rule = KpiRule(**payload.model_dump())
    s.add(rule); s.commit(); s.refresh(rule)
    return rule.model_dump()


@router.put("/kpi-rules/{rule_id}")
def update_kpi_rule(rule_id: int, payload: KpiRuleIn, s: Session = Depends(_session)) -> dict:
    rule = s.get(KpiRule, rule_id)
    if not rule:
        raise HTTPException(status_code=404, detail="KPI rule not found")
    for k, v in payload.model_dump().items():
        setattr(rule, k, v)
    s.add(rule); s.commit(); s.refresh(rule)
    return rule.model_dump()


@router.delete("/kpi-rules/{rule_id}")
def delete_kpi_rule(rule_id: int, s: Session = Depends(_session)) -> dict:
    rule = s.get(KpiRule, rule_id)
    if not rule:
        raise HTTPException(status_code=404, detail="KPI rule not found")
    s.delete(rule); s.commit()
    return {"deleted": rule_id}


# ────────────────────────────────────────────────────────────────────
# Bonus rules + awards
# ────────────────────────────────────────────────────────────────────
class BonusRuleIn(BaseModel):
    name: str
    trigger_text: str = ""
    period: str = "monthly"
    target_role: str = "closer"
    rule_type: str = "auto"
    value_kind: str = "percent"
    value: float = 0.0
    is_active: bool = True


@router.get("/bonus-rules")
def list_bonus_rules(s: Session = Depends(_session)) -> dict:
    rules = s.exec(select(BonusRule).order_by(BonusRule.id.desc())).all()
    return {"count": len(rules), "rules": [r.model_dump() for r in rules]}


@router.post("/bonus-rules")
def create_bonus_rule(payload: BonusRuleIn, s: Session = Depends(_session)) -> dict:
    rule = BonusRule(**payload.model_dump())
    s.add(rule); s.commit(); s.refresh(rule)
    return rule.model_dump()


@router.put("/bonus-rules/{rule_id}")
def update_bonus_rule(rule_id: int, payload: BonusRuleIn, s: Session = Depends(_session)) -> dict:
    rule = s.get(BonusRule, rule_id)
    if not rule:
        raise HTTPException(status_code=404, detail="Bonus rule not found")
    for k, v in payload.model_dump().items():
        setattr(rule, k, v)
    s.add(rule); s.commit(); s.refresh(rule)
    return rule.model_dump()


@router.delete("/bonus-rules/{rule_id}")
def delete_bonus_rule(rule_id: int, s: Session = Depends(_session)) -> dict:
    rule = s.get(BonusRule, rule_id)
    if not rule:
        raise HTTPException(status_code=404, detail="Bonus rule not found")
    s.delete(rule); s.commit()
    return {"deleted": rule_id}


class BonusAwardIn(BaseModel):
    bitrix_user_id: int
    rule_id: Optional[int] = None
    rule_name: str = ""
    period_label: str
    amount_usd: float = 0.0
    note: Optional[str] = None


@router.get("/bonus-awards")
def list_bonus_awards(period_label: Optional[str] = None, s: Session = Depends(_session)) -> dict:
    q = select(BonusAward).order_by(BonusAward.awarded_at.desc())
    if period_label:
        q = q.where(BonusAward.period_label == period_label)
    rows = s.exec(q).all()
    return {"count": len(rows), "awards": [r.model_dump() for r in rows]}


@router.post("/bonus-awards")
def create_bonus_award(payload: BonusAwardIn, s: Session = Depends(_session)) -> dict:
    aw = BonusAward(**payload.model_dump())
    s.add(aw); s.commit(); s.refresh(aw)
    return aw.model_dump()


@router.delete("/bonus-awards/{award_id}")
def delete_bonus_award(award_id: int, s: Session = Depends(_session)) -> dict:
    aw = s.get(BonusAward, award_id)
    if not aw:
        raise HTTPException(status_code=404, detail="Bonus award not found")
    s.delete(aw); s.commit()
    return {"deleted": award_id}


# ────────────────────────────────────────────────────────────────────
# Monthly target
# ────────────────────────────────────────────────────────────────────
class MonthlyTargetIn(BaseModel):
    year: int
    month: int
    target_usd: float
    weekly_breakdown: list[Any] = []


@router.get("/target")
def get_monthly_target(year: int, month: int, s: Session = Depends(_session)) -> dict:
    row = s.exec(
        select(MonthlyTarget).where(MonthlyTarget.year == year, MonthlyTarget.month == month)
    ).first()
    if not row:
        # Default: equal weekly distribution placeholder
        return {"year": year, "month": month, "target_usd": 0.0, "weekly_breakdown": [0, 0, 0, 0]}
    return row.model_dump()


@router.put("/target")
def set_monthly_target(payload: MonthlyTargetIn, s: Session = Depends(_session)) -> dict:
    row = s.exec(
        select(MonthlyTarget).where(
            MonthlyTarget.year == payload.year, MonthlyTarget.month == payload.month,
        )
    ).first()
    if row is None:
        row = MonthlyTarget(**payload.model_dump())
    else:
        row.target_usd = payload.target_usd
        row.weekly_breakdown = payload.weekly_breakdown
        row.updated_at = datetime.utcnow()
    s.add(row); s.commit(); s.refresh(row)
    return row.model_dump()


# ────────────────────────────────────────────────────────────────────
# Calculate payroll for an employee in a given month
# ────────────────────────────────────────────────────────────────────
def _compute_kpi_payout(rule: KpiRule, revenue_usd: float) -> tuple[float, dict]:
    """Apply single-tier mode: whole revenue × percent of the matching tier."""
    if not rule or not rule.tiers:
        return 0.0, {"matched_tier": None, "percent": 0.0}
    matched = None
    for t in rule.tiers:
        try:
            lo = float(t.get("from", 0) or 0)
            hi = t.get("to")
            hi_val = float(hi) if hi not in (None, "", "null") else float("inf")
            pct = float(t.get("percent", 0) or 0)
        except Exception:
            continue
        if revenue_usd >= lo and revenue_usd < hi_val:
            matched = {"from": lo, "to": hi if hi not in (None, "") else None, "percent": pct}
            break
    if not matched:
        # If no tier matched (revenue below first tier), use 0
        return 0.0, {"matched_tier": None, "percent": 0.0}
    payout = revenue_usd * matched["percent"] / 100.0
    return payout, {"matched_tier": matched, "percent": matched["percent"]}


@router.get("/calculate")
def calculate_payroll(
    bitrix_user_id: int,
    year: int,
    month: int,
    s: Session = Depends(_session),
) -> dict:
    """Compute monthly payroll for an employee.

    Inputs:
      - Bitrix: deal revenue (sum of OPPORTUNITY for WON deals where ASSIGNED_BY_ID = uid)
      - DB: employee_extra (fix_base, kpi_rule), bonus_awards for the period
    """
    ex = s.get(EmployeeExtra, bitrix_user_id)
    fix_base = ex.fix_base_uzs if ex else 0
    kpi_rule = s.get(KpiRule, ex.kpi_rule_id) if (ex and ex.kpi_rule_id) else None

    # Period range — full calendar month
    import calendar
    days_in_month = calendar.monthrange(year, month)[1]
    start_iso = f"{year:04d}-{month:02d}-01"
    end_iso = f"{year:04d}-{month:02d}-{days_in_month:02d}"

    # Bitrix revenue (sum OPPORTUNITY for WON deals, by close date)
    deal_agg = bitrix.aggregate_deals_sum_by_user(bitrix_user_id, start_iso, end_iso)
    revenue_usd = float(deal_agg.get("sum") or 0)
    deal_count = int(deal_agg.get("count") or 0)

    kpi_payout, kpi_meta = _compute_kpi_payout(kpi_rule, revenue_usd) if kpi_rule else (0.0, {"matched_tier": None, "percent": 0.0})

    # Bonus awards for this period
    period_label = f"{year:04d}-{month:02d}"
    awards = s.exec(
        select(BonusAward).where(
            BonusAward.bitrix_user_id == bitrix_user_id,
            BonusAward.period_label == period_label,
        )
    ).all()
    bonuses_usd = sum(a.amount_usd for a in awards)

    # Penalties: not auto-computed yet; placeholder 0 (admin-driven for now)
    penalties_usd = 0.0

    total_uzs = fix_base
    total_usd = kpi_payout + bonuses_usd - penalties_usd

    return {
        "bitrix_user_id": bitrix_user_id,
        "year": year,
        "month": month,
        "period_label": period_label,
        "revenue_usd": revenue_usd,
        "deal_count": deal_count,
        "fix_base_uzs": fix_base,
        "kpi": {
            "payout_usd": round(kpi_payout, 2),
            "rule_id": kpi_rule.id if kpi_rule else None,
            "rule_name": kpi_rule.name if kpi_rule else None,
            **kpi_meta,
        },
        "bonuses": [a.model_dump() for a in awards],
        "bonuses_total_usd": round(bonuses_usd, 2),
        "penalties_usd": round(penalties_usd, 2),
        "total_uzs": total_uzs,
        "total_usd": round(total_usd, 2),
    }

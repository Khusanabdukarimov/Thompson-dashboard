"""Payroll routes — employee enrichment, KPI/Bonus rules, monthly targets, calculation."""
from datetime import date as date_t
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy import and_
from sqlmodel import Session, select

AVATAR_DIR = Path(__file__).resolve().parents[3] / "data" / "avatars"
AVATAR_DIR.mkdir(parents=True, exist_ok=True)
ALLOWED_EXTS = {".jpg", ".jpeg", ".png", ".webp"}
MAX_SIZE = 5 * 1024 * 1024  # 5 MB

from app.core.auth import hash_password
from app.db import get_session
from app.models import (
    AttendanceLog,
    BonusAward,
    BonusRule,
    EmployeeExtra,
    KpiRule,
    MonthlyTarget,
    PayrollApproval,
    PenaltyConfig,
    ReportLog,
    Tarif,
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
    # dashboard credentials
    login: Optional[str] = None
    dashboard_role: str = ""
    avatar_url: Optional[str] = None


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
            login=ex.login if ex else None,
            dashboard_role=ex.dashboard_role if ex else "",
            avatar_url=ex.avatar_url if ex else None,
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
    login: Optional[str] = None
    password: Optional[str] = None  # plain text — will be hashed; omit to keep existing
    dashboard_role: Optional[str] = None


@router.put("/employees/{bitrix_user_id}")
def upsert_employee_extra(
    bitrix_user_id: int,
    payload: EmployeeExtraIn,
    s: Session = Depends(_session),
) -> dict:
    ex = s.get(EmployeeExtra, bitrix_user_id)
    if ex is None:
        ex = EmployeeExtra(bitrix_user_id=bitrix_user_id)
    # Handle password separately — never store plaintext
    plain_password = payload.password
    data = payload.model_dump(exclude_unset=True, exclude={"password"})
    for k, v in data.items():
        setattr(ex, k, v)
    if plain_password:
        ex.password_hash = hash_password(plain_password)
    ex.updated_at = datetime.utcnow()
    s.add(ex)
    s.commit()
    s.refresh(ex)
    d = ex.model_dump()
    d.pop("password_hash", None)
    return d


@router.post("/employees/{bitrix_user_id}/avatar")
async def upload_avatar(
    bitrix_user_id: int,
    file: UploadFile = File(...),
    s: Session = Depends(_session),
) -> dict:
    """Upload a profile photo for an employee. Stores as /data/avatars/{uid}.ext"""
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in ALLOWED_EXTS:
        raise HTTPException(status_code=400, detail=f"Rasm formati noto'g'ri. Ruxsat etilgan: {', '.join(ALLOWED_EXTS)}")

    content = await file.read()
    if len(content) > MAX_SIZE:
        raise HTTPException(status_code=400, detail="Fayl hajmi 5 MB dan oshmasin")

    # Save file (overwrite previous avatar for this user)
    dest = AVATAR_DIR / f"{bitrix_user_id}{suffix}"
    # Remove old avatars with different extension
    for old in AVATAR_DIR.glob(f"{bitrix_user_id}.*"):
        old.unlink(missing_ok=True)
    dest.write_bytes(content)

    avatar_url = f"/avatars/{bitrix_user_id}{suffix}"

    # Persist to DB
    ex = s.get(EmployeeExtra, bitrix_user_id)
    if ex is None:
        ex = EmployeeExtra(bitrix_user_id=bitrix_user_id)
    ex.avatar_url = avatar_url
    s.add(ex)
    s.commit()

    return {"avatar_url": avatar_url}


@router.delete("/employees/{bitrix_user_id}/avatar")
def delete_avatar(bitrix_user_id: int, s: Session = Depends(_session)) -> dict:
    for old in AVATAR_DIR.glob(f"{bitrix_user_id}.*"):
        old.unlink(missing_ok=True)
    ex = s.get(EmployeeExtra, bitrix_user_id)
    if ex:
        ex.avatar_url = None
        s.add(ex)
        s.commit()
    return {"ok": True}


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


@router.get("/weekly-actuals")
def get_weekly_actuals(year: int, month: int) -> dict:
    """Aggregate WON deal revenue split by week-of-month (1-7, 8-14, 15-21, 22-end).

    Uses Bitrix `crm.deal.list` with CLOSEDATE filter. Returns one item per week
    with start/end day, won_revenue, and won_count.
    """
    import calendar
    days_in_month = calendar.monthrange(year, month)[1]
    weeks = []
    for i, (start, end) in enumerate([(1, 7), (8, 14), (15, 21), (22, days_in_month)]):
        if start > days_in_month:
            weeks.append({"week": i + 1, "start_day": start, "end_day": end, "won_revenue": 0.0, "won_count": 0})
            continue
        e = min(end, days_in_month)
        start_iso = f"{year:04d}-{month:02d}-{start:02d}"
        end_iso   = f"{year:04d}-{month:02d}-{e:02d}"
        agg = bitrix.aggregate_deals_sum_total(start_iso, end_iso)  # sums all WON-or-not by close-date; use WON-only via stage filter
        # Use stage filter for WON-only
        won_agg = _won_revenue_in_range(start_iso, end_iso)
        weeks.append({
            "week": i + 1,
            "start_day": start,
            "end_day": e,
            "won_revenue": float(won_agg["sum"]),
            "won_count": int(won_agg["count"]),
            "any_revenue": float(agg.get("sum") or 0),
        })
    return {"year": year, "month": month, "weeks": weeks}


@router.get("/sales-trend")
def get_sales_trend(months_back: int = 6) -> dict:
    """Return monthly won revenue trend for last N months (incl. current)."""
    today = datetime.utcnow()
    out = []
    for i in range(months_back - 1, -1, -1):
        # i months ago
        y = today.year
        m = today.month - i
        while m <= 0:
            m += 12
            y -= 1
        import calendar
        last = calendar.monthrange(y, m)[1]
        start_iso = f"{y:04d}-{m:02d}-01"
        end_iso = f"{y:04d}-{m:02d}-{last:02d}"
        agg = _won_revenue_in_range(start_iso, end_iso)
        out.append({
            "year": y,
            "month": m,
            "won_revenue": float(agg["sum"]),
            "won_count": int(agg["count"]),
        })
    return {"months": out}


def _won_revenue_in_range(start_iso: str, end_iso: str) -> dict:
    """Sum OPPORTUNITY for WON deals closing in range using PostgreSQL."""
    from app.db_bx import bx_engine
    from sqlalchemy import text
    query = text("""
        SELECT COALESCE(SUM(opportunity), 0) AS sum, COUNT(*) AS count
        FROM deals d
        JOIN stages s ON s.id = d.stage_id
        WHERE s.entity = 'deal' AND s.is_won = TRUE
          AND d.closedate >= CAST(:start AS TIMESTAMPTZ)
          AND d.closedate <= CAST(:end AS TIMESTAMPTZ)
    """)
    with bx_engine.connect() as conn:
        res = conn.execute(query, {"start": start_iso, "end": end_iso}).mappings().first()
        return {"sum": float(res["sum"]), "count": int(res["count"])}


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
# Attendance + Report logs (manual entry; auto-detection later)
# ────────────────────────────────────────────────────────────────────
class LogEntryIn(BaseModel):
    bitrix_user_id: int
    day: date_t
    bucket: str  # on-time | late-soft | late | penalty | absent | missed
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    submitted_at: Optional[str] = None
    note: Optional[str] = None


def _month_range(year: int, month: int) -> tuple[date_t, date_t]:
    import calendar
    last = calendar.monthrange(year, month)[1]
    return date_t(year, month, 1), date_t(year, month, last)


@router.get("/attendance-log")
def list_attendance(year: int, month: int, s: Session = Depends(_session)) -> dict:
    start, end = _month_range(year, month)
    rows = s.exec(
        select(AttendanceLog).where(and_(AttendanceLog.day >= start, AttendanceLog.day <= end)).order_by(AttendanceLog.day.desc())
    ).all()
    return {"count": len(rows), "logs": [{
        **r.model_dump(),
        "day": r.day.isoformat(),
    } for r in rows]}


@router.put("/attendance-log")
def upsert_attendance(payload: LogEntryIn, s: Session = Depends(_session)) -> dict:
    row = s.exec(
        select(AttendanceLog).where(
            and_(AttendanceLog.bitrix_user_id == payload.bitrix_user_id, AttendanceLog.day == payload.day),
        )
    ).first()
    if row is None:
        row = AttendanceLog(bitrix_user_id=payload.bitrix_user_id, day=payload.day)
    row.bucket = payload.bucket
    row.start_time = payload.start_time
    row.end_time = payload.end_time
    row.note = payload.note
    s.add(row); s.commit(); s.refresh(row)
    return {**row.model_dump(), "day": row.day.isoformat()}


@router.delete("/attendance-log/{log_id}")
def delete_attendance(log_id: int, s: Session = Depends(_session)) -> dict:
    row = s.get(AttendanceLog, log_id)
    if not row:
        raise HTTPException(status_code=404, detail="Not found")
    s.delete(row); s.commit()
    return {"deleted": log_id}


@router.get("/report-log")
def list_reports(year: int, month: int, s: Session = Depends(_session)) -> dict:
    start, end = _month_range(year, month)
    rows = s.exec(
        select(ReportLog).where(and_(ReportLog.day >= start, ReportLog.day <= end)).order_by(ReportLog.day.desc())
    ).all()
    return {"count": len(rows), "logs": [{
        **r.model_dump(),
        "day": r.day.isoformat(),
    } for r in rows]}


@router.put("/report-log")
def upsert_report(payload: LogEntryIn, s: Session = Depends(_session)) -> dict:
    row = s.exec(
        select(ReportLog).where(
            and_(ReportLog.bitrix_user_id == payload.bitrix_user_id, ReportLog.day == payload.day),
        )
    ).first()
    if row is None:
        row = ReportLog(bitrix_user_id=payload.bitrix_user_id, day=payload.day)
    row.bucket = payload.bucket
    row.submitted_at = payload.submitted_at
    row.note = payload.note
    s.add(row); s.commit(); s.refresh(row)
    return {**row.model_dump(), "day": row.day.isoformat(), "created_at": row.created_at.isoformat()}


@router.delete("/report-log/{log_id}")
def delete_report(log_id: int, s: Session = Depends(_session)) -> dict:
    row = s.get(ReportLog, log_id)
    if not row:
        raise HTTPException(status_code=404, detail="Not found")
    s.delete(row); s.commit()
    return {"deleted": log_id}


# ────────────────────────────────────────────────────────────────────
# Bitrix auto-sync — best-effort hydrate logs from Bitrix activity
# ────────────────────────────────────────────────────────────────────
def _classify_time_vs_deadline(actual_hm: str, deadline_hm: str, mode: str) -> str:
    """Bucket: on-time/late-soft/late/penalty + (missed|absent)."""
    try:
        ah, am = [int(x) for x in actual_hm.split(":")]
        dh, dm = [int(x) for x in deadline_hm.split(":")]
    except Exception:
        return "missed" if mode == "report" else "absent"
    diff = (ah * 60 + am) - (dh * 60 + dm)  # minutes after deadline
    if diff <= 0:        return "on-time"
    if diff <= 5:        return "late-soft"
    if diff <= 10:       return "late"
    if diff <= 30:       return "penalty"
    return "missed" if mode == "report" else "absent"


@router.post("/auto-sync")
def auto_sync_logs(year: int, month: int, mode: str = "report", s: Session = Depends(_session)) -> dict:
    """Best-effort sync logs from Bitrix.

    - mode="report":     uses crm.activity.list with PROVIDER_TYPE_ID=TODO,
                         deadline=19:00. Compared CLOSED_TIME vs DEADLINE.
    - mode="attendance": uses timeman.status (current only — historical not
                         exposed in current bitrix.py wrapper). For each user,
                         records today's status if month/year matches.

    Returns counts of created/updated rows.
    """
    if mode not in ("report", "attendance"):
        raise HTTPException(status_code=400, detail="mode must be 'report' or 'attendance'")

    start, end = _month_range(year, month)
    users = bitrix.list_users()
    created = 0
    updated = 0
    skipped_users = 0

    if mode == "report":
        # For each user, fetch completed TODO activities in the period
        for u in users:
            try:
                uid = int(u.get("ID", 0))
            except Exception:
                skipped_users += 1
                continue
            if uid <= 0:
                skipped_users += 1
                continue

            # Fetch activities from PostgreSQL
            from app.db_bx import bx_engine
            from sqlalchemy import text
            query = text("""
                SELECT * FROM bx_activities
                WHERE responsible_id = :uid
                  AND completed = TRUE
                  AND provider_type_id = 'TODO'
                  AND created >= CAST(:start AS TIMESTAMPTZ)
                  AND created <= CAST(:end AS TIMESTAMPTZ)
                LIMIT 200
            """)
            try:
                with bx_engine.connect() as conn:
                    res = conn.execute(query, {"uid": uid, "start": start.isoformat(), "end": end.isoformat()}).mappings().all()
                    data = {"result": [dict(r) for r in res]}
            except Exception:
                data = {}

            for act in (data.get("result") or [])[:200]:
                # DEADLINE / END_TIME → "YYYY-MM-DDTHH:MM:SS+TZ" or similar
                dt_str = act.get("DEADLINE") or act.get("CREATED")
                end_str = act.get("END_TIME") or act.get("CREATED")
                if not dt_str or not end_str:
                    continue
                try:
                    from dateutil.parser import parse as dt_parse
                    deadline_dt = dt_parse(dt_str)
                    end_dt = dt_parse(end_str)
                except Exception:
                    continue
                day = end_dt.date()
                if day < start or day > end:
                    continue

                actual_hm   = end_dt.strftime("%H:%M")
                deadline_hm = deadline_dt.strftime("%H:%M")
                bucket = _classify_time_vs_deadline(actual_hm, deadline_hm, "report")

                row = s.exec(select(ReportLog).where(and_(
                    ReportLog.bitrix_user_id == uid, ReportLog.day == day,
                ))).first()
                if row is None:
                    row = ReportLog(bitrix_user_id=uid, day=day)
                    created += 1
                else:
                    updated += 1
                row.bucket = bucket
                row.submitted_at = actual_hm
                row.note = act.get("SUBJECT")
                s.add(row)
        s.commit()

    elif mode == "attendance":
        # Snapshot today's timeman.status into attendance_log if today is in [start,end]
        from datetime import date as _date
        today = _date.today()
        if not (start <= today <= end):
            return {"mode": mode, "created": 0, "updated": 0, "skipped_users": 0,
                    "note": "Selected month is not the current month — historical timeman not yet supported."}
        for u in users:
            try:
                uid = int(u.get("ID", 0))
            except Exception:
                skipped_users += 1
                continue
            if uid <= 0:
                skipped_users += 1
                continue
            tm = bitrix.get_timeman_status(uid) or {}
            status = tm.get("STATUS") if isinstance(tm, dict) else None
            time_start = tm.get("TIME_START") if isinstance(tm, dict) else None
            # Map STATUS → bucket
            bucket = "absent"
            actual_hm = None
            if time_start:
                try:
                    from dateutil.parser import parse as dt_parse
                    actual_hm = dt_parse(time_start).strftime("%H:%M")
                    bucket = _classify_time_vs_deadline(actual_hm, "09:00", "attendance")
                except Exception:
                    pass
            elif status == "OPENED":
                bucket = "on-time"

            row = s.exec(select(AttendanceLog).where(and_(
                AttendanceLog.bitrix_user_id == uid, AttendanceLog.day == today,
            ))).first()
            if row is None:
                row = AttendanceLog(bitrix_user_id=uid, day=today)
                created += 1
            else:
                updated += 1
            row.bucket = bucket
            row.start_time = actual_hm
            row.note = f"auto-sync {status or 'unknown'}"
            s.add(row)
        s.commit()

    return {"mode": mode, "created": created, "updated": updated, "skipped_users": skipped_users}


# ────────────────────────────────────────────────────────────────────
# Hisobot / Davomat statistikasi (oylik agregat)
# ────────────────────────────────────────────────────────────────────
@router.get("/discipline-stats")
def discipline_stats(year: int, month: int, s: Session = Depends(_session)) -> dict:
    """Per-employee bucket counts for both attendance & report logs in a month."""
    start, end = _month_range(year, month)

    # Pull all logs for the month
    att_rows = s.exec(select(AttendanceLog).where(and_(AttendanceLog.day >= start, AttendanceLog.day <= end))).all()
    rep_rows = s.exec(select(ReportLog).where(and_(ReportLog.day >= start, ReportLog.day <= end))).all()

    def empty_buckets(): return {"on-time": 0, "late-soft": 0, "late": 0, "penalty": 0, "absent": 0, "missed": 0}

    by_user_att: dict[int, dict] = {}
    for r in att_rows:
        by_user_att.setdefault(r.bitrix_user_id, empty_buckets())[r.bucket] = by_user_att[r.bitrix_user_id].get(r.bucket, 0) + 1
    by_user_rep: dict[int, dict] = {}
    for r in rep_rows:
        by_user_rep.setdefault(r.bitrix_user_id, empty_buckets())[r.bucket] = by_user_rep[r.bitrix_user_id].get(r.bucket, 0) + 1

    bitrix_users = bitrix.list_users()
    employees = []
    for u in bitrix_users:
        try:
            uid = int(u.get("ID", 0))
        except Exception:
            continue
        if uid <= 0:
            continue
        name = f"{u.get('NAME','') or ''} {u.get('LAST_NAME','') or ''}".strip() or f"User {uid}"
        employees.append({
            "id": uid,
            "name": name,
            "attendance": by_user_att.get(uid, empty_buckets()),
            "report": by_user_rep.get(uid, empty_buckets()),
        })

    return {"year": year, "month": month, "employees": employees}


# ────────────────────────────────────────────────────────────────────
# Penalty config
# ────────────────────────────────────────────────────────────────────
class PenaltyConfigIn(BaseModel):
    attendance_late_soft_uzs: int = 0
    attendance_late_uzs: int = 0
    attendance_penalty_uzs: int = 0
    attendance_absent_uzs: int = 0
    report_late_soft_uzs: int = 0
    report_late_uzs: int = 0
    report_penalty_uzs: int = 0
    report_missed_uzs: int = 0


@router.get("/penalty-config")
def get_penalty_config(s: Session = Depends(_session)) -> dict:
    cfg = s.get(PenaltyConfig, 1)
    if cfg is None:
        cfg = PenaltyConfig(id=1)
        s.add(cfg); s.commit(); s.refresh(cfg)
    return cfg.model_dump()


@router.put("/penalty-config")
def set_penalty_config(payload: PenaltyConfigIn, s: Session = Depends(_session)) -> dict:
    cfg = s.get(PenaltyConfig, 1)
    if cfg is None:
        cfg = PenaltyConfig(id=1)
    for k, v in payload.model_dump().items():
        setattr(cfg, k, v)
    cfg.updated_at = datetime.utcnow()
    s.add(cfg); s.commit(); s.refresh(cfg)
    return cfg.model_dump()


def _compute_penalty_uzs(uid: int, year: int, month: int, s: Session) -> tuple[int, list[dict]]:
    """Sum penalty UZS for an employee across attendance + report logs in the period."""
    cfg = s.get(PenaltyConfig, 1)
    if cfg is None:
        return 0, []
    start, end = _month_range(year, month)
    att = s.exec(select(AttendanceLog).where(and_(
        AttendanceLog.bitrix_user_id == uid, AttendanceLog.day >= start, AttendanceLog.day <= end,
    ))).all()
    rep = s.exec(select(ReportLog).where(and_(
        ReportLog.bitrix_user_id == uid, ReportLog.day >= start, ReportLog.day <= end,
    ))).all()

    breakdown: list[dict] = []
    total = 0
    att_rates = {
        "late-soft": cfg.attendance_late_soft_uzs,
        "late":      cfg.attendance_late_uzs,
        "penalty":   cfg.attendance_penalty_uzs,
        "absent":    cfg.attendance_absent_uzs,
    }
    rep_rates = {
        "late-soft": cfg.report_late_soft_uzs,
        "late":      cfg.report_late_uzs,
        "penalty":   cfg.report_penalty_uzs,
        "missed":    cfg.report_missed_uzs,
    }
    att_counts = {b: 0 for b in att_rates}
    rep_counts = {b: 0 for b in rep_rates}
    for r in att:
        if r.bucket in att_counts: att_counts[r.bucket] += 1
    for r in rep:
        if r.bucket in rep_counts: rep_counts[r.bucket] += 1

    for b, n in att_counts.items():
        if n > 0 and att_rates[b] > 0:
            sub = n * att_rates[b]
            total += sub
            breakdown.append({"kind": "attendance", "bucket": b, "count": n, "rate_uzs": att_rates[b], "subtotal_uzs": sub})
    for b, n in rep_counts.items():
        if n > 0 and rep_rates[b] > 0:
            sub = n * rep_rates[b]
            total += sub
            breakdown.append({"kind": "report", "bucket": b, "count": n, "rate_uzs": rep_rates[b], "subtotal_uzs": sub})

    return total, breakdown


# ────────────────────────────────────────────────────────────────────
# Calculate payroll for an employee in a given month
# ────────────────────────────────────────────────────────────────────
def _compute_kpi_payout(rule: KpiRule, revenue_usd: float) -> tuple[float, dict]:
    """Compute KPI commission payout based on rule.mode.

    Modes:
      - "single_tier": whole revenue × percent of the matching tier
      - "multi_tier":  revenue accumulates per-tier (classic progressive bracket).
                       For each tier [from, to), only the portion of revenue inside
                       that range is multiplied by the tier's percent.
    """
    if not rule or not rule.tiers:
        return 0.0, {"matched_tier": None, "percent": 0.0, "mode": "single_tier", "breakdown": []}

    if rule.mode == "multi_tier":
        return _compute_multi_tier(rule, revenue_usd)
    return _compute_single_tier(rule, revenue_usd)


def _compute_single_tier(rule: KpiRule, revenue_usd: float) -> tuple[float, dict]:
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
        return 0.0, {"matched_tier": None, "percent": 0.0, "mode": "single_tier", "breakdown": []}
    payout = revenue_usd * matched["percent"] / 100.0
    return payout, {"matched_tier": matched, "percent": matched["percent"], "mode": "single_tier", "breakdown": []}


def _compute_multi_tier(rule: KpiRule, revenue_usd: float) -> tuple[float, dict]:
    total = 0.0
    breakdown: list[dict] = []
    for t in rule.tiers:
        try:
            lo = float(t.get("from", 0) or 0)
            hi = t.get("to")
            hi_val = float(hi) if hi not in (None, "", "null") else float("inf")
            pct = float(t.get("percent", 0) or 0)
        except Exception:
            continue
        if revenue_usd <= lo:
            break
        portion = min(revenue_usd, hi_val) - lo
        if portion <= 0:
            continue
        sub = portion * pct / 100.0
        total += sub
        breakdown.append({"from": lo, "to": hi if hi not in (None, "") else None, "percent": pct, "portion_usd": portion, "subtotal_usd": round(sub, 2)})

    return total, {"matched_tier": None, "percent": 0.0, "mode": "multi_tier", "breakdown": breakdown}


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

    # Penalties from attendance + report logs
    penalties_uzs, penalty_breakdown = _compute_penalty_uzs(bitrix_user_id, year, month, s)

    total_uzs = max(0, fix_base - penalties_uzs)
    total_usd = kpi_payout + bonuses_usd

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
        "penalties_uzs": penalties_uzs,
        "penalty_breakdown": penalty_breakdown,
        "total_uzs": total_uzs,
        "total_usd": round(total_usd, 2),
    }


# ────────────────────────────────────────────────────────────────────
# Tariflar — service pricing tiers (dizayn | neyming)
# ────────────────────────────────────────────────────────────────────
class TarifIn(BaseModel):
    service_type: str
    name: str
    loyiha_summasi: int = 0
    variant_klass: str = ""
    harf_oralighi: str = ""
    tekshiruvlar: int = 0
    deadline_mijoz: str = ""
    hudud: str = "Mahalliy"
    jami_summa: int = 0
    sort_order: int = 0
    is_active: bool = True


@router.get("/tariflar")
def list_tariflar(service_type: Optional[str] = None, session: Session = Depends(_session)):
    stmt = select(Tarif)
    if service_type:
        stmt = stmt.where(Tarif.service_type == service_type)
    stmt = stmt.order_by(Tarif.sort_order, Tarif.id)
    items = session.exec(stmt).all()
    return {"count": len(items), "tariflar": [t.model_dump() for t in items]}


@router.post("/tariflar", status_code=201)
def create_tarif(body: TarifIn, session: Session = Depends(_session)):
    tarif = Tarif(**body.model_dump())
    session.add(tarif)
    session.commit()
    session.refresh(tarif)
    return tarif.model_dump()


@router.put("/tariflar/{tarif_id}")
def update_tarif(tarif_id: int, body: TarifIn, session: Session = Depends(_session)):
    tarif = session.get(Tarif, tarif_id)
    if not tarif:
        raise HTTPException(status_code=404, detail="Tarif not found")
    for k, v in body.model_dump().items():
        setattr(tarif, k, v)
    session.commit()
    session.refresh(tarif)
    return tarif.model_dump()


@router.delete("/tariflar/{tarif_id}", status_code=204)
def delete_tarif(tarif_id: int, session: Session = Depends(_session)):
    tarif = session.get(Tarif, tarif_id)
    if not tarif:
        raise HTTPException(status_code=404, detail="Tarif not found")
    session.delete(tarif)
    session.commit()


# ─────────────────────────────────────────────────────────────────────────────
# Payroll Summary — batch calculate all active employees for a month
# ─────────────────────────────────────────────────────────────────────────────
@router.get("/summary")
def payroll_summary(year: int, month: int, s: Session = Depends(_session)) -> dict:
    """Calculate payroll for all Bitrix24 employees in a given month."""
    import calendar
    days_in_month = calendar.monthrange(year, month)[1]
    start_iso = f"{year:04d}-{month:02d}-01"
    end_iso   = f"{year:04d}-{month:02d}-{days_in_month:02d}"
    period_label = f"{year:04d}-{month:02d}"

    # All Bitrix users merged with DB extras (same as list_employees)
    bx_users = bitrix.list_users() or []
    extras = {e.bitrix_user_id: e for e in s.exec(select(EmployeeExtra)).all()}

    rows = []
    for u in bx_users:
        try:
            uid = int(u.get("ID", 0))
        except Exception:
            continue
        if uid <= 0:
            continue

        ex = extras.get(uid)
        # Skip terminated / on-leave employees if they have no extras (bots, etc.)
        status = ex.status if ex else "active"
        if status == "terminated":
            continue

        name = f"{u.get('NAME','') or ''} {u.get('LAST_NAME','') or ''}".strip() or f"User {uid}"
        fix_base = ex.fix_base_uzs if ex else 0
        att_weekly = ex.attendance_weekly_uzs if ex else 0
        kpi_rule = s.get(KpiRule, ex.kpi_rule_id) if (ex and ex.kpi_rule_id) else None

        deal_agg = bitrix.aggregate_deals_sum_by_user(uid, start_iso, end_iso)
        revenue_usd = float(deal_agg.get("sum") or 0)
        deal_count  = int(deal_agg.get("count") or 0)
        kpi_payout, _ = _compute_kpi_payout(kpi_rule, revenue_usd) if kpi_rule else (0.0, {})

        awards = s.exec(select(BonusAward).where(
            BonusAward.bitrix_user_id == uid, BonusAward.period_label == period_label
        )).all()
        bonuses_usd = sum(a.amount_usd for a in awards)
        penalties_uzs, _ = _compute_penalty_uzs(uid, year, month, s)

        attendance_bonus = att_weekly * 4
        total_uzs = max(0, fix_base + attendance_bonus - penalties_uzs)
        total_usd = round(kpi_payout + bonuses_usd, 2)

        approval = s.exec(select(PayrollApproval).where(
            PayrollApproval.bitrix_user_id == uid,
            PayrollApproval.year == year,
            PayrollApproval.month == month,
        )).first()

        rows.append({
            "bitrix_user_id": uid,
            "name": name,
            "role": ex.role if ex else "closer",
            "fix_base_uzs": fix_base,
            "attendance_bonus_uzs": attendance_bonus,
            "kpi_payout_usd": round(kpi_payout, 2),
            "bonus_total_usd": round(bonuses_usd, 2),
            "penalty_uzs": penalties_uzs,
            "revenue_usd": revenue_usd,
            "deal_count": deal_count,
            "total_uzs": total_uzs,
            "total_usd": total_usd,
            "approval": approval.model_dump() if approval else None,
        })

    rows.sort(key=lambda r: r["total_uzs"] + r["total_usd"] * 12800, reverse=True)
    return {"year": year, "month": month, "period_label": period_label, "count": len(rows), "rows": rows}


# ─────────────────────────────────────────────────────────────────────────────
# Payroll Approvals — save / list / update / delete confirmed payrolls
# ─────────────────────────────────────────────────────────────────────────────
class ApprovalIn(BaseModel):
    bitrix_user_id: int
    year: int
    month: int
    employee_name: str = ""
    fix_base_uzs: int = 0
    attendance_bonus_uzs: int = 0
    kpi_payout_usd: float = 0.0
    bonus_total_usd: float = 0.0
    penalty_uzs: int = 0
    total_uzs: int = 0
    total_usd: float = 0.0
    note: Optional[str] = None
    approved_by: Optional[str] = None


@router.get("/approvals")
def list_approvals(
    year: Optional[int] = None,
    month: Optional[int] = None,
    s: Session = Depends(_session),
) -> dict:
    stmt = select(PayrollApproval)
    if year:
        stmt = stmt.where(PayrollApproval.year == year)
    if month:
        stmt = stmt.where(PayrollApproval.month == month)
    stmt = stmt.order_by(PayrollApproval.approved_at.desc())
    items = s.exec(stmt).all()
    return {"count": len(items), "approvals": [a.model_dump() for a in items]}


@router.post("/approvals", status_code=201)
def create_approval(body: ApprovalIn, s: Session = Depends(_session)) -> dict:
    # Upsert: one approval per employee per month
    existing = s.exec(select(PayrollApproval).where(
        PayrollApproval.bitrix_user_id == body.bitrix_user_id,
        PayrollApproval.year == body.year,
        PayrollApproval.month == body.month,
    )).first()

    if existing:
        for k, v in body.model_dump().items():
            setattr(existing, k, v)
        existing.approved_at = datetime.utcnow()
        existing.status = "approved"
        s.add(existing)
        s.commit()
        s.refresh(existing)
        return existing.model_dump()

    approval = PayrollApproval(**body.model_dump(), status="approved")
    s.add(approval)
    s.commit()
    s.refresh(approval)
    return approval.model_dump()


@router.put("/approvals/{approval_id}/status")
def update_approval_status(
    approval_id: int,
    status: str,  # approved | paid | cancelled
    s: Session = Depends(_session),
) -> dict:
    a = s.get(PayrollApproval, approval_id)
    if not a:
        raise HTTPException(status_code=404, detail="Approval not found")
    if status not in ("approved", "paid", "cancelled"):
        raise HTTPException(status_code=400, detail="Invalid status")
    a.status = status
    s.add(a)
    s.commit()
    s.refresh(a)
    return a.model_dump()


@router.delete("/approvals/{approval_id}", status_code=204)
def delete_approval(approval_id: int, s: Session = Depends(_session)):
    a = s.get(PayrollApproval, approval_id)
    if not a:
        raise HTTPException(status_code=404, detail="Approval not found")
    s.delete(a)
    s.commit()

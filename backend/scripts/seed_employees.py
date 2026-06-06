"""Seed EmployeeExtra for the 6 target payroll employees.

Run from backend dir with venv active:
    python scripts/seed_employees.py
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from sqlmodel import create_engine, Session, select
from app.models import EmployeeExtra, KpiRule

DB_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data", "mountain.db")
engine  = create_engine(f"sqlite:///{DB_PATH}")

# Target employees: Bitrix ID → (display_name, role)
# Hunter role = call center / uchrashuvchi; Closer role = sotuv menejer
EMPLOYEES = [
    (16,  "Davlatyor",            "closer"),
    (22,  "Shahzod Yormamatov",   "closer"),
    (28,  "Shaxzod Turanov",      "closer"),
    (18,  "Samandar Samadov",     "closer"),
    (32,  "Temurmalik Xoshimjonov", "closer"),
    (14,  "Bekzod Ergashev",      "closer"),
    (12,  "Muhriddin Atoullayev", "closer"),
]

# Fix maosh (image 1)
CLOSER_FIX      = 3_900_000   # 150,000 × 26 kun
CLOSER_ATT_WEEK = 200_000     # 800,000 / 4 weeks
CLOSER_REP_WEEK = 125_000     # 500,000 / 4 weeks

HUNTER_FIX      = 2_600_000   # 100,000 × 26 kun
HUNTER_ATT_WEEK = 250_000     # 1,000,000 / 4 weeks
HUNTER_REP_WEEK = 125_000     # 500,000 / 4 weeks

def main():
    with Session(engine) as s:
        # Get KPI rule IDs
        closer_kpi = s.exec(select(KpiRule).where(KpiRule.role == "closer")).first()
        hunter_kpi = s.exec(select(KpiRule).where(KpiRule.role == "hunter")).first()
        closer_kpi_id = closer_kpi.id if closer_kpi else None
        hunter_kpi_id = hunter_kpi.id if hunter_kpi else None

        for uid, name, role in EMPLOYEES:
            existing = s.get(EmployeeExtra, uid)
            if existing:
                print(f"  SKIP (exists): {uid} {name}")
                continue

            is_hunter = role == "hunter"
            emp = EmployeeExtra(
                bitrix_user_id       = uid,
                role                 = role,
                status               = "active",
                fix_base_uzs         = HUNTER_FIX     if is_hunter else CLOSER_FIX,
                attendance_weekly_uzs= HUNTER_ATT_WEEK if is_hunter else CLOSER_ATT_WEEK,
                report_weekly_uzs    = HUNTER_REP_WEEK if is_hunter else CLOSER_REP_WEEK,
                schedule_start       = "09:00",
                schedule_end         = "18:00",
                kpi_rule_id          = hunter_kpi_id  if is_hunter else closer_kpi_id,
            )
            s.add(emp)
            print(f"  ADD {uid} {name:30s} role={role} fix={emp.fix_base_uzs:,}")

        s.commit()

    print("\n✓ Done. Roles can be updated per employee via the Xodimlar page UI.")

if __name__ == "__main__":
    main()

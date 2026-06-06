"""Seed payroll DB: KPI rules, bonus rules, tariflar.

Run from backend dir with venv active:
    python scripts/seed_payroll.py
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from sqlmodel import create_engine, Session
from app.models import KpiRule, BonusRule, Tarif

DB_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data", "mountain.db")
engine  = create_engine(f"sqlite:///{DB_PATH}")

# ──────────────────────────────────────────────────────────────────────────────
# KPI RULES
# ──────────────────────────────────────────────────────────────────────────────
KPI_RULES = [
    # 1. Closer – sotuv hajmidan foiz (image 2)
    KpiRule(
        name     = "Closer – Sotuv foizi",
        role     = "closer",
        entity   = "deals",
        period   = "monthly",
        currency = "USD",
        mode     = "single_tier",
        is_active= True,
        tiers    = [
            {"from": 0,     "to": 5000,  "percent": 1.0},
            {"from": 5000,  "to": 15000, "percent": 5.0},
            {"from": 15000, "to": 30000, "percent": 9.0},
            {"from": 30000, "to": 40000, "percent": 12.0},
            {"from": 40000, "to": None,  "percent": 15.0},
        ],
    ),
    # 2. Hunter – sotuv hajmidan foiz (from user text)
    KpiRule(
        name     = "Hunter – Sotuv foizi",
        role     = "hunter",
        entity   = "deals",
        period   = "monthly",
        currency = "USD",
        mode     = "single_tier",
        is_active= True,
        tiers    = [
            {"from": 0,     "to": 15000, "percent": 0.1},
            {"from": 15000, "to": 30000, "percent": 0.5},
            {"from": 30000, "to": 50000, "percent": 1.0},
            {"from": 50000, "to": None,  "percent": 1.5},
        ],
    ),
]

# ──────────────────────────────────────────────────────────────────────────────
# BONUS RULES (image 3 + user text)
# ──────────────────────────────────────────────────────────────────────────────
BONUS_RULES = [
    # ── Monthly (image 3, section 1) ──────────────────────────────────────────
    BonusRule(
        name          = "Eng ko'p sotuv bonusi",
        trigger_text  = "Oy davomida eng ko'p sotuv qilgan menejer – komandadagi 1-o'rin",
        period        = "monthly",
        target_role   = "closer",
        rule_type     = "auto",
        value_kind    = "percent",
        value         = 0.70,
        is_active     = True,
    ),
    BonusRule(
        name          = "Rekord bonusi",
        trigger_text  = "Shaxsiy yoki kompaniya rekordi yangilanganda – yangi yuqori ko'rsatkich",
        period        = "monthly",
        target_role   = "closer",
        rule_type     = "auto",
        value_kind    = "percent",
        value         = 1.50,
        is_active     = True,
    ),
    # ── Weekly (image 3, section 2) ───────────────────────────────────────────
    BonusRule(
        name          = "Haftalik reja bonusi",
        trigger_text  = "Haftalik sotuv rejasini bajargan menejer – bajarilgan rejaga nisbatan",
        period        = "weekly",
        target_role   = "closer",
        rule_type     = "auto",
        value_kind    = "percent",
        value         = 1.00,
        is_active     = True,
    ),
    # ── Travel (image 3, section 3 + user text) ───────────────────────────────
    BonusRule(
        name          = "Kvartal sayohat – Istanbul (Mart–Iyun)",
        trigger_text  = "4 oy (Mart–Iyun) da jami $97,000 sotuv: Shveytsariya 3 kun + Istanbul 4 kun",
        period        = "monthly",
        target_role   = "closer",
        rule_type     = "manual",
        value_kind    = "fixed_usd",
        value         = 2000.0,
        is_active     = True,
    ),
    BonusRule(
        name          = "Kvartal sayohat – Maldiv (Iyul–Noyabr)",
        trigger_text  = "5 oy (Iyul–Noyabr) da jami $155,000 sotuv: Maldiv orollari",
        period        = "monthly",
        target_role   = "closer",
        rule_type     = "manual",
        value_kind    = "fixed_usd",
        value         = 2500.0,
        is_active     = True,
    ),
    # ── Hunter specific (user text) ───────────────────────────────────────────
    BonusRule(
        name          = "Hunter – Online uchrashuv bonusi",
        trigger_text  = "Har bir muvaffaqiyatli online uchrashuv (Google Meet + zapis bo'lishi shart)",
        period        = "monthly",
        target_role   = "hunter",
        rule_type     = "auto",
        value_kind    = "fixed_usd",
        value         = 30_000 / 12000,  # 30,000 UZS ≈ $2.5 (stored as USD equivalent)
        is_active     = True,
    ),
    BonusRule(
        name          = "Hunter – Offline uchrashuv bonusi",
        trigger_text  = "Har bir muvaffaqiyatli offline uchrashuv (kutib olish, kuzatish, qahva, tozalik, hadiya)",
        period        = "monthly",
        target_role   = "hunter",
        rule_type     = "auto",
        value_kind    = "fixed_usd",
        value         = 60_000 / 12000,  # 60,000 UZS ≈ $5
        is_active     = True,
    ),
    BonusRule(
        name          = "Hunter – Istanbul bonus ($35k)",
        trigger_text  = "Oylik sotuv $35,000 ga yetganda Istanbul sayohati 4 kun",
        period        = "monthly",
        target_role   = "hunter",
        rule_type     = "manual",
        value_kind    = "fixed_usd",
        value         = 600.0,
        is_active     = True,
    ),
    BonusRule(
        name          = "Hunter – Istanbul bonus ($50k)",
        trigger_text  = "Oylik sotuv $50,000 ga yetganda Istanbul sayohati 4 kun",
        period        = "monthly",
        target_role   = "hunter",
        rule_type     = "manual",
        value_kind    = "fixed_usd",
        value         = 600.0,
        is_active     = True,
    ),
]

# ──────────────────────────────────────────────────────────────────────────────
# TARIFLAR
# ──────────────────────────────────────────────────────────────────────────────
TARIFLAR = [
    # ── Logotip tariflari (image 4) ───────────────────────────────────────────
    Tarif(
        service_type   = "logotip",
        name           = "Mountain",
        loyiha_summasi = 7_000_000,
        variant_klass  = "3+3 variant | 1 klass",
        harf_oralighi  = "—",
        tekshiruvlar   = 0,
        deadline_mijoz = "18 ish kuni (12+6)",
        hudud          = "Xalqaro",
        jami_summa     = 12_000_000,
        sort_order     = 1,
        is_active      = True,
    ),
    Tarif(
        service_type   = "logotip",
        name           = "Everest",
        loyiha_summasi = 7_000_000,
        variant_klass  = "3+3 variant | 1 klass",
        harf_oralighi  = "—",
        tekshiruvlar   = 0,
        deadline_mijoz = "18 ish kuni (12+6)",
        hudud          = "Xalqaro",
        jami_summa     = 12_000_000,
        sort_order     = 2,
        is_active      = True,
    ),
    Tarif(
        service_type   = "logotip",
        name           = "Tibet",
        loyiha_summasi = 2_000_000,
        variant_klass  = "2+2 variant | 1 klass",
        harf_oralighi  = "—",
        tekshiruvlar   = 0,
        deadline_mijoz = "14 ish kuni (10+4)",
        hudud          = "Mahalliy",
        jami_summa     = 5_000_000,
        sort_order     = 3,
        is_active      = True,
    ),
    Tarif(
        service_type   = "logotip",
        name           = "Alp",
        loyiha_summasi = 1_500_000,
        variant_klass  = "2+2 variant | 1 klass",
        harf_oralighi  = "—",
        tekshiruvlar   = 0,
        deadline_mijoz = "10 ish kuni",
        hudud          = "Mahalliy",
        jami_summa     = 3_500_000,
        sort_order     = 4,
        is_active      = True,
    ),
    # ── Neyming tariflari (image 5 + user text) ───────────────────────────────
    Tarif(
        service_type   = "neyming",
        name           = "Light",
        loyiha_summasi = 1_000_000,
        variant_klass  = "3+3 / 1 klass",
        harf_oralighi  = "6-8 harf",
        tekshiruvlar   = 0,
        deadline_mijoz = "700k + 800k",
        hudud          = "Mahalliy",
        jami_summa     = 2_500_000,
        sort_order     = 1,
        is_active      = True,
    ),
    Tarif(
        service_type   = "neyming",
        name           = "Air",
        loyiha_summasi = 1_500_000,
        variant_klass  = "3+3+3 / 2 klass",
        harf_oralighi  = "6-8 harf",
        tekshiruvlar   = 1,
        deadline_mijoz = "1 000k + 1 000k",
        hudud          = "Mahalliy",
        jami_summa     = 3_500_000,
        sort_order     = 2,
        is_active      = True,
    ),
    Tarif(
        service_type   = "neyming",
        name           = "Marine",
        loyiha_summasi = 2_000_000,
        variant_klass  = "4+4+4 / 3 klass",
        harf_oralighi  = "5-7 harf",
        tekshiruvlar   = 1,
        deadline_mijoz = "1 500k + 1 500k",
        hudud          = "Mahalliy",
        jami_summa     = 5_000_000,
        sort_order     = 3,
        is_active      = True,
    ),
    Tarif(
        service_type   = "neyming",
        name           = "Premier",
        loyiha_summasi = 6_000_000,
        variant_klass  = "5+5+5 / 3 klass (3 davlat)",
        harf_oralighi  = "6-8 harf",
        tekshiruvlar   = 1,
        deadline_mijoz = "2 000k + 2 000k",
        hudud          = "Xalqaro",
        jami_summa     = 10_000_000,
        sort_order     = 4,
        is_active      = True,
    ),
    Tarif(
        service_type   = "neyming",
        name           = "Premier (mahalliy)",
        loyiha_summasi = 5_000_000,
        variant_klass  = "5+5+5 / 3 klass",
        harf_oralighi  = "4-6 harf",
        tekshiruvlar   = 1,
        deadline_mijoz = "1 500k + 1 500k",
        hudud          = "Mahalliy",
        jami_summa     = 8_000_000,
        sort_order     = 5,
        is_active      = True,
    ),
]

# ──────────────────────────────────────────────────────────────────────────────
# INSERT
# ──────────────────────────────────────────────────────────────────────────────
def main():
    with Session(engine) as s:
        for r in KPI_RULES:
            s.add(r)
        for r in BONUS_RULES:
            s.add(r)
        for t in TARIFLAR:
            s.add(t)
        s.commit()

    print(f"✓ Inserted {len(KPI_RULES)} KPI rules")
    print(f"✓ Inserted {len(BONUS_RULES)} bonus rules")
    print(f"✓ Inserted {len(TARIFLAR)} tarifs")
    print()
    print("Closer fix (oylik):")
    print("  fix_base_uzs    = 3,900,000  (150,000 × 26 kun)")
    print("  attendance/week = 200,000    (800,000 / 4)")
    print("  report/week     = 125,000    (500,000 / 4)")
    print()
    print("Hunter fix (oylik):")
    print("  fix_base_uzs    = 2,600,000  (100,000 × 26 kun)")
    print("  attendance/week = 250,000    (1,000,000 / 4)")
    print("  report/week     = 125,000    (500,000 / 4)")
    print()
    print("Hunter meeting bonus: 30,000 UZS online / 60,000 UZS offline (manual monthly)")
    print("Hunter travel bonus : Istanbul $600 at $35k or $50k (manual)")

if __name__ == "__main__":
    main()

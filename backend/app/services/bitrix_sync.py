"""Bitrix24 → PostgreSQL sync service.

Two modes:
  full   — fetches all records, upserts everything (on startup if DB empty)
  incremental — fetches only records modified since last sync (runs every 10 min)
"""
import logging
import threading
import time
from datetime import datetime, timedelta
from typing import Any

from sqlmodel import Session, select, text

from app.bx_models import BxActivity, BxDeal, BxLead, BxSyncState, BxUser
from app.db_bx import bx_engine
from app.services import bitrix as bx

log = logging.getLogger(__name__)

_INCREMENTAL_INTERVAL = 10 * 60   # 10 minutes
_FULL_SYNC_INTERVAL   = 12 * 3600  # 12 hours (nightly re-sync)


# ── helpers ──────────────────────────────────────────────────────────

def _get_last_sync(session: Session, entity: str) -> datetime | None:
    row = session.get(BxSyncState, entity)
    return row.last_sync if row else None


def _set_last_sync(session: Session, entity: str, total: int) -> None:
    row = session.get(BxSyncState, entity)
    if row:
        row.last_sync = datetime.utcnow()
        row.total_rows = total
    else:
        row = BxSyncState(entity=entity, last_sync=datetime.utcnow(), total_rows=total)
    session.add(row)
    session.commit()


def _parse_dt(s: Any) -> datetime | None:
    if not s:
        return None
    try:
        from dateutil.parser import parse
        return parse(str(s)).replace(tzinfo=None)
    except Exception:
        return None


def _uf_val(raw: Any) -> str | None:
    """Extract first value from Bitrix24 enum field (may be list or scalar)."""
    if raw is None:
        return None
    if isinstance(raw, list):
        return str(raw[0]) if raw else None
    return str(raw)


# ── entity sync functions ─────────────────────────────────────────────

def sync_users(session: Session, incremental: bool = True) -> int:
    last = _get_last_sync(session, "users")
    f = {}
    if incremental and last:
        f[">=TIMESTAMP_X"] = (last - timedelta(minutes=5)).isoformat()

    raw = bx._paginate("user.get.json", filter_dict={"ACTIVE": "Y"} | f)[0]
    for u in raw:
        obj = BxUser(
            id=int(u["ID"]),
            name=u.get("NAME"),
            last_name=u.get("LAST_NAME"),
            email=u.get("EMAIL"),
            active=u.get("ACTIVE", "Y") == "Y",
            work_position=u.get("WORK_POSITION"),
            synced_at=datetime.utcnow(),
        )
        session.merge(obj)
    session.commit()
    _set_last_sync(session, "users", session.exec(select(BxUser)).all().__len__())
    log.info("sync_users: upserted %d rows", len(raw))
    return len(raw)


def sync_leads(session: Session, incremental: bool = True) -> int:
    last = _get_last_sync(session, "leads")
    f: dict = {}
    if incremental and last:
        f[">=DATE_MODIFY"] = (last - timedelta(minutes=5)).isoformat()

    select_fields = [
        "ID", "ASSIGNED_BY_ID", "STATUS_ID", "OPPORTUNITY", "SOURCE_ID",
        "UTM_SOURCE", "UTM_MEDIUM", "UTM_CAMPAIGN", "UTM_CONTENT", "UTM_TERM",
        "DATE_CREATE", "DATE_MODIFY",
        "UF_CRM_1775825731211", "UF_CRM_1777030859057",
        "UF_CRM_1775824803703", "UF_CRM_1775825155935", "UF_CRM_1770281264686",
    ]
    raw, _ = bx._paginate("crm.lead.list", filter_dict=f, select=select_fields)

    for r in raw:
        obj = BxLead(
            id=int(r["ID"]),
            assigned_by_id=int(r["ASSIGNED_BY_ID"]) if r.get("ASSIGNED_BY_ID") else None,
            status_id=r.get("STATUS_ID"),
            opportunity=float(r.get("OPPORTUNITY") or 0),
            source_id=r.get("SOURCE_ID") or None,
            utm_source=r.get("UTM_SOURCE") or None,
            utm_medium=r.get("UTM_MEDIUM") or None,
            utm_campaign=r.get("UTM_CAMPAIGN") or None,
            utm_content=r.get("UTM_CONTENT") or None,
            utm_term=r.get("UTM_TERM") or None,
            date_create=_parse_dt(r.get("DATE_CREATE")),
            date_modify=_parse_dt(r.get("DATE_MODIFY")),
            uf_segment=_uf_val(r.get("UF_CRM_1775825731211")),
            uf_filial=_uf_val(r.get("UF_CRM_1777030859057")),
            uf_service=_uf_val(r.get("UF_CRM_1775824803703")),
            uf_activity=_uf_val(r.get("UF_CRM_1775825155935")),
            uf_with_whom=_uf_val(r.get("UF_CRM_1770281264686")),
            synced_at=datetime.utcnow(),
        )
        session.merge(obj)

    session.commit()
    total = session.exec(text("SELECT COUNT(*) FROM bx_leads")).one()[0]
    _set_last_sync(session, "leads", total)
    log.info("sync_leads: upserted %d, DB total %d", len(raw), total)
    return len(raw)


def sync_deals(session: Session, incremental: bool = True) -> int:
    last = _get_last_sync(session, "deals")
    f: dict = {}
    if incremental and last:
        f[">=DATE_MODIFY"] = (last - timedelta(minutes=5)).isoformat()

    select_fields = [
        "ID", "ASSIGNED_BY_ID", "STAGE_ID", "OPPORTUNITY", "CURRENCY_ID",
        "SOURCE_ID", "UTM_SOURCE", "DATE_CREATE", "CLOSEDATE",
    ]
    raw, _ = bx._paginate("crm.deal.list", filter_dict=f, select=select_fields)

    for r in raw:
        obj = BxDeal(
            id=int(r["ID"]),
            assigned_by_id=int(r["ASSIGNED_BY_ID"]) if r.get("ASSIGNED_BY_ID") else None,
            stage_id=r.get("STAGE_ID"),
            opportunity=float(r.get("OPPORTUNITY") or 0),
            currency_id=r.get("CURRENCY_ID") or None,
            source_id=r.get("SOURCE_ID") or None,
            utm_source=r.get("UTM_SOURCE") or None,
            date_create=_parse_dt(r.get("DATE_CREATE")),
            closedate=_parse_dt(r.get("CLOSEDATE")),
            synced_at=datetime.utcnow(),
        )
        session.merge(obj)

    session.commit()
    total = session.exec(text("SELECT COUNT(*) FROM bx_deals")).one()[0]
    _set_last_sync(session, "deals", total)
    log.info("sync_deals: upserted %d, DB total %d", len(raw), total)
    return len(raw)


def sync_activities(session: Session, incremental: bool = True) -> int:
    last = _get_last_sync(session, "activities")
    f: dict = {}
    if incremental and last:
        f[">=CREATED"] = (last - timedelta(minutes=5)).isoformat()

    select_fields = ["ID", "RESPONSIBLE_ID", "COMPLETED", "DIRECTION",
                     "PROVIDER_TYPE_ID", "CREATED"]
    raw, _ = bx._paginate("crm.activity.list", filter_dict=f, select=select_fields)

    for r in raw:
        obj = BxActivity(
            id=int(r["ID"]),
            responsible_id=int(r["RESPONSIBLE_ID"]) if r.get("RESPONSIBLE_ID") else None,
            completed=r.get("COMPLETED") == "Y",
            direction=int(r["DIRECTION"]) if r.get("DIRECTION") else None,
            provider_type_id=r.get("PROVIDER_TYPE_ID") or None,
            created=_parse_dt(r.get("CREATED")),
            synced_at=datetime.utcnow(),
        )
        session.merge(obj)

    session.commit()
    total = session.exec(text("SELECT COUNT(*) FROM bx_activities")).one()[0]
    _set_last_sync(session, "activities", total)
    log.info("sync_activities: upserted %d, DB total %d", len(raw), total)
    return len(raw)


# ── sync runner ───────────────────────────────────────────────────────

def run_sync(incremental: bool = True) -> None:
    mode = "incremental" if incremental else "full"
    log.info("bx_sync [%s]: starting", mode)
    with Session(bx_engine) as session:
        try:
            sync_users(session, incremental=incremental)
        except Exception as e:
            log.warning("bx_sync users failed: %s", e)
        try:
            sync_leads(session, incremental=incremental)
        except Exception as e:
            log.warning("bx_sync leads failed: %s", e)
        try:
            sync_deals(session, incremental=incremental)
        except Exception as e:
            log.warning("bx_sync deals failed: %s", e)
        try:
            sync_activities(session, incremental=incremental)
        except Exception as e:
            log.warning("bx_sync activities failed: %s", e)
    log.info("bx_sync [%s]: done", mode)


def _db_is_empty() -> bool:
    try:
        with Session(bx_engine) as s:
            count = s.exec(text("SELECT COUNT(*) FROM bx_leads")).one()[0]
            return count == 0
    except Exception:
        return True


def start_sync_worker() -> None:
    """Launch background sync thread. Call once at startup."""
    def _worker():
        time.sleep(3)  # let uvicorn finish binding
        # Full sync if DB is empty, incremental otherwise
        incremental = not _db_is_empty()
        run_sync(incremental=incremental)

        last_full = time.time()
        while True:
            time.sleep(_INCREMENTAL_INTERVAL)
            full = (time.time() - last_full) >= _FULL_SYNC_INTERVAL
            run_sync(incremental=not full)
            if full:
                last_full = time.time()

    t = threading.Thread(target=_worker, daemon=True, name="bx-sync")
    t.start()
    log.info("bx_sync worker started")

"""SQLModel tables synced from Bitrix24 → PostgreSQL."""
from datetime import datetime
from typing import Optional
from sqlmodel import Field, SQLModel


class BxUser(SQLModel, table=True):
    __tablename__ = "bx_users"

    id: int = Field(primary_key=True)
    name: Optional[str] = None
    last_name: Optional[str] = None
    email: Optional[str] = None
    active: bool = Field(default=True)
    work_position: Optional[str] = None
    synced_at: datetime = Field(default_factory=datetime.utcnow)


class BxLead(SQLModel, table=True):
    __tablename__ = "bx_leads"

    id: int = Field(primary_key=True)
    assigned_by_id: Optional[int] = Field(default=None, index=True)
    status_id: Optional[str] = Field(default=None, index=True)
    opportunity: float = Field(default=0.0)
    source_id: Optional[str] = Field(default=None, index=True)
    utm_source: Optional[str] = None
    utm_medium: Optional[str] = None
    utm_campaign: Optional[str] = None
    utm_content: Optional[str] = None
    utm_term: Optional[str] = None
    date_create: Optional[datetime] = Field(default=None, index=True)
    date_modify: Optional[datetime] = Field(default=None, index=True)
    # Segment custom fields
    uf_segment: Optional[str] = None    # UF_CRM_1775825731211
    uf_filial: Optional[str] = None     # UF_CRM_1777030859057
    uf_service: Optional[str] = None    # UF_CRM_1775824803703
    uf_activity: Optional[str] = None   # UF_CRM_1775825155935
    uf_with_whom: Optional[str] = None  # UF_CRM_1770281264686
    synced_at: datetime = Field(default_factory=datetime.utcnow)


class BxDeal(SQLModel, table=True):
    __tablename__ = "bx_deals"

    id: int = Field(primary_key=True)
    assigned_by_id: Optional[int] = Field(default=None, index=True)
    stage_id: Optional[str] = Field(default=None, index=True)
    opportunity: float = Field(default=0.0)
    currency_id: Optional[str] = None
    source_id: Optional[str] = Field(default=None, index=True)
    utm_source: Optional[str] = None
    date_create: Optional[datetime] = Field(default=None, index=True)
    closedate: Optional[datetime] = Field(default=None, index=True)
    synced_at: datetime = Field(default_factory=datetime.utcnow)


class BxActivity(SQLModel, table=True):
    __tablename__ = "bx_activities"

    id: int = Field(primary_key=True)
    responsible_id: Optional[int] = Field(default=None, index=True)
    completed: bool = Field(default=False)
    direction: Optional[int] = None
    provider_type_id: Optional[str] = None
    created: Optional[datetime] = Field(default=None, index=True)
    synced_at: datetime = Field(default_factory=datetime.utcnow)


class BxSyncState(SQLModel, table=True):
    """Tracks last successful sync timestamps per entity."""
    __tablename__ = "bx_sync_state"

    entity: str = Field(primary_key=True)  # leads | deals | users | activities
    last_sync: datetime = Field(default_factory=datetime.utcnow)
    total_rows: int = Field(default=0)


class BxCache(SQLModel, table=True):
    __tablename__ = "bx_cache"

    key: str = Field(primary_key=True)
    value: str  # JSON serialized string
    expires_at: datetime = Field(index=True)


class BxLock(SQLModel, table=True):
    __tablename__ = "bx_locks"

    key: str = Field(primary_key=True)
    token: str
    expires_at: datetime = Field(index=True)

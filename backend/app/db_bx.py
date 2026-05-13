"""PostgreSQL engine for Bitrix24 sync tables (bx_leads, bx_deals, bx_users, bx_activities)."""
import os
from sqlmodel import Session, SQLModel, create_engine

DATABASE_URL = os.environ.get("DATABASE_URL", "")

if not DATABASE_URL:
    raise RuntimeError("DATABASE_URL env var is not set")

bx_engine = create_engine(DATABASE_URL, pool_size=5, max_overflow=10, echo=False)


def init_bx_db() -> None:
    from app import bx_models  # noqa: F401
    SQLModel.metadata.create_all(bx_engine)


def get_bx_session() -> Session:
    return Session(bx_engine)

"""PostgreSQL engine for Bitrix24 sync tables (bx_leads, bx_deals, bx_users, bx_activities)."""
import os
from sqlmodel import Session, SQLModel, create_engine

DATABASE_URL = os.environ.get("DATABASE_URL", "")

# Make the Bitrix/Postgres engine optional so the API can run without a DB.
if DATABASE_URL:
    bx_engine = create_engine(
        DATABASE_URL,
        pool_size=5,
        max_overflow=10,
        echo=False,
        connect_args={"options": "-c timezone=Asia/Tashkent"},
    )

    def init_bx_db() -> None:
        from app import bx_models  # noqa: F401
        SQLModel.metadata.create_all(bx_engine)

    def get_bx_session() -> Session:
        return Session(bx_engine)
else:
    bx_engine = None

    def init_bx_db() -> None:
        # No-op when DATABASE_URL is not configured.
        return

    def get_bx_session() -> Session:
        raise RuntimeError("DATABASE_URL is not set; Bitrix DB session is unavailable")

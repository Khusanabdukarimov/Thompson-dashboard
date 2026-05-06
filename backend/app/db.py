"""SQLite database engine + session helper."""
from pathlib import Path

from sqlmodel import Session, SQLModel, create_engine

APP_DIR = Path(__file__).resolve().parent          # backend/app/
BACKEND_DIR = APP_DIR.parent                       # backend/
DB_DIR = BACKEND_DIR / "data"
DB_DIR.mkdir(exist_ok=True)
DB_PATH = DB_DIR / "mountain.db"

engine = create_engine(
    f"sqlite:///{DB_PATH}",
    connect_args={"check_same_thread": False},
    echo=False,
)


def _migrate_columns() -> None:
    """Add new columns to existing tables (idempotent — ignores duplicate-column errors)."""
    from sqlalchemy import text
    migrations = [
        "ALTER TABLE employees_extra ADD COLUMN login TEXT",
        "ALTER TABLE employees_extra ADD COLUMN password_hash TEXT",
        "ALTER TABLE employees_extra ADD COLUMN dashboard_role TEXT NOT NULL DEFAULT ''",
    ]
    with engine.connect() as conn:
        for sql in migrations:
            try:
                conn.execute(text(sql))
                conn.commit()
            except Exception:
                pass  # column already exists


def init_db() -> None:
    """Create all tables (idempotent)."""
    # Import models so SQLModel.metadata picks them up
    from app import models  # noqa: F401
    SQLModel.metadata.create_all(engine)
    _migrate_columns()


def get_session() -> Session:
    return Session(engine)

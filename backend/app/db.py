"""SQLite database engine + session helper."""
from pathlib import Path
from sqlmodel import SQLModel, create_engine, Session


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


def init_db() -> None:
    """Create all tables (idempotent)."""
    # Import models so SQLModel.metadata picks them up
    from app import models  # noqa: F401
    SQLModel.metadata.create_all(engine)


def get_session() -> Session:
    return Session(engine)

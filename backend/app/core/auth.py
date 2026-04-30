"""Lightweight JWT auth — opt-in via AUTH_ENABLED env var.

When `AUTH_ENABLED` is not "true", auth middleware is bypassed entirely and
the app behaves as before (no breaking change for existing deployments).

When enabled:
- POST /api/auth/login {password} → {access_token}
- GET  /api/auth/me                → {username}
- All other /api/* routes require `Authorization: Bearer <token>`
"""
import os
from datetime import datetime, timedelta
from typing import Optional

import jwt
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel


JWT_SECRET = os.getenv("JWT_SECRET", "dev-insecure-change-me-via-env")
JWT_ALGO = "HS256"
JWT_EXPIRE_HOURS = 24 * 7  # 7 days

ADMIN_USERNAME = os.getenv("ADMIN_USERNAME", "admin")
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "")
AUTH_ENABLED = os.getenv("AUTH_ENABLED", "false").lower() == "true"


def is_auth_enabled() -> bool:
    return AUTH_ENABLED and bool(ADMIN_PASSWORD)


def create_token(username: str) -> str:
    payload = {
        "sub": username,
        "iat": datetime.utcnow(),
        "exp": datetime.utcnow() + timedelta(hours=JWT_EXPIRE_HOURS),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGO)


def verify_token(token: str) -> Optional[dict]:
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGO])
    except jwt.PyJWTError:
        return None


# ────────────────────────────────────────────────────────────────────
# Routes
# ────────────────────────────────────────────────────────────────────
router = APIRouter(prefix="/api/auth", tags=["auth"])


class LoginIn(BaseModel):
    username: Optional[str] = None
    password: str


@router.get("/status")
def auth_status() -> dict:
    """Expose whether auth is enforced on this deployment."""
    return {"enabled": is_auth_enabled(), "admin_username": ADMIN_USERNAME if is_auth_enabled() else None}


@router.post("/login")
def login(payload: LoginIn) -> dict:
    if not is_auth_enabled():
        # When auth disabled, return stub token (frontend can still call /me)
        return {"access_token": "auth-disabled", "token_type": "bearer", "username": "anon"}
    if not ADMIN_PASSWORD:
        raise HTTPException(status_code=500, detail="ADMIN_PASSWORD env not set")
    if payload.password != ADMIN_PASSWORD:
        raise HTTPException(status_code=401, detail="Login yoki parol noto'g'ri")
    if payload.username and payload.username != ADMIN_USERNAME:
        raise HTTPException(status_code=401, detail="Login yoki parol noto'g'ri")
    token = create_token(ADMIN_USERNAME)
    return {"access_token": token, "token_type": "bearer", "username": ADMIN_USERNAME}


@router.get("/me")
def me(request: Request) -> dict:
    if not is_auth_enabled():
        return {"username": "anon", "auth_enabled": False}
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Auth required")
    payload = verify_token(auth[7:])
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    return {"username": payload.get("sub", ""), "auth_enabled": True}


# ────────────────────────────────────────────────────────────────────
# Middleware factory — register on app
# ────────────────────────────────────────────────────────────────────
def install_auth_middleware(app):
    """Install on FastAPI app to enforce auth on /api/* (when enabled)."""

    PUBLIC_PREFIXES = (
        "/api/auth/",        # login, status
        "/api/openapi.json", # docs
        "/api/docs",
        "/api/config",       # bootstrap config (no secrets)
    )

    @app.middleware("http")
    async def _auth_mw(request: Request, call_next):
        if not is_auth_enabled():
            return await call_next(request)
        path = request.url.path
        if not path.startswith("/api/"):
            return await call_next(request)
        if any(path.startswith(p) for p in PUBLIC_PREFIXES):
            return await call_next(request)
        auth = request.headers.get("Authorization", "")
        if not auth.startswith("Bearer "):
            return JSONResponse({"detail": "Auth required"}, status_code=401)
        if not verify_token(auth[7:]):
            return JSONResponse({"detail": "Invalid or expired token"}, status_code=401)
        return await call_next(request)

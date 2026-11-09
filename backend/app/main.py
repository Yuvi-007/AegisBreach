"""FastAPI application.

Run from backend/ with settings from the repo's .env file:
    uvicorn app.main:app --env-file ../.env
"""

import logging
import os
from typing import Any

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1.router import api_router
from app.core.security import (
    API_KEY_ENV,
    API_KEY_HEADER,
    auth_disabled_for_development,
    configured_api_key,
)

logger = logging.getLogger(__name__)

API_TITLE = "AegisBreach API"
API_VERSION = "1.0.0"
# Local frontend dev servers (Vite, CRA/Next). Override with a comma-separated list.
DEFAULT_CORS_ORIGINS = (
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
)


def cors_origins() -> list[str]:
    raw = os.environ.get("AEGIS_CORS_ORIGINS", "")
    origins = [o.strip() for o in raw.split(",") if o.strip()]
    return origins or list(DEFAULT_CORS_ORIGINS)


def create_app() -> FastAPI:
    app = FastAPI(title=API_TITLE, version=API_VERSION)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=cors_origins(),
        allow_credentials=False,
        allow_methods=["GET", "POST"],
        allow_headers=["Content-Type", API_KEY_HEADER],
    )
    if auth_disabled_for_development():
        logger.warning("%s is not set and AEGIS_ENV=development: API authentication is OFF", API_KEY_ENV)
    elif configured_api_key() is None:
        logger.warning("%s is not set: all protected API routes will return 401", API_KEY_ENV)
    app.include_router(api_router, prefix="/api/v1")

    @app.get("/", tags=["health"])
    def root() -> dict[str, Any]:
        return {"service": API_TITLE, "version": API_VERSION, "status": "ok", "docs": "/docs"}

    return app


app = create_app()

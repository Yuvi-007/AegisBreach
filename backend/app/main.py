"""FastAPI application.

Run from backend/ with settings from the repo's .env file:
    uvicorn app.main:app --env-file ../.env

If a built frontend is present (backend/app/static/index.html, or the folder
named by AEGIS_STATIC_DIR), it is served from "/" alongside the API.
"""

import logging
import os
from pathlib import Path
from typing import Any

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.responses import Response
from starlette.types import Scope

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


STATIC_DIR_ENV = "AEGIS_STATIC_DIR"
DEFAULT_STATIC_DIR = Path(__file__).resolve().parent / "static"
# First path segments the frontend fallback must never answer, so a mistyped
# API or docs URL still gets a real 404 instead of the app's HTML.
RESERVED_SEGMENTS = frozenset({"api", "docs", "redoc", "openapi.json"})


class SPAStaticFiles(StaticFiles):
    """Serve the built frontend; unknown non-API paths get index.html.

    Lets client-side routes such as /runs/<id> load the app on refresh.
    """

    async def get_response(self, path: str, scope: Scope) -> Response:
        try:
            return await super().get_response(path, scope)
        except StarletteHTTPException as exc:
            # Starlette normalizes path with os.path, so it uses "\" on Windows.
            first_segment = path.replace(os.sep, "/").split("/", 1)[0]
            if exc.status_code != 404 or first_segment in RESERVED_SEGMENTS:
                raise
            return await super().get_response("index.html", scope)


def static_dir() -> Path | None:
    """The built frontend folder, or None if there is no index.html to serve."""
    raw = os.environ.get(STATIC_DIR_ENV, "").strip()
    directory = Path(raw) if raw else DEFAULT_STATIC_DIR
    return directory if (directory / "index.html").is_file() else None


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

    frontend = static_dir()
    if frontend is None:
        @app.get("/", tags=["health"])
        def root() -> dict[str, Any]:
            return {"service": API_TITLE, "version": API_VERSION, "status": "ok", "docs": "/docs"}
    else:
        # Mounted last, so API and docs routes registered above always win.
        app.mount("/", SPAStaticFiles(directory=frontend, html=True), name="frontend")
        logger.info("Serving frontend from %s", frontend)

    return app


app = create_app()

"""Liveness and engine status."""

from typing import Any

from fastapi import APIRouter

from app.core.store import ACTIVE_STATUSES, StoreDep
from app.engine import seed_loader
from app.engine.mutators.registry import get_default_registry

router = APIRouter(tags=["health"])


@router.get("/health")
def health(store: StoreDep) -> dict[str, Any]:
    runs = store.list_runs(limit=store.max_runs)
    return {
        "status": "ok",
        "engine": {
            "mutators": len(get_default_registry()),
            "suites": seed_loader.available_suites(),
            "active_runs": sum(r.status in ACTIVE_STATUSES for r in runs),
            "stored_runs": len(runs),
        },
    }

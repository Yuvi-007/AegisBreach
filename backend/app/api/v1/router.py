"""All /api/v1 routes. Everything except /health requires an X-API-Key header."""

from fastapi import APIRouter, Depends

from app.api.v1.endpoints import benchmarks, health
from app.core.security import verify_api_key

api_router = APIRouter()
api_router.include_router(health.router)
api_router.include_router(benchmarks.router, dependencies=[Depends(verify_api_key)])

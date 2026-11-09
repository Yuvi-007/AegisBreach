"""All /api/v1 routes."""

from fastapi import APIRouter

from app.api.v1.endpoints import benchmarks, health

api_router = APIRouter()
api_router.include_router(health.router)
api_router.include_router(benchmarks.router)

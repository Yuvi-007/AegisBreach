"""Mutator/suite catalogue and benchmark run endpoints."""

import asyncio
import logging
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, HTTPException, Query, status

from app.core.security import validate_target_url
from app.core.store import RunRecord, RunStore, StoreDep, TooManyActiveRunsError
from app.engine import seed_loader
from app.engine.mutators.registry import MutatorNotFoundError, get_default_registry
from app.engine.runner import BenchmarkRunner
from app.engine.seed_loader import BenchmarkSeed, SeedLoadError
from app.engine.targets.base import BaseTargetAdapter
from app.engine.targets.mock import MockTargetAdapter
from app.engine.targets.nemo_shield import CHAT_PATH, NeMoShieldTargetAdapter
from app.schemas.benchmarks import (
    MutatorInfoResponse,
    RunBenchmarkRequest,
    RunBenchmarkResponse,
    RunDetailResponse,
    RunSummaryResponse,
    SuiteInfoResponse,
    TargetType,
)

logger = logging.getLogger(__name__)
router = APIRouter(tags=["benchmarks"])

MOCK_TARGET_URL = "mock://local"
BENCHMARKS_DIR = seed_loader.DEFAULT_BENCHMARKS_DIR
SUITE_DISPLAY_NAMES = {
    "owasp_llm_top10": "OWASP LLM Top 10",
    "benign_controls": "Benign Controls",
}


# --- catalogue --------------------------------------------------------------------

@router.get("/mutators", response_model=list[MutatorInfoResponse])
def list_mutators() -> list[dict[str, str]]:
    return get_default_registry().describe()


@router.get("/suites", response_model=list[SuiteInfoResponse])
def list_suites() -> list[SuiteInfoResponse]:
    suites = []
    for suite_id in seed_loader.available_suites(BENCHMARKS_DIR):
        try:
            seeds = seed_loader.load_suite(suite_id, BENCHMARKS_DIR)
        except SeedLoadError:
            # One broken file should not hide the others.
            logger.warning("Skipping invalid benchmark suite %s", suite_id, exc_info=True)
            continue
        suites.append(
            SuiteInfoResponse(
                suite_id=suite_id,
                name=SUITE_DISPLAY_NAMES.get(suite_id, suite_id.replace("_", " ").title()),
                total_seeds=len(seeds),
                categories=sorted({s.category for s in seeds}),
            )
        )
    return suites


# --- runs --------------------------------------------------------------------------

@router.post("/run", response_model=RunBenchmarkResponse, status_code=status.HTTP_202_ACCEPTED)
async def start_run(
    request: RunBenchmarkRequest,
    background_tasks: BackgroundTasks,
    store: StoreDep,
) -> RunBenchmarkResponse:
    """Check the request, then queue the run. Every check fails fast with 400."""
    seeds = _load_seeds(request.suite_names)
    _check_mutators(request.mutator_names)

    if request.target_type == "mock":
        target_url = MOCK_TARGET_URL
    else:
        target_url = _base_url(request.target_url or "")
        # DNS lookup is blocking; keep it off the event loop.
        ok, message = await asyncio.to_thread(validate_target_url, target_url)
        if not ok:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=f"Target URL rejected: {message}")

    try:
        record = store.create_run(
            target_type=request.target_type,
            target_url=target_url,
            suite_names=request.suite_names,
            mutator_names=request.mutator_names,
            max_concurrency=request.max_concurrency,
        )
    except TooManyActiveRunsError as exc:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, detail=str(exc)) from exc

    background_tasks.add_task(execute_run, store, record.run_id, seeds)
    return RunBenchmarkResponse(run_id=record.run_id, status=record.status, created_at=record.created_at)


@router.get("/runs", response_model=list[RunSummaryResponse])
def list_runs(
    store: StoreDep,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> list[RunRecord]:
    return store.list_runs(limit=limit, offset=offset)


@router.get("/runs/{run_id}", response_model=RunDetailResponse)
def get_run(run_id: str, store: StoreDep) -> RunRecord:
    record = store.get_run(run_id)
    if record is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail=f"Run {run_id!r} not found")
    return record


# --- background execution ----------------------------------------------------------

def build_adapter(target_type: TargetType, target_url: str) -> BaseTargetAdapter:
    if target_type == "mock":
        return MockTargetAdapter()
    return NeMoShieldTargetAdapter(target_url)


async def execute_run(store: RunStore, run_id: str, seeds: list[BenchmarkSeed]) -> None:
    """Run one benchmark and record the outcome. Never raises: failures mark the run FAILED."""
    record = store.update_run(run_id, status="RUNNING", started_at=datetime.now(UTC))
    try:
        async with build_adapter(record.target_type, record.target_url) as adapter:
            runner = BenchmarkRunner(adapter, max_concurrency=record.max_concurrency)
            metrics, results = await runner.run_suite(seeds, record.mutator_names)
    except Exception as exc:  # background job boundary: record, don't crash the server
        logger.exception("Benchmark run %s failed", run_id)
        store.update_run(
            run_id,
            status="FAILED",
            error=f"{type(exc).__name__}: {exc}",
            completed_at=datetime.now(UTC),
        )
        return
    store.update_run(
        run_id,
        status="COMPLETED",
        metrics=metrics,
        results=results,
        completed_at=datetime.now(UTC),
    )


# --- request checks ----------------------------------------------------------------

def _load_seeds(suite_names: list[str]) -> list[BenchmarkSeed]:
    seeds: list[BenchmarkSeed] = []
    for name in suite_names:
        try:
            seeds += seed_loader.load_suite(name, BENCHMARKS_DIR)
        except SeedLoadError as exc:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return seeds


def _check_mutators(names: list[str]) -> None:
    registry = get_default_registry()
    for name in names:
        try:
            registry.get(name)
        except MutatorNotFoundError as exc:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


def _base_url(url: str) -> str:
    """Accept either the target's base URL or its full chat endpoint URL."""
    url = url.rstrip("/")
    return url.removesuffix(CHAT_PATH) or url

"""Thread-safe, in-memory record of benchmark runs.

Runs live only as long as the process. The store is bounded so a busy server
cannot grow without limit: it keeps at most max_runs records (dropping the
oldest finished runs first) and refuses new runs past max_active_runs.
"""

import threading
import uuid
from collections import OrderedDict
from datetime import UTC, datetime
from typing import Annotated, Any

from fastapi import Depends
from pydantic import BaseModel, ConfigDict, Field

from app.engine.judge.evaluator import BenchmarkMetrics, EvaluationResult
from app.schemas.benchmarks import RunStatus, TargetType

ACTIVE_STATUSES = frozenset({"QUEUED", "RUNNING"})


class TooManyActiveRunsError(RuntimeError):
    """Raised when max_active_runs runs are already queued or running."""


class RunRecord(BaseModel):
    """Immutable snapshot of a run. Updates replace the stored record."""

    model_config = ConfigDict(frozen=True)

    run_id: str
    status: RunStatus = "QUEUED"
    target_type: TargetType
    target_url: str
    suite_names: list[str]
    mutator_names: list[str] = Field(default_factory=list)
    max_concurrency: int = 5
    metrics: BenchmarkMetrics | None = None
    results: list[EvaluationResult] = Field(default_factory=list)
    error: str | None = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    started_at: datetime | None = None
    completed_at: datetime | None = None


class RunStore:
    def __init__(self, max_runs: int = 100, max_active_runs: int = 5) -> None:
        if max_runs < 1 or max_active_runs < 1:
            raise ValueError("max_runs and max_active_runs must be at least 1")
        if max_active_runs > max_runs:
            raise ValueError("max_active_runs cannot exceed max_runs")
        self.max_runs = max_runs
        self.max_active_runs = max_active_runs
        self._runs: OrderedDict[str, RunRecord] = OrderedDict()
        self._lock = threading.Lock()

    def create_run(
        self,
        *,
        target_type: TargetType,
        target_url: str,
        suite_names: list[str],
        mutator_names: list[str] | None = None,
        max_concurrency: int = 5,
    ) -> RunRecord:
        record = RunRecord(
            run_id=str(uuid.uuid4()),
            target_type=target_type,
            target_url=target_url,
            suite_names=list(suite_names),
            mutator_names=list(mutator_names or []),
            max_concurrency=max_concurrency,
        )
        with self._lock:
            active = sum(r.status in ACTIVE_STATUSES for r in self._runs.values())
            if active >= self.max_active_runs:
                raise TooManyActiveRunsError(
                    f"{active} runs already in progress (limit {self.max_active_runs})"
                )
            self._runs[record.run_id] = record
            self._evict_finished()
        return record

    def get_run(self, run_id: str) -> RunRecord | None:
        with self._lock:
            return self._runs.get(run_id)

    def list_runs(self, limit: int = 20, offset: int = 0) -> list[RunRecord]:
        """Newest first."""
        if limit < 0 or offset < 0:
            raise ValueError("limit and offset must be >= 0")
        with self._lock:
            newest_first = list(reversed(self._runs.values()))
        return newest_first[offset : offset + limit]

    def update_run(self, run_id: str, /, **changes: Any) -> RunRecord:
        """Replace fields on a run. Unknown run ids raise KeyError; run_id itself can't change."""
        unknown = set(changes) - set(RunRecord.model_fields) | ({"run_id"} & set(changes))
        if unknown:
            raise ValueError(f"Cannot update fields: {sorted(unknown)}")
        with self._lock:
            current = self._runs[run_id]
            # Validate the merged record so a bad status or type is rejected.
            updated = RunRecord.model_validate({**current.model_dump(), **changes})
            self._runs[run_id] = updated
        return updated

    def __len__(self) -> int:
        with self._lock:
            return len(self._runs)

    def _evict_finished(self) -> None:
        """Drop the oldest finished runs until within max_runs. Caller holds the lock."""
        excess = len(self._runs) - self.max_runs
        if excess <= 0:
            return
        finished = [rid for rid, r in self._runs.items() if r.status not in ACTIVE_STATUSES]
        for run_id in finished[:excess]:
            del self._runs[run_id]


run_store = RunStore()


def get_run_store() -> RunStore:
    """FastAPI dependency; tests override it with a fresh store."""
    return run_store


StoreDep = Annotated[RunStore, Depends(get_run_store)]

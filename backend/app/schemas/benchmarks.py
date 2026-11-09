"""Request and response models for the benchmark API."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.engine.judge.evaluator import BenchmarkMetrics, EvaluationResult

TargetType = Literal["mock", "nemo_shield"]
RunStatus = Literal["QUEUED", "RUNNING", "COMPLETED", "FAILED"]
MAX_CONCURRENCY = 20


def _dedupe(values: list[str]) -> list[str]:
    return list(dict.fromkeys(values))


class RunBenchmarkRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    target_type: TargetType
    target_url: str | None = Field(
        default=None,
        max_length=2048,
        description="Base URL of the target, e.g. https://nemo-shield-api.onrender.com. "
        "Required for nemo_shield; ignored for mock.",
    )
    suite_names: list[str] = Field(min_length=1, max_length=20)
    mutator_names: list[str] = Field(default_factory=list, max_length=20)
    max_concurrency: int = Field(default=5, ge=1, le=MAX_CONCURRENCY)

    _dedupe_suites = field_validator("suite_names")(_dedupe)
    _dedupe_mutators = field_validator("mutator_names")(_dedupe)

    @model_validator(mode="after")
    def _url_required_for_remote_targets(self) -> "RunBenchmarkRequest":
        if self.target_type != "mock" and not self.target_url:
            raise ValueError(f"target_url is required for target_type {self.target_type!r}")
        return self


class RunBenchmarkResponse(BaseModel):
    run_id: str
    status: RunStatus
    created_at: datetime


class RunSummaryResponse(BaseModel):
    """One row of GET /runs: everything except the per-prompt results."""

    run_id: str
    status: RunStatus
    target_type: TargetType
    target_url: str
    suite_names: list[str]
    mutator_names: list[str]
    metrics: BenchmarkMetrics | None = None
    error: str | None = None
    created_at: datetime
    started_at: datetime | None = None
    completed_at: datetime | None = None


class RunDetailResponse(RunSummaryResponse):
    results: list[EvaluationResult] = Field(default_factory=list)


class MutatorInfoResponse(BaseModel):
    name: str
    description: str
    category: str


class SuiteInfoResponse(BaseModel):
    suite_id: str
    name: str
    total_seeds: int
    categories: list[str]

"""Run benchmark suites (optionally mutated) against a target, concurrently."""

import asyncio
import time
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any, Literal

import httpx

from app.engine.judge.evaluator import (
    BenchmarkMetrics,
    EvaluationResult,
    Outcome,
    calculate_metrics,
    evaluate_response,
)
from app.engine.mutators.registry import (
    MutatorRegistry,
    PipelineMode,
    get_default_registry,
)
from app.engine.seed_loader import MAX_PROMPT_CHARS, BenchmarkSeed
from app.engine.targets.base import BaseTargetAdapter

ORIGINAL = "original"
OverflowPolicy = Literal["skip", "truncate"]


@dataclass(frozen=True)
class _Case:
    seed: BenchmarkSeed
    prompt: str
    mutator: str
    truncated: bool = False


class BenchmarkRunner:
    """Send every seed (and its mutations) to a target and score the replies.

    max_concurrency caps in-flight requests, which keeps load on the target
    predictable; it limits parallelism, not request rate, so 429s are still
    reported as RATE_LIMITED rather than retried.

    Prompts longer than max_prompt_length are skipped by default. Truncating
    cuts off encoded or framed payloads, so the target would see a broken
    attack; use overflow="truncate" if you want that anyway.
    """

    def __init__(
        self,
        adapter: BaseTargetAdapter,
        max_concurrency: int = 5,
        max_prompt_length: int = MAX_PROMPT_CHARS,
        *,
        overflow: OverflowPolicy = "skip",
        registry: MutatorRegistry | None = None,
    ) -> None:
        if max_concurrency < 1:
            raise ValueError("max_concurrency must be at least 1")
        if max_prompt_length < 1:
            raise ValueError("max_prompt_length must be at least 1")
        if overflow not in ("skip", "truncate"):
            raise ValueError(f"overflow must be 'skip' or 'truncate', got {overflow!r}")
        self.adapter = adapter
        self.max_concurrency = max_concurrency
        self.max_prompt_length = max_prompt_length
        self.overflow = overflow
        self._registry = registry

    async def run_suite(
        self,
        seeds: Sequence[BenchmarkSeed],
        mutator_names: Sequence[str] = (),
        *,
        mode: PipelineMode = "independent",
        options: Mapping[str, Mapping[str, Any]] | None = None,
        include_original: bool = True,
    ) -> tuple[BenchmarkMetrics, list[EvaluationResult]]:
        """Run every case and return (metrics, results). Results keep input order."""
        cases, skipped = self._build_cases(seeds, mutator_names, mode, options, include_original)
        # A new semaphore per run: asyncio primitives can't be shared across event loops.
        semaphore = asyncio.Semaphore(self.max_concurrency)
        results = await asyncio.gather(*(self._run_case(case, semaphore) for case in cases))
        return calculate_metrics(results, skipped_prompts=skipped), list(results)

    def _build_cases(
        self,
        seeds: Sequence[BenchmarkSeed],
        mutator_names: Sequence[str],
        mode: PipelineMode,
        options: Mapping[str, Mapping[str, Any]] | None,
        include_original: bool,
    ) -> tuple[list[_Case], int]:
        registry = self._registry or get_default_registry()
        cases: list[_Case] = []
        skipped = 0
        for seed in seeds:
            candidates: list[tuple[str, str]] = []
            if include_original:
                candidates.append((ORIGINAL, seed.prompt))
            if mutator_names:
                candidates += [
                    (item["mutator"], item["variant"])
                    for item in registry.apply_pipeline(
                        seed.prompt, mutator_names, mode=mode, options=options
                    )
                ]

            seen: set[str] = set()
            for label, prompt in candidates:
                truncated = False
                if len(prompt) > self.max_prompt_length:
                    if self.overflow == "skip":
                        skipped += 1
                        continue
                    prompt, truncated = prompt[: self.max_prompt_length], True
                if prompt in seen:  # e.g. leetspeak on text with no mappable letters
                    continue
                seen.add(prompt)
                cases.append(_Case(seed, prompt, label, truncated))
        return cases, skipped

    async def _run_case(self, case: _Case, semaphore: asyncio.Semaphore) -> EvaluationResult:
        async with semaphore:
            start = time.perf_counter()
            try:
                response = await self.adapter.send_prompt(case.prompt)
            except (httpx.HTTPError, OSError) as exc:
                return EvaluationResult(
                    prompt=case.prompt,
                    original_seed_id=case.seed.id,
                    category=case.seed.category,
                    mutator=case.mutator,
                    expected_action=case.seed.expected_action,
                    outcome=Outcome.SYSTEM_ERROR,
                    latency_ms=(time.perf_counter() - start) * 1000,
                    status_code=0,
                    details={"error": type(exc).__name__, "message": str(exc), "truncated": case.truncated},
                )

        result = evaluate_response(
            case.seed.expected_action,
            response,
            case.prompt,
            seed_id=case.seed.id,
            category=case.seed.category,
            mutator=case.mutator,
        )
        result.details["truncated"] = case.truncated
        return result

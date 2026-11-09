"""Load and validate benchmark prompt suites from config/benchmarks/*.json."""

import json
from collections import Counter
from pathlib import Path
from typing import Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    TypeAdapter,
    ValidationError,
    model_validator,
)

ATTACK_CATEGORIES = ("prompt_injection", "system_prompt_leakage", "jailbreak", "pii_extraction")
BENIGN_CATEGORIES = ("customer_support", "summarization", "code_generation", "general_qa")
# NeMo-Shield rejects prompts longer than this with HTTP 422.
MAX_PROMPT_CHARS = 2000
# backend/app/engine/seed_loader.py -> repo root is three levels above engine/.
DEFAULT_BENCHMARKS_DIR = Path(__file__).resolve().parents[3] / "config" / "benchmarks"

SeedCategory = Literal[
    "prompt_injection",
    "system_prompt_leakage",
    "jailbreak",
    "pii_extraction",
    "customer_support",
    "summarization",
    "code_generation",
    "general_qa",
]


class SeedLoadError(Exception):
    """A seed file is missing, unreadable, malformed or fails validation."""


class BenchmarkSeed(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, str_strip_whitespace=True)

    id: str = Field(min_length=1, max_length=64)
    category: SeedCategory
    prompt: str = Field(min_length=1, max_length=MAX_PROMPT_CHARS)
    expected_action: Literal["block", "allow"]

    @model_validator(mode="after")
    def _action_matches_category(self) -> "BenchmarkSeed":
        expected = "block" if self.category in ATTACK_CATEGORIES else "allow"
        if self.expected_action != expected:
            raise ValueError(
                f"category {self.category!r} must have expected_action {expected!r}"
            )
        return self


_SEED_LIST = TypeAdapter(list[BenchmarkSeed])


def load_seeds(path: str | Path) -> list[BenchmarkSeed]:
    """Read one JSON array of seeds. Raises SeedLoadError with a readable reason."""
    path = Path(path)
    try:
        raw = path.read_text(encoding="utf-8")
    except FileNotFoundError:
        raise SeedLoadError(f"Seed file not found: {path}") from None
    except (OSError, UnicodeDecodeError) as exc:
        raise SeedLoadError(f"Could not read seed file {path}: {exc}") from exc

    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise SeedLoadError(
            f"{path.name} is not valid JSON (line {exc.lineno}, column {exc.colno}): {exc.msg}"
        ) from exc

    if not isinstance(data, list):
        raise SeedLoadError(f"{path.name} must contain a JSON array, got {type(data).__name__}")
    if not data:
        raise SeedLoadError(f"{path.name} contains no seeds")

    try:
        seeds = _SEED_LIST.validate_python(data)
    except ValidationError as exc:
        problems = "; ".join(
            f"[{'.'.join(str(p) for p in err['loc'])}] {err['msg']}" for err in exc.errors()
        )
        raise SeedLoadError(f"{path.name} has invalid seeds: {problems}") from exc

    _reject_duplicate_ids(seeds, path.name)
    return seeds


def available_suites(directory: str | Path | None = None) -> list[str]:
    """Names of the suites (JSON files) in the benchmarks directory."""
    directory = Path(directory) if directory is not None else DEFAULT_BENCHMARKS_DIR
    return sorted(p.stem for p in directory.glob("*.json"))


def load_suite(name: str, directory: str | Path | None = None) -> list[BenchmarkSeed]:
    """Load config/benchmarks/<name>.json. name must be a plain identifier."""
    if not name or not name.replace("_", "").replace("-", "").isalnum() or not name.isascii():
        raise SeedLoadError(f"Invalid suite name {name!r}: use letters, digits, '_' or '-'")
    directory = Path(directory) if directory is not None else DEFAULT_BENCHMARKS_DIR
    return load_seeds(directory / f"{name}.json")


def load_all_suites(directory: str | Path | None = None) -> dict[str, list[BenchmarkSeed]]:
    """Load every suite. Seed ids must be unique across all suites."""
    suites = {name: load_suite(name, directory) for name in available_suites(directory)}
    if not suites:
        raise SeedLoadError("No benchmark suites found")
    _reject_duplicate_ids([s for seeds in suites.values() for s in seeds], "benchmark suites")
    return suites


def _reject_duplicate_ids(seeds: list[BenchmarkSeed], where: str) -> None:
    duplicates = sorted(i for i, n in Counter(s.id for s in seeds).items() if n > 1)
    if duplicates:
        raise SeedLoadError(f"Duplicate seed ids in {where}: {duplicates}")

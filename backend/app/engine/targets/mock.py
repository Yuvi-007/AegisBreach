"""Offline target that behaves like a simple keyword-filtering gateway."""

import asyncio
import time
from collections.abc import Iterable

from app.engine.targets.base import BaseTargetAdapter, TargetResponse

DEFAULT_BLACKLIST = (
    "ignore previous",
    "override system",
    "admin password",
    "system prompt",
    "developer mode",
)
DEFAULT_DELAY_MS = 10.0
REFUSAL_MESSAGE = "Request blocked by gateway policy."
ALLOWED_MESSAGE = "Mock target processed the request."


class MockTargetAdapter(BaseTargetAdapter):
    """Blocks prompts containing a blacklisted phrase; allows everything else.

    Matching is case-insensitive and ignores repeated whitespace, but nothing
    more. That is deliberate: like many real keyword filters, it can be beaten
    by leetspeak, homoglyphs or zero-width characters, which lets the mutation
    engine show measurable bypasses without a network.
    """

    def __init__(
        self,
        *,
        blacklist: Iterable[str] = DEFAULT_BLACKLIST,
        delay_ms: float = DEFAULT_DELAY_MS,
        blocked_status: int = 403,
        name: str = "mock",
    ) -> None:
        if delay_ms < 0:
            raise ValueError("delay_ms must be >= 0")
        self.blacklist = tuple(_normalize(term) for term in blacklist)
        if not all(self.blacklist):
            raise ValueError("blacklist terms must not be empty")
        self.delay_ms = delay_ms
        self.blocked_status = blocked_status
        self.name = name
        self.target_url = "mock://local"

    def match(self, prompt: str) -> str | None:
        """Return the first blacklisted phrase found in prompt, if any."""
        normalized = _normalize(prompt)
        return next((term for term in self.blacklist if term in normalized), None)

    async def send_prompt(self, prompt: str) -> TargetResponse:
        start = time.perf_counter()
        if self.delay_ms:
            await asyncio.sleep(self.delay_ms / 1000)
        matched = self.match(prompt)
        latency_ms = (time.perf_counter() - start) * 1000

        if matched is not None:
            return TargetResponse(
                raw_response=REFUSAL_MESSAGE,
                status_code=self.blocked_status,
                latency_ms=latency_ms,
                is_blocked=True,
                refusal_phrase=REFUSAL_MESSAGE,
                metadata={"matched_term": matched},
            )
        return TargetResponse(
            raw_response=ALLOWED_MESSAGE,
            status_code=200,
            latency_ms=latency_ms,
            is_blocked=False,
        )


def _normalize(text: str) -> str:
    """Lower-case and collapse whitespace. Single pass each, so O(N)."""
    return " ".join(text.casefold().split())

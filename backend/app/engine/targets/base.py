"""Common interface for the systems AegisBreach sends prompts to."""

from abc import ABC, abstractmethod
from typing import Any, Self

from pydantic import BaseModel, Field


class TargetResponse(BaseModel):
    """What a target did with one prompt."""

    raw_response: str
    status_code: int
    latency_ms: float = Field(ge=0)
    is_blocked: bool
    refusal_phrase: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class BaseTargetAdapter(ABC):
    """Sends prompts to one target and reports whether each was blocked.

    Adapters can be used as async context managers so network clients get closed:

        async with NeMoShieldTargetAdapter() as target:
            result = await target.send_prompt("hello")
    """

    name: str
    target_url: str

    @abstractmethod
    async def send_prompt(self, prompt: str) -> TargetResponse:
        """Send one prompt and describe the target's reaction."""

    async def aclose(self) -> None:
        """Release resources. Adapters without any can keep this no-op."""

    async def __aenter__(self) -> Self:
        return self

    async def __aexit__(self, *exc_info: object) -> None:
        await self.aclose()

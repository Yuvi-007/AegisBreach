"""Adapter for the NeMo-Shield guardrail gateway (POST /api/v1/guard/chat)."""

import time
from typing import Any
from urllib.parse import urlparse

import httpx

from app.core.security import create_safe_client
from app.engine.targets.base import BaseTargetAdapter, TargetResponse

DEFAULT_BASE_URL = "https://nemo-shield-api.onrender.com"
CHAT_PATH = "/api/v1/guard/chat"
# Render's free tier can take 20s+ to wake up, so allow more than the client default.
DEFAULT_TIMEOUT = 30.0
BLOCKING_STATUS_CODES = frozenset({400, 403})
BLOCKED_VERDICT = "INPUT_BLOCKED"
# ChatResponse fields copied into TargetResponse.metadata when present.
_METADATA_FIELDS = {
    "verdict": "verdict",
    "threat_category": "threat_category",
    "confidence": "confidence",
    "rail_path": "rail_path",
    "latency_ms": "server_latency_ms",
}


class NeMoShieldTargetAdapter(BaseTargetAdapter):
    """Sends prompts to NeMo-Shield through the SSRF-safe HTTP client.

    A prompt counts as blocked when any of these hold:
      - the JSON body has "verdict": "INPUT_BLOCKED" (what NeMo-Shield returns,
        with HTTP 200);
      - the JSON body has "blocked": true (generic gateways);
      - the status code is 400 or 403.
    "OUTPUT_ALTERED" (PII redacted from the reply) is not a block; the verdict is
    kept in metadata so scoring can treat it separately. 422 (e.g. prompt over
    NeMo-Shield's 2,000-character limit) and 429 (rate limited) are request
    problems, not blocks, and are flagged in metadata["error"].

    Network errors, including SSRFBlockedError, are raised to the caller.
    """

    name = "nemo_shield"

    def __init__(
        self,
        base_url: str = DEFAULT_BASE_URL,
        *,
        timeout: float = DEFAULT_TIMEOUT,
        client: httpx.AsyncClient | None = None,
    ) -> None:
        """client is for tests. Leave it unset in real use so the pinned,
        SSRF-safe client from create_safe_client() is used."""
        parsed = urlparse(base_url)
        if parsed.scheme not in ("http", "https") or not parsed.hostname:
            raise ValueError(f"base_url must be an http(s) URL with a host, got {base_url!r}")
        if parsed.query or parsed.fragment:
            raise ValueError("base_url must not contain a query string or fragment")

        self.target_url = base_url.rstrip("/") + CHAT_PATH
        self._owns_client = client is None
        self._client = client if client is not None else create_safe_client(timeout=timeout)

    async def send_prompt(self, prompt: str) -> TargetResponse:
        start = time.perf_counter()
        response = await self._client.post(self.target_url, json={"prompt": prompt})
        latency_ms = (time.perf_counter() - start) * 1000
        return _parse_response(response, latency_ms)

    async def aclose(self) -> None:
        if self._owns_client:
            await self._client.aclose()


def _parse_response(response: httpx.Response, latency_ms: float) -> TargetResponse:
    text = response.text
    body = _json_object(response)
    status = response.status_code

    verdict = body.get("verdict")
    is_blocked = (
        verdict == BLOCKED_VERDICT
        or body.get("blocked") is True
        or status in BLOCKING_STATUS_CODES
    )

    metadata: dict[str, Any] = {
        out_key: body[in_key] for in_key, out_key in _METADATA_FIELDS.items() if in_key in body
    }
    reply = body.get("reply")
    if isinstance(reply, str):
        metadata["reply"] = reply
    if status == 422:
        metadata["error"] = "validation_error"
    elif status == 429:
        metadata["error"] = "rate_limited"
    elif status >= 500:
        metadata["error"] = "server_error"

    return TargetResponse(
        raw_response=text,
        status_code=status,
        latency_ms=latency_ms,
        is_blocked=is_blocked,
        refusal_phrase=_refusal_phrase(body, text) if is_blocked else None,
        metadata=metadata,
    )


def _json_object(response: httpx.Response) -> dict[str, Any]:
    """Parse the body as a JSON object; anything else becomes {}."""
    try:
        body = response.json()
    except ValueError:
        return {}
    return body if isinstance(body, dict) else {}


def _refusal_phrase(body: dict[str, Any], text: str) -> str | None:
    """The gateway's explanation for a block, from the first field that has one."""
    for key in ("reply", "message", "reason", "detail"):
        value = body.get(key)
        if isinstance(value, str) and value.strip():
            return value
    return text.strip() or None

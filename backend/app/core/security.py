"""Anti-SSRF helpers: validate target URLs and build a hardened HTTP client.

The client returned by create_safe_client resolves DNS once per connection,
checks every resolved IP, and connects to a checked IP directly. This closes
the DNS-rebinding gap where a host resolves to a public IP during validation
and to an internal IP when the request is actually sent.
"""

import hashlib
import ipaddress
import os
import secrets
import socket
from collections.abc import Awaitable, Callable, Iterable
from typing import Annotated, Any
from urllib.parse import urlparse

import anyio
import httpcore
import httpx
from fastapi import HTTPException, Security, status
from fastapi.security import APIKeyHeader

ALLOWED_SCHEMES = ("http", "https")
CLOUD_METADATA_IP = ipaddress.ip_address("169.254.169.254")
DEFAULT_TIMEOUT = 10.0

# Client options that must not be overridden: each one could route traffic
# around the pinned transport or follow a redirect to an unchecked host.
_FORBIDDEN_CLIENT_OPTIONS = ("transport", "mounts", "proxy")
# Client options that httpx ignores once a custom transport is given, so they
# are forwarded to the transport instead.
_TRANSPORT_OPTIONS = ("verify", "cert", "http1", "http2", "limits")

Resolver = Callable[[str, int], Awaitable[list[str]]]


class SSRFBlockedError(httpx.RequestError):
    """Raised when a request would connect to a restricted address."""


def is_safe_ip(ip_str: str) -> bool:
    """Return True only for a valid, publicly routable unicast IP address."""
    try:
        ip = ipaddress.ip_address(ip_str)
    except ValueError:
        return False

    # Check IPv4-mapped IPv6 (e.g. ::ffff:127.0.0.1) as the IPv4 address it wraps.
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped is not None:
        ip = ip.ipv4_mapped

    if ip == CLOUD_METADATA_IP:
        return False

    if (
        ip.is_private
        or ip.is_loopback
        or ip.is_link_local
        or ip.is_multicast
        or ip.is_reserved
        or ip.is_unspecified
    ):
        return False

    # Catches ranges not covered above, such as 100.64.0.0/10 (carrier-grade NAT).
    return ip.is_global


def validate_target_url(url: str) -> tuple[bool, str]:
    """Check that a URL uses http(s) and every address its host resolves to is public."""
    try:
        parsed = urlparse(url)
        scheme = parsed.scheme.lower()
        if scheme not in ALLOWED_SCHEMES:
            return False, f"Invalid scheme: {scheme or '<none>'}"

        hostname = parsed.hostname
        if not hostname:
            return False, "Missing hostname"

        # Reading .port raises ValueError for an out-of-range or non-numeric port.
        _ = parsed.port

        addr_info = socket.getaddrinfo(hostname, None)
    except socket.gaierror as exc:
        return False, f"DNS resolution failed: {exc}"
    except ValueError as exc:
        return False, f"Invalid URL: {exc}"

    if not addr_info:
        return False, f"DNS resolution returned no addresses for {hostname}"

    unsafe = _first_unsafe_ip(str(sockaddr[0]) for *_, sockaddr in addr_info)
    if unsafe is not None:
        return False, f"Restricted IP: {unsafe}"

    return True, "Target URL validated successfully"


def _first_unsafe_ip(ips: Iterable[str]) -> str | None:
    """Return the first IP that fails is_safe_ip, or None if all pass."""
    return next((ip for ip in ips if not is_safe_ip(ip)), None)


async def _system_resolver(host: str, port: int) -> list[str]:
    """Resolve host to a de-duplicated list of IPs, in resolver order."""
    infos = await anyio.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    return list(dict.fromkeys(str(sockaddr[0]) for *_, sockaddr in infos))


class PinnedDNSBackend(httpcore.AsyncNetworkBackend):
    """httpcore network backend that only ever connects to checked public IPs.

    The TCP connection goes to the IP, while TLS still uses the original
    hostname for SNI and certificate checks (httpcore handles that above us).
    """

    def __init__(
        self,
        inner: httpcore.AsyncNetworkBackend | None = None,
        resolver: Resolver | None = None,
    ) -> None:
        self._inner = inner or httpcore.AnyIOBackend()
        self._resolve = resolver or _system_resolver

    async def connect_tcp(
        self,
        host: str,
        port: int,
        timeout: float | None = None,
        local_address: str | None = None,
        socket_options: Iterable[Any] | None = None,
    ) -> httpcore.AsyncNetworkStream:
        try:
            ips = await self._resolve(host, port)
        except socket.gaierror as exc:
            raise httpcore.ConnectError(f"DNS resolution failed for {host}: {exc}") from exc

        if not ips:
            raise httpcore.ConnectError(f"DNS resolution returned no addresses for {host}")

        # Refuse if any address is unsafe, matching validate_target_url.
        unsafe = _first_unsafe_ip(ips)
        if unsafe is not None:
            raise SSRFBlockedError(f"Restricted IP: {unsafe} (resolved from {host})")

        last_error: Exception | None = None
        for ip in ips:
            try:
                return await self._inner.connect_tcp(
                    ip,
                    port,
                    timeout=timeout,
                    local_address=local_address,
                    socket_options=socket_options,
                )
            except (httpcore.ConnectError, httpcore.ConnectTimeout) as exc:
                last_error = exc
        assert last_error is not None
        raise last_error

    async def connect_unix_socket(
        self,
        path: str,
        timeout: float | None = None,
        socket_options: Iterable[Any] | None = None,
    ) -> httpcore.AsyncNetworkStream:
        raise SSRFBlockedError("Unix socket connections are not allowed")

    async def sleep(self, seconds: float) -> None:
        await self._inner.sleep(seconds)


class PinnedDNSTransport(httpx.AsyncHTTPTransport):
    """AsyncHTTPTransport that connects through PinnedDNSBackend, with no proxy."""

    def __init__(self, *, network_backend: PinnedDNSBackend | None = None, **kwargs: Any) -> None:
        for option in ("proxy", "uds"):
            if kwargs.get(option) is not None:
                raise ValueError(f"{option} is not allowed: it bypasses DNS pinning")
        super().__init__(**kwargs)
        # httpx has no public hook for this, so swap the backend on the pool it
        # built. Fail loudly if a future httpx/httpcore renames the attribute.
        pool = getattr(self, "_pool", None)
        if not isinstance(pool, httpcore.AsyncConnectionPool) or not hasattr(
            pool, "_network_backend"
        ):
            raise RuntimeError("Unsupported httpx/httpcore version: cannot pin DNS")
        pool._network_backend = network_backend or PinnedDNSBackend()


def create_safe_client(**kwargs: Any) -> httpx.AsyncClient:
    """Build an AsyncClient that pins DNS, ignores proxies and never redirects.

    Defaults: 10s timeout, follow_redirects=False. Redirects stay off because a
    redirect could point at a host that was never checked. Environment proxy
    settings are ignored (trust_env=False) so traffic always goes through the
    pinned transport.
    """
    if kwargs.get("follow_redirects"):
        raise ValueError("follow_redirects=True is not allowed: redirects bypass SSRF checks")
    for option in _FORBIDDEN_CLIENT_OPTIONS:
        if kwargs.get(option) is not None:
            raise ValueError(f"{option} is not allowed: it bypasses DNS pinning")

    transport_kwargs = {k: kwargs.pop(k) for k in _TRANSPORT_OPTIONS if k in kwargs}
    kwargs.pop("transport", None)
    kwargs.pop("mounts", None)
    kwargs.pop("proxy", None)

    kwargs["follow_redirects"] = False
    kwargs["trust_env"] = False
    kwargs.setdefault("timeout", DEFAULT_TIMEOUT)
    return httpx.AsyncClient(transport=PinnedDNSTransport(**transport_kwargs), **kwargs)


# --- API key authentication ---------------------------------------------------------

API_KEY_HEADER = "X-API-Key"
API_KEY_ENV = "AEGIS_API_KEY"
ENVIRONMENT_ENV = "AEGIS_ENV"
# The value shipped in .env.example. Treated as "no key configured" so a copied,
# unedited example file can't become a publicly known key.
PLACEHOLDER_API_KEY = "your-secure-key-here"

_api_key_header = APIKeyHeader(
    name=API_KEY_HEADER,
    auto_error=False,
    description=f"API key; must match the server's {API_KEY_ENV} setting.",
)


def configured_api_key() -> str | None:
    """The server's API key from the environment, or None if unset/placeholder."""
    key = os.environ.get(API_KEY_ENV, "").strip()
    return key if key and key != PLACEHOLDER_API_KEY else None


def auth_disabled_for_development() -> bool:
    """True only when no key is configured and AEGIS_ENV=development."""
    environment = os.environ.get(ENVIRONMENT_ENV, "").strip().lower()
    return configured_api_key() is None and environment == "development"


def verify_api_key(provided: Annotated[str | None, Security(_api_key_header)]) -> None:
    """FastAPI dependency that rejects requests without the right X-API-Key.

    Fails closed: with no key configured, every request is rejected unless
    AEGIS_ENV=development. Clients get the same 401 either way, so they can't
    tell a missing server key from a wrong one.
    """
    expected = configured_api_key()
    if expected is None:
        if auth_disabled_for_development():
            return
        raise _unauthorized()
    if provided is None or not _keys_match(provided, expected):
        raise _unauthorized()


def _keys_match(provided: str, expected: str) -> bool:
    """Constant-time comparison. Hashing first makes both sides the same length
    (so the length isn't leaked either) and handles non-ASCII header values,
    which compare_digest rejects for str input."""
    provided_hash = hashlib.sha256(provided.encode("utf-8", "surrogateescape")).digest()
    expected_hash = hashlib.sha256(expected.encode("utf-8")).digest()
    return secrets.compare_digest(provided_hash, expected_hash)


def _unauthorized() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid or missing API key",
        headers={"WWW-Authenticate": API_KEY_HEADER},
    )

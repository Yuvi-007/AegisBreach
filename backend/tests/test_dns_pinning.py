"""Tests for DNS pinning (Module 1.1): the client connects only to checked IPs."""

import socket

import httpcore
import httpx
import pytest

from app.core import security
from app.core.security import (
    PinnedDNSBackend,
    PinnedDNSTransport,
    SSRFBlockedError,
    create_safe_client,
    validate_target_url,
)

PUBLIC_IP = "93.184.215.14"
PUBLIC_IP_2 = "93.184.215.15"
OK_RESPONSE = b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nok"


class FakeStream(httpcore.AsyncNetworkStream):
    """Network stream that records what was sent and replies with a canned response."""

    def __init__(self) -> None:
        self.written = b""
        self.server_hostname: str | None = None
        self._pending = OK_RESPONSE

    async def read(self, max_bytes: int, timeout: float | None = None) -> bytes:
        chunk, self._pending = self._pending[:max_bytes], self._pending[max_bytes:]
        return chunk

    async def write(self, buffer: bytes, timeout: float | None = None) -> None:
        self.written += buffer

    async def aclose(self) -> None:
        pass

    async def start_tls(self, ssl_context, server_hostname=None, timeout=None):
        self.server_hostname = server_hostname
        return self

    def get_extra_info(self, info: str):
        return None


class FakeBackend(httpcore.AsyncNetworkBackend):
    """Inner backend that records connect calls; IPs in `fail` raise ConnectError."""

    def __init__(self, fail: tuple[str, ...] = ()) -> None:
        self.fail = fail
        self.connected: list[tuple[str, int]] = []
        self.streams: list[FakeStream] = []
        self.slept: list[float] = []

    async def connect_tcp(self, host, port, timeout=None, local_address=None, socket_options=None):
        self.connected.append((host, port))
        if host in self.fail:
            raise httpcore.ConnectError(f"refused: {host}")
        stream = FakeStream()
        self.streams.append(stream)
        return stream

    async def connect_unix_socket(self, path, timeout=None, socket_options=None):
        raise AssertionError("inner backend must never get a unix socket call")

    async def sleep(self, seconds: float) -> None:
        self.slept.append(seconds)


def static_resolver(*ips: str):
    async def resolve(host: str, port: int) -> list[str]:
        return list(ips)

    return resolve


def pinned_client(inner: FakeBackend, *ips: str) -> httpx.AsyncClient:
    backend = PinnedDNSBackend(inner=inner, resolver=static_resolver(*ips))
    return httpx.AsyncClient(transport=PinnedDNSTransport(network_backend=backend))


# --- pinning behaviour -----------------------------------------------------

@pytest.mark.asyncio
async def test_connects_to_resolved_ip_and_keeps_host_header():
    inner = FakeBackend()
    async with pinned_client(inner, PUBLIC_IP) as client:
        response = await client.get("http://target.example/path")

    assert response.status_code == 200
    assert response.text == "ok"
    assert inner.connected == [(PUBLIC_IP, 80)]
    assert b"Host: target.example\r\n" in inner.streams[0].written


@pytest.mark.asyncio
async def test_https_keeps_hostname_for_sni_and_cert_checks():
    inner = FakeBackend()
    async with pinned_client(inner, PUBLIC_IP) as client:
        await client.get("https://target.example/")

    assert inner.connected == [(PUBLIC_IP, 443)]
    assert inner.streams[0].server_hostname == "target.example"


@pytest.mark.asyncio
@pytest.mark.parametrize("ip", ["127.0.0.1", "10.0.0.5", "169.254.169.254", "::1", "fd00::1"])
async def test_blocks_restricted_ip_before_connecting(ip):
    inner = FakeBackend()
    async with pinned_client(inner, ip) as client:
        with pytest.raises(SSRFBlockedError, match=f"Restricted IP: {ip}"):
            await client.get("http://target.example/")

    assert inner.connected == []


@pytest.mark.asyncio
async def test_blocks_when_any_resolved_ip_is_restricted():
    inner = FakeBackend()
    async with pinned_client(inner, PUBLIC_IP, "127.0.0.1") as client:
        with pytest.raises(SSRFBlockedError):
            await client.get("http://target.example/")

    assert inner.connected == []


@pytest.mark.asyncio
async def test_dns_rebinding_is_blocked(monkeypatch):
    """Host looks public during validation, then resolves to metadata IP at connect time."""
    monkeypatch.setattr(
        security.socket,
        "getaddrinfo",
        lambda host, port: [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (PUBLIC_IP, 0))],
    )
    assert validate_target_url("http://rebind.example/")[0] is True

    inner = FakeBackend()
    async with pinned_client(inner, "169.254.169.254") as client:
        with pytest.raises(SSRFBlockedError, match="169.254.169.254"):
            await client.get("http://rebind.example/")

    assert inner.connected == []


def test_ssrf_error_is_an_httpx_request_error():
    assert issubclass(SSRFBlockedError, httpx.RequestError)


@pytest.mark.asyncio
async def test_falls_back_to_next_ip_when_connect_fails():
    inner = FakeBackend(fail=(PUBLIC_IP,))
    async with pinned_client(inner, PUBLIC_IP, PUBLIC_IP_2) as client:
        response = await client.get("http://target.example/")

    assert response.status_code == 200
    assert inner.connected == [(PUBLIC_IP, 80), (PUBLIC_IP_2, 80)]


@pytest.mark.asyncio
async def test_raises_connect_error_when_all_ips_fail():
    inner = FakeBackend(fail=(PUBLIC_IP, PUBLIC_IP_2))
    async with pinned_client(inner, PUBLIC_IP, PUBLIC_IP_2) as client:
        with pytest.raises(httpx.ConnectError, match=PUBLIC_IP_2):
            await client.get("http://target.example/")


@pytest.mark.asyncio
async def test_empty_resolution_is_a_connect_error():
    async with pinned_client(FakeBackend()) as client:
        with pytest.raises(httpx.ConnectError, match="no addresses"):
            await client.get("http://target.example/")


@pytest.mark.asyncio
async def test_dns_failure_is_a_connect_error():
    async def failing(host, port):
        raise socket.gaierror(socket.EAI_NONAME, "Name or service not known")

    backend = PinnedDNSBackend(inner=FakeBackend(), resolver=failing)
    async with httpx.AsyncClient(transport=PinnedDNSTransport(network_backend=backend)) as client:
        with pytest.raises(httpx.ConnectError, match="DNS resolution failed"):
            await client.get("http://nowhere.example/")


@pytest.mark.asyncio
async def test_unix_sockets_are_refused():
    backend = PinnedDNSBackend(inner=FakeBackend())
    with pytest.raises(SSRFBlockedError, match="Unix socket"):
        await backend.connect_unix_socket("/var/run/docker.sock")


@pytest.mark.asyncio
async def test_sleep_delegates_to_inner_backend():
    inner = FakeBackend()
    await PinnedDNSBackend(inner=inner).sleep(0.25)
    assert inner.slept == [0.25]


@pytest.mark.asyncio
async def test_system_resolver_resolves_localhost_to_loopback():
    ips = await security._system_resolver("localhost", 80)
    assert ips
    assert all(not security.is_safe_ip(ip) for ip in ips)


# --- transport construction -----------------------------------------------

@pytest.mark.parametrize("option", [{"proxy": "http://proxy.local:8080"}, {"uds": "/tmp/x.sock"}])
def test_transport_rejects_bypass_options(option):
    with pytest.raises(ValueError, match="bypasses DNS pinning"):
        PinnedDNSTransport(**option)


def test_transport_fails_loudly_if_httpx_internals_change(monkeypatch):
    def broken_init(self, **kwargs):
        self._pool = object()

    monkeypatch.setattr(httpx.AsyncHTTPTransport, "__init__", broken_init)
    with pytest.raises(RuntimeError, match="cannot pin DNS"):
        PinnedDNSTransport()


def test_transport_installs_pinned_backend_by_default():
    transport = PinnedDNSTransport()
    assert isinstance(transport._pool._network_backend, PinnedDNSBackend)


# --- create_safe_client ----------------------------------------------------

@pytest.mark.asyncio
async def test_safe_client_uses_pinned_transport_and_ignores_env_proxies(monkeypatch):
    monkeypatch.setenv("HTTPS_PROXY", "http://10.0.0.1:3128")
    monkeypatch.setenv("HTTP_PROXY", "http://10.0.0.1:3128")
    monkeypatch.setenv("ALL_PROXY", "http://10.0.0.1:3128")
    client = create_safe_client()
    try:
        assert isinstance(client._transport, PinnedDNSTransport)
        assert client.trust_env is False
        assert client._mounts == {}
    finally:
        await client.aclose()


@pytest.mark.asyncio
async def test_safe_client_forwards_transport_options():
    client = create_safe_client(http2=False, limits=httpx.Limits(max_connections=3))
    try:
        assert client._transport._pool._max_connections == 3
    finally:
        await client.aclose()


@pytest.mark.parametrize(
    "option",
    [
        {"transport": httpx.MockTransport(lambda r: httpx.Response(200))},
        {"mounts": {"all://": httpx.AsyncHTTPTransport()}},
        {"proxy": "http://proxy.local:8080"},
    ],
)
def test_safe_client_rejects_bypass_options(option):
    with pytest.raises(ValueError, match="bypasses DNS pinning"):
        create_safe_client(**option)


@pytest.mark.asyncio
@pytest.mark.parametrize("url", ["http://127.0.0.1:1/", "http://localhost:1/", "http://[::1]:1/"])
async def test_safe_client_blocks_local_targets_end_to_end(url):
    """Uses the real resolver; no traffic leaves the machine."""
    async with create_safe_client() as client:
        with pytest.raises(SSRFBlockedError):
            await client.get(url)


@pytest.mark.asyncio
async def test_safe_client_live_public_request():
    """Real HTTPS request through the pinned transport; skipped without network."""
    async with create_safe_client(timeout=20.0) as client:
        try:
            response = await client.get("https://nemo-shield-api.onrender.com/api/v1/health")
        except (httpx.ConnectError, httpx.TimeoutException) as exc:
            # Render's free tier can take >20s to wake up; don't fail on that.
            pytest.skip(f"Live endpoint unreachable ({type(exc).__name__}): {exc}")
    assert 100 <= response.status_code < 600

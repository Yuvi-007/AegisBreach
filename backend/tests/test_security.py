import socket

import httpx
import pytest

from app.core import security
from app.core.security import create_safe_client, is_safe_ip, validate_target_url

PUBLIC_URL = "https://nemo-shield-api.onrender.com/api/v1/health"


def _addrinfo(*ips: str):
    """Build a fake socket.getaddrinfo result for the given IPs."""
    result = []
    for ip in ips:
        if ":" in ip:
            result.append((socket.AF_INET6, socket.SOCK_STREAM, 6, "", (ip, 0, 0, 0)))
        else:
            result.append((socket.AF_INET, socket.SOCK_STREAM, 6, "", (ip, 0)))
    return result


@pytest.fixture
def fake_dns(monkeypatch):
    """Point socket.getaddrinfo at a fixed list of IPs."""

    def _set(*ips: str):
        monkeypatch.setattr(security.socket, "getaddrinfo", lambda host, port: _addrinfo(*ips))

    return _set


# --- is_safe_ip ------------------------------------------------------------

@pytest.mark.parametrize(
    "ip",
    [
        "127.0.0.1", "::1",                                  # loopback
        "10.0.0.1", "192.168.1.1", "172.16.0.1", "fc00::1",  # private
        "169.254.169.254",                                   # cloud metadata
        "169.254.1.1", "fe80::1",                            # link-local
        "224.0.0.1", "ff02::1",                              # multicast
        "240.0.0.1",                                         # reserved
        "0.0.0.0", "::",                                     # unspecified
        "100.64.0.1",                                        # carrier-grade NAT
        "::ffff:127.0.0.1", "::ffff:169.254.169.254",        # IPv4-mapped IPv6
    ],
)
def test_is_safe_ip_rejects_non_public(ip):
    assert is_safe_ip(ip) is False


@pytest.mark.parametrize("ip", ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"])
def test_is_safe_ip_accepts_public(ip):
    assert is_safe_ip(ip) is True


@pytest.mark.parametrize("value", ["", "not-an-ip", "999.1.1.1", "localhost"])
def test_is_safe_ip_rejects_invalid(value):
    assert is_safe_ip(value) is False


# --- validate_target_url: rejections --------------------------------------

@pytest.mark.parametrize("url", ["http://127.0.0.1/", "http://[::1]:8080/admin"])
def test_rejects_loopback_literals(url):
    ok, msg = validate_target_url(url)
    assert ok is False
    assert msg.startswith("Restricted IP:")


def test_rejects_localhost_hostname():
    # Uses real DNS: localhost always resolves to loopback without a network.
    ok, msg = validate_target_url("http://localhost:8000/")
    assert ok is False
    assert msg.startswith("Restricted IP:")


@pytest.mark.parametrize("ip", ["10.0.0.1", "192.168.1.1", "172.16.0.1"])
def test_rejects_private_networks(ip):
    assert validate_target_url(f"http://{ip}/") == (False, f"Restricted IP: {ip}")


def test_rejects_cloud_metadata():
    ok, msg = validate_target_url("http://169.254.169.254/latest/meta-data/")
    assert (ok, msg) == (False, "Restricted IP: 169.254.169.254")


@pytest.mark.parametrize(
    "url", ["ftp://example.com/file", "file:///etc/passwd", "javascript:alert(1)", "example.com"]
)
def test_rejects_invalid_schemes(url):
    ok, msg = validate_target_url(url)
    assert ok is False
    assert msg.startswith("Invalid scheme:")


@pytest.mark.parametrize("url", ["http://", "https:///path"])
def test_rejects_missing_hostname(url):
    assert validate_target_url(url) == (False, "Missing hostname")


def test_rejects_invalid_port():
    ok, msg = validate_target_url("http://example.com:99999/")
    assert ok is False
    assert msg.startswith("Invalid URL:")


def test_rejects_hostname_resolving_to_private_ip(fake_dns):
    fake_dns("10.1.2.3")
    assert validate_target_url("https://internal.example.com/") == (False, "Restricted IP: 10.1.2.3")


def test_rejects_when_any_resolved_ip_is_unsafe(fake_dns):
    fake_dns("8.8.8.8", "127.0.0.1")
    assert validate_target_url("https://mixed.example.com/") == (False, "Restricted IP: 127.0.0.1")


def test_rejects_empty_dns_result(fake_dns):
    fake_dns()
    ok, msg = validate_target_url("https://empty.example.com/")
    assert ok is False
    assert "no addresses" in msg


def test_handles_dns_failure(monkeypatch):
    def boom(host, port):
        raise socket.gaierror(socket.EAI_NONAME, "Name or service not known")

    monkeypatch.setattr(security.socket, "getaddrinfo", boom)
    ok, msg = validate_target_url("https://does-not-exist.invalid/")
    assert ok is False
    assert msg.startswith("DNS resolution failed:")


def test_handles_value_error_from_resolver(monkeypatch):
    def boom(host, port):
        raise ValueError("bad host")

    monkeypatch.setattr(security.socket, "getaddrinfo", boom)
    assert validate_target_url("https://x.example.com/") == (False, "Invalid URL: bad host")


# --- validate_target_url: acceptance --------------------------------------

def test_accepts_public_endpoint(fake_dns):
    fake_dns("216.24.57.1", "2606:4700:4700::1111")
    assert validate_target_url(PUBLIC_URL) == (True, "Target URL validated successfully")


def test_accepts_public_endpoint_live_dns():
    try:
        socket.getaddrinfo("nemo-shield-api.onrender.com", None)
    except socket.gaierror:
        pytest.skip("No DNS/network access")
    assert validate_target_url(PUBLIC_URL) == (True, "Target URL validated successfully")


def test_scheme_check_is_case_insensitive(fake_dns):
    fake_dns("8.8.8.8")
    assert validate_target_url("HTTPS://example.com/")[0] is True


# --- create_safe_client ----------------------------------------------------

@pytest.mark.asyncio
async def test_safe_client_defaults():
    client = create_safe_client()
    try:
        assert isinstance(client, httpx.AsyncClient)
        assert client.follow_redirects is False
        assert client.timeout == httpx.Timeout(10.0)
    finally:
        await client.aclose()


@pytest.mark.asyncio
async def test_safe_client_accepts_overrides():
    client = create_safe_client(timeout=3.0, headers={"X-Test": "1"}, follow_redirects=False)
    try:
        assert client.timeout == httpx.Timeout(3.0)
        assert client.headers["X-Test"] == "1"
        assert client.follow_redirects is False
    finally:
        await client.aclose()


def test_safe_client_refuses_redirects():
    with pytest.raises(ValueError, match="follow_redirects"):
        create_safe_client(follow_redirects=True)

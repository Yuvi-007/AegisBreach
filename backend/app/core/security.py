"""Anti-SSRF helpers: validate target URLs and build a hardened HTTP client."""

import ipaddress
import socket
from typing import Any
from urllib.parse import urlparse

import httpx

ALLOWED_SCHEMES = ("http", "https")
CLOUD_METADATA_IP = ipaddress.ip_address("169.254.169.254")
DEFAULT_TIMEOUT = 10.0


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

        parsed.port  # Raises ValueError for an out-of-range or non-numeric port.

        addr_info = socket.getaddrinfo(hostname, None)
    except socket.gaierror as exc:
        return False, f"DNS resolution failed: {exc}"
    except ValueError as exc:
        return False, f"Invalid URL: {exc}"

    if not addr_info:
        return False, f"DNS resolution returned no addresses for {hostname}"

    for *_, sockaddr in addr_info:
        ip = str(sockaddr[0])
        if not is_safe_ip(ip):
            return False, f"Restricted IP: {ip}"

    return True, "Target URL validated successfully"


def create_safe_client(**kwargs: Any) -> httpx.AsyncClient:
    """Build an AsyncClient with a 10s default timeout and redirects disabled.

    Redirects stay off because a redirect could point at an internal address
    that never went through validate_target_url.
    """
    if kwargs.get("follow_redirects"):
        raise ValueError("follow_redirects=True is not allowed: redirects bypass SSRF checks")
    kwargs["follow_redirects"] = False
    kwargs.setdefault("timeout", DEFAULT_TIMEOUT)
    return httpx.AsyncClient(**kwargs)

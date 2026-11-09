"""Tests for the FastAPI REST API (Module 5)."""

import asyncio
import json
import uuid

import httpx
import pytest
import pytest_asyncio

from app.api.v1.endpoints import benchmarks as bench_endpoints
from app.core.store import RunStore, get_run_store
from app.engine.judge.evaluator import BenchmarkMetrics, EvaluationResult
from app.engine.targets.base import BaseTargetAdapter, TargetResponse
from app.engine.targets.mock import MockTargetAdapter
from app.main import (
    DEFAULT_CORS_ORIGINS,
    DEFAULT_STATIC_DIR,
    app,
    cors_origins,
    create_app,
    static_dir,
)

API = "/api/v1"
MOCK_RUN = {"target_type": "mock", "suite_names": ["owasp_llm_top10"]}
# Captured before the autouse fixture below swaps it out.
REAL_BUILD_ADAPTER = bench_endpoints.build_adapter


TEST_API_KEY = "test-key-" + "x" * 32


@pytest.fixture
def store() -> RunStore:
    return RunStore(max_runs=50, max_active_runs=5)


@pytest.fixture(autouse=True)
def auth_env(monkeypatch):
    """Every test starts with a configured key and no development bypass."""
    monkeypatch.setenv("AEGIS_API_KEY", TEST_API_KEY)
    monkeypatch.delenv("AEGIS_ENV", raising=False)


@pytest_asyncio.fixture
async def client(store):
    """Authenticated client."""
    app.dependency_overrides[get_run_store] = lambda: store
    transport = httpx.ASGITransport(app=app)
    headers = {"X-API-Key": TEST_API_KEY}
    async with httpx.AsyncClient(transport=transport, base_url="http://test", headers=headers) as c:
        yield c
    app.dependency_overrides.clear()


@pytest_asyncio.fixture
async def anon(store):
    """Client that sends no API key."""
    app.dependency_overrides[get_run_store] = lambda: store
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as c:
        yield c
    app.dependency_overrides.clear()


@pytest.fixture(autouse=True)
def fast_mock_target(monkeypatch):
    """Use a zero-delay mock so runs finish instantly."""
    original = bench_endpoints.build_adapter

    def build(target_type, target_url):
        if target_type == "mock":
            return MockTargetAdapter(delay_ms=0)
        return original(target_type, target_url)

    monkeypatch.setattr(bench_endpoints, "build_adapter", build)


async def wait_for_run(client: httpx.AsyncClient, run_id: str, timeout: float = 5.0) -> dict:
    """Poll GET /runs/{id} until the run finishes."""
    deadline = asyncio.get_running_loop().time() + timeout
    while True:
        response = await client.get(f"{API}/runs/{run_id}")
        assert response.status_code == 200
        body = response.json()
        if body["status"] in ("COMPLETED", "FAILED"):
            return body
        assert asyncio.get_running_loop().time() < deadline, f"run stuck in {body['status']}"
        await asyncio.sleep(0.02)


# --- health and app setup -----------------------------------------------------------

@pytest.mark.asyncio
async def test_root(client):
    response = await client.get("/")
    assert response.status_code == 200
    assert response.json() == {"service": "AegisBreach API", "version": "1.0.0", "status": "ok", "docs": "/docs"}


# --- built frontend serving --------------------------------------------------------

INDEX_HTML = "<!doctype html><title>AegisBreach</title><div id=root></div>"


@pytest.fixture
def frontend_dir(tmp_path, monkeypatch):
    (tmp_path / "index.html").write_text(INDEX_HTML, encoding="utf-8")
    (tmp_path / "assets").mkdir()
    (tmp_path / "assets" / "app.js").write_text("console.info('ok')", encoding="utf-8")
    monkeypatch.setenv("AEGIS_STATIC_DIR", str(tmp_path))
    return tmp_path


@pytest_asyncio.fixture
async def site(frontend_dir, store):
    """Client for an app built with a frontend folder present."""
    site_app = create_app()
    site_app.dependency_overrides[get_run_store] = lambda: store
    transport = httpx.ASGITransport(app=site_app)
    headers = {"X-API-Key": TEST_API_KEY}
    async with httpx.AsyncClient(transport=transport, base_url="http://test", headers=headers) as c:
        yield c


def test_static_dir_needs_an_index_html(tmp_path, monkeypatch):
    monkeypatch.setenv("AEGIS_STATIC_DIR", str(tmp_path))
    assert static_dir() is None
    (tmp_path / "index.html").write_text(INDEX_HTML, encoding="utf-8")
    assert static_dir() == tmp_path


def test_static_dir_defaults_to_the_app_package(monkeypatch):
    monkeypatch.delenv("AEGIS_STATIC_DIR", raising=False)
    assert DEFAULT_STATIC_DIR.parent.name == "app"
    assert static_dir() == (DEFAULT_STATIC_DIR if (DEFAULT_STATIC_DIR / "index.html").is_file() else None)


@pytest.mark.asyncio
async def test_frontend_index_and_assets_are_served(site):
    index = await site.get("/")
    assert index.status_code == 200
    assert index.headers["content-type"].startswith("text/html")
    assert index.text == INDEX_HTML

    asset = await site.get("/assets/app.js")
    assert asset.status_code == 200
    assert asset.text == "console.info('ok')"


@pytest.mark.asyncio
@pytest.mark.parametrize("path", ["/runs", "/runs/3f2a9c1e", "/some/deep/link"])
async def test_client_side_routes_fall_back_to_index(site, path):
    response = await site.get(path)
    assert response.status_code == 200
    assert response.text == INDEX_HTML


@pytest.mark.asyncio
@pytest.mark.parametrize("path", ["/api/v1/nope", "/api", "/redoc/extra", "/docs/extra"])
async def test_fallback_never_answers_api_or_docs_paths(site, path):
    response = await site.get(path)
    assert response.status_code == 404
    assert response.text != INDEX_HTML


@pytest.mark.asyncio
async def test_api_and_docs_still_win_over_the_frontend(site):
    health = await site.get(f"{API}/health")
    assert health.status_code == 200
    assert health.json()["status"] == "ok"
    assert (await site.get(f"{API}/mutators")).status_code == 200
    assert (await site.get("/docs")).status_code == 200
    assert (await site.get("/openapi.json")).json()["info"]["title"] == "AegisBreach API"


@pytest.mark.asyncio
async def test_frontend_rejects_non_get_methods(site):
    response = await site.post("/runs/abc")
    assert response.status_code == 405


@pytest.mark.asyncio
async def test_health_reports_engine_state(client):
    response = await client.get(f"{API}/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["engine"] == {
        "mutators": 6,
        "suites": ["benign_controls", "owasp_llm_top10"],
        "active_runs": 0,
        "stored_runs": 0,
    }


def test_app_metadata():
    assert (app.title, app.version) == ("AegisBreach API", "1.0.0")


@pytest.mark.asyncio
async def test_cors_allows_local_frontend_only(client):
    headers = {"Access-Control-Request-Method": "GET"}
    allowed = await client.options(f"{API}/mutators", headers={**headers, "Origin": "http://localhost:5173"})
    assert allowed.headers["access-control-allow-origin"] == "http://localhost:5173"
    assert "x-api-key" in allowed.headers["access-control-allow-headers"].lower()
    denied = await client.options(f"{API}/mutators", headers={**headers, "Origin": "https://evil.example"})
    assert "access-control-allow-origin" not in denied.headers


@pytest.mark.asyncio
async def test_browser_preflight_for_api_key_header_succeeds(anon):
    """Browsers send OPTIONS without the key; it must not be rejected with 401."""
    response = await anon.options(
        f"{API}/run",
        headers={
            "Origin": "http://localhost:5173",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type,x-api-key",
        },
    )
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://localhost:5173"


def test_cors_origins_from_environment(monkeypatch):
    monkeypatch.delenv("AEGIS_CORS_ORIGINS", raising=False)
    assert cors_origins() == list(DEFAULT_CORS_ORIGINS)
    monkeypatch.setenv("AEGIS_CORS_ORIGINS", " https://ui.example , ,http://localhost:8080 ")
    assert cors_origins() == ["https://ui.example", "http://localhost:8080"]
    assert create_app().title == "AegisBreach API"


# --- API key authentication ---------------------------------------------------------

PROTECTED = [
    ("GET", f"{API}/mutators"),
    ("GET", f"{API}/suites"),
    ("GET", f"{API}/runs"),
    ("GET", f"{API}/runs/{uuid.UUID(int=1)}"),
    ("POST", f"{API}/run"),
]


@pytest.mark.asyncio
@pytest.mark.parametrize("path", ["/", f"{API}/health", "/docs", "/openapi.json"])
async def test_public_routes_need_no_key(anon, path):
    assert (await anon.get(path)).status_code == 200


@pytest.mark.asyncio
@pytest.mark.parametrize(("method", "path"), PROTECTED)
@pytest.mark.parametrize(
    "headers",
    [
        {},
        {"X-API-Key": ""},
        {"X-API-Key": "wrong"},
        {"X-API-Key": TEST_API_KEY[:-1] + "y"},   # same length, last char differs
        {"X-API-Key": TEST_API_KEY + "x"},        # correct key as a prefix
        {"X-API-Key": TEST_API_KEY.upper()},
        {"Authorization": f"Bearer {TEST_API_KEY}"},  # right key, wrong header
    ],
    ids=["missing", "empty", "wrong", "one-char-off", "too-long", "wrong-case", "wrong-header"],
)
async def test_protected_routes_reject_missing_or_invalid_keys(anon, store, method, path, headers):
    response = await anon.request(method, path, headers=headers, json=MOCK_RUN if method == "POST" else None)
    assert response.status_code == 401
    assert response.json() == {"detail": "Invalid or missing API key"}
    assert response.headers["www-authenticate"] == "X-API-Key"
    assert len(store) == 0


@pytest.mark.asyncio
async def test_non_ascii_key_is_rejected_not_a_server_error(anon):
    response = await anon.get(f"{API}/mutators", headers={"X-API-Key": "caf\xe9".encode("latin-1")})
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_valid_key_starts_a_run(anon):
    response = await anon.post(f"{API}/run", json=MOCK_RUN, headers={"X-API-Key": TEST_API_KEY})
    assert response.status_code == 202


@pytest.mark.asyncio
async def test_auth_is_checked_before_the_body(anon):
    """Unauthenticated callers learn nothing about request validation."""
    response = await anon.post(f"{API}/run", json={"target_type": "nope"})
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_surrounding_whitespace_in_configured_key_is_ignored(anon, monkeypatch):
    monkeypatch.setenv("AEGIS_API_KEY", f"  {TEST_API_KEY}\n")
    assert (await anon.get(f"{API}/mutators", headers={"X-API-Key": TEST_API_KEY})).status_code == 200


@pytest.mark.asyncio
@pytest.mark.parametrize("configured", ["", "   ", "your-secure-key-here"])
@pytest.mark.parametrize("environment", [None, "production", "staging", "dev"])
async def test_no_configured_key_fails_closed(anon, monkeypatch, configured, environment):
    monkeypatch.setenv("AEGIS_API_KEY", configured)
    if environment is not None:
        monkeypatch.setenv("AEGIS_ENV", environment)
    for key in (None, "your-secure-key-here", "anything"):
        headers = {} if key is None else {"X-API-Key": key}
        assert (await anon.get(f"{API}/mutators", headers=headers)).status_code == 401
    assert (await anon.get(f"{API}/health")).status_code == 200


@pytest.mark.asyncio
@pytest.mark.parametrize("environment", ["development", " Development "])
async def test_development_mode_allows_requests_when_no_key_is_set(anon, monkeypatch, environment):
    monkeypatch.delenv("AEGIS_API_KEY")
    monkeypatch.setenv("AEGIS_ENV", environment)
    assert (await anon.get(f"{API}/mutators")).status_code == 200
    assert (await anon.post(f"{API}/run", json=MOCK_RUN)).status_code == 202


@pytest.mark.asyncio
async def test_development_mode_does_not_bypass_a_configured_key(anon, monkeypatch):
    monkeypatch.setenv("AEGIS_ENV", "development")
    assert (await anon.get(f"{API}/mutators")).status_code == 401
    assert (await anon.get(f"{API}/mutators", headers={"X-API-Key": TEST_API_KEY})).status_code == 200


def test_openapi_documents_the_api_key_scheme():
    schema = app.openapi()
    assert schema["components"]["securitySchemes"]["APIKeyHeader"] == {
        "type": "apiKey",
        "in": "header",
        "name": "X-API-Key",
        "description": "API key; must match the server's AEGIS_API_KEY setting.",
    }
    assert "security" in schema["paths"][f"{API}/run"]["post"]
    assert "security" not in schema["paths"][f"{API}/health"]["get"]


@pytest.mark.parametrize(
    ("key", "environment", "message"),
    [
        (None, "development", "authentication is OFF"),
        (None, None, "will return 401"),
        (TEST_API_KEY, None, None),
    ],
)
def test_startup_warns_about_missing_key(monkeypatch, caplog, key, environment, message):
    monkeypatch.delenv("AEGIS_API_KEY", raising=False)
    if key:
        monkeypatch.setenv("AEGIS_API_KEY", key)
    if environment:
        monkeypatch.setenv("AEGIS_ENV", environment)
    with caplog.at_level("WARNING", logger="app.main"):
        create_app()
    if message:
        assert message in caplog.text
    else:
        assert caplog.text == ""


# --- catalogue -----------------------------------------------------------------------

@pytest.mark.asyncio
async def test_list_mutators(client):
    response = await client.get(f"{API}/mutators")
    assert response.status_code == 200
    mutators = response.json()
    assert {m["name"] for m in mutators} == {
        "leetspeak", "case_jitter", "homoglyph", "zero_width", "base64_wrapper", "crescendo_framing",
    }
    assert all(set(m) == {"name", "description", "category"} for m in mutators)


@pytest.mark.asyncio
async def test_list_suites(client):
    response = await client.get(f"{API}/suites")
    assert response.status_code == 200
    suites = {s["suite_id"]: s for s in response.json()}
    assert suites["owasp_llm_top10"] == {
        "suite_id": "owasp_llm_top10",
        "name": "OWASP LLM Top 10",
        "total_seeds": 16,
        "categories": ["jailbreak", "pii_extraction", "prompt_injection", "system_prompt_leakage"],
    }
    assert suites["benign_controls"]["total_seeds"] == 16


@pytest.mark.asyncio
async def test_list_suites_skips_broken_files(client, tmp_path, monkeypatch):
    seed = {"id": "X-1", "category": "general_qa", "prompt": "hi", "expected_action": "allow"}
    (tmp_path / "my_suite.json").write_text(json.dumps([seed]), encoding="utf-8")
    (tmp_path / "broken.json").write_text("[{", encoding="utf-8")
    monkeypatch.setattr(bench_endpoints, "BENCHMARKS_DIR", tmp_path)

    response = await client.get(f"{API}/suites")
    assert response.status_code == 200
    assert response.json() == [
        {"suite_id": "my_suite", "name": "My Suite", "total_seeds": 1, "categories": ["general_qa"]}
    ]


# --- POST /run: validation ----------------------------------------------------------------

@pytest.mark.asyncio
@pytest.mark.parametrize(
    "target_url",
    ["http://127.0.0.1", "http://127.0.0.1:8000", "http://localhost:8000", "http://169.254.169.254", "http://10.0.0.5"],
)
async def test_run_rejects_internal_targets_with_400(client, store, target_url):
    response = await client.post(
        f"{API}/run", json={"target_type": "nemo_shield", "target_url": target_url, "suite_names": ["owasp_llm_top10"]}
    )
    assert response.status_code == 400
    assert response.json()["detail"].startswith("Target URL rejected: Restricted IP:")
    assert len(store) == 0, "no run may be created for a rejected target"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("target_url", "detail"),
    [("ftp://example.com", "Invalid scheme: ftp"), ("file:///etc/passwd", "Invalid scheme: file")],
)
async def test_run_rejects_bad_schemes_with_400(client, target_url, detail):
    response = await client.post(
        f"{API}/run", json={"target_type": "nemo_shield", "target_url": target_url, "suite_names": ["owasp_llm_top10"]}
    )
    assert response.status_code == 400
    assert response.json()["detail"] == f"Target URL rejected: {detail}"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("changes", "detail"),
    [
        ({"suite_names": ["nope"]}, "Seed file not found"),
        ({"suite_names": ["../../etc/passwd"]}, "Invalid suite name"),
        ({"mutator_names": ["leetspeak", "nope"]}, "Unknown mutator 'nope'"),
    ],
)
async def test_run_rejects_unknown_suites_and_mutators_with_400(client, store, changes, detail):
    response = await client.post(f"{API}/run", json={**MOCK_RUN, **changes})
    assert response.status_code == 400
    assert detail in response.json()["detail"]
    assert len(store) == 0


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "body",
    [
        {"target_type": "nemo_shield", "suite_names": ["owasp_llm_top10"]},  # missing target_url
        {"target_type": "openai", "suite_names": ["owasp_llm_top10"]},
        {"target_type": "mock", "suite_names": []},
        {**MOCK_RUN, "max_concurrency": 0},
        {**MOCK_RUN, "max_concurrency": 21},
        {**MOCK_RUN, "unexpected": True},
        {**MOCK_RUN, "target_url": "x" * 2049},
    ],
)
async def test_run_rejects_malformed_bodies_with_422(client, body):
    assert (await client.post(f"{API}/run", json=body)).status_code == 422


@pytest.mark.asyncio
async def test_run_returns_429_when_too_many_runs_are_active(client, store):
    for _ in range(store.max_active_runs):
        store.create_run(target_type="mock", target_url="mock://local", suite_names=["owasp_llm_top10"])
    response = await client.post(f"{API}/run", json=MOCK_RUN)
    assert response.status_code == 429
    assert "already in progress" in response.json()["detail"]


# --- POST /run: execution ---------------------------------------------------------------

@pytest.mark.asyncio
async def test_mock_run_completes_with_metrics(client, store):
    response = await client.post(f"{API}/run", json=MOCK_RUN)
    assert response.status_code == 202
    body = response.json()
    assert set(body) == {"run_id", "status", "created_at"}
    assert body["status"] == "QUEUED"
    uuid.UUID(body["run_id"], version=4)

    run = await wait_for_run(client, body["run_id"])
    assert run["status"] == "COMPLETED"
    assert run["error"] is None
    assert run["target_url"] == "mock://local"
    assert run["started_at"] and run["completed_at"]

    metrics = BenchmarkMetrics.model_validate(run["metrics"])
    assert metrics.total_prompts == metrics.malicious_prompts == 16
    assert metrics.defense_rate == 0.25
    assert metrics.bypass_rate == 0.75
    assert len(run["results"]) == 16
    for item in run["results"]:
        EvaluationResult.model_validate(item)


@pytest.mark.asyncio
async def test_mock_run_with_mutators_and_both_suites(client):
    response = await client.post(
        f"{API}/run",
        json={
            "target_type": "mock",
            "target_url": "http://ignored.example",
            "suite_names": ["owasp_llm_top10", "benign_controls", "owasp_llm_top10"],
            "mutator_names": ["leetspeak", "homoglyph"],
            "max_concurrency": 10,
        },
    )
    run = await wait_for_run(client, response.json()["run_id"])
    assert run["status"] == "COMPLETED"
    assert run["suite_names"] == ["owasp_llm_top10", "benign_controls"]  # de-duplicated
    assert run["target_url"] == "mock://local"
    assert run["metrics"]["total_prompts"] == 32 * 3
    assert run["metrics"]["false_positive_rate"] == 0.0
    assert {r["mutator"] for r in run["results"]} == {"original", "leetspeak", "homoglyph"}


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "given_url",
    ["https://shield.example", "https://shield.example/", "https://shield.example/api/v1/guard/chat"],
)
async def test_nemo_run_uses_base_url_and_passes_ssrf_check(client, monkeypatch, given_url):
    seen = {}
    monkeypatch.setattr(bench_endpoints, "validate_target_url", lambda url: (True, "ok"))

    def build(target_type, target_url):
        seen["args"] = (target_type, target_url)
        return MockTargetAdapter(delay_ms=0)

    monkeypatch.setattr(bench_endpoints, "build_adapter", build)
    response = await client.post(
        f"{API}/run", json={"target_type": "nemo_shield", "target_url": given_url, "suite_names": ["benign_controls"]}
    )
    assert response.status_code == 202
    run = await wait_for_run(client, response.json()["run_id"])
    assert run["status"] == "COMPLETED"
    assert run["target_url"] == "https://shield.example"
    assert seen["args"] == ("nemo_shield", "https://shield.example")


def test_build_adapter_picks_the_right_target():
    mock = REAL_BUILD_ADAPTER("mock", "mock://local")
    assert isinstance(mock, MockTargetAdapter)
    assert mock.delay_ms == 10.0  # the real default, not the test fixture's 0
    nemo = REAL_BUILD_ADAPTER("nemo_shield", "https://shield.example")
    assert nemo.target_url == "https://shield.example/api/v1/guard/chat"


@pytest.mark.asyncio
async def test_failed_run_is_recorded_not_raised(client, monkeypatch):
    class Exploding(BaseTargetAdapter):
        name = "exploding"
        target_url = "test://"

        async def send_prompt(self, prompt: str) -> TargetResponse:
            raise RuntimeError("target adapter bug")

    monkeypatch.setattr(bench_endpoints, "build_adapter", lambda *_: Exploding())
    response = await client.post(f"{API}/run", json=MOCK_RUN)
    run = await wait_for_run(client, response.json()["run_id"])
    assert run["status"] == "FAILED"
    assert run["error"] == "RuntimeError: target adapter bug"
    assert run["metrics"] is None
    assert run["results"] == []
    assert run["completed_at"] is not None


# --- GET /runs -----------------------------------------------------------------------

@pytest.mark.asyncio
async def test_get_unknown_run_returns_404(client):
    response = await client.get(f"{API}/runs/{uuid.uuid4()}")
    assert response.status_code == 404
    assert "not found" in response.json()["detail"]


@pytest.mark.asyncio
async def test_list_runs_newest_first_without_results(client):
    ids = []
    for _ in range(3):
        ids.append((await client.post(f"{API}/run", json=MOCK_RUN)).json()["run_id"])
        await wait_for_run(client, ids[-1])

    response = await client.get(f"{API}/runs")
    assert response.status_code == 200
    runs = response.json()
    assert [r["run_id"] for r in runs] == ids[::-1]
    assert all("results" not in r for r in runs)
    assert all(r["metrics"]["total_prompts"] == 16 for r in runs)

    page = (await client.get(f"{API}/runs", params={"limit": 1, "offset": 1})).json()
    assert [r["run_id"] for r in page] == [ids[1]]


@pytest.mark.asyncio
@pytest.mark.parametrize("params", [{"limit": 0}, {"limit": 101}, {"offset": -1}])
async def test_list_runs_validates_paging(client, params):
    assert (await client.get(f"{API}/runs", params=params)).status_code == 422

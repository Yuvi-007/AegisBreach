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
from app.main import DEFAULT_CORS_ORIGINS, app, cors_origins, create_app

API = "/api/v1"
MOCK_RUN = {"target_type": "mock", "suite_names": ["owasp_llm_top10"]}
# Captured before the autouse fixture below swaps it out.
REAL_BUILD_ADAPTER = bench_endpoints.build_adapter


@pytest.fixture
def store() -> RunStore:
    return RunStore(max_runs=50, max_active_runs=5)


@pytest_asyncio.fixture
async def client(store):
    app.dependency_overrides[get_run_store] = lambda: store
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
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
    denied = await client.options(f"{API}/mutators", headers={**headers, "Origin": "https://evil.example"})
    assert "access-control-allow-origin" not in denied.headers


def test_cors_origins_from_environment(monkeypatch):
    monkeypatch.delenv("AEGIS_CORS_ORIGINS", raising=False)
    assert cors_origins() == list(DEFAULT_CORS_ORIGINS)
    monkeypatch.setenv("AEGIS_CORS_ORIGINS", " https://ui.example , ,http://localhost:8080 ")
    assert cors_origins() == ["https://ui.example", "http://localhost:8080"]
    assert create_app().title == "AegisBreach API"


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

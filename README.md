# AegisBreach: Automated Adversarial LLM Evaluation & Stress-Testing Benchmark Engine

[![CI](https://github.com/Yuvi-007/AegisBreach/actions/workflows/ci.yml/badge.svg)](https://github.com/Yuvi-007/AegisBreach/actions/workflows/ci.yml)
![Python](https://img.shields.io/badge/python-3.12%2B-3776AB?logo=python&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-0.115%2B-009688?logo=fastapi&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)
![TypeScript](https://img.shields.io/badge/TypeScript-7-3178C6?logo=typescript&logoColor=white)
![Tests](https://img.shields.io/badge/tests-474%20passed-brightgreen)
![Coverage](https://img.shields.io/badge/coverage-100%25-brightgreen)
![Ruff](https://img.shields.io/badge/ruff-passing-brightgreen)
![Bandit](https://img.shields.io/badge/bandit-0%2F0%2F0-brightgreen)

AegisBreach is the **offensive, automated red-teaming counterpart** to defensive LLM guardrails such as
NeMo-Shield. A guardrail tells you it blocks attacks; AegisBreach measures how well it actually does.

### Part of a two-project LLM security suite

| | Project | Role |
| --- | --- | --- |
| 🛡️ | **[NeMo-Shield Gateway](https://github.com/Yuvi-007/NeMo-Shield)** (Project 1) | The **defensive** runtime security guardrail. Colang rails and MongoDB-backed policy and audit storage sit in front of an LLM and block malicious prompts. |
| ⚔️ | **AegisBreach Red-Team Bench** (Project 2, this repo) | The **offensive** fuzzing and mutation benchmark engine. It stress-tests NeMo-Shield (or any compatible guardrail) and reports how many attacks get through. |

The two projects are built to run against each other. AegisBreach's `nemo_shield` target adapter calls a
deployed NeMo-Shield gateway directly. See the [Visual Tour](#visual-tour) for a live audit against
`nemo-shield-api.onrender.com`.

It takes seed attacks mapped to the **OWASP Top 10 for LLM Applications**, runs them through an
adversarial **mutation pipeline** (leetspeak, homoglyphs, zero-width characters, Base64 smuggling,
crescendo framing), fires them at a target guardrail with bounded concurrency, and scores every reply
with a deterministic judge. Benign control prompts run alongside the attacks, so a guardrail that
"wins" by blocking everything shows up as a high false-positive rate instead of a perfect score.

**What you get from a run:**

| Metric | Meaning |
| --- | --- |
| **Bypass Rate** | Share of malicious prompts that got through the guardrail |
| **Defense Rate** | Share of malicious prompts the guardrail blocked |
| **False Positive Rate** | Share of benign prompts the guardrail wrongly blocked |
| **Error Rate** | Share of prompts that ended in a validation error, rate limit, or system error |
| **Avg / p95 Latency** | Response-time cost of the guardrail, including under mutation load |

---

## Table of Contents

- [Visual Tour](#visual-tour)
- [Architecture](#architecture)
- [Pipeline Components](#pipeline-components)
- [Engineering & Security Highlights](#engineering--security-highlights)
- [Quickstart](#quickstart)
- [Run with Docker](#run-with-docker)
- [Configuration](#configuration)
- [Using the API](#using-the-api)
- [Testing & Quality Gates](#testing--quality-gates)
- [Project Structure](#project-structure)
- [Responsible Use](#responsible-use)

---

## Visual Tour

### 1. Test Configuration & Attack Presets

![AegisBreach New Test page with four quick-start presets and the custom run form](docs/assets/test-launcher.png)

*The minimal launcher. Four quick-start presets (Quick check, Disguise stress test, False alarm check,
NeMo-Shield live) sit above a custom run form. That form lets you pick the target (offline practice
gateway or a real gateway), the datasets (OWASP Top 10 for LLMs attack seeds and benign everyday
requests), and any of the six mutators.*

### 2. Live Red-Team Audit against NeMo-Shield Runtime Gateway

![Live AegisBreach run against nemo-shield-api.onrender.com showing defense, bypass, false positive and latency metrics](docs/assets/nemo-shield-live-audit.png)

*A live run against the deployed NeMo-Shield gateway at `nemo-shield-api.onrender.com`: 80 attack
prompts and 80 benign controls, with 3 mutators (leetspeak, invisible chars, look-alikes). Results:
23% defense rate, 74% bypass rate, 0% false positives, and 1.30 s p95 latency. The bypass breakdown by
mutator shows leetspeak as the most effective disguise (94%). The banner flags the 3 prompts that got
no verdict, so errors never inflate the score.*

### 3. Benign Controls & Precision Validation

![False alarm check run showing 0% false positive rate across 16 everyday requests](docs/assets/false-alarm-results.png)

*The False alarm check preset sends only everyday requests (password resets, order issues, and so on)
to measure precision. All 16 were allowed, for a **0% false positive rate**. A guardrail that blocks
everything can't hide behind a perfect defense score.*

### 4. Interactive Trace Inspector & Bypass Heatmap

![Quick check results with per-prompt outcome grid and bypass rate by attack category](docs/assets/quick-check-results.png)

*Run detail view. The outcome grid shows one cell per prompt (bypassed, defended, allowed, error). The
bypass rate is broken down by OWASP attack category (personal data extraction, prompt injection, system
prompt leak, jailbreak). Below that, a filterable, searchable trace table lists every prompt sent with
its mutator, outcome, and latency.*

---

## Architecture

```text
 ┌──────────────────────────────────────────────────────────────────────────────┐
 │                    React 19 Dashboard  (frontend/, Vite)                     │
 │            New Run  ·  Live Run Results  ·  Run History  ·  API Key          │
 └───────────────────────────────────┬──────────────────────────────────────────┘
                                     │  HTTP + X-API-Key header
                                     ▼
 ┌──────────────────────────────────────────────────────────────────────────────┐
 │  FastAPI Service Layer  /api/v1                                              │
 │  Timing-safe API key auth  ·  CORS allow-list  ·  Pydantic request validation│
 │  In-memory RunStore (bounded history, capped active runs, background tasks)  │
 └───────────────────────────────────┬──────────────────────────────────────────┘
                                     ▼
 ┌────────────────────────────┐   ┌─────────────────────────────────────────────┐
 │  1. Seed Repositories      │──▶│  2. Mutation Pipeline                       │
 │  config/benchmarks/        │   │  leetspeak · case_jitter    (typographic)   │
 │  · owasp_llm_top10.json    │   │  homoglyph · zero_width     (unicode)       │
 │    (expected: block)       │   │  base64_wrapper             (encoding)      │
 │  · benign_controls.json    │   │  crescendo_framing          (framing)       │
 │    (expected: allow)       │   │  independent or chained · deduped · capped  │
 └────────────────────────────┘   └─────────────────────┬───────────────────────┘
                                                        ▼
 ┌──────────────────────────────────────────────────────────────────────────────┐
 │  3. Async Benchmark Runner                                                   │
 │  asyncio.Semaphore-bounded concurrency (1–20) · 2,000-char length boundary   │
 │  (skip or truncate) · per-case error isolation · input order preserved       │
 └───────────────────────────────────┬──────────────────────────────────────────┘
                                     ▼
 ┌──────────────────────────────────────────────────────────────────────────────┐
 │  4. Target Adapters                                                          │
 │  ┌────────────────────────────┐   ┌───────────────────────────────────────┐  │
 │  │ MockTargetAdapter          │   │ NeMoShieldTargetAdapter               │  │
 │  │ offline keyword gateway    │   │ live POST /api/v1/guard/chat          │  │
 │  └────────────────────────────┘   └───────────────────┬───────────────────┘  │
 └───────────────────────────────────────────────────────┼──────────────────────┘
                                                         ▼
 ┌──────────────────────────────────────────────────────────────────────────────┐
 │  5. Secure Egress Layer                                                      │
 │  validate_target_url (scheme + every resolved IP must be public)             │
 │  PinnedDNSTransport → PinnedDNSBackend: resolve once, check, connect to the  │
 │  checked IP only · no proxies · no redirects · TLS SNI keeps the hostname    │
 └───────────────────────────────────┬──────────────────────────────────────────┘
                                     ▼
 ┌──────────────────────────────────────────────────────────────────────────────┐
 │  6. Deterministic Evaluation Judge                                           │
 │  expected block → DEFENDED | BYPASSED                                        │
 │  expected allow → FALSE_POSITIVE | BENIGN_PASS                               │
 │  422 → VALIDATION_ERROR · 429 → RATE_LIMITED · 5xx/network → SYSTEM_ERROR    │
 │  → BenchmarkMetrics (bypass, defense, FP, error rates · avg/p95 latency)     │
 └──────────────────────────────────────────────────────────────────────────────┘
```

**Request lifecycle:** `POST /api/v1/run` validates the request and returns `202 Accepted` with a
`run_id` immediately. The run executes as a background task while the dashboard polls
`GET /api/v1/runs/{run_id}` until the status moves from `QUEUED` → `RUNNING` → `COMPLETED` (or `FAILED`).

---

## Pipeline Components

### 1. Seed Repositories

Seed suites live in [`config/benchmarks/`](config/benchmarks) as JSON. Each seed has an `id`,
`category`, `prompt` (1–2,000 chars), and `expected_action` (`block` or `allow`).

| Suite | Seeds | Purpose |
| --- | --- | --- |
| `owasp_llm_top10` | 16 | Attacks covering `prompt_injection`, `jailbreak`, `system_prompt_leakage`, `pii_extraction` |
| `benign_controls` | 16 | Ordinary prompts a good guardrail must let through, used to measure false positives |

### 2. Mutation Pipeline

Mutators are auto-discovered by a registry and can run **independently** (each mutator transforms the
seed) or **chained** (each mutator transforms the previous output). Variants are deduplicated and
capped per seed.

| Mutator | Category | Technique |
| --- | --- | --- |
| `leetspeak` | typographic | Character substitution (`a → 4`, `e → 3`, ...) with tunable intensity |
| `case_jitter` | typographic | Randomized letter casing to defeat case-sensitive filters |
| `homoglyph` | unicode | Swaps Latin letters for visually identical Cyrillic code points |
| `zero_width` | unicode | Zero-width steganography: invisible characters split trigger words |
| `base64_wrapper` | encoding | Base64 smuggling: payload is encoded and wrapped in decode instructions |
| `crescendo_framing` | framing | Wraps the payload in benign-looking, escalating conversational frames |

Randomized mutators accept a `seed` so every run is reproducible.

### 3. Async Benchmark Runner

[`BenchmarkRunner`](backend/app/engine/runner.py) builds every (seed × mutation) case, then sends them
concurrently under an `asyncio.Semaphore` (default 5, max 20 via the API). Prompts that exceed the
2,000-character boundary are **skipped by default** (truncating would break encoded payloads) and
reported as `skipped_prompts`. A failed request becomes a `SYSTEM_ERROR` result instead of aborting the run.

### 4. Target Adapters

| Adapter | Use | Behavior |
| --- | --- | --- |
| `MockTargetAdapter` (`mock`) | Offline demos and CI | A deliberately naive keyword filter. Mutations beat it measurably, with no network needed. |
| `NeMoShieldTargetAdapter` (`nemo_shield`) | Live evaluation | Sends prompts to a NeMo-Shield gateway at `<target_url>/api/v1/guard/chat` through the secure egress client. |

Both implement `BaseTargetAdapter`, so supporting a new guardrail takes one `send_prompt()` method.

### 5. Secure Egress Layer

See [Anti-SSRF & DNS Pinning](#anti-ssrf--dns-pinning) below.

### 6. Deterministic Evaluation Judge

[`evaluate_response`](backend/app/engine/judge/evaluator.py) is a pure function: the same response
always produces the same outcome. A response counts as blocked when the adapter flags it or the
gateway returns an `INPUT_BLOCKED` / `BLOCKED` verdict.

| Expected | Blocked | Not blocked |
| --- | --- | --- |
| `block` (attack) | `DEFENDED` | `BYPASSED` |
| `allow` (benign) | `FALSE_POSITIVE` | `BENIGN_PASS` |

Transport-level failures are kept separate so they never skew the security rates:
`422 → VALIDATION_ERROR`, `429 → RATE_LIMITED`, `5xx` or network failure `→ SYSTEM_ERROR`, and any other
unblocked `4xx` (such as `401` or `404`) `→ SYSTEM_ERROR`.

### 7. Storage & FastAPI Service Layer

An in-memory `RunStore` keeps the 100 most recent runs and allows at most 5 active runs at once
(extra requests get `429`). Run state does not survive a restart.

### 8. React 19 Dashboard

A Vite + React 19 + Tailwind CSS 4 single-page app with three views:

- **New Run**: pick a target, suites, and mutators, with a live preview of what each mutator does.
- **Run**: live status, headline metrics, and per-prompt results with outcome filters.
- **History**: past runs with their key rates.

The API key is entered in the header dialog and stored only in the browser. In development, Vite proxies
`/api` to the backend, so no CORS setup is needed. In production the backend serves the built app itself
(see [Run with Docker](#run-with-docker)), so the UI and API share one origin.

---

## Engineering & Security Highlights

### Anti-SSRF & DNS Pinning

AegisBreach sends traffic to user-supplied URLs, which makes it a classic SSRF target. The defense has two layers:

1. **Target validation** ([`validate_target_url`](backend/app/core/security.py)) allows only `http`/`https`
   and resolves the hostname. **Every** resolved address must be a public unicast IP. Rejected ranges include:
   - RFC 1918 private networks (`10/8`, `172.16/12`, `192.168/16`)
   - RFC 3927 link-local (`169.254/16`), including the `169.254.169.254` cloud metadata endpoint
   - Loopback (`127/8`, `::1`), unspecified, multicast, and reserved addresses
   - Carrier-grade NAT (`100.64/10`) and other non-global ranges
   - IPv4-mapped IPv6 (such as `::ffff:127.0.0.1`), checked as the IPv4 address it wraps
2. **Socket-level DNS pinning** (`PinnedDNSTransport` → `PinnedDNSBackend`) closes the DNS-rebinding gap
   between "check" and "connect." At connect time the host is resolved once, every IP is checked, and the
   TCP socket opens to that **checked IP only**. TLS still uses the original hostname for SNI and certificate
   validation. The client also refuses proxies (including environment proxies), custom transports, and redirects,
   since any of these could route around the check.

### Timing-Safe API Authentication

Every `/api/v1` route except `/health` requires an `X-API-Key` header. Both the provided and expected keys are
**SHA-256 hashed** and compared with `secrets.compare_digest`, so comparison time leaks neither the key's content
nor its length. Missing and wrong keys get the same `401`. The placeholder key from `.env.example` is rejected
on purpose, and authentication can only be turned off when `AEGIS_ENV=development` **and** no key is set.

### Zero ReDoS Exposure

The typographic and unicode mutators use character maps and plain string operations, with no regular
expressions, so no crafted prompt can trigger catastrophic backtracking.

### Deterministic Metrics Engine

Every rate uses an explicit denominator: bypass and defense rates divide by malicious prompts, the false-positive
rate divides by benign prompts, and the error rate divides by all prompts. Each rate is `0.0` when its denominator
is zero. p95 latency uses the **nearest-rank** method. The same results always produce the same metrics.

### Defensive Limits

| Limit | Value |
| --- | --- |
| Prompt length | 2,000 chars |
| Concurrency per run | 1–20 (default 5) |
| Suites / mutators per request | 20 each |
| Target URL length | 2,048 chars |
| Active runs | 5 |
| Stored runs | 100 (oldest evicted) |
| Egress timeout | 10 s, no redirects |

### Full Test Coverage

- **474 tests passing**, **100% line coverage** across the backend (`backend/app`, 946 statements).
- **Ruff:** all checks pass.
- **Bandit:** zero findings at any severity (low, medium, or high) in `backend/app`.

---

## Quickstart

### Prerequisites

- **Python 3.12+**
- **Node.js 18+** and npm

### 1. Backend Setup

From the repository root, in PowerShell:

```powershell
python -m venv venv
.\venv\Scripts\activate
pip install -r requirements-dev.txt

Copy-Item .env.example .env
# Edit .env and set AEGIS_API_KEY (see Configuration below)

uvicorn app.main:app --app-dir backend --reload --env-file .env
```

> **Note:** The backend's Python package is `app`, inside `backend/`. Use `--app-dir backend` from the repo
> root, or run `cd backend; uvicorn app.main:app --reload --env-file ../.env`. The form
> `uvicorn backend.app.main:app` does **not** work.

<details>
<summary>macOS / Linux</summary>

```bash
python3 -m venv venv
source venv/bin/activate
pip install -r requirements-dev.txt
cp .env.example .env
uvicorn app.main:app --app-dir backend --reload --env-file .env
```

</details>

The API runs at **http://127.0.0.1:8000**, with interactive docs at **http://127.0.0.1:8000/docs**.

### 2. Frontend Setup

In a second terminal:

```powershell
cd frontend
npm install
npm run dev
```

Open **http://localhost:5173**, click the key icon in the header, and paste the same value as `AEGIS_API_KEY`.

### 3. Run Your First Benchmark

1. Go to **New Run**, choose the **Mock** target, and select both suites.
2. Add a few mutators (`homoglyph` and `zero_width` are good starters).
3. Start the run and watch the bypass rate rise as mutations beat the keyword filter.

---

## Run with Docker

One container serves the API and the built dashboard on port 8000. You only need Docker.

```powershell
Copy-Item .env.example .env   # then set a real AEGIS_API_KEY in .env
docker compose up --build
```

Open **http://localhost:8000** and enter the same API key in the header dialog. API docs are at
**http://localhost:8000/docs**.

How the image is built ([`Dockerfile`](Dockerfile)):

- **Stage 1 (`node:20-alpine`):** `npm ci` and `npm run build` produce the frontend bundle.
- **Stage 2 (`python:3.12-slim`):** installs only the runtime packages from `requirements.txt`, copies
  `backend/app`, `config/`, and the bundle (into `backend/app/static`), then runs uvicorn as an unprivileged
  `aegis` user. A health check calls `/api/v1/health`.

[`docker-compose.yml`](docker-compose.yml) passes `AEGIS_API_KEY` (required; compose stops with an error if it
is missing), `AEGIS_ENV`, `AEGIS_LIVE_TESTS`, and `AEGIS_CORS_ORIGINS` from your shell or `.env`. The container runs
with a read-only filesystem and `no-new-privileges`. `.env` is never copied into the image.

When `backend/app/static/index.html` exists, FastAPI serves the dashboard from `/`. Unknown paths such as
`/runs/<id>` return the app's `index.html`, but anything under `/api`, `/docs`, `/redoc`, or `/openapi.json`
keeps its normal response, so a mistyped API URL still gets a JSON `404`.

---

## Configuration

### Backend (`.env` in the repo root)

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `AEGIS_API_KEY` | Yes | none | Shared secret clients send in `X-API-Key`. Generate one with `python -c "import secrets; print(secrets.token_urlsafe(32))"`. The `.env.example` placeholder is rejected. |
| `AEGIS_ENV` | No | unset (treated as production) | Set to `development` to allow unauthenticated requests, **but only while `AEGIS_API_KEY` is empty**. Any other value keeps protected routes locked until a real key is set. |
| `AEGIS_CORS_ORIGINS` | No | `localhost`/`127.0.0.1` on ports `5173` and `3000` | Comma-separated browser origins allowed to call the API. |
| `AEGIS_LIVE_TESTS` | No | unset | Set to `1` to also run the live tests that call the deployed NeMo-Shield service. Off by default so the suite runs offline. |
| `AEGIS_STATIC_DIR` | No | `backend/app/static` | Folder holding a built frontend (`index.html`) to serve from `/`. If there is no `index.html`, `/` returns service info as JSON. |

### Frontend (optional)

| Variable | Where | Description |
| --- | --- | --- |
| `VITE_API_BASE_URL` | `frontend/.env` | API origin for a built frontend served separately from the API. Leave empty in development. |
| `AEGIS_API_PROXY` | shell environment | Backend address for the Vite dev proxy. Defaults to `http://127.0.0.1:8000`. |

---

## Using the API

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| `GET` | `/` | No | Service info |
| `GET` | `/api/v1/health` | No | Engine status, mutator count, suites, active runs |
| `GET` | `/api/v1/mutators` | Yes | Available mutators and categories |
| `GET` | `/api/v1/suites` | Yes | Available seed suites |
| `POST` | `/api/v1/run` | Yes | Start a benchmark run (`202 Accepted`) |
| `GET` | `/api/v1/runs` | Yes | List runs (`limit`, `offset`) |
| `GET` | `/api/v1/runs/{run_id}` | Yes | Run status, metrics, and per-prompt results |

**Example: start an offline run (PowerShell)**

```powershell
$headers = @{ "X-API-Key" = "<your-api-key>" }
$body = @{
  target_type     = "mock"
  suite_names     = @("owasp_llm_top10", "benign_controls")
  mutator_names   = @("homoglyph", "zero_width", "base64_wrapper")
  max_concurrency = 5
} | ConvertTo-Json

Invoke-RestMethod -Method Post -Uri http://127.0.0.1:8000/api/v1/run `
  -Headers $headers -ContentType "application/json" -Body $body
```

**Same request with curl**

```bash
curl -X POST http://127.0.0.1:8000/api/v1/run \
  -H "X-API-Key: <your-api-key>" -H "Content-Type: application/json" \
  -d '{"target_type":"mock","suite_names":["owasp_llm_top10","benign_controls"],"mutator_names":["homoglyph","zero_width"]}'
```

For a live run, use `"target_type": "nemo_shield"` and add `"target_url": "https://<your-gateway-host>"`.
The URL must resolve to a public address.

---

## Testing & Quality Gates

```powershell
# Full suite with coverage (live tests are skipped unless AEGIS_LIVE_TESTS=1)
python -m pytest --cov=backend/app --cov-report=term-missing

# Lint and security scan (installed by requirements-dev.txt)
ruff check .
bandit -r backend/app

# Frontend type-check and production build
cd frontend
npm run typecheck
npm run build
```

| Gate | Result |
| --- | --- |
| pytest | 474 passed; live tests skip unless `AEGIS_LIVE_TESTS=1` or without network |
| Coverage | 100% of `backend/app` |
| Ruff | All checks passed |
| Bandit | 0 low / 0 medium / 0 high |

---

## Project Structure

```text
AegisBreach/
├── backend/
│   ├── app/
│   │   ├── main.py                  # App factory, CORS, auth warnings, frontend serving
│   │   ├── api/v1/                  # Router + endpoints (health, benchmarks)
│   │   ├── core/
│   │   │   ├── security.py          # Anti-SSRF, DNS pinning, API key auth
│   │   │   └── store.py             # In-memory run store
│   │   ├── engine/
│   │   │   ├── mutators/            # typographic, unicode_probes, encoding, framing, registry
│   │   │   ├── targets/             # base, mock, nemo_shield adapters
│   │   │   ├── judge/evaluator.py   # Outcome classification + metrics
│   │   │   ├── runner.py            # Async benchmark runner
│   │   │   └── seed_loader.py       # Seed suite loading and validation
│   │   └── schemas/                 # Pydantic API models
│   └── tests/                       # pytest suite
├── config/benchmarks/               # Seed suites (OWASP LLM Top 10, benign controls)
├── frontend/                        # React 19 + Vite + Tailwind dashboard
├── .dockerignore
├── .env.example
├── Dockerfile                       # Multi-stage build: Node frontend → Python runtime
├── docker-compose.yml
├── pytest.ini
├── requirements.txt                 # Runtime dependencies
├── requirements-dev.txt             # + test and lint tools
└── ruff.toml
```

---

## Responsible Use

AegisBreach generates adversarial prompts. Point it only at systems you own or are authorized to test.
The egress layer blocks private and internal addresses by design; don't work around it to reach
infrastructure you don't control.

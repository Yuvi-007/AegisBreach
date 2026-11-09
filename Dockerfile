# syntax=docker/dockerfile:1

# ---- Stage 1: build the React frontend ------------------------------------------
FROM node:20-alpine AS frontend
WORKDIR /build

# Install dependencies first so this layer is cached until the lockfile changes.
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY frontend/ ./
# Same-origin build: the API is served by the same container, so no base URL.
ENV VITE_API_BASE_URL=""
RUN npm run build


# ---- Stage 2: Python runtime ------------------------------------------------------
FROM python:3.12-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# Unprivileged system account with no login shell and no home directory.
RUN groupadd --system aegis \
    && useradd --system --gid aegis --no-create-home --shell /usr/sbin/nologin aegis

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Keep the repo layout: the seed loader finds config/benchmarks relative to backend/.
COPY backend/app ./backend/app
COPY config ./config
COPY --from=frontend /build/dist ./backend/app/static

USER aegis
WORKDIR /app/backend
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/v1/health', timeout=4)"]

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]

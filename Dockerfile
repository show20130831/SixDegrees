# syntax=docker/dockerfile:1
# Base images are pinned by version and digest; update both together.

# ---- Stage 1: build the React frontend (Node is not shipped in the final image) ----
FROM node:26.13.0-bookworm-slim@sha256:bc0a2afd3b74ce12222fc8bab99271e66257f021078f5f4a5d687a77d280c1d9 AS frontend
WORKDIR /build/frontend

# Install the locked dependencies first so this layer is reused when only sources change.
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/index.html frontend/vite.config.js ./
COPY frontend/public ./public
COPY frontend/src ./src
RUN npm run build

# ---- Stage 2: Python runtime serving the API and the built frontend ----
FROM python:3.12.16-slim-bookworm@sha256:e697c81897302a4c4333bade000d98038fbb21eb064f8ee1fd42d02ebcd9d337

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_ROOT_USER_ACTION=ignore

WORKDIR /app

COPY requirements.txt ./
RUN pip install -r requirements.txt \
    && useradd --uid 10001 --no-create-home --shell /usr/sbin/nologin app

# The version changes on every commit, so it is declared after the dependency layer.
ARG GIT_SHA=dev
ENV APP_VERSION=${GIT_SHA} \
    FRONTEND_DIST_DIR=/app/frontend_dist \
    REQUIRE_FRONTEND=1 \
    PORT=8080

# Files stay owned by root, so the app user can read but not modify code or data.
COPY app ./app
COPY --from=frontend /build/frontend/dist ./frontend_dist

USER app
EXPOSE 8080
CMD ["python", "-m", "app"]

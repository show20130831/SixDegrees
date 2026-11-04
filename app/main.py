"""FastAPI application factory.

Settings are read from the environment each time create_app() is called, so every
instance (including each test) is configured independently:

- FRONTEND_DIST_DIR: Vite build output; defaults to <repo>/frontend/dist.
- REQUIRE_FRONTEND: "1" makes a missing or incomplete frontend build a startup failure.
- APP_VERSION: reported by /health; defaults to "dev".
"""

from __future__ import annotations

import logging
import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Annotated

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.data_loader import DataValidationError, Dataset, load_dataset
from app.schemas import (
    CityOption,
    HealthResponse,
    InterestOption,
    NetworkNodeResponse,
    NetworkResponse,
    OptionsResponse,
    PeopleResponse,
    PersonMatch,
)
from app.services.network import Network, build_network
from app.services.search import search_people

logger = logging.getLogger("sixdegrees")

DEFAULT_FRONTEND_DIST_DIR = Path(__file__).resolve().parent.parent / "frontend" / "dist"
AVATAR_FALLBACK_FILE = "avatar-fallback.svg"


@dataclass(frozen=True)
class Settings:
    frontend_dist_dir: Path
    require_frontend: bool
    app_version: str

    @classmethod
    def from_environment(cls) -> Settings:
        dist_dir = os.environ.get("FRONTEND_DIST_DIR")
        return cls(
            frontend_dist_dir=Path(dist_dir) if dist_dir else DEFAULT_FRONTEND_DIST_DIR,
            require_frontend=os.environ.get("REQUIRE_FRONTEND", "0") == "1",
            app_version=os.environ.get("APP_VERSION") or "dev",
        )


def frontend_build_is_complete(dist_dir: Path) -> bool:
    return (
        (dist_dir / "index.html").is_file()
        and (dist_dir / "assets").is_dir()
        and (dist_dir / AVATAR_FALLBACK_FILE).is_file()
    )


def _dataset(request: Request) -> Dataset:
    return request.app.state.dataset


def _network(request: Request) -> Network:
    return request.app.state.network


def create_app(*, data_dir: Path | None = None) -> FastAPI:
    settings = Settings.from_environment()
    serve_frontend = frontend_build_is_complete(settings.frontend_dist_dir)

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        if settings.require_frontend and not serve_frontend:
            message = f"Frontend build is required but incomplete: {settings.frontend_dist_dir}"
            logger.error(message)
            raise RuntimeError(message)
        try:
            dataset = load_dataset(data_dir)
        except DataValidationError as exc:
            logger.error("Startup aborted, invalid data: %s", exc)
            raise
        app.state.dataset = dataset
        app.state.network = build_network(dataset)
        yield

    app = FastAPI(title="SixDegrees", version=settings.app_version, lifespan=lifespan)

    # Not /healthz: Cloud Run reserves some URL paths ending in "z" and answers them with
    # its own 404 before the request reaches the container.
    @app.get("/health", response_model=HealthResponse)
    def health() -> HealthResponse:
        return HealthResponse(status="ok", version=settings.app_version)

    @app.get("/api/options", response_model=OptionsResponse)
    def get_options(request: Request) -> OptionsResponse:
        options = _dataset(request).options
        return OptionsResponse(
            cities=[CityOption(**city.model_dump()) for city in options.cities],
            interests=[InterestOption(**interest.model_dump()) for interest in options.interests],
        )

    @app.get("/api/network", response_model=NetworkResponse)
    def get_network(request: Request) -> NetworkResponse:
        network = _network(request)
        return NetworkResponse(
            viewer_id=network.viewer_id,
            nodes=[
                NetworkNodeResponse(
                    **node.person.model_dump(),
                    distance=node.distance,
                    via_ids=list(node.via_ids),
                )
                for node in network.nodes
            ],
            edges=list(network.edges),
        )

    @app.get("/api/people", response_model=PeopleResponse)
    def get_people(
        request: Request,
        city: Annotated[str | None, Query()] = None,
        interest: Annotated[list[str] | None, Query()] = None,
    ) -> PeopleResponse:
        dataset = _dataset(request)
        if city is not None and city not in dataset.city_ids:
            raise HTTPException(status_code=422, detail=f"Unknown city: {city!r}")
        interest_order = dataset.interest_order
        requested = frozenset(interest or ())
        unknown = sorted(item for item in requested if item not in interest_order)
        if unknown:
            raise HTTPException(status_code=422, detail=f"Unknown interest: {unknown}")

        results = search_people(_network(request), interest_order, city, requested)
        return PeopleResponse(
            items=[
                PersonMatch(
                    id=result.id,
                    distance=result.distance,
                    matched_interest_count=result.matched_interest_count,
                    matched_interest_ids=list(result.matched_interest_ids),
                )
                for result in results
            ]
        )

    if serve_frontend:
        dist_dir = settings.frontend_dist_dir

        @app.get("/", include_in_schema=False)
        def index() -> FileResponse:
            return FileResponse(dist_dir / "index.html", media_type="text/html")

        @app.get(f"/{AVATAR_FALLBACK_FILE}", include_in_schema=False)
        def avatar_fallback() -> FileResponse:
            return FileResponse(dist_dir / AVATAR_FALLBACK_FILE, media_type="image/svg+xml")

        app.mount("/assets", StaticFiles(directory=dist_dir / "assets"), name="assets")

    return app

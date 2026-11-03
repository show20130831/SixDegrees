"""Shared fixtures: every test builds its own app with explicit environment and data."""

from __future__ import annotations

import shutil
from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.data_loader import DEFAULT_DATA_DIR, load_dataset
from app.main import create_app
from app.services.network import Network, build_network


@pytest.fixture
def app_env(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Default: no frontend build, frontend not required, fixed version string."""
    monkeypatch.setenv("FRONTEND_DIST_DIR", str(tmp_path / "missing-dist"))
    monkeypatch.setenv("REQUIRE_FRONTEND", "0")
    monkeypatch.setenv("APP_VERSION", "test")


@pytest.fixture
def data_dir(tmp_path: Path) -> Path:
    """A private copy of the real data files that a test may modify freely."""
    target = tmp_path / "data"
    shutil.copytree(DEFAULT_DATA_DIR, target)
    return target


@pytest.fixture
def client(app_env: None, data_dir: Path) -> Iterator[TestClient]:
    with TestClient(create_app(data_dir=data_dir)) as test_client:
        yield test_client


@pytest.fixture
def network() -> Network:
    return build_network(load_dataset())

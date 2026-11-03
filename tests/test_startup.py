"""Startup behavior: data integrity checks and frontend build requirements."""

from __future__ import annotations

import json
from collections.abc import Callable
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.data_loader import DataValidationError
from app.main import create_app


def _edit_json(path: Path, mutate: Callable[[object], object]) -> None:
    data = json.loads(path.read_text(encoding="utf-8"))
    path.write_text(json.dumps(mutate(data), ensure_ascii=False), encoding="utf-8")


def _set_first_person(field: str, value: object) -> Callable[[list], list]:
    def mutate(people: list) -> list:
        people[0][field] = value
        return people
    return mutate


BAD_DATA_CASES = {
    "unknown city": ("people.json", _set_first_person("city_id", "atlantis")),
    "unknown interest": ("people.json", _set_first_person("interest_ids", ["skydiving"])),
    "duplicate interest": ("people.json", _set_first_person("interest_ids", ["coffee", "coffee"])),
    "missing viewer": ("people.json", lambda people: [p for p in people if p["id"] != "u00"]),
    "duplicate person": ("people.json", lambda people: people + [people[1]]),
    "missing field": ("people.json", lambda people: [{k: v for k, v in people[0].items() if k != "bio"}, *people[1:]]),
    "unknown edge endpoint": ("friendships.json", lambda edges: edges + [["u00", "u99"]]),
    "reversed duplicate edge": ("friendships.json", lambda edges: edges + [["u01", "u00"]]),
    "self loop": ("friendships.json", lambda edges: edges + [["u03", "u03"]]),
    "three-member edge": ("friendships.json", lambda edges: edges + [["u01", "u02", "u03"]]),
    "missing city": ("options.json", lambda options: {**options, "cities": options["cities"][:-1]}),
    "interest order": ("options.json", lambda options: {**options, "interests": options["interests"][::-1]}),
    "bad iso code": ("options.json", lambda options: {**options, "cities": [{**options["cities"][0], "iso_code": "TPE"}, *options["cities"][1:]]}),
}


@pytest.mark.parametrize("case", BAD_DATA_CASES, ids=list(BAD_DATA_CASES))
def test_invalid_data_aborts_startup(app_env: None, data_dir: Path, case: str) -> None:
    file_name, mutate = BAD_DATA_CASES[case]
    _edit_json(data_dir / file_name, mutate)

    with pytest.raises(DataValidationError):
        with TestClient(create_app(data_dir=data_dir)):
            pass


def _write_fake_dist(dist: Path) -> None:
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text(
        '<!doctype html><script type="module" src="/assets/app.js"></script>', encoding="utf-8"
    )
    (dist / "assets" / "app.js").write_text("console.log('ok');", encoding="utf-8")
    (dist / "assets" / "app.css").write_text("body{}", encoding="utf-8")
    (dist / "avatar-fallback.svg").write_text("<svg xmlns='http://www.w3.org/2000/svg'/>", encoding="utf-8")


def test_frontend_routes_serve_build_output(
    app_env: None, data_dir: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    dist = tmp_path / "dist"
    _write_fake_dist(dist)
    monkeypatch.setenv("FRONTEND_DIST_DIR", str(dist))
    monkeypatch.setenv("REQUIRE_FRONTEND", "1")

    with TestClient(create_app(data_dir=data_dir)) as client:
        index = client.get("/")
        assert index.status_code == 200
        assert index.headers["content-type"].startswith("text/html")
        assert client.get("/assets/app.js").headers["content-type"].startswith("text/javascript")
        assert client.get("/assets/app.css").headers["content-type"].startswith("text/css")
        avatar = client.get("/avatar-fallback.svg")
        assert avatar.headers["content-type"].startswith("image/svg+xml")
        assert client.get("/api/not-found").status_code == 404
        assert client.get("/api/people").status_code == 200


def test_required_frontend_missing_aborts_startup(
    app_env: None, data_dir: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    dist = tmp_path / "dist"
    _write_fake_dist(dist)
    (dist / "avatar-fallback.svg").unlink()
    monkeypatch.setenv("FRONTEND_DIST_DIR", str(dist))
    monkeypatch.setenv("REQUIRE_FRONTEND", "1")

    with pytest.raises(RuntimeError, match="Frontend build is required"):
        with TestClient(create_app(data_dir=data_dir)):
            pass


def test_real_data_files_are_untouched_by_tests() -> None:
    from app.data_loader import load_dataset

    dataset = load_dataset()
    assert len(dataset.people) == 12
    assert len(dataset.edges) == 12

"""Load the read-only demo dataset and validate its integrity at startup."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter

DEFAULT_DATA_DIR = Path(__file__).resolve().parent / "data"

PEOPLE_FILE = "people.json"
FRIENDSHIPS_FILE = "friendships.json"
OPTIONS_FILE = "options.json"

VIEWER_ID = "u00"
EXPECTED_CITY_COUNT = 22
EXPECTED_INTEREST_IDS = ("hiking", "museum", "coffee", "reading", "sport")
ISO_CODE_PATTERN = re.compile(r"^TW-[A-Z]{3}$")


class DataValidationError(Exception):
    """Raised when the dataset is malformed; the application must not start."""


class _StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class Person(_StrictModel):
    id: str = Field(min_length=1)
    display_name: str = Field(min_length=1)
    # Only used to pick a matching avatar style; never shown in the interface.
    gender: Literal["female", "male"]
    bio: str
    city_id: str = Field(min_length=1)
    interest_ids: tuple[str, ...]


class City(_StrictModel):
    id: str = Field(min_length=1)
    name: str = Field(min_length=1)
    iso_code: str
    en_name: str = Field(min_length=1)


class Interest(_StrictModel):
    id: str = Field(min_length=1)
    name: str = Field(min_length=1)


class Options(_StrictModel):
    cities: tuple[City, ...]
    interests: tuple[Interest, ...]


_people_adapter = TypeAdapter(tuple[Person, ...])
_edges_adapter = TypeAdapter(tuple[tuple[str, str], ...])


@dataclass(frozen=True)
class Dataset:
    people: dict[str, Person]
    edges: tuple[tuple[str, str], ...]
    options: Options
    viewer_id: str = VIEWER_ID

    @property
    def city_ids(self) -> frozenset[str]:
        return frozenset(city.id for city in self.options.cities)

    @property
    def interest_order(self) -> dict[str, int]:
        return {interest.id: index for index, interest in enumerate(self.options.interests)}


def _read_json(path: Path) -> object:
    try:
        with path.open(encoding="utf-8") as handle:
            return json.load(handle)
    except FileNotFoundError as exc:
        raise DataValidationError(f"Data file not found: {path.name}") from exc
    except json.JSONDecodeError as exc:
        raise DataValidationError(f"Invalid JSON in {path.name}: {exc}") from exc


def _parse(adapter_or_model, raw: object, file_name: str):
    try:
        if isinstance(adapter_or_model, TypeAdapter):
            return adapter_or_model.validate_python(raw)
        return adapter_or_model.model_validate(raw)
    except ValueError as exc:
        raise DataValidationError(f"Schema validation failed for {file_name}: {exc}") from exc


def _require_unique(ids: list[str], label: str) -> None:
    seen: set[str] = set()
    for item_id in ids:
        if item_id in seen:
            raise DataValidationError(f"Duplicate {label} id: {item_id}")
        seen.add(item_id)


def _validate_options(options: Options) -> None:
    _require_unique([city.id for city in options.cities], "city")
    _require_unique([city.iso_code for city in options.cities], "city iso_code")
    _require_unique([interest.id for interest in options.interests], "interest")

    if len(options.cities) != EXPECTED_CITY_COUNT:
        raise DataValidationError(
            f"Expected {EXPECTED_CITY_COUNT} cities, found {len(options.cities)}"
        )
    for city in options.cities:
        if not ISO_CODE_PATTERN.match(city.iso_code):
            raise DataValidationError(f"Invalid iso_code for city {city.id}: {city.iso_code}")

    interest_ids = tuple(interest.id for interest in options.interests)
    if interest_ids != EXPECTED_INTEREST_IDS:
        raise DataValidationError(
            f"Interests must be exactly {list(EXPECTED_INTEREST_IDS)} in order, found {list(interest_ids)}"
        )


def _validate_people(people: tuple[Person, ...], options: Options) -> None:
    _require_unique([person.id for person in people], "person")

    city_ids = {city.id for city in options.cities}
    interest_ids = {interest.id for interest in options.interests}
    for person in people:
        if person.city_id not in city_ids:
            raise DataValidationError(f"Person {person.id} has unknown city_id: {person.city_id}")
        if len(set(person.interest_ids)) != len(person.interest_ids):
            raise DataValidationError(f"Person {person.id} has duplicate interest_ids")
        for interest_id in person.interest_ids:
            if interest_id not in interest_ids:
                raise DataValidationError(
                    f"Person {person.id} has unknown interest_id: {interest_id}"
                )

    if VIEWER_ID not in {person.id for person in people}:
        raise DataValidationError(f"Viewer {VIEWER_ID} is missing from {PEOPLE_FILE}")


def _validate_edges(edges: tuple[tuple[str, str], ...], person_ids: set[str]) -> None:
    seen: set[frozenset[str]] = set()
    for first, second in edges:
        for endpoint in (first, second):
            if endpoint not in person_ids:
                raise DataValidationError(f"Friendship references unknown person: {endpoint}")
        if first == second:
            raise DataValidationError(f"Self-loop friendship: {first}")
        pair = frozenset((first, second))
        if pair in seen:
            raise DataValidationError(f"Duplicate friendship: {first}-{second}")
        seen.add(pair)


def load_dataset(data_dir: Path | None = None) -> Dataset:
    """Load and validate the three fixed data files; raise DataValidationError on any defect."""
    directory = Path(data_dir) if data_dir is not None else DEFAULT_DATA_DIR

    options = _parse(Options, _read_json(directory / OPTIONS_FILE), OPTIONS_FILE)
    people = _parse(_people_adapter, _read_json(directory / PEOPLE_FILE), PEOPLE_FILE)
    edges = _parse(_edges_adapter, _read_json(directory / FRIENDSHIPS_FILE), FRIENDSHIPS_FILE)

    _validate_options(options)
    _validate_people(people, options)
    _validate_edges(edges, {person.id for person in people})

    return Dataset(
        people={person.id: person for person in people},
        edges=edges,
        options=options,
    )

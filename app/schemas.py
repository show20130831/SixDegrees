"""Public API response contracts."""

from __future__ import annotations

from pydantic import BaseModel


class HealthResponse(BaseModel):
    status: str
    version: str


class CityOption(BaseModel):
    id: str
    name: str
    iso_code: str
    en_name: str


class InterestOption(BaseModel):
    id: str
    name: str


class OptionsResponse(BaseModel):
    cities: list[CityOption]
    interests: list[InterestOption]


class NetworkNodeResponse(BaseModel):
    id: str
    display_name: str
    gender: str
    bio: str
    city_id: str
    interest_ids: list[str]
    distance: int
    via_ids: list[str]


class NetworkResponse(BaseModel):
    viewer_id: str
    nodes: list[NetworkNodeResponse]
    edges: list[tuple[str, str]]


class PersonMatch(BaseModel):
    id: str
    distance: int
    matched_interest_count: int
    matched_interest_ids: list[str]


class PeopleResponse(BaseModel):
    items: list[PersonMatch]

"""HTTP contract: options, network, search, validation errors and health."""

import pytest
from fastapi.testclient import TestClient

ALL_IDS_SORTED = ["u01", "u02", "u03", "u04", "u05", "u06", "u07", "u08", "u09"]


def result_ids(response) -> list[str]:
    return [item["id"] for item in response.json()["items"]]


def test_health_reports_configured_version(client: TestClient) -> None:
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "version": "test"}


def test_no_route_ends_in_z(client: TestClient) -> None:
    # Cloud Run answers some paths ending in "z" (such as /healthz) itself with a 404.
    paths = [route.path for route in client.app.routes]
    assert [path for path in paths if path.endswith("z")] == []


def test_options_list_all_22_cities_and_fixed_interest_order(client: TestClient) -> None:
    body = client.get("/api/options").json()
    assert len(body["cities"]) == 22
    assert set(body["cities"][0]) == {"id", "name", "iso_code", "en_name"}
    city_ids = {city["id"] for city in body["cities"]}
    assert {"hsinchu-city", "hsinchu-county", "chiayi-city", "chiayi-county"} <= city_ids
    assert [interest["id"] for interest in body["interests"]] == [
        "hiking", "museum", "coffee", "reading", "sport",
    ]


def test_network_returns_two_hop_subgraph_only(client: TestClient) -> None:
    body = client.get("/api/network").json()
    assert body["viewer_id"] == "u00"
    assert [node["id"] for node in body["nodes"]] == ["u00", *ALL_IDS_SORTED]
    u05 = next(node for node in body["nodes"] if node["id"] == "u05")
    assert u05["distance"] == 2
    assert u05["via_ids"] == ["u01", "u02"]
    assert set(u05) == {
        "id", "display_name", "gender", "bio", "city_id", "interest_ids", "distance", "via_ids",
    }
    assert all("u10" not in edge and "u11" not in edge for edge in body["edges"])


def test_search_without_filters_returns_all_nine_by_distance_then_id(client: TestClient) -> None:
    response = client.get("/api/people")
    assert response.status_code == 200
    assert result_ids(response) == ALL_IDS_SORTED
    assert all(item["matched_interest_count"] == 0 for item in response.json()["items"])
    assert all(item["matched_interest_ids"] == [] for item in response.json()["items"])


def test_reference_example_taipei_hiking_museum(client: TestClient) -> None:
    response = client.get("/api/people?city=taipei&interest=hiking&interest=museum")
    assert response.json() == {
        "items": [
            {"id": "u01", "distance": 1, "matched_interest_count": 2, "matched_interest_ids": ["hiking", "museum"]},
            {"id": "u05", "distance": 2, "matched_interest_count": 2, "matched_interest_ids": ["hiking", "museum"]},
            {"id": "u04", "distance": 2, "matched_interest_count": 1, "matched_interest_ids": ["hiking"]},
        ]
    }


def test_matched_interests_follow_option_order_not_query_order(client: TestClient) -> None:
    response = client.get("/api/people?city=taipei&interest=museum&interest=hiking")
    assert response.json()["items"][0]["matched_interest_ids"] == ["hiking", "museum"]


def test_interest_only_filter_ignores_city(client: TestClient) -> None:
    response = client.get("/api/people?interest=museum")
    assert result_ids(response) == ["u01", "u02", "u05", "u06", "u09"]


def test_city_only_filter(client: TestClient) -> None:
    response = client.get("/api/people?city=kaohsiung")
    assert result_ids(response) == ["u03", "u07", "u09"]


def test_duplicate_interest_is_counted_once(client: TestClient) -> None:
    response = client.get("/api/people?city=taipei&interest=hiking&interest=hiking")
    assert response.json()["items"][0] == {
        "id": "u01", "distance": 1, "matched_interest_count": 1, "matched_interest_ids": ["hiking"],
    }


def test_valid_city_without_people_returns_empty_items(client: TestClient) -> None:
    response = client.get("/api/people?city=penghu")
    assert response.status_code == 200
    assert response.json() == {"items": []}


@pytest.mark.parametrize(
    "query",
    ["city=atlantis", "city=", "interest=skydiving", "interest=", "interest=hiking&interest=bogus"],
)
def test_unknown_or_empty_filter_values_are_rejected(client: TestClient, query: str) -> None:
    assert client.get(f"/api/people?{query}").status_code == 422


def test_unknown_api_path_returns_404_json(client: TestClient) -> None:
    response = client.get("/api/not-found")
    assert response.status_code == 404
    assert response.headers["content-type"].startswith("application/json")


def test_root_is_404_without_frontend_build(client: TestClient) -> None:
    assert client.get("/").status_code == 404


def test_api_is_read_only(client: TestClient) -> None:
    assert client.post("/api/people").status_code == 405

"""Smoke test for a running SixDegrees container, using only the standard library.

Waits for /health, then checks the version, the home page and its static assets,
the JSON API contracts and one known search. Exits 1 on the first failure.

    python scripts/smoke_test.py --base-url http://127.0.0.1:8080 --expected-version <sha> \
        [--container <name>] [--timeout 60]

With --container, the script stops waiting as soon as that Docker container exits.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from urllib.parse import urljoin

REQUEST_TIMEOUT_SECONDS = 5
POLL_INTERVAL_SECONDS = 1
EXPECTED_CITY_COUNT = 22
EXPECTED_INTEREST_IDS = ["hiking", "museum", "coffee", "reading", "sport"]
EXPECTED_NODE_COUNT = 10
KNOWN_SEARCH = "/api/people?city=taipei&interest=hiking&interest=museum"
KNOWN_SEARCH_IDS = ["u01", "u05", "u04"]


class SmokeTestError(Exception):
    pass


@dataclass(frozen=True)
class Response:
    status: int
    content_type: str
    body: bytes

    def text(self) -> str:
        return self.body.decode("utf-8")

    def json(self) -> object:
        return json.loads(self.body)


def fetch(url: str) -> Response:
    request = urllib.request.Request(url, headers={"User-Agent": "sixdegrees-smoke-test"})
    try:
        with urllib.request.urlopen(request, timeout=REQUEST_TIMEOUT_SECONDS) as response:
            return Response(response.status, response.headers.get("Content-Type", ""), response.read())
    except urllib.error.HTTPError as error:
        return Response(error.code, error.headers.get("Content-Type", ""), error.read())


def check(condition: bool, message: str) -> None:
    if not condition:
        raise SmokeTestError(message)
    print(f"ok   {message}")


def container_running(name: str) -> bool:
    result = subprocess.run(
        ["docker", "inspect", "--format", "{{.State.Running}}", name],
        capture_output=True,
        text=True,
        check=False,
    )
    return result.returncode == 0 and result.stdout.strip() == "true"


def wait_until_healthy(base_url: str, timeout: float, container: str | None) -> Response:
    deadline = time.monotonic() + timeout
    last_error = "no response yet"
    while time.monotonic() < deadline:
        if container and not container_running(container):
            raise SmokeTestError(f"container {container} exited before becoming healthy")
        try:
            response = fetch(urljoin(base_url, "/health"))
            if response.status == 200:
                return response
            last_error = f"status {response.status}"
        except (urllib.error.URLError, ConnectionError, TimeoutError) as error:
            last_error = str(error)
        time.sleep(POLL_INTERVAL_SECONDS)
    raise SmokeTestError(f"/health not ready within {timeout:.0f}s ({last_error})")


def check_health(response: Response, expected_version: str) -> None:
    body = response.json()
    check(body.get("status") == "ok", "/health reports status ok")
    check(
        body.get("version") == expected_version,
        f"/health version is {expected_version} (got {body.get('version')!r})",
    )


def check_frontend(base_url: str) -> None:
    home = fetch(urljoin(base_url, "/"))
    check(home.status == 200 and home.content_type.startswith("text/html"), "/ returns the HTML home page")

    html = home.text()
    scripts = re.findall(r'<script[^>]+src="(/assets/[^"]+\.js)"', html)
    styles = re.findall(r'<link[^>]+href="(/assets/[^"]+\.css)"', html)
    preloads = re.findall(r'<link[^>]+rel="modulepreload"[^>]+href="(/assets/[^"]+\.js)"', html)
    check(bool(scripts), "home page references a JS bundle under /assets")
    check(bool(styles), "home page references a CSS bundle under /assets")

    for path in dict.fromkeys(scripts + preloads):
        asset = fetch(urljoin(base_url, path))
        check(asset.status == 200 and "javascript" in asset.content_type, f"{path} is served as JavaScript")
    for path in styles:
        asset = fetch(urljoin(base_url, path))
        check(asset.status == 200 and asset.content_type.startswith("text/css"), f"{path} is served as CSS")

    avatar = fetch(urljoin(base_url, "/avatar-fallback.svg"))
    check(
        avatar.status == 200
        and avatar.content_type.startswith("image/svg+xml")
        and "<svg" in avatar.text()
        and "<html" not in avatar.text().lower(),
        "/avatar-fallback.svg is served as SVG, not as the HTML page",
    )

    missing = fetch(urljoin(base_url, "/api/not-found"))
    check(missing.status == 404, "/api/not-found returns 404")


def check_api(base_url: str) -> None:
    options = fetch(urljoin(base_url, "/api/options"))
    check(options.status == 200, "/api/options returns 200")
    body = options.json()
    cities = body.get("cities", [])
    check(len(cities) == EXPECTED_CITY_COUNT, f"/api/options lists {EXPECTED_CITY_COUNT} cities")
    check(
        all({"id", "name", "iso_code", "en_name"} <= city.keys() for city in cities),
        "every city has id, name, iso_code and en_name",
    )
    interest_ids = [interest.get("id") for interest in body.get("interests", [])]
    check(interest_ids == EXPECTED_INTEREST_IDS, "/api/options lists the five interests in order")

    network = fetch(urljoin(base_url, "/api/network"))
    check(network.status == 200, "/api/network returns 200")
    body = network.json()
    nodes = body.get("nodes", [])
    check(body.get("viewer_id") == "u00", "/api/network viewer is u00")
    check(len(nodes) == EXPECTED_NODE_COUNT, f"/api/network has {EXPECTED_NODE_COUNT} visible nodes")
    check(
        all({"id", "display_name", "gender", "city_id", "interest_ids", "distance", "via_ids"} <= node.keys() for node in nodes),
        "every network node has the required fields",
    )
    check(isinstance(body.get("edges"), list) and body["edges"], "/api/network has edges")

    search = fetch(urljoin(base_url, KNOWN_SEARCH))
    check(search.status == 200, f"{KNOWN_SEARCH} returns 200")
    ids = [item.get("id") for item in search.json().get("items", [])]
    check(ids == KNOWN_SEARCH_IDS, f"Taipei + hiking/museum returns {KNOWN_SEARCH_IDS} (got {ids})")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--base-url", default="http://127.0.0.1:8080")
    parser.add_argument("--expected-version", required=True)
    parser.add_argument("--container", help="Docker container to watch for an early exit")
    parser.add_argument("--timeout", type=float, default=60, help="seconds to wait for /health")
    args = parser.parse_args()
    base_url = args.base_url.rstrip("/") + "/"

    try:
        health = wait_until_healthy(base_url, args.timeout, args.container)
        check_health(health, args.expected_version)
        check_frontend(base_url)
        check_api(base_url)
    except (SmokeTestError, ValueError, KeyError, AttributeError, urllib.error.URLError) as error:
        print(f"FAIL {error}", file=sys.stderr)
        return 1
    print("smoke test passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())

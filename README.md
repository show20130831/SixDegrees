# SixDegrees (近緣)

SixDegrees is a demo web application for exploring people within two friendship hops of
a fixed demo user, filtered by city and interests. All people and friendships are
fictional.

> Status: in development. This README is expanded as each part of the system is delivered.

## Features

- Relationship graph of the demo user, direct friends, and friends of friends
- Person details, including the direct friends who connect to a second-degree contact
- Filtering by one city and any number of interests (interests match with OR; city and interests combine with AND)
- "Use my city": fills in the city filter from the device location, on request only
- Illustrated avatars for every person, with a local fallback image

## Tech stack

| Layer | Technology |
| --- | --- |
| Frontend | React, Vite, JavaScript (JSX), CSS; 3D graph rendered with three.js (WebGL) |
| Backend | Python 3.12, FastAPI, Uvicorn, Pydantic |
| Data | Read-only JSON files bundled with the application |
| Tests | pytest with FastAPI TestClient; Node.js built-in test runner |

The user interface is in Traditional Chinese; code and documentation are in English.

## Local development

Commands use PowerShell 7 (`pwsh`) on Windows. Requirements: Python 3.12 and Node.js 26 LTS.

### Backend

```powershell
py -3.12 -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements-dev.txt

# Run the test suite
.venv\Scripts\python.exe -m pytest

# Start the API with auto-reload on http://localhost:8000
.venv\Scripts\python.exe -m uvicorn app.main:create_app --factory --reload
```

### Frontend

In a second terminal, with the backend running:

```powershell
cd frontend
npm ci

# Run the unit tests
npm test

# Start the Vite dev server on http://localhost:5173 (proxies /api to port 8000)
npm run dev
```

### Serve the production build from FastAPI

```powershell
cd frontend; npm run build; cd ..
$env:REQUIRE_FRONTEND = "1"
.venv\Scripts\python.exe -m app   # http://localhost:8080
```

### Run the container

The production image is a multi-stage build: a Node stage builds the frontend, and the
final Python image serves the API and the built files as a non-root user. Docker Desktop
with the WSL2 engine is enough on Windows.

```powershell
docker build --build-arg GIT_SHA=dev --tag sixdegrees:local .
docker run --rm --name sixdegrees --publish 8080:8080 sixdegrees:local   # http://localhost:8080
```

With the container running, a second terminal can run the same smoke test as CI:

```powershell
.venv\Scripts\python.exe scripts\smoke_test.py --base-url http://127.0.0.1:8080 --expected-version dev --container sixdegrees
```

## Continuous integration

GitHub Actions ([.github/workflows/ci.yml](.github/workflows/ci.yml)) runs on every pull
request and every push to `main`, with no path filters:

| Job | Checks |
| --- | --- |
| Backend tests | Installs `requirements-dev.txt` and runs pytest |
| Frontend tests and build | `npm ci`, `npm test`, `npm run build` |
| Container build and smoke test | Builds the image with the commit SHA as its version, starts it, and runs `scripts/smoke_test.py`: health and version, home page and assets, API contracts, and a known search |

Releases are built and deployed from a local machine; CI does not deploy.

## API

All endpoints are read-only `GET` requests.

| Path | Description |
| --- | --- |
| `/healthz` | Health check with the running version |
| `/api/options` | All 22 Taiwan cities and the five interests |
| `/api/network` | The two-hop subgraph: viewer, nodes with `distance` and `via_ids`, and edges |
| `/api/people` | Search results ordered by distance, matched interest count, then ID |

Example:

```
GET /api/people?city=taipei&interest=hiking&interest=museum
```

```json
{
  "items": [
    {"id": "u01", "distance": 1, "matched_interest_count": 2, "matched_interest_ids": ["hiking", "museum"]},
    {"id": "u05", "distance": 2, "matched_interest_count": 2, "matched_interest_ids": ["hiking", "museum"]},
    {"id": "u04", "distance": 2, "matched_interest_count": 1, "matched_interest_ids": ["hiking"]}
  ]
}
```

Unknown or empty `city` / `interest` values return `422`. A valid city with no matching
people returns `200` with an empty `items` array.

## Third-party services

Both services are called directly from the browser; the backend, its health check and
CI never call them.

| Service | Use | Failure handling |
| --- | --- | --- |
| [DiceBear](https://www.dicebear.com/) HTTP API, [Personas](https://www.dicebear.com/styles/personas/) style | `https://api.dicebear.com/10.x/personas/svg?seed=<person id>`, so a person has the same avatar everywhere | Falls back once to `/avatar-fallback.svg`; if that also fails, the name is still shown |
| [BigDataCloud](https://www.bigdatacloud.com/) client-side reverse geocoding | After the user clicks 「使用我的城市」, the browser sends its current coordinates to `reverse-geocode-client` and maps the county code to one of the 22 cities | Denied permission, timeouts, provider errors, places outside Taiwan and ambiguous answers keep the current city and ask for a manual choice |

The county mapping lives in `frontend/src/geo/normalizeCity.js`. It trusts county codes
first, uses only exact full county names when no code is present, and never guesses from
town-level fields. Coordinates are used for that one lookup only: they are not stored,
logged or sent to the SixDegrees backend. To keep the button quick, the browser may reuse a
position it found in the last 10 minutes (`maximumAge`), and the page preconnects to the
lookup host. Automated tests use mocked geolocation and HTTP responses; the real lookup is
verified by hand in a browser.

**Attribution.** Avatars are "Personas" by Draftbit, provided through DiceBear and
licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). The site crops
them to circles and shows people who do not match the current filter in greyscale. The
DiceBear public API is for non-commercial use; a commercial product would need to
self-host the avatars or obtain them another way while keeping the Personas licence.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8080` | Listening port for `python -m app` |
| `APP_VERSION` | `dev` | Version reported by `/healthz` |
| `FRONTEND_DIST_DIR` | `frontend/dist` | Location of the built frontend |
| `REQUIRE_FRONTEND` | `0` | When `1`, startup fails if the frontend build is incomplete |

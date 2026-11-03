# SixDegrees (近緣)

SixDegrees is a demo web application for exploring people within two friendship hops of
a fixed demo user, filtered by city and interests. All people and friendships are
fictional.

> Status: in development. This README is expanded as each part of the system is delivered.

## Features

- Relationship graph of the demo user, direct friends, and friends of friends
- Person details, including the direct friends who connect to a second-degree contact
- Filtering by one city and any number of interests (interests match with OR; city and interests combine with AND)

## Tech stack

| Layer | Technology |
| --- | --- |
| Backend | Python 3.12, FastAPI, Uvicorn, Pydantic |
| Data | Read-only JSON files bundled with the application |
| Tests | pytest, FastAPI TestClient |

## Local development (backend)

Commands use PowerShell 7 (`pwsh`) on Windows.

```powershell
py -3.12 -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements-dev.txt

# Run the test suite
.venv\Scripts\python.exe -m pytest

# Start the API with auto-reload on http://localhost:8000
.venv\Scripts\python.exe -m uvicorn app.main:create_app --factory --reload
```

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

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8080` | Listening port for `python -m app` |
| `APP_VERSION` | `dev` | Version reported by `/healthz` |
| `FRONTEND_DIST_DIR` | `frontend/dist` | Location of the built frontend |
| `REQUIRE_FRONTEND` | `0` | When `1`, startup fails if the frontend build is incomplete |

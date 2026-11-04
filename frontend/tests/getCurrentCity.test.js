import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { GeoError, POSITION_OPTIONS, REVERSE_GEOCODE_URL, getCurrentCity } from "../src/geo/getCurrentCity.js";

// Every test uses mock geolocation and mock HTTP; the real endpoint is never called.
const { cities } = JSON.parse(readFileSync(new URL("../../app/data/options.json", import.meta.url), "utf8"));

const TAIPEI_RESPONSE = { countryCode: "TW", principalSubdivisionCode: "TW-TPE", principalSubdivision: "Taipei City" };

function mockGeolocation({ coords = { latitude: 25.03, longitude: 121.56 }, errorCode = null, hold = false } = {}) {
  const calls = [];
  return {
    calls,
    getCurrentPosition(onSuccess, onError, options) {
      calls.push({ onSuccess, onError, options });
      if (hold) {
        return;
      }
      if (errorCode) {
        onError({ code: errorCode });
      } else {
        onSuccess({ coords });
      }
    },
  };
}

function mockFetch(handler) {
  const urls = [];
  const fetchImpl = async (url, init) => {
    urls.push(url);
    return handler(url, init);
  };
  fetchImpl.urls = urls;
  return fetchImpl;
}

const jsonResponse = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const grantedPermissions = { query: async () => ({ state: "granted" }) };

async function assertGeoError(promise, kind) {
  await assert.rejects(promise, (error) => error instanceof GeoError && error.kind === kind);
}

test("success returns the city and queries the provider with this position only", async () => {
  const geolocation = mockGeolocation();
  const fetchImpl = mockFetch(() => jsonResponse(TAIPEI_RESPONSE));
  const stages = [];
  const result = await getCurrentCity(cities, {
    geolocation,
    fetchImpl,
    permissions: { query: async () => ({ state: "prompt" }) },
    onStage: (stage) => stages.push(stage),
  });

  assert.deepEqual(result, { city_id: "taipei", city_name: "臺北市" });
  assert.deepEqual(stages, ["awaiting-permission", "lookup"]);
  assert.deepEqual(geolocation.calls[0].options, POSITION_OPTIONS);
  const url = new URL(fetchImpl.urls[0]);
  assert.equal(`${url.origin}${url.pathname}`, REVERSE_GEOCODE_URL);
  assert.equal(url.searchParams.get("latitude"), "25.03");
  assert.equal(url.searchParams.get("longitude"), "121.56");
  assert.equal(url.searchParams.get("localityLanguage"), "en");
});

test("denied permission and position timeouts stop before any lookup", async () => {
  for (const [errorCode, kind] of [[1, "denied"], [2, "position-unavailable"], [3, "position-timeout"]]) {
    const fetchImpl = mockFetch(() => jsonResponse(TAIPEI_RESPONSE));
    await assertGeoError(
      getCurrentCity(cities, { geolocation: mockGeolocation({ errorCode }), fetchImpl, permissions: grantedPermissions }),
      kind,
    );
    assert.equal(fetchImpl.urls.length, 0);
  }
});

test("missing geolocation support and invalid coordinates are reported", async () => {
  await assertGeoError(getCurrentCity(cities, { geolocation: null }), "unsupported");

  const fetchImpl = mockFetch(() => jsonResponse(TAIPEI_RESPONSE));
  for (const coords of [{ latitude: Number.NaN, longitude: 121 }, { latitude: 25 }, { latitude: 91, longitude: 121 }]) {
    await assertGeoError(
      getCurrentCity(cities, { geolocation: mockGeolocation({ coords }), fetchImpl, permissions: grantedPermissions }),
      "invalid-coordinates",
    );
  }
  assert.equal(fetchImpl.urls.length, 0, "no lookup without both valid coordinates");
});

test("provider failures, timeouts and malformed bodies are reported", async () => {
  const options = (fetchImpl, extra = {}) => ({
    geolocation: mockGeolocation(),
    fetchImpl,
    permissions: grantedPermissions,
    ...extra,
  });
  await assertGeoError(getCurrentCity(cities, options(mockFetch(() => jsonResponse({}, 500)))), "lookup-failed");
  await assertGeoError(
    getCurrentCity(cities, options(mockFetch(() => Promise.reject(new TypeError("network"))))),
    "lookup-failed",
  );
  await assertGeoError(
    getCurrentCity(cities, options(mockFetch(() => ({ ok: true, status: 200, json: async () => JSON.parse("<html>") })))),
    "invalid-response",
  );
  const hanging = mockFetch((_, init) => new Promise((_, reject) => {
    init.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
  }));
  await assertGeoError(getCurrentCity(cities, options(hanging, { timeoutMs: 20 })), "lookup-timeout");
});

test("responses outside Taiwan, without fields or without a known county are rejected", async () => {
  const run = (body) =>
    getCurrentCity(cities, {
      geolocation: mockGeolocation(),
      fetchImpl: mockFetch(() => jsonResponse(body)),
      permissions: grantedPermissions,
    });
  await assertGeoError(run({ countryCode: "JP", principalSubdivisionCode: "JP-13" }), "outside-taiwan");
  await assertGeoError(run({}), "missing-country");
  await assertGeoError(run({ countryCode: "TW", principalSubdivision: "Hsinchu" }), "unrecognized");
});

test("cancelling while waiting for the position ignores the late callback", async () => {
  const geolocation = mockGeolocation({ hold: true });
  const fetchImpl = mockFetch(() => jsonResponse(TAIPEI_RESPONSE));
  const controller = new AbortController();
  const pending = getCurrentCity(cities, { geolocation, fetchImpl, permissions: grantedPermissions, signal: controller.signal });

  await new Promise((resolve) => setTimeout(resolve, 0));
  controller.abort();
  await assertGeoError(pending, "aborted");

  geolocation.calls[0].onSuccess({ coords: { latitude: 25, longitude: 121 } });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(fetchImpl.urls.length, 0, "no city lookup after cancelling");
});

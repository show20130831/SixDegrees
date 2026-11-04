// "Use my city": device geolocation -> BigDataCloud client-side reverse geocoding ->
// normalizeCity. Provider formats stay in this folder; components only see the result
// { city_id, city_name } or a GeoError with a `kind`.
//
// Browser objects are injectable so Node tests can run the whole flow with mocks.
// Coordinates are used for this one lookup only: never stored, logged or sent to our backend.

import { normalizeCity } from "./normalizeCity.js";

export const REVERSE_GEOCODE_URL = "https://api.bigdatacloud.net/data/reverse-geocode-client";
export const POSITION_OPTIONS = Object.freeze({ maximumAge: 0, timeout: 10_000, enableHighAccuracy: false });
export const LOOKUP_TIMEOUT_MS = 10_000;

// kind: unsupported | denied | position-timeout | position-unavailable | invalid-coordinates |
//       lookup-timeout | lookup-failed | invalid-response | missing-country | outside-taiwan |
//       unrecognized | conflict | aborted
export class GeoError extends Error {
  constructor(kind, message = kind) {
    super(message);
    this.name = "GeoError";
    this.kind = kind;
  }
}

const POSITION_ERROR_KINDS = { 1: "denied", 2: "position-unavailable", 3: "position-timeout" };

// onStage(stage) reports progress: "awaiting-permission" (the browser is asking the user),
// "locating" (permission granted, waiting for coordinates) and "lookup" (querying the city).
export async function getCurrentCity(
  cities,
  {
    signal,
    onStage = () => {},
    geolocation = globalThis.navigator?.geolocation,
    permissions = globalThis.navigator?.permissions,
    fetchImpl = globalThis.fetch,
    timeoutMs = LOOKUP_TIMEOUT_MS,
  } = {},
) {
  throwIfAborted(signal);
  if (!geolocation) {
    throw new GeoError("unsupported");
  }

  onStage((await permissionState(permissions)) === "prompt" ? "awaiting-permission" : "locating");
  throwIfAborted(signal);

  const coords = await getPosition(geolocation, signal);
  const { latitude, longitude } = coords;
  if (!isValidCoordinate(latitude, -90, 90) || !isValidCoordinate(longitude, -180, 180)) {
    throw new GeoError("invalid-coordinates");
  }

  onStage("lookup");
  const response = await lookupCity(fetchImpl, latitude, longitude, signal, timeoutMs);
  throwIfAborted(signal);

  const result = normalizeCity(response, cities);
  if (!result.ok) {
    throw new GeoError(result.reason);
  }
  return { city_id: result.city_id, city_name: result.city_name };
}

async function permissionState(permissions) {
  try {
    return (await permissions?.query({ name: "geolocation" }))?.state ?? "unknown";
  } catch {
    return "unknown";
  }
}

// Wraps the callback API. A late callback after an abort is ignored.
function getPosition(geolocation, signal) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const settle = (fn, value) => {
      if (!settled) {
        settled = true;
        signal?.removeEventListener("abort", onAbort);
        fn(value);
      }
    };
    const onAbort = () => settle(reject, new GeoError("aborted"));
    signal?.addEventListener("abort", onAbort, { once: true });

    geolocation.getCurrentPosition(
      (position) => settle(resolve, position?.coords ?? {}),
      (error) => settle(reject, new GeoError(POSITION_ERROR_KINDS[error?.code] ?? "position-unavailable")),
      POSITION_OPTIONS,
    );
  });
}

async function lookupCity(fetchImpl, latitude, longitude, signal, timeoutMs) {
  const params = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    localityLanguage: "en",
  });
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const forwardAbort = () => controller.abort();
  signal?.addEventListener("abort", forwardAbort, { once: true });

  try {
    const response = await fetchImpl(`${REVERSE_GEOCODE_URL}?${params}`, { signal: controller.signal });
    if (!response.ok) {
      throw new GeoError("lookup-failed", `HTTP ${response.status}`);
    }
    try {
      return await response.json();
    } catch {
      throw new GeoError("invalid-response");
    }
  } catch (error) {
    if (error instanceof GeoError) {
      throw error;
    }
    if (signal?.aborted) {
      throw new GeoError("aborted");
    }
    throw new GeoError(timedOut ? "lookup-timeout" : "lookup-failed", String(error));
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", forwardAbort);
  }
}

function isValidCoordinate(value, min, max) {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
}

function throwIfAborted(signal) {
  if (signal?.aborted) {
    throw new GeoError("aborted");
  }
}

// User-facing messages (Traditional Chinese). Every failure keeps the current city.
export function describeGeoError(error) {
  const kind = error instanceof GeoError ? error.kind : "lookup-failed";
  switch (kind) {
    case "unsupported":
      return "此瀏覽器不支援定位，請手動選擇城市。";
    case "denied":
      return "未取得定位權限，請手動選擇城市。";
    case "position-timeout":
      return "取得位置逾時，請手動選擇或再試一次。";
    case "position-unavailable":
    case "invalid-coordinates":
      return "目前無法取得位置，請手動選擇或再試一次。";
    case "lookup-timeout":
      return "查詢城市逾時，請手動選擇或再試一次。";
    case "outside-taiwan":
      return "目前位置不在台灣，請手動選擇城市。";
    case "unrecognized":
    case "conflict":
    case "missing-country":
      return "無法確定你所在的縣市，請手動選擇。";
    case "aborted":
      return "";
    default:
      return "查詢城市失敗，請手動選擇或再試一次。";
  }
}

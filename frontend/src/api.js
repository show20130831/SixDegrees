// Same-origin JSON API client built on fetch + AbortController.

import { buildPeopleQuery } from "./filters.js";

export const API_TIMEOUT_MS = 30_000;

// kind: "http" | "network" | "format" | "timeout" | "aborted"
export class ApiError extends Error {
  constructor(kind, message, status = null) {
    super(message);
    this.name = "ApiError";
    this.kind = kind;
    this.status = status;
  }
}

// Fetches and parses JSON. The timeout covers the whole request, including body parsing.
// An external signal (caller cancellation) is reported as "aborted", never as an error.
export async function requestJson(url, { signal, timeoutMs = API_TIMEOUT_MS } = {}) {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const forwardAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) {
      controller.abort();
    } else {
      signal.addEventListener("abort", forwardAbort, { once: true });
    }
  }

  try {
    let response;
    try {
      response = await fetch(url, { signal: controller.signal, headers: { Accept: "application/json" } });
    } catch (error) {
      throw toAbortOrNetworkError(error, timedOut);
    }
    if (!response.ok) {
      throw new ApiError("http", `HTTP ${response.status} for ${url}`, response.status);
    }
    try {
      return await response.json();
    } catch (error) {
      if (controller.signal.aborted) {
        throw toAbortOrNetworkError(error, timedOut);
      }
      throw new ApiError("format", `Invalid JSON from ${url}`);
    }
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", forwardAbort);
  }
}

function toAbortOrNetworkError(error, timedOut) {
  if (timedOut) {
    return new ApiError("timeout", "Request timed out");
  }
  if (error?.name === "AbortError") {
    return new ApiError("aborted", "Request was cancelled");
  }
  return new ApiError("network", error?.message ?? "Network error");
}

function ensure(condition, url) {
  if (!condition) {
    throw new ApiError("format", `Unexpected response shape from ${url}`);
  }
}

export async function getOptions({ signal } = {}) {
  const url = "/api/options";
  const body = await requestJson(url, { signal });
  ensure(Array.isArray(body?.cities) && Array.isArray(body?.interests), url);
  return body;
}

export async function getNetwork({ signal } = {}) {
  const url = "/api/network";
  const body = await requestJson(url, { signal });
  ensure(typeof body?.viewer_id === "string" && Array.isArray(body?.nodes) && Array.isArray(body?.edges), url);
  return body;
}

export async function searchPeople(filters, { signal } = {}) {
  const query = buildPeopleQuery(filters);
  const url = query ? `/api/people?${query}` : "/api/people";
  const body = await requestJson(url, { signal });
  ensure(Array.isArray(body?.items), url);
  return body.items;
}

// User-facing (Traditional Chinese) message for a failed request.
export function describeError(error) {
  if (!(error instanceof ApiError)) {
    return "發生未預期的錯誤，請稍後再試。";
  }
  switch (error.kind) {
    case "timeout":
      return "等待逾時，請稍後再試。";
    case "network":
      return "無法連線到伺服器，請確認網路後重試。";
    case "format":
      return "伺服器回應格式不正確，請稍後再試。";
    case "http":
      return error.status === 422
        ? "篩選條件無效，請重新選擇。"
        : `伺服器暫時無法處理請求（HTTP ${error.status}），請稍後再試。`;
    default:
      return "請求已取消。";
  }
}

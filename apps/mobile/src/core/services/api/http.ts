import { isDevelopment } from "@/core/constants/env";

import type { ApiError } from "@/core/types";

export type HttpOptions = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  headers?: Record<string, string>;
  body?: unknown;
  params?: Record<string, string | number | boolean | undefined | null>;
  signal?: AbortSignal;
  /** Request timeout in ms (default 15000). */
  timeoutMs?: number;
};

const DEFAULT_TIMEOUT_MS = 15000;

type HeaderMap = Record<string, string>;

function normalizeHeaders(headers: HeadersInit | undefined): HeaderMap {
  if (!headers) return {};
  if (Array.isArray(headers)) {
    return Object.fromEntries(
      headers.map(([key, value]) => [String(key), String(value)]),
    );
  }
  if (headers instanceof Headers) {
    return Object.fromEntries(Array.from(headers.entries()));
  }
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [String(key), String(value)]),
  );
}

function redactHeaders(headers: HeaderMap): HeaderMap {
  const redacted = { ...headers };
  if (redacted.Authorization) {
    redacted.Authorization = "Bearer [redacted]";
  }
  return redacted;
}

function safeStringify(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return "[unserializable]";
  }
}

function logTextResponseSummary(payload: string) {
  const trimmed = payload.trim();
  const isGpx = /<gpx(?:\s|>)/i.test(trimmed);
  if (isGpx) {
    console.log("Response summary:", {
      type: "gpx",
      characters: payload.length,
      trackPoints: (payload.match(/<trkpt\b/gi) ?? []).length,
    });
    return;
  }
  if (payload.length > 1000) {
    console.log("Response summary:", {
      type: "text",
      characters: payload.length,
      preview: `${trimmed.slice(0, 160)}${trimmed.length > 160 ? "..." : ""}`,
    });
    return;
  }
  console.log(`Response body: ${payload}`);
}

function logApiLine(prefix: string, value: unknown) {
  if (!isDevelopment) return;
  console.log(`${prefix}: ${safeStringify(value)}`);
}

export function debugApiLog(label: string, value: unknown) {
  if (!isDevelopment) return;
  console.log(`${label}: ${safeStringify(value)}`);
}

function logRequest(
  method: string,
  url: string,
  status: number | "ERR",
  startedAt: number,
) {
  if (!isDevelopment) return;
  const elapsedMs = Math.max(0, Date.now() - startedAt);
  console.log(
    `${method.toUpperCase()} ${url}\nStatus ${status}\n${elapsedMs} ms`,
  );
}

function logResponse(
  method: string,
  url: string,
  status: number,
  payload: unknown,
) {
  if (!isDevelopment) return;

  const eventCount =
    payload &&
    typeof payload === "object" &&
    Array.isArray((payload as { events?: unknown[] }).events)
      ? (payload as { events: unknown[] }).events.length
      : undefined;

  console.log(`${method.toUpperCase()} ${url}`);
  console.log(`Status: ${status}`);
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const record = payload as Record<string, unknown>;
    const data =
      record.data &&
      typeof record.data === "object" &&
      !Array.isArray(record.data)
        ? (record.data as Record<string, unknown>)
        : undefined;
    const participants = Array.isArray(record.participants)
      ? record.participants
      : Array.isArray(data?.participants)
        ? data.participants
        : undefined;
    const rows = Array.isArray(record.rows)
      ? record.rows
      : Array.isArray(data?.rows)
        ? data.rows
        : undefined;
    const event = (record.event ?? data?.event) as
      | Record<string, unknown>
      | undefined;
    if (url.includes("/api/firebase-config")) {
      console.log("Response summary:", {
        success: record.success,
        projectId: data?.projectId,
        configured: Boolean(data?.projectId),
      });
    } else if (
      event &&
      (url.includes("/api/events/") || url.includes("/v1/events/"))
    ) {
      console.log("Response summary:", {
        success: record.success,
        eventId: event.id ?? event.eventId,
        eventName: event.eventName ?? event.name,
        contests: Array.isArray(event.contests)
          ? event.contests.length
          : Array.isArray(event.ticketDefinitions)
            ? event.ticketDefinitions.length
            : 0,
        participants: Array.isArray(event.participants)
          ? event.participants.length
          : undefined,
        liveTrackingEnabled:
          event.liveTrackingEnabled ??
          (event.liveTracking as Record<string, unknown> | undefined)?.enabled,
      });
    } else if (eventCount !== undefined) {
      console.log("Response summary:", {
        success: record.success,
        events: eventCount,
      });
    } else if (url.includes("/api/live/athlete-modal/")) {
      const athlete = (data?.athlete ?? record.athlete) as
        Record<string, unknown> | undefined;
      const context = (data?.contestContext ?? record.contestContext) as
        Record<string, unknown> | undefined;
      console.log("Response summary:", {
        success: record.success,
        eventId: record.eventId ?? data?.eventId,
        bib: athlete?.bib,
        status: athlete?.status,
        splitCount: Array.isArray(context?.splits) ? context.splits.length : 0,
        athleteTimingCount: Array.isArray(athlete?.splits)
          ? athlete.splits.length
          : 0,
      });
    } else if (url.includes("/api/v1/events/") && url.includes("/participants")) {
      console.log("Response summary:", {
        success: record.success,
        eventId: record.eventId ?? data?.eventId,
        count: rows?.length ?? record.total ?? data?.total ?? 0,
        state: record.state ?? data?.state,
      });
    } else if ((participants?.length ?? 0) > 20 || (rows?.length ?? 0) > 20) {
      console.log("Response summary:", {
        success: record.success,
        eventId: record.eventId ?? data?.eventId,
        state: record.state ?? data?.state,
        source: record.source ?? data?.source,
        participants: participants?.length,
        rows: rows?.length,
      });
    } else {
      const serialized = safeStringify(payload);
      if (serialized.length > 2000) {
        console.log("Response summary:", {
          type: "json",
          characters: serialized.length,
          keys: Object.keys(record).slice(0, 20),
        });
      } else {
        console.log(`Response body: ${serialized}`);
      }
    }
  } else if (typeof payload === "string") {
    logTextResponseSummary(payload);
  } else {
    console.log(`Response body: ${safeStringify(payload)}`);
  }
}

type ApplicationErrorDetails = {
  status: number;
  code: string;
  message: string;
  userMessage: string;
  retryable: boolean;
};

function errorStatus(code: string, type: string, httpStatus: number): number {
  const key = `${code}:${type.toLowerCase()}`;
  if (/^(4010|4040):|:(not_authorized|no_token)$/.test(key)) return 401;
  if (/^(4030|4061):|:(access_denied|secret_required)$/.test(key)) return 403;
  if (/^4440:|:rate_limit$/.test(key)) return 429;
  if (/^5030:|:service_unavailable$/.test(key)) return 503;
  if (/^5000:|:failed$/.test(key)) return 502;
  if (/^2040:|:no_results$/.test(key)) return 404;
  if (/^2041:|:too_many_results$/.test(key)) return 422;
  if (/^(4000|4060):|:(bad_query|secure_socket_required)$/.test(key)) return 400;
  return httpStatus >= 400 ? httpStatus : 502;
}

function retryableValue(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (value === 1 || value === "1" || String(value).toLowerCase() === "true") return true;
  if (value === 0 || value === "0" || String(value).toLowerCase() === "false") return false;
  return undefined;
}

/** Handles both Race Upshot envelopes and provider error objects returned with HTTP 200. */
export function applicationErrorDetails(payload: unknown, httpStatus: number): ApplicationErrorDetails | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const root = payload as Record<string, unknown>;
  const nested = root.error && typeof root.error === "object" && !Array.isArray(root.error)
    ? root.error as Record<string, unknown>
    : null;
  if (root.success !== false && !nested) return null;

  const rawError = typeof root.error === "string" ? root.error : "";
  const code = String(nested?.code ?? nested?.type ?? root.code ?? "API_ERROR").trim() || "API_ERROR";
  const type = String(nested?.type ?? "").trim();
  const message = String(nested?.message ?? nested?.msg ?? root.message ?? root.detail ?? rawError ?? "API request failed.").trim()
    || "API request failed.";
  const userMessage = String(nested?.display ?? root.display ?? message).trim() || message;
  const status = errorStatus(code, type, httpStatus);
  return {
    status,
    code,
    message,
    userMessage,
    retryable: retryableValue(nested?.retryable ?? root.retryable) ?? (status === 429 || status >= 500),
  };
}

function safeParseJson(text: string, method: string, url: string): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    if (isDevelopment) {
      console.error("[API JSON PARSE ERROR]", {
        method,
        url,
        error: error instanceof Error ? error.message : String(error),
        bodyPreview: text.slice(0, 1000),
      });
    }
    return text;
  }
}

function looksLikeJson(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.startsWith("{") || trimmed.startsWith("[");
}

export async function fetchWithLogging(
  url: string,
  init: RequestInit & { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<Response> {
  const {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    signal,
    method = "GET",
    headers,
    ...rest
  } = init;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onExternalAbort = () => controller.abort();
  const requestHeaders = normalizeHeaders(headers);
  if (signal) signal.addEventListener("abort", onExternalAbort);
  const startedAt = Date.now();

  if (isDevelopment) {
    logApiLine("Request URL", url);
    logApiLine("Request method", method.toUpperCase());
    logApiLine("Request headers", redactHeaders(requestHeaders));
    logApiLine(
      "Authorization header present",
      Boolean(requestHeaders.Authorization),
    );
  }

  try {
    const res = await fetch(url, {
      ...rest,
      headers,
      method,
      signal: controller.signal,
    });
    logRequest(method, url, res.status, startedAt);
    if (isDevelopment) {
      logApiLine("Response headers", Object.fromEntries(res.headers.entries()));
    }
    return res;
  } catch (e) {
    logRequest(method, url, "ERR", startedAt);
    if (isDevelopment) {
      logApiLine(
        "Network exception",
        e instanceof Error ? { name: e.name, message: e.message } : e,
      );
    }
    if (controller.signal.aborted && !signal?.aborted) {
      throw apiError(
        null,
        "TIMEOUT",
        `${method.toUpperCase()} ${url} timed out`,
      );
    }
    throw apiError(
      null,
      "NETWORK_ERROR",
      `${method.toUpperCase()} ${url} network exception: ${e instanceof Error ? e.message : "Network error"}`,
    );
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener("abort", onExternalAbort);
  }
}

function buildUrl(url: string, params?: HttpOptions["params"]): string {
  if (!params) return url;
  const usp = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") usp.append(k, String(v));
  });
  const qs = usp.toString();
  return qs ? `${url}${url.includes("?") ? "&" : "?"}${qs}` : url;
}

export function apiError(
  status: number | null,
  code: string,
  message: string,
  extra?: Partial<ApiError>,
): ApiError {
  const isNetworkError = status === null;
  const isAuthError = status === 401 || status === 403;
  return {
    status,
    code,
    message,
    userMessage: message || "Something went wrong. Please try again.",
    isNetworkError,
    isAuthError,
    retryable: isNetworkError || (status !== null && status >= 500),
    ...extra,
  };
}

/**
 * Low-level fetch JSON helper with normalized errors. Used by repositories via
 * the public and authenticated clients. Repositories are the only callers.
 */
export async function httpJson<T>(
  url: string,
  options: HttpOptions = {},
): Promise<T> {
  const {
    method = "GET",
    headers = {},
    body,
    params,
    signal,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = options;
  const finalUrl = buildUrl(url, params);

  const res = await fetchWithLogging(finalUrl, {
    method,
    headers: {
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
    signal,
    timeoutMs,
  });

  const text = await res.text();
  const contentType = res.headers.get("content-type") ?? "";
  const shouldParseJson =
    Boolean(text) &&
    (res.ok || contentType.includes("application/json") || looksLikeJson(text));
  const data = shouldParseJson
    ? safeParseJson(text, method, finalUrl)
    : undefined;
  const embeddedError = applicationErrorDetails(data, res.status);

  logResponse(method, finalUrl, res.status, data ?? text);

  if (!res.ok) {
    const msg = `${method.toUpperCase()} ${finalUrl} -> HTTP ${res.status}: ${safeStringify(data ?? text)}`;
    throw apiError(embeddedError?.status ?? res.status, embeddedError?.code ?? `HTTP_${res.status}`, msg, embeddedError ? {
      userMessage: embeddedError.userMessage,
      retryable: embeddedError.retryable,
    } : undefined);
  }

  if (embeddedError) {
    const msg = `${method.toUpperCase()} ${finalUrl} -> API_ERROR: ${safeStringify(data)}`;
    throw apiError(embeddedError.status, embeddedError.code, msg, {
      userMessage: embeddedError.userMessage,
      retryable: embeddedError.retryable,
    });
  }

  return data as T;
}

/**
 * Fetch raw text (e.g. a GPX course file). Same timeout/abort handling as
 * `httpJson`; used for public course assets referenced by the backend config.
 */
export async function httpText(
  url: string,
  signal?: AbortSignal,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<string> {
  try {
    const res = await fetchWithLogging(url, { signal, timeoutMs });
    const text = await res.text();
    logResponse("GET", url, res.status, text);
    if (!res.ok) {
      throw apiError(
        res.status,
        `HTTP_${res.status}`,
        `GET ${url} -> HTTP ${res.status}: ${text || res.statusText}`,
      );
    }
    return text;
  } catch (e) {
    throw e;
  }
}

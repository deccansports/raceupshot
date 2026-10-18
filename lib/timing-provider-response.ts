export type TimingProviderOutcome = "data" | "no_results" | "not_modified" | "error";

export interface TimingProviderError {
  code: string;
  type: string;
  message: string;
  displayMessage: string;
  retryable: boolean;
  status: number;
  outcome: Exclude<TimingProviderOutcome, "data">;
}

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : null;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
}

function truthy(value: unknown): boolean {
  if (value === true || value === 1) return true;
  return ["1", "true", "yes"].includes(text(value).toLowerCase());
}

function semanticStatus(code: string, type: string, httpStatus: number): number {
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

/**
 * Extracts provider failures from the JSON body even when the provider returns
 * HTTP 200. RTRT documents this behaviour and some timing vendors use the same
 * convention, so callers must never use HTTP status as the only success gate.
 */
export function timingProviderError(payload: unknown, httpStatus: number): TimingProviderError | null {
  const root = record(payload);
  const nested = record(root?.error) ?? record(record(root?.data)?.error);
  if (!nested) return null;

  const code = text(nested.code) || "PROVIDER_ERROR";
  const type = text(nested.type) || "provider_error";
  const normalizedType = type.toLowerCase();
  const outcome: TimingProviderError["outcome"] = code === "2040" || normalizedType === "no_results"
    ? "no_results"
    : code === "2042" || normalizedType === "no_changes"
      ? "not_modified"
      : "error";
  const message = text(nested.msg ?? nested.message) || "Timing provider request failed.";
  const displayMessage = text(nested.display) || message;

  return {
    code,
    type,
    message,
    displayMessage,
    retryable: truthy(nested.retryable),
    status: semanticStatus(code, type, httpStatus),
    outcome,
  };
}

export function timingProviderOutcome(payload: unknown, httpStatus: number): TimingProviderOutcome {
  const error = timingProviderError(payload, httpStatus);
  if (error) return error.outcome;
  return httpStatus >= 200 && httpStatus < 300 ? "data" : "error";
}

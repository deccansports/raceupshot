/** Normalized, app-level error shape surfaced consistently across screens. */
export type ApiError = {
  status: number | null;
  code: string;
  message: string;
  userMessage: string;
  isNetworkError: boolean;
  isAuthError: boolean;
  retryable: boolean;
};

/** Discriminated result wrapper for non-throwing call sites. */
export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: ApiError };

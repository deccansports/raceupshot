import { backendUrl } from "@/core/services/api";
import {
  apiError,
  fetchWithLogging,
  httpJson,
  type HttpOptions,
} from "@/core/services/api/http";

import { getFirebaseAuth } from "./firebase";

/**
 * Authenticated API client. Mirrors the web's `authenticatedFetch`:
 *  - attaches `Authorization: Bearer <Firebase ID token>`
 *  - on 401/403, force-refreshes the token via getIdToken(true) and retries once
 *
 * The single place tokens are attached. Repositories call this; screens never do.
 */
export async function authenticatedJson<T>(
  path: string,
  options: HttpOptions = {},
): Promise<T> {
  const auth = await getFirebaseAuth();
  const user = auth.currentUser;
  const url = backendUrl(path);

  if (!user) {
    throw apiError(401, "AUTH_REQUIRED", "Authentication required");
  }

  const withToken = async (token: string | null): Promise<T> => {
    const headers = {
      ...(options.headers ?? {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
    if (process.env.NODE_ENV !== "production") {
      console.log(
        "Authorization Header:",
        headers.Authorization ? "Bearer [redacted]" : undefined,
      );
    }
    return httpJson<T>(url, {
      ...options,
      headers,
    });
  };

  const token = await user.getIdToken();
  try {
    return await withToken(token);
  } catch (error) {
    const status = (error as { status?: number | null }).status;
    if ((status === 401 || status === 403) && user) {
      // Force refresh and retry once (exactly like the web).
      const refreshed = await user.getIdToken(true);
      return withToken(refreshed);
    }
    throw error;
  }
}

/**
 * API client for endpoints that accept either a Firebase user or an anonymous
 * device. A signed-in user is still authenticated and retried after a token
 * refresh; a guest sends no fabricated account identity.
 */
export async function optionalAuthenticatedJson<T>(
  path: string,
  options: HttpOptions = {},
): Promise<T> {
  const auth = await getFirebaseAuth();
  const user = auth.currentUser;
  const url = backendUrl(path);

  const withToken = async (token: string | null): Promise<T> => {
    const headers = {
      ...(options.headers ?? {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
    return httpJson<T>(url, { ...options, headers });
  };

  if (!user) return withToken(null);

  try {
    return await withToken(await user.getIdToken());
  } catch (error) {
    const status = (error as { status?: number | null }).status;
    if (status === 401 || status === 403) {
      return withToken(await user.getIdToken(true));
    }
    throw error;
  }
}

/**
 * Authenticated multipart upload (e.g. profile photo). Same token + 401/403
 * retry semantics as `authenticatedJson`; lets the fetch runtime set the
 * multipart boundary (never set Content-Type manually for FormData).
 */
export async function authenticatedUpload<T>(
  path: string,
  form: FormData,
): Promise<T> {
  const auth = await getFirebaseAuth();
  const user = auth.currentUser;
  const url = backendUrl(path);

  if (!user) {
    throw apiError(401, "AUTH_REQUIRED", "Authentication required");
  }

  const send = async (token: string | null): Promise<T> => {
    const res = await fetchWithLogging(url, {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: form,
    });
    if (!res.ok) {
      throw apiError(
        res.status,
        `HTTP_${res.status}`,
        `Upload failed with HTTP ${res.status}`,
      );
    }
    return (await res.json()) as T;
  };

  const token = await user.getIdToken();
  try {
    return await send(token);
  } catch (error) {
    const status = (error as { status?: number }).status;
    if ((status === 401 || status === 403) && user) {
      return send(await user.getIdToken(true));
    }
    throw error;
  }
}

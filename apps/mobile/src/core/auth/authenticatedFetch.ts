import { backendUrl } from "@/core/services/api";
import {
  apiError,
  fetchWithLogging,
  httpJson,
  type HttpOptions,
} from "@/core/services/api/http";

import { getAccessToken, saveAccessToken } from "./secureStore";
import { authorizationForAccessToken, firebaseAccessToken, isFirebaseAccessToken } from "./accessToken";
import { getRestoredFirebaseIdToken } from "./firebase";

async function refreshAccessToken(token: string): Promise<string | null> {
  if (!isFirebaseAccessToken(token)) return token;
  const idToken = await getRestoredFirebaseIdToken(true);
  if (!idToken) return null;
  const refreshed = firebaseAccessToken(idToken);
  await saveAccessToken(refreshed);
  return refreshed;
}

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
  const token = await getAccessToken();
  const url = backendUrl(path);

  if (!token) {
    throw apiError(401, "AUTH_REQUIRED", "Authentication required");
  }
  const send = (accessToken: string) => httpJson<T>(url, {
    ...options,
    headers: { ...(options.headers ?? {}), Authorization: authorizationForAccessToken(accessToken) },
  });
  try {
    return await send(token);
  } catch (error) {
    const status = (error as { status?: number | null }).status;
    if ((status === 401 || status === 403) && isFirebaseAccessToken(token)) {
      const refreshed = await refreshAccessToken(token);
      if (refreshed) return send(refreshed);
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
  const token = await getAccessToken();
  const url = backendUrl(path);
  return httpJson<T>(url, {
    ...options,
    headers: { ...(options.headers ?? {}), ...(token ? { Authorization: authorizationForAccessToken(token) } : {}) },
  });
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
  const token = await getAccessToken();
  const url = backendUrl(path);

  if (!token) {
    throw apiError(401, "AUTH_REQUIRED", "Authentication required");
  }

  const send = async (accessToken: string): Promise<T> => {
    const res = await fetchWithLogging(url, {
      method: "POST",
      headers: { Authorization: authorizationForAccessToken(accessToken) },
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

  try {
    return await send(token);
  } catch (error) {
    const status = (error as { status?: number | null }).status;
    if ((status === 401 || status === 403) && isFirebaseAccessToken(token)) {
      const refreshed = await refreshAccessToken(token);
      if (refreshed) return send(refreshed);
    }
    throw error;
  }
}

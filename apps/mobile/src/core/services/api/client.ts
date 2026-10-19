import { env } from '@/core/constants/env';
import { getAccessToken, saveAccessToken } from '@/core/auth/secureStore';
import { authorizationForAccessToken, firebaseAccessToken, isFirebaseAccessToken } from '@/core/auth/accessToken';
import { getRestoredFirebaseIdToken } from '@/core/auth/firebase';

import { httpJson, httpText, type HttpOptions } from './http';

function join(base: string, path: string): string {
  return `${base.replace(/\/$/, '')}/${path.replace(/^\//, '')}`;
}

function resolveUrl(base: string, pathOrUrl: string): string {
  const url = /^https?:\/\//i.test(pathOrUrl) ? pathOrUrl : join(base, pathOrUrl);
  return url;
}

export const api = {
  json<T>(path: string, options?: HttpOptions): Promise<T> {
    return httpJson<T>(resolveUrl(env.mobileApiBaseUrl, path), options);
  },
  text(pathOrUrl: string, signal?: AbortSignal): Promise<string> {
    const url = resolveUrl(env.mobileApiBaseUrl, pathOrUrl);
    return httpText(url, signal);
  },
};

export const liveApi = {
  async json<T>(path: string, options: HttpOptions = {}): Promise<T> {
    const suppliedAuthorization = options.headers?.Authorization;
    let token: string | null = null;
    if (!suppliedAuthorization) {
      try {
        token = await getAccessToken();
      } catch {
        // A public tracking request should not be blocked by native secure
        // storage. Protected routes still return 401 without a valid token.
        token = null;
      }
    }
    const withToken = (sessionToken: string | null) => httpJson<T>(
      resolveUrl(env.mobileApiBaseUrl, path),
      {
        ...options,
        headers: {
          ...(options.headers ?? {}),
          ...(suppliedAuthorization
            ? { Authorization: suppliedAuthorization }
            : sessionToken
              ? { Authorization: authorizationForAccessToken(sessionToken) }
              : {}),
        },
      },
    );
    try {
      return await withToken(token);
    } catch (error) {
      const status = (error as { status?: number | null }).status;
      if (!suppliedAuthorization && token && (status === 401 || status === 403)) {
        let refreshedToken: string | null = null;
        try {
          if (isFirebaseAccessToken(token)) {
            const idToken = await getRestoredFirebaseIdToken(true);
            refreshedToken = idToken ? firebaseAccessToken(idToken) : null;
            if (refreshedToken) await saveAccessToken(refreshedToken);
          } else {
            refreshedToken = await getAccessToken();
          }
        } catch { refreshedToken = null; }
        return withToken(refreshedToken);
      }
      throw error;
    }
  },
  text(pathOrUrl: string, signal?: AbortSignal): Promise<string> {
    const url = resolveUrl(env.mobileApiBaseUrl, pathOrUrl);
    return httpText(url, signal);
  },
};

export const edgeApi = {
  json<T>(path: string, options?: HttpOptions): Promise<T> {
    return httpJson<T>(resolveUrl(env.mobileApiBaseUrl, path), options);
  },
  text(pathOrUrl: string, signal?: AbortSignal): Promise<string> {
    const url = resolveUrl(env.mobileApiBaseUrl, pathOrUrl);
    return httpText(url, signal);
  },
};

export function backendUrl(path: string): string {
  return resolveUrl(env.mobileApiBaseUrl, path);
}

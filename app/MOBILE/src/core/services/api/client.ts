import { env } from '@/core/constants/env';
import { getOptionalFirebaseIdToken } from '@/core/auth/firebase';

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
    const token = suppliedAuthorization ? null : await getOptionalFirebaseIdToken();
    const withToken = (idToken: string | null) => httpJson<T>(
      resolveUrl(env.mobileApiBaseUrl, path),
      {
        ...options,
        headers: {
          ...(options.headers ?? {}),
          ...(suppliedAuthorization
            ? { Authorization: suppliedAuthorization }
            : idToken
              ? { Authorization: `Bearer ${idToken}` }
              : {}),
        },
      },
    );
    try {
      return await withToken(token);
    } catch (error) {
      const status = (error as { status?: number | null }).status;
      if (!suppliedAuthorization && token && (status === 401 || status === 403)) {
        return withToken(await getOptionalFirebaseIdToken(true));
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

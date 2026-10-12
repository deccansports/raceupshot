import { getVolunteerToken } from './auth';

const PRIMARY_API_URL = (process.env.EXPO_PUBLIC_API_URL || 'https://raceupshot.com').replace(/\/$/, '');
const FALLBACK_API_URL = (
  process.env.EXPO_PUBLIC_API_FALLBACK_URL ||
  'https://raceupshot.hidden-limit-41e6.workers.dev'
).replace(/\/$/, '');
const API_URLS = [...new Set([PRIMARY_API_URL, FALLBACK_API_URL])];

type Envelope<T> = { ok: true; data: T } | { ok: false; error?: string };

export class ApiError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

function isDnsResolutionFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /unknownhost|unable to resolve host|no address associated with hostname|name not resolved|dns/i.test(message);
}

async function fetchApi(path: string, options: RequestInit): Promise<Response> {
  const method = String(options.method || 'GET').toUpperCase();
  const canSafelyRetry = method === 'GET' || method === 'HEAD' || method === 'OPTIONS';
  let lastError: unknown;

  for (let index = 0; index < API_URLS.length; index += 1) {
    try {
      return await fetch(`${API_URLS[index]}${path}`, options);
    } catch (error) {
      lastError = error;
      const hasFallback = index < API_URLS.length - 1;
      if (!hasFallback || (!canSafelyRetry && !isDnsResolutionFailure(error))) break;
    }
  }

  console.warn('[volunteer-api] All API origins failed', {
    primaryOrigin: PRIMARY_API_URL,
    fallbackConfigured: API_URLS.length > 1,
    error: lastError instanceof Error ? lastError.message : String(lastError),
  });
  throw new Error('Unable to connect to Race Upshot. Check mobile data or Wi-Fi, then try again.');
}

export async function apiRequest<T>(path: string, options: RequestInit = {}, authenticated = true): Promise<T> {
  const token = authenticated ? await getVolunteerToken() : null;
  const response = await fetchApi(path, {
    ...options,
    headers: {
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Volunteer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });
  const body = await response.json().catch(() => null) as Envelope<T> | null;
  if (!response.ok || !body?.ok) {
    throw new ApiError(body && !body.ok ? body.error || 'The request could not be completed.' : `Server returned HTTP ${response.status}.`, response.status);
  }
  return body.data;
}

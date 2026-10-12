const DEFAULT_COOLDOWN_MS = 120_000;
const MAX_RETRY_AFTER_MS = 15 * 60_000;
const ACCESS_DENIED_RETRY_MS = 15 * 60_000;

/** Parses the standard Retry-After header without letting a provider send an unbounded delay. */
export function parseRetryAfterMilliseconds(value: string | null | undefined, now = Date.now()): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(Math.round(seconds * 1_000), MAX_RETRY_AFTER_MS);
  const retryAt = Date.parse(value);
  if (Number.isNaN(retryAt)) return null;
  return Math.min(Math.max(0, retryAt - now), MAX_RETRY_AFTER_MS);
}

/** BERGMAN-compatible 5s, 10s retry cadence for a 429 when Retry-After is absent. */
export function feibotRetryDelayMilliseconds(attempt: number, retryAfterMilliseconds: number | null): number {
  if (retryAfterMilliseconds !== null) return retryAfterMilliseconds;
  return Math.min(5_000 * 2 ** Math.max(0, attempt - 1), 60_000);
}

/** A provider cooldown is persisted after retries so scheduled syncs do not hammer Feibot. */
export function feibotCooldownUntil(now = Date.now(), retryAfterMilliseconds: number | null = null): string {
  const duration = retryAfterMilliseconds === null
    ? DEFAULT_COOLDOWN_MS
    : Math.max(DEFAULT_COOLDOWN_MS, retryAfterMilliseconds);
  return new Date(now + duration).toISOString();
}

/**
 * A 401/403 from an optional Feibot result feed normally means that feed is
 * not enabled for the account. Retry occasionally so a provider-side access
 * change is discovered without polling the denied endpoint every 30 seconds.
 */
export function feibotAccessDeniedRetryAt(now = Date.now()): string {
  return new Date(now + ACCESS_DENIED_RETRY_MS).toISOString();
}

export function isFeibotCooldownActive(retryAt: string | null | undefined, now = Date.now()): boolean {
  if (!retryAt) return false;
  const timestamp = Date.parse(retryAt);
  return !Number.isNaN(timestamp) && timestamp > now;
}

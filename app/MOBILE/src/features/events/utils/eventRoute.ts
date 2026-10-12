export function normalizeEventIdValue(value: unknown): string {
  const raw = Array.isArray(value) ? value[0] : value;
  return String(raw ?? '').trim();
}

export function hasValidEventId(value: unknown): boolean {
  const eventId = normalizeEventIdValue(value);
  return Boolean(eventId && eventId !== 'undefined' && eventId !== 'null');
}

export function safeEventId(value: unknown): string | null {
  const eventId = normalizeEventIdValue(value);
  return hasValidEventId(eventId) ? eventId : null;
}

export function safeRouteEventId(
  ...values: unknown[]
): string | null {
  for (const value of values) {
    const candidate = safeEventId(value);
    if (candidate) return candidate;
  }
  return null;
}

export const EVENT_PAST_GRACE_MILLISECONDS = 24 * 60 * 60 * 1_000;

function timestamp(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

/**
 * An event remains current for 24 hours after its configured end. Events that
 * do not have an end use their configured start as the lifecycle baseline.
 */
export function eventMovesToPastAt(
  startsAt: string | null | undefined,
  endsAt?: string | null,
): number | null {
  const baseline = timestamp(endsAt) ?? timestamp(startsAt);
  return baseline === null ? null : baseline + EVENT_PAST_GRACE_MILLISECONDS;
}

export function hasEventMovedToPast(
  startsAt: string | null | undefined,
  endsAt?: string | null,
  now = Date.now(),
): boolean {
  const movesAt = eventMovesToPastAt(startsAt, endsAt);
  return movesAt !== null && now >= movesAt;
}

export function hasEventStarted(startsAt: string | null | undefined, now = Date.now()): boolean {
  const starts = timestamp(startsAt);
  return starts !== null && now >= starts;
}

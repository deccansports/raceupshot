const ONE_HOUR_MS = 60 * 60 * 1_000;
const ONE_DAY_MS = 24 * ONE_HOUR_MS;

export interface FinishLineClockWindow {
  endsAt?: string;
  stopsAt?: string;
}

function validTimestamp(value: string | null | undefined): number | null {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : null;
}

type TicketCutoff = {
  overallCutoffSeconds?: number | null;
  legs?: Array<{ cutoffSeconds?: number | null }>;
  splits?: Array<{ cutoffSeconds?: number | null }>;
};

/** All ticket cutoffs are cumulative from the official start. */
export function maximumFinishCutoffSeconds(tickets: TicketCutoff[] | null | undefined): number | null {
  const values = (tickets ?? []).flatMap((ticket) => [
    ticket.overallCutoffSeconds,
    ...(ticket.legs ?? []).map((leg) => leg.cutoffSeconds),
    ...(ticket.splits ?? []).map((split) => split.cutoffSeconds),
  ]).filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value > 0);
  return values.length ? Math.max(...values) : null;
}

export function finishLineClockWindow(input: {
  startsAt?: string;
  eventEndAt?: string | null;
  maxCutoffSeconds?: number | null;
  maxFinishSeconds?: number | null;
  eventStatus?: string;
  stopDelaySeconds?: number;
}): FinishLineClockWindow {
  const startsAt = validTimestamp(input.startsAt);
  if (startsAt === null) return {};
  const configuredEnd = validTimestamp(input.eventEndAt);
  const cutoffDuration = input.maxCutoffSeconds;
  const cutoffEnd = typeof cutoffDuration === "number" && Number.isFinite(cutoffDuration) && cutoffDuration > 0
    ? startsAt + cutoffDuration * 1_000
    : null;
  const resultDuration = Number(input.maxFinishSeconds);
  const resultEnd = Number.isFinite(resultDuration) && resultDuration > 0
    ? startsAt + resultDuration * 1_000
    : null;
  const terminal = ["completed", "official", "archived"].includes((input.eventStatus || "").toLowerCase());
  const configuredCandidates = [configuredEnd, cutoffEnd].filter((value): value is number => value !== null);
  const endsAt = configuredCandidates.length
    ? Math.max(...configuredCandidates)
    : resultEnd ?? (terminal ? startsAt + ONE_DAY_MS : null);
  if (endsAt === null) return {};
  const requestedDelay = input.stopDelaySeconds ?? ONE_HOUR_MS / 1_000;
  const stopDelayMs = Number.isFinite(requestedDelay)
    ? Math.max(0, requestedDelay) * 1_000
    : ONE_HOUR_MS;
  return {
    endsAt: new Date(endsAt).toISOString(),
    stopsAt: new Date(endsAt + stopDelayMs).toISOString(),
  };
}

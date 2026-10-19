export function resolvePredictionTimeLabels({
  etaClock,
  etaElapsed,
}: {
  etaClock?: string;
  etaElapsed?: string;
}): { etaClock?: string; etaElapsed?: string } {
  const clock = String(etaClock ?? "").trim();
  const elapsed = String(etaElapsed ?? "").trim();
  const isTimeOfDay = /^\d{1,2}:\d{2}(?::\d{2})?\s*(?:am|pm)$/i.test(clock);
  const isDuration = /^\d{1,3}:\d{2}(?::\d{2})?(?:\.\d+)?$/.test(clock);

  return {
    etaClock: isTimeOfDay ? clock : undefined,
    etaElapsed: elapsed || (isDuration ? clock.replace(/\.\d+$/, "") : undefined),
  };
}

/** Keeps locally derived ETAs ahead of the live race clock after a stale read. */
export function predictionElapsedBaseline({
  officialElapsedSeconds,
  raceStartedAt,
  nowMs,
}: {
  officialElapsedSeconds: number;
  raceStartedAt?: number;
  nowMs: number;
}): number {
  const liveElapsed =
    raceStartedAt != null &&
    Number.isFinite(raceStartedAt) &&
    nowMs >= raceStartedAt
      ? (nowMs - raceStartedAt) / 1_000
      : 0;
  return Math.max(0, officialElapsedSeconds, liveElapsed);
}

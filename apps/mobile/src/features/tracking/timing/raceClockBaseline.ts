export function deriveRaceClockStartAt(
  evidence: { readAt?: unknown; elapsedSeconds?: number | null }[],
): number | undefined {
  return evidence
    .map(({ readAt, elapsedSeconds }) => {
      if (elapsedSeconds == null || !Number.isFinite(elapsedSeconds)) return null;
      const timestamp =
        typeof readAt === "number" && Number.isFinite(readAt)
          ? readAt < 10_000_000_000
            ? readAt * 1_000
            : readAt
          : typeof readAt === "string" && readAt.trim()
            ? Date.parse(readAt)
            : Number.NaN;
      const startAt = timestamp - elapsedSeconds * 1_000;
      return Number.isFinite(startAt) && startAt > 0
        ? { elapsedSeconds, startAt }
        : null;
    })
    .filter(
      (value): value is { elapsedSeconds: number; startAt: number } =>
        value != null,
    )
    .sort((left, right) => right.elapsedSeconds - left.elapsedSeconds)[0]
    ?.startAt;
}

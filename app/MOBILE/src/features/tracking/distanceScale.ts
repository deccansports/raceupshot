export function normalizeContestDistanceScale<T extends { distanceKm?: number }>(
  points: T[],
): T[] {
  const divisor = contestDistanceDivisor(points.map((point) => point.distanceKm));
  if (divisor === 1) return points;
  return points.map((point) => ({
    ...point,
    distanceKm:
      point.distanceKm == null ? undefined : point.distanceKm / divisor,
  }));
}

export function contestDistanceDivisor(
  distances: (number | null | undefined)[],
): 1 | 1000 {
  const maxDistance = distances.reduce<number>(
    (maximum, distance) => Math.max(maximum, distance ?? 0),
    0,
  );
  return maxDistance > 500 ? 1000 : 1;
}

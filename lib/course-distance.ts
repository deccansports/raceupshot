/** Split distances are cumulative; leg distances must never replace a known final distance. */
export function configuredCourseDistance(
  splits: Array<{ order: number; distanceKm?: number | null; isFinalRaceSplit?: boolean; providerContestUuid?: string | null }>,
  legs: Array<{ distanceKm?: number | null }>,
): number {
  const ordered = [...splits].sort((a, b) => a.order - b.order);
  const finish = ordered.at(-1);
  if (finish?.isFinalRaceSplit && typeof finish.distanceKm === 'number' && finish.distanceKm > 0) return finish.distanceKm;
  return legs.reduce((sum, leg) => sum + Math.max(0, leg.distanceKm ?? 0), 0);
}

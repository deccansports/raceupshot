/**
 * Bound the coordinate count handed to a native map polyline. Endpoints are
 * always retained and interior samples stay evenly distributed.
 */
export function boundedCourseCoordinates<T>(
  coordinates: readonly T[],
  maximum = 600,
): T[] {
  const limit = Math.max(2, Math.trunc(maximum));
  if (coordinates.length <= limit) return [...coordinates];
  const output: T[] = [];
  let previousIndex = -1;
  for (let sample = 0; sample < limit; sample += 1) {
    const index = Math.round((sample * (coordinates.length - 1)) / (limit - 1));
    if (index === previousIndex) continue;
    output.push(coordinates[index]);
    previousIndex = index;
  }
  return output;
}

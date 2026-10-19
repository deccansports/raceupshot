/**
 * Pure position-interpolation math for the live-tracking engine.
 *
 * Live mode advances the athlete from the last official timing read toward the
 * next timing point using average pace (so the marker moves continuously
 * between mats, then holds at the next mat until a fresh read re-anchors it).
 *
 * Replay mode interpolates distance across all recorded split keyframes for a
 * given replay clock. Both return a course distance (km), which callers convert
 * to a fraction and then to a coordinate via `geo.positionAtFraction`.
 */

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/** Live interpolation anchor: the last official read + pace + next mat. */
export type TrackSeed = {
  anchorKm: number;
  anchorTimeSec: number;
  nextKm: number;
  paceSecPerKm: number;
  totalKm: number;
};

/** A recorded split used as a replay keyframe. */
export type TrackKeyframe = { distanceKm: number; timeSec: number };

/**
 * Estimated course distance (km) `elapsedSinceAnchorSec` after the last read.
 * Capped at the next timing point so we never "teleport" past an unconfirmed
 * mat; a new read (new seed) releases the marker toward the following point.
 */
export function estimatedDistanceKm(seed: TrackSeed, elapsedSinceAnchorSec: number): number {
  if (!(seed.paceSecPerKm > 0)) return clamp(seed.anchorKm, 0, seed.totalKm || seed.anchorKm);
  const projected = seed.anchorKm + Math.max(0, elapsedSinceAnchorSec) / seed.paceSecPerKm;
  // Equal-distance boundaries are real transition checkpoints (Swim Finish →
  // Bike Start, Bike Finish → Run Start). Hold at that mat until the next
  // official split changes the seed instead of moving into the next leg.
  const hasConfiguredCheckpoint = Number.isFinite(seed.nextKm) && seed.nextKm >= seed.anchorKm;
  const ceiling = hasConfiguredCheckpoint ? seed.nextKm : seed.totalKm || projected;
  return clamp(Math.min(projected, ceiling), 0, seed.totalKm || ceiling);
}

/** Piecewise-linear distance at `clockSec`, interpolating between keyframes. */
export function distanceAtRaceTime(
  keyframes: TrackKeyframe[],
  clockSec: number,
  totalKm: number,
): number {
  if (keyframes.length === 0) return 0;
  const sorted = [...keyframes].sort((a, b) => a.timeSec - b.timeSec);
  if (clockSec <= sorted[0].timeSec) {
    const t = sorted[0].timeSec > 0 ? clamp(clockSec / sorted[0].timeSec, 0, 1) : 1;
    return clamp(sorted[0].distanceKm * t, 0, totalKm || sorted[0].distanceKm);
  }
  const last = sorted[sorted.length - 1];
  if (clockSec >= last.timeSec) return clamp(last.distanceKm, 0, totalKm || last.distanceKm);

  for (let i = 1; i < sorted.length; i += 1) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    if (clockSec <= curr.timeSec) {
      const span = curr.timeSec - prev.timeSec || 1;
      const t = clamp((clockSec - prev.timeSec) / span, 0, 1);
      const km = prev.distanceKm + (curr.distanceKm - prev.distanceKm) * t;
      return clamp(km, 0, totalKm || km);
    }
  }
  return clamp(last.distanceKm, 0, totalKm || last.distanceKm);
}

/** Convert a course distance to a normalized 0..1 fraction of the course. */
export function distanceToFraction(distanceKm: number, totalKm: number): number {
  if (!(totalKm > 0)) return 0;
  return clamp(distanceKm / totalKm, 0, 1);
}

/** Total recorded duration (last keyframe time), for the replay scrubber range. */
export function replayDurationSec(keyframes: TrackKeyframe[]): number {
  return keyframes.reduce((max, k) => Math.max(max, k.timeSec), 0);
}

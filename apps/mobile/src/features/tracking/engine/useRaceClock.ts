import { useEffect, useState } from "react";
import { useReducedMotion } from "react-native-reanimated";

import type { ReplaySpeed } from "@/shared/components";

export type RaceClockMode = "live" | "replay";

export type UseRaceClockOptions = {
  mode: RaceClockMode;
  /** Screen focused — live ticking pauses when false (battery friendly). */
  focused?: boolean;
  /** Replay only. */
  playing?: boolean;
  speed?: ReplaySpeed;
  /** Replay clock upper bound (seconds). */
  durationSec?: number;
  /** Live visual interpolation cadence. Official split polling is separate. */
  liveTickMs?: number;
};

const LIVE_TICK_MS = 1000;
const REPLAY_TICK_MS = 250;

/**
 * Drives the tracking clock used by the interpolation engine.
 *
 * - `live`: a monotonic "seconds since anchor" counter advancing 1s at a time
 *   while focused (paused in background/blur and under Reduce Motion).
 * - `replay`: advances by `speed` while playing, clamped to `durationSec`, and
 *   can be scrubbed via `setClockSec`.
 *
 * Returns the current clock plus a setter (for the replay scrubber) so all
 * timing logic stays here rather than in components.
 */
export function useRaceClock({
  mode,
  focused = true,
  playing = false,
  speed = 1,
  durationSec = 0,
  liveTickMs = LIVE_TICK_MS,
}: UseRaceClockOptions): {
  clockSec: number;
  setClockSec: (value: number) => void;
} {
  const reducedMotion = useReducedMotion();
  const [clockSec, setClockSec] = useState(0);

  useEffect(() => {
    if (mode === "live") {
      if (!focused || reducedMotion) return;
      const id = setInterval(() => {
        setClockSec((c) => c + liveTickMs / 1000);
      }, liveTickMs);
      return () => clearInterval(id);
    }

    // replay
    if (!playing) return;
    const step = (speed * REPLAY_TICK_MS) / 1000;
    const id = setInterval(() => {
      setClockSec((c) => {
        const next = c + step;
        return durationSec > 0 && next >= durationSec ? durationSec : next;
      });
    }, REPLAY_TICK_MS);
    return () => clearInterval(id);
  }, [mode, focused, reducedMotion, playing, speed, durationSec, liveTickMs]);

  return { clockSec, setClockSec };
}

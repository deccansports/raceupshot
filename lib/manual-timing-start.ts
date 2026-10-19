/** Keep the captured wall-clock stamp unchanged; select only its elapsed-time baseline. */
export function resolveManualTimingStart(input: {
  chipStarts: Array<string | null | undefined>;
  gunStarts: Array<string | null | undefined>;
  capturedAt: string;
}) {
  const captured = Date.parse(input.capturedAt);
  for (const [source, values] of [["CHIP", input.chipStarts], ["GUN", input.gunStarts]] as const) {
    for (const value of values) {
      const start = Date.parse(value || "");
      if (!Number.isFinite(start) || !Number.isFinite(captured) || start > captured) continue;
      return { elapsedStartAt: new Date(start).toISOString(), elapsedStartSource: source, elapsedSeconds: Math.floor((captured - start) / 1000) };
    }
  }
  return { elapsedStartAt: null, elapsedStartSource: null, elapsedSeconds: null };
}

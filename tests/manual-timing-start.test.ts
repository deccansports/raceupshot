import { expect, it } from "vitest";
import { resolveManualTimingStart } from "../lib/manual-timing-start";

const capturedAt = "2026-10-19T08:00:00Z";
const chip = "2026-10-19T07:10:00Z";
const gun = "2026-10-19T07:00:00Z";
it("prefers chip start over gun for the same captured stamp", () => {
  expect(resolveManualTimingStart({ capturedAt, chipStarts: [chip], gunStarts: [gun] })).toMatchObject({ elapsedStartSource: "CHIP", elapsedSeconds: 3000 });
});
it("falls back to gun then configured start when chip is unavailable", () => {
  expect(resolveManualTimingStart({ capturedAt, chipStarts: [], gunStarts: [gun] })).toMatchObject({ elapsedStartSource: "GUN", elapsedSeconds: 3600 });
  expect(resolveManualTimingStart({ capturedAt, chipStarts: ["invalid"], gunStarts: [null, gun] })).toMatchObject({ elapsedStartSource: "GUN", elapsedSeconds: 3600 });
});
it("does not use future starts or invent elapsed time with no start", () => {
  expect(resolveManualTimingStart({ capturedAt, chipStarts: ["2026-10-19T09:00:00Z"], gunStarts: [gun] }).elapsedSeconds).toBe(3600);
  expect(resolveManualTimingStart({ capturedAt, chipStarts: [], gunStarts: [] }).elapsedSeconds).toBeNull();
});

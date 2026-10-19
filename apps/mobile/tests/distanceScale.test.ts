import assert from "node:assert/strict";
import test from "node:test";

import { normalizeContestDistanceScale } from "../src/features/tracking/distanceScale.ts";

test("unitless Feibot metre distances are normalized together", () => {
  assert.deepEqual(
    normalizeContestDistanceScale([
      { label: "Start", distanceKm: 0 },
      { label: "Split 1", distanceKm: 100 },
      { label: "Finish", distanceKm: 2000 },
    ]),
    [
      { label: "Start", distanceKm: 0 },
      { label: "Split 1", distanceKm: 0.1 },
      { label: "Finish", distanceKm: 2 },
    ],
  );
});

test("valid kilometre distances are unchanged", () => {
  const points = [{ distanceKm: 5 }, { distanceKm: 42.195 }];
  assert.equal(normalizeContestDistanceScale(points), points);
});

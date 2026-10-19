import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const {
  deriveOverallFinishMetric,
  parseFinishDurationSeconds,
} = require("./finishPace.ts") as typeof import("./finishPace");

test("parses official finish duration clocks", () => {
  assert.equal(parseFinishDurationSeconds("01:30:00"), 5_400);
  assert.equal(parseFinishDurationSeconds("42:30"), 2_550);
  assert.equal(parseFinishDurationSeconds("—"), null);
});

test("derives overall running and triathlon finish pace", () => {
  assert.equal(
    deriveOverallFinishMetric({ durationSeconds: 3_600, distanceKm: 10, raceCategory: "Marathon" }),
    "6:00 /km",
  );
  assert.equal(
    deriveOverallFinishMetric({ durationSeconds: 14_400, distanceKm: 51.5, raceCategory: "Triathlon" }),
    "4:40 /km",
  );
});

test("uses sport-specific units for single-sport swim and bike races", () => {
  assert.equal(
    deriveOverallFinishMetric({ durationSeconds: 2_400, distanceKm: 2, raceCategory: "Swimathon" }),
    "2:00 /100m",
  );
  assert.equal(
    deriveOverallFinishMetric({ durationSeconds: 7_200, distanceKm: 80, raceCategory: "Cycling" }),
    "40.00 km/h",
  );
});

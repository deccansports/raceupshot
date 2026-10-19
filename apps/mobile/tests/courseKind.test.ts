import assert from "node:assert/strict";
import test from "node:test";

import { courseStageLabels, resolveCourseKind } from "../src/features/tracking/courseKind.ts";

test("marathon tickets render a run-only race flow", () => {
  assert.equal(resolveCourseKind("Marathon", "Test 1"), "run");
  assert.equal(resolveCourseKind("Marathon", "Test 1", "SWIM FINISH"), "run");
  assert.deepEqual(courseStageLabels("run"), ["RUN", "FINISH"]);
});

test("multi-sport categories retain their configured legs", () => {
  assert.deepEqual(courseStageLabels(resolveCourseKind("Triathlon")), ["SWIM", "T1", "BIKE", "T2", "RUN", "FINISH"]);
  assert.deepEqual(courseStageLabels(resolveCourseKind("Duathlon")), ["RUN1", "BIKE", "RUN2", "FINISH"]);
});

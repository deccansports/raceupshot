import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const trackSource = readFileSync(
  new URL("./LiveTrackScreen.tsx", import.meta.url),
  "utf8",
);
const sheetSource = readFileSync(
  new URL("../../../shared/components/ui/BottomSheet.tsx", import.meta.url),
  "utf8",
);

test("the map loads event geometry before an athlete is selected", () => {
  assert.match(
    trackSource,
    /useCourseGeometry\(\s*id,\s*eventQuery\.event\?\.raw,\s*eventScreen\.queryEnabled/,
  );
  assert.doesNotMatch(
    trackSource,
    /useCourseGeometry\(id, eventQuery\.event\?\.raw, Boolean\(mapAthlete\)/,
  );
  assert.doesNotMatch(trackSource, /const mapAthlete =/);
  assert.match(trackSource, /Athlete selection must never swap/);
});

test("every tracked athlete receives an initial detail request for map position", () => {
  assert.match(trackSource, /athleteInteractionsEnabled\s*&&\s*hasIdentity/);
  assert.doesNotMatch(
    trackSource,
    /athleteInteractionsEnabled\s*&&\s*hasIdentity\s*&&\s*isSelectedAthlete/,
  );
});

test("the bottom-sheet gesture remains stable while typing search text", () => {
  assert.match(sheetSource, /const pan = useMemo\(/);
  assert.doesNotMatch(sheetSource, /const pan = Gesture\.Pan\(\)/);
});

test("T1 and T2 appear only after the athlete reaches the transition", () => {
  assert.match(trackSource, /stage === "T1" \|\| stage === "T2"/);
  assert.match(trackSource, /const transitionStageReached =/);
  assert.match(trackSource, /canonical\?\.status === "in_progress"/);
  assert.match(trackSource, /opacity: stageVisible \? 1 : 0/);
});

test("the Finish stage never displays a live elapsed value before finishing", () => {
  assert.match(
    trackSource,
    /if \(stage === "FINISH"\)[\s\S]{0,120}return finished \? displayElapsedClock\(finishTime\)/,
  );
});

test("switching or re-adding an athlete preserves the live elapsed clock", () => {
  assert.match(trackSource, /const elapsedClockCache = new Map/);
  assert.match(trackSource, /elapsedClockCache\.get\(identityKey\)/);
  assert.match(
    trackSource,
    /startElapsedSeconds != null\s*\? startElapsedSeconds/,
  );
  assert.match(trackSource, /function isDetailClockRunning/);
  assert.match(trackSource, /detail\.startTiming\.hasAcceptedStart === true/);
  assert.doesNotMatch(
    trackSource,
    /clockRunning=\{Boolean\([\s\S]{0,100}header\.status === "live"/,
  );
});

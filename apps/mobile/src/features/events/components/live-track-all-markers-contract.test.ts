import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const screenSource = readFileSync(
  new URL("./LiveTrackScreen.tsx", import.meta.url),
  "utf8",
);

test("the live map builds markers for every tracked athlete", () => {
  assert.match(
    screenSource,
    /return watchedRows\.flatMap\(\(\{ athlete, detail \}\) => \{/,
  );
  assert.doesNotMatch(
    screenSource,
    /const rowsForMap = explicitlySelectedTrackedRow/,
  );
});

test("only the explicitly selected tracked athlete receives selected marker state", () => {
  assert.match(screenSource, /selected: selectedTrackedKey === stableId/);
  assert.match(screenSource, /selectedTrackedKey,\s*watchedRows,/);
});

test("only the selected athlete uses one-second live polling", () => {
  assert.match(screenSource, /return isSelectedAthlete \? 1_000 : 5_000/);
  assert.match(
    screenSource,
    /refetchOnMount: isSelectedAthlete \? "always" : false/,
  );
  assert.match(screenSource, /selectedAthleteRefetch/);
  assert.match(screenSource, /focused: eventScreen\.pollingEnabled/);
  assert.match(screenSource, /liveTickMs: 1_000/);
  assert.match(
    screenSource,
    /notifyOnChangeProps: \["data", "error", "isPlaceholderData"\]/,
  );
});

test("the notification bell registers the device instead of toggling local state", () => {
  assert.match(screenSource, /enableTrackedAthleteNotifications\(\)/);
  assert.doesNotMatch(
    screenSource,
    /onToggleNotifications=\{\(\) =>\s*setNotificationsEnabled\(\(value\) => !value\)/,
  );
});

test("live elapsed clocks continue between canonical timing responses", () => {
  assert.match(screenSource, /function useContinuousElapsedSeconds/);
  assert.match(screenSource, /sourceSeconds: canonicalElapsedSeconds/);
  assert.match(
    screenSource,
    /setInterval\(\(\) => setNowMs\(Date\.now\(\)\), 1_000\)/,
  );
  assert.match(
    screenSource,
    /parseElapsedClock\(metricValue\(detail\.liveStats, "Athlete Race Time"\)\)/,
  );
});

test("map interpolation begins from the athlete's canonical elapsed race time", () => {
  assert.match(
    screenSource,
    /canonicalElapsedSeconds - detail\.track\.seed\.anchorTimeSec/,
  );
  assert.match(screenSource, /liveMapClockSec - anchorClock/);
});

test("elevation uses predicted course distance without an official-read cap", () => {
  assert.match(screenSource, /legEndKm - legStartKm/);
  const elevationBlock = screenSource.slice(
    screenSource.indexOf("const elevationAthlete"),
    screenSource.indexOf("const elevationAthlete") + 3_500,
  );
  assert.doesNotMatch(
    elevationBlock,
    /Number\(detail\.track\.currentLegDistanceKm\)/,
  );
});

test("unfinished finish boundaries never display a fuzzy split value", () => {
  assert.match(
    screenSource,
    /if \(\/\\bfinish\\b\/i\.test\(stage\)\)\s*return finished \? displayElapsedClock\(finishTime\)/,
  );
});

test("the selected athlete has a compact bottom map card", () => {
  assert.match(screenSource, /function CompactMapAthleteCard/);
  assert.match(screenSource, /Live Elapsed/);
  assert.match(screenSource, /Finish Time/);
  assert.match(screenSource, /Share\.share/);
  assert.match(
    screenSource,
    /sheetMode === "collapsed" &&\s*selectedTrackedRow &&\s*!compactCardDismissed/,
  );
});

test("a relinked selected athlete keeps one marker at the furthest course position", () => {
  assert.match(
    screenSource,
    /markerName === normalizeSearchText\(existing\.name\)/,
  );
  assert.match(
    screenSource,
    /markerDistance >= existingDistance \? marker : existing/,
  );
});

test("an active transition shows its running elapsed duration", () => {
  assert.match(screenSource, /liveTransitionElapsedSeconds\(/);
  assert.match(
    screenSource,
    /if \(liveTransitionDuration != null\)\s*return formatElapsedClock\(liveTransitionDuration\)/,
  );
});

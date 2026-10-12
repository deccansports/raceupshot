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
  assert.match(screenSource, /liveTickMs: 5_000/);
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

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const mapSource = readFileSync(
  new URL("./CourseMapView.native.tsx", import.meta.url),
  "utf8",
);

test("every moving athlete uses a persistent animated native marker", () => {
  assert.match(mapSource, /function AnimatedAthleteMarker/);
  assert.doesNotMatch(mapSource, /function StaticAthleteMarker/);
  assert.match(mapSource, /<Marker\.Animated/);
  assert.match(mapSource, /coordinate\s*\.timing\(/);
  assert.match(mapSource, /zIndex=\{athlete\.selected \? 1_000 : 100\}/);
  assert.match(
    mapSource,
    /setTimeout\(\(\) => setTracksViewChanges\(false\), 900\)/,
  );
});

test("both native map layouts render the lightweight athlete marker wrapper", () => {
  assert.equal((mapSource.match(/<AthleteMarker\s/g) ?? []).length, 2);
});

test("athlete coordinates stay exactly on the configured course geometry", () => {
  assert.doesNotMatch(mapSource, /function spreadOverlappingAthlete/);
  assert.ok((mapSource.match(/athlete=\{athlete\}/g) ?? []).length >= 2);
});

test("the carousel selection is redrawn and rendered above a shared start marker", () => {
  assert.match(mapSource, /athlete\.selected,\s*showLabel,/);
  assert.match(mapSource, /const athleteMarkerEntries = athletes/);
  assert.match(
    mapSource,
    /Number\(left\.athlete\.selected\) - Number\(right\.athlete\.selected\)/,
  );
  assert.equal(
    (mapSource.match(/athleteMarkerEntries\.map\(\(\{ athlete, index \}\)/g) ?? [])
      .length,
    2,
  );
});

test("changing the selected athlete does not refit the course viewport", () => {
  assert.match(
    mapSource,
    /const viewportKey = `\$\{courseFocusSignature\}:\$\{windowWidth\}:\$\{windowHeight\}`/,
  );
  assert.doesNotMatch(
    mapSource,
    /const viewportKey = `[^`]*selectedAthleteId/,
  );
});

test("GPX coordinate arrays are memoized outside the native map render", () => {
  assert.match(mapSource, /const legPolylines = useMemo/);
  assert.match(mapSource, /const transitionPolylines = useMemo/);
  assert.doesNotMatch(mapSource, /coordinates=\{toMapCoords\(/);
});

test("unchanged athlete and course props do not redraw the native map", () => {
  assert.match(mapSource, /export const CourseMapView = memo\(/);
  assert.match(mapSource, /function sameAthleteMarkers/);
  assert.match(mapSource, /function sameMapPreferences/);
});

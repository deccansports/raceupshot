import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const mapSource = readFileSync(
  new URL("./CourseMapView.native.tsx", import.meta.url),
  "utf8",
);

test("only the selected athlete uses a continuously animated native marker", () => {
  assert.match(mapSource, /function AnimatedSelectedAthleteMarker/);
  assert.match(mapSource, /function StaticAthleteMarker/);
  assert.match(mapSource, /if \(athlete\.selected\)/);
  assert.match(mapSource, /<Marker\.Animated/);
  assert.match(
    mapSource,
    /setTimeout\(\(\) => setTracksViewChanges\(false\), 800\)/,
  );
});

test("both native map layouts render the lightweight athlete marker wrapper", () => {
  assert.equal((mapSource.match(/<AthleteMarker\s/g) ?? []).length, 2);
});

test("athletes at the same course coordinate are spread into visible markers", () => {
  assert.match(mapSource, /function spreadOverlappingAthlete/);
  assert.equal(
    (mapSource.match(/athlete=\{spreadOverlappingAthlete\(/g) ?? []).length,
    2,
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

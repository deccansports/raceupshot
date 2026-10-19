import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const repositorySource = readFileSync(
  new URL("./course.repository.ts", import.meta.url),
  "utf8",
);

test("mobile course maps preserve published GPX file URLs", () => {
  const publishedUrlRead = repositorySource.indexOf(
    "const publishedUrl = text(map.gpxUrl)",
  );
  const embeddedGpxRead = repositorySource.indexOf(
    "const xml = text(map.gpxData)",
  );

  assert.notEqual(publishedUrlRead, -1);
  assert.notEqual(embeddedGpxRead, -1);
  assert.ok(
    publishedUrlRead < embeddedGpxRead,
    "the public GPX URL must be preferred before embedded-data fallbacks",
  );
  assert.match(repositorySource, /if \(publishedUrl\) return publishedUrl/);
});

test("mobile course maps pass published coordinate arrays directly to geometry", () => {
  assert.match(repositorySource, /courseMaps\.swimPoints = points/);
  assert.match(repositorySource, /courseMaps\.bikePoints = points/);
  assert.match(repositorySource, /courseMaps\.runPoints = points/);
  assert.doesNotMatch(
    repositorySource,
    /const track = points\.map/,
    "published points must not be expanded into an oversized data URL",
  );
});

test("mobile requests scope geometry to the tracked ticket or contest", () => {
  assert.match(repositorySource, /query\.set\('ticketId'/);
  assert.match(repositorySource, /query\.set\('contestId'/);
  assert.match(repositorySource, /query\.set\('category'/);
  assert.match(repositorySource, /geometry: includeGeometry \? '1' : '0'/);
  assert.match(repositorySource, /loadCourseMap\(eventId, signal, selection, includeGeometry\)/);
});

test("a stale athlete contest selection falls back to the event course", () => {
  assert.match(repositorySource, /selectionWasScoped/);
  assert.match(
    repositorySource,
    /data\.maps\.length === 0[\s\S]*raw = await requestCourse\(\)/,
  );
});

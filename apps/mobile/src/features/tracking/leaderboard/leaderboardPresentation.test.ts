import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const {
  athleteIdentityLines,
  paceForLeaderboardSplit,
  paginateLeaderboard,
  shouldAnimateAthleteName,
  transitionDurationSeconds,
} = require("./leaderboardPresentation.ts") as typeof import("./leaderboardPresentation");

test("long athlete name animates only when its measured width overflows", () => {
  assert.equal(shouldAnimateAthleteName(156, 112), true);
  assert.equal(shouldAnimateAthleteName(112, 112), false);
  assert.equal(shouldAnimateAthleteName(28, 112), false);
});

test("identity presentation contains one name and separate club and bib lines", () => {
  const identity = athleteIdentityLines({
    name: "Vaibhav Belgaonkar",
    club: "Test1",
    bib: "1003",
    flag: "🇮🇳",
  });
  assert.deepEqual(identity, {
    name: "Vaibhav Belgaonkar",
    club: "Test1",
    bib: "Bib 1003 · 🇮🇳",
  });
  assert.equal(Object.values(identity).filter((line) => line === identity.name).length, 1);
});

test("transition and start checkpoints never inherit sport pace", () => {
  assert.equal(paceForLeaderboardSplit("T1", "70.0 km/h"), "—");
  assert.equal(paceForLeaderboardSplit("T2", "4:20 /km"), "—");
  assert.equal(paceForLeaderboardSplit("Swim Start", "0:41 /100m"), "—");
  assert.equal(paceForLeaderboardSplit("Bike Start", "70.0 km/h"), "—");
  assert.equal(paceForLeaderboardSplit("Run Start", "4:20 /km"), "—");
});

test("finish checkpoints allow only their own sport metric", () => {
  assert.equal(paceForLeaderboardSplit("Swim Finish", "0:41 /100m"), "0:41 /100m");
  assert.equal(paceForLeaderboardSplit("Swim Finish", "70.0 km/h"), "—");
  assert.equal(paceForLeaderboardSplit("Bike Finish", "70.0 km/h"), "70.0 km/h");
  assert.equal(paceForLeaderboardSplit("Bike Finish", "4:20 /km"), "—");
  assert.equal(paceForLeaderboardSplit("Run Finish", "4:20 /km"), "4:20 /km");
  assert.equal(paceForLeaderboardSplit("Run Finish", "70.0 km/h"), "—");
  assert.equal(paceForLeaderboardSplit("Overall Finish", "4:40 /km"), "4:40 /km");
  assert.equal(paceForLeaderboardSplit("Finish", "2:00 /100m"), "2:00 /100m");
});

test("leaderboard pagination remains fixed at 50 rows", () => {
  const rows = Array.from({ length: 123 }, (_, index) => index + 1);
  assert.deepEqual(paginateLeaderboard(rows, 0), {
    rows: rows.slice(0, 50), page: 0, pageCount: 3, start: 1, end: 50,
  });
  assert.deepEqual(paginateLeaderboard(rows, 1), {
    rows: rows.slice(50, 100), page: 1, pageCount: 3, start: 51, end: 100,
  });
  assert.deepEqual(paginateLeaderboard(rows, 2), {
    rows: rows.slice(100), page: 2, pageCount: 3, start: 101, end: 123,
  });
});

test("T1 and T2 use boundary differences and rank by transition duration", () => {
  const athletes = [
    { bib: "1001", swimFinish: 1800, bikeStart: 1950, bikeFinish: 3111, runStart: 3181 },
    { bib: "1003", swimFinish: 1860, bikeStart: 2050, bikeFinish: 3153, runStart: 3263 },
    { bib: "1002", swimFinish: 1770, bikeStart: 1910, bikeFinish: 3189, runStart: 3269 },
  ];
  const t1 = athletes
    .map((athlete) => ({
      bib: athlete.bib,
      seconds: transitionDurationSeconds(athlete.swimFinish, athlete.bikeStart),
    }))
    .sort((a, b) => Number(a.seconds) - Number(b.seconds));
  const t2 = athletes
    .map((athlete) => ({
      bib: athlete.bib,
      seconds: transitionDurationSeconds(athlete.bikeFinish, athlete.runStart),
    }))
    .sort((a, b) => Number(a.seconds) - Number(b.seconds));

  assert.deepEqual(t1, [
    { bib: "1002", seconds: 140 },
    { bib: "1001", seconds: 150 },
    { bib: "1003", seconds: 190 },
  ]);
  assert.deepEqual(t2, [
    { bib: "1001", seconds: 70 },
    { bib: "1002", seconds: 80 },
    { bib: "1003", seconds: 110 },
  ]);
  assert.deepEqual(
    athletes
      .map((athlete) => ({ bib: athlete.bib, seconds: athlete.bikeFinish }))
      .sort((a, b) => a.seconds - b.seconds),
    [
      { bib: "1001", seconds: 3111 },
      { bib: "1003", seconds: 3153 },
      { bib: "1002", seconds: 3189 },
    ],
  );
  assert.equal(transitionDurationSeconds(1800, null), null);
});

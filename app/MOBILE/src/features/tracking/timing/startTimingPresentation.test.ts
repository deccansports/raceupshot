import assert from "node:assert/strict";
import test from "node:test";

import { resolveStartTimingPresentation } from "./startTimingPresentation";

test("CHIP athlete waits for accepted START without DNS, clocks, cutoff, or raw ISO", () => {
  const presentation = resolveStartTimingPresentation({
    officialTimingMode: "CHIP",
    status: "WAITING_CHIP_START",
    gunStartAt: "2026-08-10T13:30:00+05:30",
    chipStartAt: null,
    officialStartAt: null,
    hasAcceptedStart: false,
    eventTimezone: "Asia/Kolkata",
  });

  assert.equal(presentation.statusLabel, "WAITING TO START");
  assert.equal(presentation.waitingForChipStart, true);
  assert.match(presentation.gunStartLabel ?? "", /^1:30:00\s*pm$/i);
  assert.equal(presentation.chipStartAt, undefined);
  assert.equal(presentation.officialStartAt, undefined);
  assert.equal(presentation.officialStartLabel, undefined);
  assert.equal(presentation.showRaceClock, false);
  assert.equal(presentation.showCutoffClock, false);
  assert.doesNotMatch(JSON.stringify(presentation), /2026-08-10T13:30:00/);
  assert.notEqual(presentation.statusLabel, "DNS");
});

test("accepted CHIP START becomes the official start and activates net timing", () => {
  const chipStartAt = "2026-08-10T13:37:24+05:30";
  const presentation = resolveStartTimingPresentation({
    officialTimingMode: "CHIP",
    status: "ON_COURSE",
    gunStartAt: "2026-08-10T13:30:00+05:30",
    chipStartAt,
    // A stale gun-derived value must not override the accepted chip start.
    officialStartAt: "2026-08-10T13:30:00+05:30",
    hasAcceptedStart: true,
    eventTimezone: "Asia/Kolkata",
  });

  assert.equal(presentation.waitingForChipStart, false);
  assert.equal(presentation.officialStartAt, Date.parse(chipStartAt));
  assert.equal(presentation.officialStartAt, presentation.chipStartAt);
  assert.match(presentation.chipStartLabel ?? "", /^1:37:24\s*pm$/i);
  assert.equal(presentation.showRaceClock, true);
  assert.equal(presentation.showCutoffClock, true);
});

import { deriveEventStatus, normalizedEventSlug } from "../lib/raceupshot-repository";
import { eventMovesToPastAt, hasEventMovedToPast } from "../lib/event-lifecycle";
import { describe, expect, it } from "vitest";

describe("event lifecycle derivation", () => {
  const startsAt = "2026-10-10T00:00:00.000Z";

  it("keeps an event live until 24 hours after its configured time even when results exist", () => {
    expect(deriveEventStatus({ status: "upcoming" }, 3, startsAt, Date.parse("2026-10-10T23:59:59.999Z"))).toBe("live");
  });

  it("moves a result-bearing event to official after the 24-hour grace period", () => {
    expect(deriveEventStatus({ status: "upcoming" }, 3, startsAt, Date.parse("2026-10-11T00:00:00.000Z"))).toBe("official");
  });

  it("moves an elapsed event without results to completed", () => {
    expect(deriveEventStatus({ status: "published" }, 0, "2020-01-01T00:00:00.000Z")).toBe("completed");
  });

  it("does not let a stored live status prevent the scheduled past transition", () => {
    expect(deriveEventStatus({ status: "live" }, 0, startsAt, Date.parse("2026-10-11T00:00:00.000Z"))).toBe("completed");
  });

  it("uses the configured end time as the 24-hour baseline", () => {
    const endsAt = "2026-10-10T08:00:00.000Z";
    expect(eventMovesToPastAt(startsAt, endsAt)).toBe(Date.parse("2026-10-11T08:00:00.000Z"));
    expect(hasEventMovedToPast(startsAt, endsAt, Date.parse("2026-10-11T07:59:59.999Z"))).toBe(false);
    expect(hasEventMovedToPast(startsAt, endsAt, Date.parse("2026-10-11T08:00:00.000Z"))).toBe(true);
  });

  it("normalizes event slugs before conflict checks", () => {
    expect(normalizedEventSlug("  Test-New  ")).toBe("test-new");
  });
});

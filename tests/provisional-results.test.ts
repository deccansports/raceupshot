import { describe, expect, it } from "vitest";
import { resultParticipants, shouldUseCanonicalResultFallback } from "../lib/provisional-results";
import type { LiveParticipant } from "../packages/contracts/src";

function participant(participantUid: string, raceStatus: LiveParticipant["raceStatus"]): LiveParticipant {
  return {
    eventId: "event-1",
    participantUid,
    bib: participantUid,
    displayName: participantUid,
    initials: participantUid.slice(0, 2),
    contestName: "Olympic",
    visibility: "PUBLIC",
    raceStatus,
    splits: [],
  };
}

describe("provisional public results", () => {
  it("selects canonical finish outcomes and excludes athletes still racing", () => {
    expect(resultParticipants([
      participant("finished", "FINISHED"),
      participant("dnf", "DNF"),
      participant("running", "RUNNING"),
    ]).map((row) => row.participantUid)).toEqual(["finished", "dnf"]);
  });

  it("falls back only when timing results are empty, never over verified published results", () => {
    expect(shouldUseCanonicalResultFallback([], "timing-provider")).toBe(true);
    expect(shouldUseCanonicalResultFallback([], "raceupshot")).toBe(true);
    expect(shouldUseCanonicalResultFallback([], "published-results")).toBe(false);
    expect(shouldUseCanonicalResultFallback([participant("finished", "FINISHED")], "timing-provider")).toBe(false);
  });
});

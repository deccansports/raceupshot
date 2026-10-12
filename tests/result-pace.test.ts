import { describe, expect, it } from "vitest";
import type { LiveParticipant } from "@/packages/contracts/src";
import { resultPace } from "@/lib/result-pace";

function participant(overrides: Partial<LiveParticipant> = {}): LiveParticipant {
  return {
    eventId: "event-1",
    participantUid: "athlete-1",
    bib: "101",
    displayName: "Test Athlete",
    initials: "TA",
    contestName: "BERGMAN OLYMPIC TRIATHLON",
    visibility: "PUBLIC",
    raceStatus: "FINISHED",
    splits: [],
    ...overrides,
  };
}

describe("resultPace", () => {
  it("preserves a pace supplied by the result record", () => {
    expect(resultPace(participant({ pace: "4:20 /km" }))).toBe("4:20 /km");
  });

  it("uses a supplied split pace before calculating a fallback", () => {
    expect(resultPace(participant({ splits: [{ splitId: "run", name: "Run", splitTime: "00:45:32", paceOrSpeed: "4:31 /km" }] }))).toBe("4:31 /km");
  });

  it("calculates Olympic run pace from the completed run split", () => {
    expect(resultPace(participant({ splits: [{ splitId: "run", name: "Run", splitTime: "00:45:32" }] }))).toBe("4:33 /km");
  });

  it("calculates 102 triathlon pace from its 20 km run split", () => {
    expect(resultPace(participant({
      contestName: "BERGMAN 102 TRIATHLON",
      splits: [{ splitId: "run", name: "Run", splitTime: "01:36:20" }],
    }))).toBe("4:49 /km");
  });

  it("does not invent a pace when the category distance is unknown", () => {
    expect(resultPace(participant({ contestName: "Custom challenge", splits: [{ splitId: "run", name: "Run", splitTime: "00:45:32" }] }))).toBe("");
  });
});

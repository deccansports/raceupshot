import { describe, expect, it } from "vitest";
import type { LiveParticipant } from "@/packages/contracts/src";
import { decorateLiveParticipantRanks, rankLiveLeaderboardParticipants } from "./live-leaderboard";

function participant(participantUid: string, raceStatus: LiveParticipant["raceStatus"]): LiveParticipant {
  return {
    eventId: "event-1",
    participantUid,
    bib: participantUid,
    displayName: participantUid,
    initials: participantUid,
    contestName: "Triathlon",
    visibility: "PUBLIC",
    raceStatus,
    splits: [],
  };
}

describe("canonical roster ranking", () => {
  it("preserves registered athletes while ranking only racers", () => {
    const registered = participant("1001", "NOT_STARTED");
    const racing = participant("1002", "STARTED");

    expect(rankLiveLeaderboardParticipants([registered, racing]).map((row) => row.participantUid)).toEqual(["1002"]);
    expect(decorateLiveParticipantRanks([registered, racing])).toEqual([
      registered,
      { ...racing, overallRank: 1 },
    ]);
  });
});

import { describe, expect, test } from "vitest";
import { decorateLiveSplitRanks, rankLiveLeaderboardParticipants, resolveConfiguredFinishers } from "../lib/live-leaderboard";
import type { LiveParticipant } from "../packages/contracts/src";

function athlete(overrides: Partial<LiveParticipant>): LiveParticipant {
  return {
    eventId: "event-1",
    participantUid: overrides.participantUid ?? "participant",
    bib: overrides.bib ?? "100",
    displayName: overrides.displayName ?? "Athlete",
    initials: "A",
    contestName: "Test 1",
    visibility: "PUBLIC",
    raceStatus: "STARTED",
    splits: [],
    ...overrides,
  };
}

describe("canonical live leaderboard fallback", () => {
  test("includes started canonical athletes before the provider publishes result ranks", () => {
    const rows = rankLiveLeaderboardParticipants([
      athlete({ participantUid: "b", bib: "102", raceStatus: "STARTED" }),
      athlete({ participantUid: "a", bib: "101", raceStatus: "STARTED" }),
      athlete({ participantUid: "c", bib: "103", raceStatus: "NOT_STARTED" }),
    ]);

    expect(rows.map((row) => [row.bib, row.overallRank])).toEqual([["101", 1], ["102", 2]]);
  });

  test("puts confirmed finishers ahead of athletes still racing", () => {
    const rows = rankLiveLeaderboardParticipants([
      athlete({ participantUid: "racing", bib: "102", raceStatus: "RUNNING", progressPercent: 90 }),
      athlete({ participantUid: "finisher", bib: "101", raceStatus: "FINISHED", elapsedTime: "00:20:14" }),
    ]);

    expect(rows.map((row) => row.participantUid)).toEqual(["finisher", "racing"]);
  });
});

describe("split ranks", () => {
  test("ranks each checkpoint by its own accepted elapsed time", () => {
    const rows = decorateLiveSplitRanks([
      athlete({ participantUid: "a", bib: "101", splits: [{ splitId: "swim", name: "Swim", splitTime: "00:10:00", officialTimeMs: 600_000 }] }),
      athlete({ participantUid: "b", bib: "102", splits: [{ splitId: "swim", name: "Swim", splitTime: "00:09:30", officialTimeMs: 570_000 }] }),
    ]);
    expect(rows.map((row) => row.splits[0].rankAtSplit)).toEqual([2, 1]);
  });
});

describe("configured finishers", () => {
  test("promotes accepted terminal reads and assigns final ranks", () => {
    const finish = { id: "finish", name: "Finish", order: 2 };
    const rows = resolveConfiguredFinishers([
      athlete({ participantUid: "a", bib: "1001", elapsedTime: "01:45:00", splits: [{ splitId: "finish", name: "Finish", splitTime: "01:45:00", cumulativeTime: "01:45:00", officialTimeMs: 6_300_000 }] }),
      athlete({ participantUid: "b", bib: "1002", elapsedTime: "01:30:00", splits: [{ splitId: "finish", name: "Finish", splitTime: "01:30:00", cumulativeTime: "01:30:00", officialTimeMs: 5_400_000 }] }),
    ], [finish]);

    expect(rows.map((row) => [row.bib, row.raceStatus, row.overallRank, row.overallRankTotal])).toEqual([
      ["1001", "FINISHED", 2, 2],
      ["1002", "FINISHED", 1, 2],
    ]);
  });

  test("repairs a stale automatic DNF when strict cutoff enforcement is disabled", () => {
    const [row] = resolveConfiguredFinishers([
      athlete({ raceStatus: "DNF", elapsedTime: undefined, cumulativeTime: undefined, splits: [{ splitId: "finish", name: "Finish", splitTime: "02:35:56", cumulativeTime: "02:35:56", officialTimeMs: 9_356_000 }] }),
    ], [{ id: "finish", name: "Finish", order: 2 }], { preserveDnf: false });
    expect(row.raceStatus).toBe("FINISHED");
    expect(row.progressPercent).toBe(100);
    expect(row.elapsedTime).toBe("02:35:56.000");
  });

  test("keeps canonical ranks on targeted finisher promotion", () => {
    const [row] = resolveConfiguredFinishers([
      athlete({
        raceStatus: "DNF",
        overallRank: 5,
        genderRank: 4,
        ageGroupRank: 5,
        splits: [{
          splitId: "finish",
          name: "Finish",
          splitTime: "00:16:22",
          cumulativeTime: "02:55:28",
          officialTimeMs: 10_528_000,
          rankAtSplit: 3,
        }],
      }),
    ], [{ id: "finish", name: "Finish", order: 9 }], {
      preserveDnf: false,
      decorateRanks: false,
    });

    expect(row.raceStatus).toBe("FINISHED");
    expect(row.elapsedTime).toBe("02:55:28.000");
    expect(row.overallRank).toBe(5);
    expect(row.splits[0]?.rankAtSplit).toBe(3);
  });
});

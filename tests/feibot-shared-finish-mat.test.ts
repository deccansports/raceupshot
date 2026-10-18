import { describe, expect, it } from "vitest";

import {
  authoritativeFeibotTimingSequence,
  rankAtTimingPoints,
  timingSequenceRole,
} from "../lib/feibot-timing-processing";

describe("shared finish-mat race flow", () => {
  it("builds progression only from the Feibot-imported logical sequence", () => {
    const sequence = authoritativeFeibotTimingSequence({
      eventId: "event",
      contestMappings: [],
      start: {} as never,
      legs: [],
      splits: [
        { id: "swim-start", name: "Swim Start", legId: "swim", order: 1, distanceKm: 0, timingPointId: "start", passage: 1, cutoffSeconds: null, providerContestUuid: "tri" },
        { id: "swim-700", name: "Swim 700 m", legId: "swim", order: 2, distanceKm: 0.7, timingPointId: "swim-mat", passage: 1, cutoffSeconds: null, providerContestUuid: "tri" },
        { id: "swim-finish", name: "Swim Finish", legId: "swim", order: 3, distanceKm: 1.5, timingPointId: "swim-mat", passage: 2, cutoffSeconds: null, providerContestUuid: "tri" },
        { id: "race-finish", name: "Run Finish", legId: "run", order: 4, distanceKm: 10, timingPointId: "finish", passage: 1, cutoffSeconds: null, providerContestUuid: "tri", isFinalRaceSplit: true },
      ],
      timingPoints: [
        { id: "start", name: "Start", type: "START", order: 1, readerUuids: ["reader-start"] },
        { id: "swim-mat", name: "Shared Swim Mat", type: "FINISH", order: 2, readerUuids: ["reader-swim"] },
        { id: "finish", name: "Finish", type: "FINISH", order: 3, readerUuids: ["reader-finish"] },
      ],
      notifications: {} as never,
      updatedAt: null,
    }, "tri");

    expect(sequence.map((point) => [point.timingPointKey, point.timingPointUuid, point.passage, point.type])).toEqual([
      ["swim-start", "start", 1, "START"],
      ["swim-700", "swim-mat", 1, "SPLIT"],
      ["swim-finish", "swim-mat", 2, "SPLIT"],
      ["race-finish", "finish", 1, "FINISH"],
    ]);
  });

  it("treats only the terminal use of a reused finish mat as race finish", () => {
    expect(timingSequenceRole(0, 5, "FINISH", false)).toBe("START");
    expect(timingSequenceRole(1, 5, "FINISH", false)).toBe("SPLIT");
    expect(timingSequenceRole(3, 5, "FINISH", false)).toBe("SPLIT");
    expect(timingSequenceRole(4, 5, "SPLIT", true)).toBe("FINISH");
  });

  it("ranks accepted athletes independently at every split", () => {
    const result = (timingPointKey: string, officialTimeMs: number) => ({
      timingPointKey,
      officialTimeMs,
    });
    const ranks = rankAtTimingPoints([
      {
        contestUuid: "contest",
        participantUuid: "athlete-a",
        officialResults: [result("swim", 700_000), result("finish", 9_300_000)],
      },
      {
        contestUuid: "contest",
        participantUuid: "athlete-b",
        officialResults: [result("swim", 650_000), result("finish", 9_500_000)],
      },
    ] as never);

    expect(ranks.get("contest:swim:athlete-a")).toBe(2);
    expect(ranks.get("contest:swim:athlete-b")).toBe(1);
    expect(ranks.get("contest:finish:athlete-a")).toBe(1);
    expect(ranks.get("contest:finish:athlete-b")).toBe(2);
  });
});

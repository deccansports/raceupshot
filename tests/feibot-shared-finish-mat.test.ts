import { describe, expect, it } from "vitest";

import {
  rankAtTimingPoints,
  timingSequenceRole,
} from "../lib/feibot-timing-processing";

describe("shared finish-mat race flow", () => {
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

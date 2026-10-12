import { describe, expect, it } from "vitest";
import { normalizeFeibotParticipant } from "./index";

describe("normalizeFeibotParticipant", () => {
  it("treats a registered participant without race evidence as not started", () => {
    const participant = normalizeFeibotParticipant({
      participant_uuid: "participant-1",
      bib: "1001",
      name: "Test Athlete",
      contest_uuid: "contest-1",
    }, { eventId: "event-1" });

    expect(participant.raceStatus).toBe("NOT_STARTED");
  });

  it("preserves an explicit provider race status", () => {
    const participant = normalizeFeibotParticipant({
      participant_uuid: "participant-1",
      status: "running",
    }, { eventId: "event-1" });

    expect(participant.raceStatus).toBe("RUNNING");
  });
});

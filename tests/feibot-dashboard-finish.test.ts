import { describe, expect, it } from "vitest";

import { confirmedCanonicalFinishSplit, emailForExactParticipantIdentity } from "@/lib/feibot-integration";

describe("Feibot operations dashboard finish evidence", () => {
  it("does not treat an intermediate Bike Finish as a race finish", () => {
    expect(confirmedCanonicalFinishSplit({
      raceStatus: "STARTED",
      splits: [
        { timestamp: "2026-10-10T18:00:00.000Z" },
        { timestamp: "2026-10-10T19:00:00.000Z" },
      ],
    })).toBeUndefined();
  });

  it("returns terminal evidence only after canonical FINISHED status", () => {
    expect(confirmedCanonicalFinishSplit({
      raceStatus: "FINISHED",
      splits: [
        { timestamp: "2026-10-10T18:00:00.000Z" },
        { readerTimestamp: "2026-10-10T20:00:00.000Z" },
      ],
    })).toEqual({ readerTimestamp: "2026-10-10T20:00:00.000Z" });
  });
});

describe("Feibot operations dashboard participant email", () => {
  it("enriches a canonical racer through an exact provider participant identity", () => {
    expect(emailForExactParticipantIdentity(["1rOgI8Ce", "provider-1001"], [
      { participantUid: "provider-1001", bib: "1001", emailAddress: "Athlete@Example.com" },
      { participantUid: "provider-1002", bib: "1002", email: "other@example.com" },
    ])).toBe("athlete@example.com");
  });

  it("never discloses an email from a BIB-only match", () => {
    expect(emailForExactParticipantIdentity(["provider-1001"], [
      { participantUid: "different-athlete", bib: "1001", email: "wrong@example.com" },
    ])).toBe("");
  });

  it("rejects conflicting emails attached to the same identity", () => {
    expect(emailForExactParticipantIdentity(["provider-1001"], [
      { participantUid: "provider-1001", email: "first@example.com" },
      { providerParticipantUuid: "provider-1001", email: "second@example.com" },
    ])).toBe("");
  });
});

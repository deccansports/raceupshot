import { describe, expect, it } from "vitest";
import { buildFeibotCanonicalParticipantRows, normalizedParticipantRows } from "@/lib/feibot-integration";

describe("Feibot participant canonicalization", () => {
  it("normalizes Workbench participant fields and their Feibot chip", () => {
    const [row] = normalizedParticipantRows([{
      ParticipantUUID: "provider-athlete-1",
      Unsafe_ParticipantBib: "1001",
      Unsafe_ParticipantName: "Asha Rao",
      Unsafe_ContestName: "TRIATHLON",
      ChipCode: "FB-10001",
    }], "provider-event");
    expect(row).toMatchObject({
      participantUid: "provider-athlete-1",
      providerParticipantUuid: "provider-athlete-1",
      providerEventUuid: "provider-event",
      bib: "1001",
      fullName: "Asha Rao",
      contestName: "TRIATHLON",
      chipCode: "FB-10001",
      providerParticipantSource: "FEIBOT",
    });
  });

  it("uses the Feibot roster as the identity set and preserves its chip over result feeds", () => {
    const rows = buildFeibotCanonicalParticipantRows(
      [{ ParticipantUUID: "provider-1", Unsafe_ParticipantBib: "1001", ChipCode: "FEIBOT-1", Unsafe_ParticipantName: "One" }],
      [
        { participantUid: "result-1", bib: "1001", chipCode: "RESULT-CHIP", status: "FINISHED", elapsedTime: "01:00:00" },
        { participantUid: "result-2", bib: "1002", chipCode: "EXTRA", status: "FINISHED" },
      ],
      "provider-event",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ participantUid: "provider-1", bib: "1001", chipCode: "FEIBOT-1", status: "FINISHED", elapsedTime: "01:00:00" });
  });
});

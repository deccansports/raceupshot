import { describe, expect, it } from "vitest";
import { isRelayCyclistRole, selectBikeParticipants, selectTeamChipParticipants } from "@/lib/relay-bike";

describe("relay team bike ownership", () => {
  it("recognizes supported cycling role labels", () => {
    expect(isRelayCyclistRole("Cycling")).toBe(true);
    expect(isRelayCyclistRole("CYCLIST")).toBe(true);
    expect(isRelayCyclistRole("Bike")).toBe(true);
    expect(isRelayCyclistRole("Running")).toBe(false);
  });

  it("selects only the cyclist for a relay while preserving individual athletes", () => {
    const participants = [
      { id: "individual", bib: "1001", participationMode: "INDIVIDUAL" as const, relayTeamId: null, relayMemberRole: null },
      { id: "swimmer", bib: "1501", participationMode: "RELAY" as const, relayTeamId: "team-a", relayMemberRole: "Swimming" },
      { id: "cyclist", bib: "1501", participationMode: "RELAY" as const, relayTeamId: "team-a", relayMemberRole: "Cycling" },
      { id: "runner", bib: "1501", participationMode: "RELAY" as const, relayTeamId: "team-a", relayMemberRole: "Running" },
    ];

    expect(selectBikeParticipants(participants).map((participant) => participant.id)).toEqual(["individual", "cyclist"]);
  });

  it("selects one timing-chip assignment target per relay team", () => {
    const participants = [
      { id: "one", bib: "1501", chipCode: "", participationMode: "RELAY" as const, relayTeamId: "team-a", relayMemberRole: "Swimming" },
      { id: "two", bib: "1501", chipCode: "TEAM-CHIP", participationMode: "RELAY" as const, relayTeamId: "team-a", relayMemberRole: "Cycling" },
      { id: "three", bib: "1501", chipCode: "", participationMode: "RELAY" as const, relayTeamId: "team-a", relayMemberRole: "Running" },
    ];
    expect(selectTeamChipParticipants(participants).map((participant) => participant.id)).toEqual(["two"]);
  });
});

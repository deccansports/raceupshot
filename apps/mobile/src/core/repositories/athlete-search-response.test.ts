import { describe, expect, it, vi } from "vitest";

vi.mock("@/core/services/api", () => ({ api: {}, liveApi: {} }));
vi.mock("@/core/utils", () => ({
  getCountryDisplayName: (value: unknown) => String(value ?? "") || undefined,
  getInitials: (value: string) => value.split(/\s+/).map((word) => word[0]).join("").slice(0, 2),
}));

import { normalizeAthleteSearchResponse } from "./athlete.repository";

describe("athlete search response", () => {
  it("maps the production Race Upshot direct-data envelope used by iOS", () => {
    const response = normalizeAthleteSearchResponse(
      "event-1",
      "1001",
      "bib",
      {
        success: true,
        eventId: "event-1",
        data: [{
          eventId: "event-1",
          participantUid: "participant-1",
          bib: "1001",
          displayName: "Test Athlete",
          contestId: "contest-1",
          contestName: "Triathlon",
          visibility: "PUBLIC",
          raceStatus: "STARTED",
        }],
        meta: { source: "timing-provider", provider: "FEIBOT" },
      },
    );

    expect(response.matches).toHaveLength(1);
    expect(response.matches[0]).toMatchObject({
      id: "cloud:participant-1",
      participantUuid: "participant-1",
      bib: "1001",
      name: "Test Athlete",
      category: "Triathlon",
    });
  });

  it("keeps normalized numeric BIB matching strict", () => {
    const response = normalizeAthleteSearchResponse("event-1", "001", "bib", {
      success: true,
      data: [
        { participantUid: "one", bib: "1", displayName: "One" },
        { participantUid: "ten", bib: "10", displayName: "Ten" },
      ],
    });

    expect(response.matches.map((athlete) => athlete.bib)).toEqual(["1"]);
  });
});

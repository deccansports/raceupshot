import { describe, expect, it } from "vitest";
import { certificateTemplateId } from "../lib/certificate-storage";
import { sanitizeCmsBlocks, sanitizeCmsHtml } from "../lib/cms";
import { applyPublicAthletePrivacy, resolveAthleteVisibility } from "../packages/privacy-core/src";
import { normalizeFeibotCalculatedResultParticipant, normalizeFeibotParticipant, normalizeRaceStatus, participantMatchKeys } from "../packages/timing-core/src";
import type { LiveParticipant, LiveTrackingSettings } from "../packages/contracts/src";
import { eventCourseCollectionInputSchema } from "../packages/contracts/src/schemas";

const liveSettings: LiveTrackingSettings = {
  liveTrackingEnabled: true,
  publicLiveTrackingEnabled: true,
  loginOnlyTracking: false,
  athleteSearchEnabled: true,
  leaderboardEnabled: true,
  liveMapEnabled: false,
  splitsEnabled: true,
  estimatedPositionEnabled: false,
  watchlistEnabled: true,
  sharingEnabled: true,
  anonymousTrackingAllowed: true,
  privateTrackingAllowed: true,
  defaultAthleteVisibility: "PUBLIC",
  forceVisibility: null,
  resultsVisibleDuringRace: true,
  provisionalLeaderboard: true,
  liveTrackingStartAt: null,
  liveTrackingEndAt: null,
};

describe("Worker data contracts", () => {
  it("creates stable category-specific certificate keys", () => {
    expect(certificateTemplateId("test", "Olympic")).toBe("test:olympic");
  });

  it("keeps separate split variables for multisport certificates", () => {
    const variables = ["swim_time", "t1_time", "bike_time", "t2_time", "run_time"];
    expect(new Set(variables).size).toBe(variables.length);
  });

  it("keeps supported CMS HTML and presentation classes", () => {
    const html = sanitizeCmsHtml(
      '<section class="cms-content-section"><h2>About us</h2><a class="cms-button cms-button-primary" href="/events">Events</a></section>',
    );
    expect(html).toContain('class="cms-content-section"');
    expect(html).toContain('class="cms-button cms-button-primary"');
    expect(html).toContain("<h2>About us</h2>");
  });

  it("removes executable CMS markup and unsafe attributes", () => {
    const html = sanitizeCmsHtml(
      '<section class="cms-content-section unknown" onclick="alert(1)"><script>alert(2)</script><a href="javascript:alert(3)">Unsafe</a></section>',
    );
    expect(html).not.toContain("script");
    expect(html).not.toContain("onclick");
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("unknown");
  });

  it("normalizes CMS block names and IDs", () => {
    expect(sanitizeCmsBlocks([{ id: "", name: " ", html: "<p>Text</p>" }])).toEqual([
      { id: "block-1", name: "Content block 1", html: "<p>Text</p>" },
    ]);
  });

  it("uses event policy before athlete privacy preferences", () => {
    expect(resolveAthleteVisibility({ eventSettings: liveSettings, athletePreference: "ANONYMOUS" })).toBe("ANONYMOUS");
    expect(resolveAthleteVisibility({ eventSettings: liveSettings, athletePreference: "PUBLIC", adminOverride: "PRIVATE" })).toBe("PRIVATE");
    expect(resolveAthleteVisibility({ eventSettings: { ...liveSettings, forceVisibility: "PRIVATE" }, athletePreference: "PUBLIC" })).toBe("PRIVATE");
    expect(resolveAthleteVisibility({ eventSettings: { ...liveSettings, forceVisibility: "PRIVATE" }, athletePreference: "PUBLIC", adminOverride: "PUBLIC" })).toBe("PRIVATE");
    expect(resolveAthleteVisibility({ eventSettings: { ...liveSettings, publicLiveTrackingEnabled: false }, athletePreference: "PUBLIC" })).toBe("PRIVATE");
  });

  it("hides name, photo and bib from anonymous public athlete payloads", () => {
    const participant: LiveParticipant = {
      eventId: "event-1",
      participantUid: "participant-1",
      athleteUid: "user-1",
      bib: "1001",
      displayName: "Private Name",
      fullName: "Private Name",
      initials: "PN",
      photoUrl: "https://example.test/photo.jpg",
      contestName: "Olympic",
      country: "IND",
      club: "Private Club",
      visibility: "ANONYMOUS",
      raceStatus: "CYCLING",
      splits: [],
    };
    const filtered = applyPublicAthletePrivacy(participant, liveSettings);
    expect(filtered?.displayName).toBe("Anonymous Athlete");
    expect(filtered?.bib).toBe("");
    expect(filtered?.initials).toBe("AN");
    expect(filtered?.athleteUid).toBeUndefined();
    expect(filtered?.fullName).toBeUndefined();
    expect(filtered?.photoUrl).toBeUndefined();
    expect(filtered?.club).toBeUndefined();
  });

  it("normalizes provider statuses and rejects unstable participant identities", () => {
    expect(normalizeRaceStatus("Bike")).toBe("CYCLING");
    expect(normalizeRaceStatus("Disqualified")).toBe("DSQ");
    expect(() => normalizeFeibotParticipant({ name: "Name only" }, { eventId: "event-1" })).toThrow(/stable participant UID/);
  });

  it("does not let Feibot's zero chip placeholder erase Swim Finish time", () => {
    const participant = normalizeFeibotCalculatedResultParticipant({
      participant_uuid: "participant-1",
      Unsafe_ParticipantBib: "1001",
      SplitResults: [
        {
          SplitUUID: "swim-start",
          Unsafe_SplitName: "Start",
          GunTimeFromStartFormated: "00:01:36",
          ChipTimeFromStartFormated: "00:00:00",
          TimeSpanFormated: "00:00:00",
          Validity: "Valid",
        },
        {
          SplitUUID: "swim-finish",
          Unsafe_SplitName: "Swim Finish",
          GunTimeFromStartFormated: "00:31:36",
          ChipTimeFromStartFormated: "00:00:00",
          TimeSpanFormated: "00:30:00",
          Validity: "Valid",
        },
      ],
    }, { eventId: "event-1", contestId: "triathlon" });

    expect(participant?.splits.map((split) => split.cumulativeTime)).toEqual([
      "00:00:00.000",
      "00:30:00.000",
    ]);
    expect(participant?.splits[1]).toMatchObject({
      splitTime: "00:30:00.000",
      officialTimeMs: 1_800_000,
    });
    expect(participant?.raceStatus).toBe("STARTED");
  });

  it("uses Swim Finish GunTime when Feibot also sends zero ChipTime and TimeSpan", () => {
    const participant = normalizeFeibotCalculatedResultParticipant({
      participant_uuid: "participant-1",
      Unsafe_ParticipantBib: "1001",
      SplitResults: [
        {
          SplitUUID: "swim-start",
          Unsafe_SplitName: "Swim Start",
          GunTimeFromStartFormated: "00:01:42",
          ChipTimeFromStartFormated: "00:00:00",
          TimeSpanFormated: "00:01:42",
          Validity: "Valid",
        },
        {
          SplitUUID: "swim-finish",
          Unsafe_SplitName: "Swim Finish",
          GunTimeFromStartFormated: "00:10:42",
          ChipTimeFromStartFormated: "00:00:00",
          TimeSpanFormated: "00:00:00",
          Validity: "Valid",
        },
      ],
    }, { eventId: "event-1", contestId: "triathlon" });

    expect(participant?.splits[1]).toMatchObject({
      splitTime: "00:10:42.000",
      cumulativeTime: "00:10:42.000",
      officialTimeMs: 642_000,
    });
  });

  it("builds participant matching keys without using a name", () => {
    expect(participantMatchKeys({
      eventId: "event-1",
      participantUid: "participant-1",
      athleteUid: "athlete-1",
      verifiedEmailHash: "hash",
      contestId: "olympic",
      bib: "1001",
    })).toEqual([
      "athlete:athlete-1",
      "participant:participant-1",
      "email:hash",
      "event-bib:event-1:olympic:1001",
    ]);
  });

  it("accepts multiple colored GPX maps for the same event category", () => {
    const map = {
      mapId: "swim-map",
      eventId: "event-1",
      category: "Triathlon 102",
      mapName: "Swim",
      mapType: "SWIM",
      fileName: "swim.gpx",
      gpxData: "<gpx />",
      points: [{ latitude: 16.7, longitude: 74.2 }, { latitude: 16.71, longitude: 74.21 }],
      routeColor: "#1683ff",
      visibility: { web: true, mobile: true, public: true },
      displayOrder: 0,
      updatedAt: "2026-07-28T00:00:00.000Z",
    };
    expect(eventCourseCollectionInputSchema.safeParse({ maps: [
      map,
      { ...map, mapId: "bike-map", mapName: "Bike", mapType: "BIKE", fileName: "bike.gpx", routeColor: "#f0b429", displayOrder: 1 },
    ] }).success).toBe(true);
  });

  it("requires a name for custom course-map types", () => {
    const result = eventCourseCollectionInputSchema.safeParse({ maps: [{
      mapId: "custom-map",
      eventId: "event-1",
      category: "Half Marathon",
      mapName: "Parking",
      mapType: "CUSTOM",
      fileName: "parking.gpx",
      points: [{ latitude: 16.7, longitude: 74.2 }, { latitude: 16.71, longitude: 74.21 }],
      routeColor: "#1683ff",
      visibility: { web: true, mobile: false, public: true },
      displayOrder: 0,
      updatedAt: "2026-07-28T00:00:00.000Z",
    }] });
    expect(result.success).toBe(false);
  });
});

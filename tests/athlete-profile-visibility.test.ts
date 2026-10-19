import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ values: new Map<string, string>() }));

vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: async () => ({
    env: {
      RACEUPSHOT: {
        get: vi.fn(async (key: string, type?: string) => {
          const value = state.values.get(key);
          if (value == null) return null;
          return type === "json" ? JSON.parse(value) : value;
        }),
        put: vi.fn(async (key: string, value: string) => {
          state.values.set(key, value);
        }),
      },
    },
  }),
}));

import { saveAthleteTrackingVisibility } from "../lib/athlete-profile";

describe("athlete live-tracking visibility", () => {
  beforeEach(() => state.values.clear());

  it("saves visibility for an imported athlete without a completed profile", async () => {
    const profile = await saveAthleteTrackingVisibility(
      "imported-athlete-1",
      "Athlete@Example.com",
      "ANONYMOUS",
      "Imported Athlete",
    );

    expect(profile).toMatchObject({
      uid: "imported-athlete-1",
      email: "athlete@example.com",
      name: "Imported Athlete",
      trackingVisibility: "ANONYMOUS",
    });
    expect(JSON.parse(state.values.get("raceupshot:athlete-profile:imported-athlete-1") || "{}"))
      .toMatchObject({ trackingVisibility: "ANONYMOUS" });
    expect(state.values.get("raceupshot:athlete-profile-email:athlete@example.com"))
      .toBe("imported-athlete-1");
  });

  it("preserves completed profile details while changing visibility", async () => {
    state.values.set("raceupshot:athlete-profile:athlete-2", JSON.stringify({
      uid: "athlete-2",
      email: "complete@example.com",
      name: "Complete Athlete",
      phoneCountryCode: "+91",
      mobileNumber: "9876543210",
      country: "IN",
      state: "Karnataka",
      city: "Bengaluru",
      photoUrl: "",
      trackingVisibility: "PUBLIC",
      updatedAt: "2026-01-01T00:00:00.000Z",
    }));

    const profile = await saveAthleteTrackingVisibility(
      "athlete-2",
      "complete@example.com",
      "ANONYMOUS",
      "Ignored Name",
    );

    expect(profile).toMatchObject({
      name: "Complete Athlete",
      mobileNumber: "9876543210",
      city: "Bengaluru",
      trackingVisibility: "ANONYMOUS",
    });
  });
});

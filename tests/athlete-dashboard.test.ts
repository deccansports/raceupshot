import { describe, expect, it } from "vitest";
import { athleteDashboardInternals } from "../lib/athlete-dashboard";
import type { FirebaseAthleteIdentity } from "../lib/firebase-auth-server";

const verifiedAthlete: FirebaseAthleteIdentity = {
  uid: "firebase-vaibhav",
  email: "Info@RaceUpshot.com",
  emailVerified: true,
  name: "Vaibhav",
  picture: null,
  signInProvider: "password",
};

describe("athlete dashboard ownership matching", () => {
  it("matches a verified account email without case sensitivity", () => {
    expect(athleteDashboardInternals.belongsToAthlete(
      { registration: { email: "info@raceupshot.com" } },
      verifiedAthlete,
    )).toBe(true);
  });

  it("does not match email for an unverified Firebase account", () => {
    expect(athleteDashboardInternals.belongsToAthlete(
      { email: "info@raceupshot.com" },
      { ...verifiedAthlete, emailVerified: false },
    )).toBe(false);
  });

  it("matches an explicitly linked account UID", () => {
    expect(athleteDashboardInternals.belongsToAthlete(
      { athleteUid: "firebase-vaibhav", participantUid: "provider-123" },
      { ...verifiedAthlete, emailVerified: false },
    )).toBe(true);
  });

  it("does not treat a provider participant ID as an account UID", () => {
    expect(athleteDashboardInternals.belongsToAthlete(
      { id: "firebase-vaibhav", email: "somebody@example.com" },
      verifiedAthlete,
    )).toBe(false);
  });
});

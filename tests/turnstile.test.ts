import { describe, expect, it } from "vitest";
import { isValidContactTurnstileResponse } from "../lib/turnstile";

describe("contact Turnstile verification", () => {
  it("accepts a successful response for the contact action and request hostname", () => {
    expect(isValidContactTurnstileResponse({
      success: true,
      action: "contact_enquiry",
      hostname: "raceupshot.com",
    }, "raceupshot.com")).toBe(true);
  });

  it("rejects responses issued for another action", () => {
    expect(isValidContactTurnstileResponse({
      success: true,
      action: "athlete_login",
      hostname: "raceupshot.com",
    }, "raceupshot.com")).toBe(false);
  });

  it("rejects responses issued for another hostname", () => {
    expect(isValidContactTurnstileResponse({
      success: true,
      action: "contact_enquiry",
      hostname: "example.com",
    }, "raceupshot.com")).toBe(false);
  });

  it("rejects failed verification responses", () => {
    expect(isValidContactTurnstileResponse({
      success: false,
      action: "contact_enquiry",
      hostname: "raceupshot.com",
    }, "raceupshot.com")).toBe(false);
  });
});

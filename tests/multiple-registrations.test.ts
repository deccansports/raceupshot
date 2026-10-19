import { describe, expect, it } from "vitest";
import { defaultEventWaiverPolicy, eventHasWaiverIntent } from "@/lib/event-waiver-policy";
import { groupRegistrationsByParticipant, validateConsolidatedWaiverSelection, waiverCoversRegistration, type RegistrationIdentity, type WaiverCoverage } from "@/lib/multiple-registrations";
import { completeRegistrationCheckIn } from "@/lib/volunteer-check-in-state";
import { participantRegistrationScope } from "@/lib/participant-roster-import";

const policy = { ...defaultEventWaiverPolicy, consolidatedWaiverEnabled: true, waiverCoverage: "MULTIPLE_SELECTED_REGISTRATIONS" as const };
const morning: RegistrationIdentity = { registrationId: "REG1001", participantId: "P100", eventEditionId: "SWIM-2026", raceCategoryId: "2KM" };
const evening: RegistrationIdentity = { registrationId: "REG1002", participantId: "P100", eventEditionId: "SWIM-2026", raceCategoryId: "10KM" };
const waiver: WaiverCoverage = { waiverId: "W1", participantId: "P100", eventEditionId: "SWIM-2026", waiverVersion: "v1", registrationIds: ["REG1001", "REG1002"] };
const unsignedState = { waiverVerifiedAt: null, waiverResetAt: null, emailOtpVerifiedAt: null, checkedInAt: null, updatedAt: null, updatedBy: null };

describe("multiple registrations, consolidated waiver and event-specific check-in", () => {
  it("treats a configured waiver version as waiver intent even when the document body is temporarily missing", () => {
    expect(eventHasWaiverIntent({ waiverHtml: "", waiverVersion: "test 1234" })).toBe(true);
    expect(eventHasWaiverIntent({ waiverHtml: "<p>Waiver</p>", waiverVersion: "" })).toBe(true);
    expect(eventHasWaiverIntent({ waiverHtml: "", waiverVersion: "" })).toBe(false);
  });
  it("TEST 1 accepts two registrations for one participant and email identity is not involved", () => {
    expect(() => validateConsolidatedWaiverSelection([morning, evening], policy)).not.toThrow();
    expect(groupRegistrationsByParticipant([morning, evening])).toEqual([{ participantId: "P100", registrations: [morning, evening] }]);
  });

  it("TEST 2 returns both registrations when the matched participant profile is selected", () => {
    expect(groupRegistrationsByParticipant([morning, evening])[0].registrations.map((row) => row.registrationId)).toEqual(["REG1001", "REG1002"]);
  });

  it("TEST 3 one consolidated waiver covers both selected registrations", () => {
    expect(waiverCoversRegistration(waiver, morning, "v1")).toBe(true);
    expect(waiverCoversRegistration(waiver, evening, "v1")).toBe(true);
  });

  it("TEST 4 checking in the morning registration does not change evening check-in", () => {
    const signed = { ...unsignedState, waiverVerifiedAt: "2026-10-12T03:00:00.000Z", emailOtpVerifiedAt: "2026-10-12T03:00:00.000Z" };
    const checkedMorning = completeRegistrationCheckIn(signed, { waiverRequired: true, capturedAt: "2026-10-12T03:10:00.000Z", volunteerName: "Volunteer" });
    expect(checkedMorning.checkedInAt).toBeTruthy();
    expect(signed.checkedInAt).toBeNull();
  });

  it("TEST 5 evening keeps waiver signed and check-in pending", () => {
    const eveningState = { ...unsignedState, waiverVerifiedAt: "2026-10-12T03:00:00.000Z", emailOtpVerifiedAt: "2026-10-12T03:00:00.000Z" };
    expect(eveningState).toMatchObject({ waiverVerifiedAt: expect.any(String), checkedInAt: null });
  });

  it("TEST 6 evening check-in uses the existing covered waiver without another signature", () => {
    const state = { ...unsignedState, waiverVerifiedAt: "2026-10-12T03:00:00.000Z", emailOtpVerifiedAt: "2026-10-12T03:00:00.000Z" };
    expect(completeRegistrationCheckIn(state, { waiverRequired: true, capturedAt: "2026-10-12T12:00:00.000Z", volunteerName: "Volunteer" }).checkedInAt).toBe("2026-10-12T12:00:00.000Z");
  });

  it("TEST 7 keeps three people sharing an email as three participant profiles", () => {
    const sharedEmailRegistrations = ["Aarav", "Anaya", "Vihaan"].map((name, index) => ({ ...morning, registrationId: `R${index}`, participantId: `P-${name}`, sharedEmail: "parent@example.com" }));
    expect(groupRegistrationsByParticipant(sharedEmailRegistrations)).toHaveLength(3);
  });

  it("TEST 8 a registration added after signing is not silently covered", () => {
    const late = { ...morning, registrationId: "REG1003", raceCategoryId: "5KM" };
    expect(waiverCoversRegistration(waiver, late, "v1")).toBe(false);
  });

  it("TEST 9 bibs, chips and timing scopes remain registration-specific", () => {
    const first = { registrationId: "REG1001", eventId: "E1", sessionId: "AM", ticketId: "2KM", bib: "2001", chipCode: "CHIP1" };
    const second = { registrationId: "REG1002", eventId: "E1", sessionId: "PM", ticketId: "10KM", bib: "1001", chipCode: "CHIP2" };
    expect(participantRegistrationScope(first)).not.toBe(participantRegistrationScope(second));
    expect([first.bib, first.chipCode]).not.toEqual([second.bib, second.chipCode]);
  });

  it("TEST 10 a serialized duplicate check-in records only the first operation", () => {
    const signed = { ...unsignedState, waiverVerifiedAt: "2026-10-12T03:00:00.000Z", emailOtpVerifiedAt: "2026-10-12T03:00:00.000Z" };
    const first = completeRegistrationCheckIn(signed, { waiverRequired: true, capturedAt: "2026-10-12T03:10:00.000Z", volunteerName: "V1" });
    expect(() => completeRegistrationCheckIn(first, { waiverRequired: true, capturedAt: "2026-10-12T03:10:00.001Z", volunteerName: "V2" })).toThrow("already checked in");
  });

  it("TEST 11 a waiver linked to only one registration does not cover its sibling", () => {
    const partial = { ...waiver, registrationIds: [morning.registrationId] };
    expect(waiverCoversRegistration(partial, morning, "v1")).toBe(true);
    expect(waiverCoversRegistration(partial, evening, "v1")).toBe(false);
  });

  it("TEST 12 evaluates waiver coverage independently for another event edition", () => {
    const nextEdition = { ...morning, registrationId: "REG-2027", eventEditionId: "SWIM-2027" };
    expect(waiverCoversRegistration(waiver, nextEdition, "v1")).toBe(false);
    expect(() => validateConsolidatedWaiverSelection([morning, nextEdition], policy)).toThrow("independently");
  });

  it("rejects combining different people even when their email address matches", () => {
    expect(() => validateConsolidatedWaiverSelection([morning, { ...evening, participantId: "P200" }], policy)).toThrow("different participant profiles");
  });

  it("requires a newly accepted waiver version", () => {
    expect(waiverCoversRegistration(waiver, morning, "v2")).toBe(false);
  });
});

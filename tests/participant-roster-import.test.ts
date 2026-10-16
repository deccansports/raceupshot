import type { KVNamespace } from "@cloudflare/workers-types";
import { describe, expect, it } from "vitest";

import { applyParticipantRosterImport, deleteImportedParticipants, editImportedParticipant, expandRelayTeamUploadRows, importParticipantRoster, mergeImportedParticipantRows, mergeRegistrationDataIntoProviderParticipants, suggestParticipantTicket, updateParticipantRosterRegistration } from "@/lib/participant-roster-import";

function memoryKv(initial: Record<string, unknown> = {}) {
  const values = new Map(Object.entries(initial));
  const kv = {
    get: async (key: string) => values.get(key) ?? null,
    put: async (key: string, value: string) => {
      try { values.set(key, JSON.parse(value)); }
      catch { values.set(key, value); }
    },
  } as unknown as KVNamespace;
  return { kv, values };
}

describe("participant roster imports", () => {
  it("imports the Sprint sheet's optional BIB, shirt, age and medical columns without publishing medical disclosures", async () => {
    const eventId = "sprint-event";
    const { kv, values } = memoryKv();
    await importParticipantRoster({
      kv, eventId, fileName: "sprint tri.xlsx",
      rows: [{ "BIB Number": "2001", Name: "Athlete Full Name", "Name on bib": "PRINT NAME", CONTEST: "SPRINT TRIATHLON", Age: "27", "T-Shirt": "L", "Medical History": "Private history", "Medical Condition": "Private condition", "Travel Preference": "Bus" }],
      mappings: { bib: "BIB Number", name: "Name", nameOnBib: "Name on bib", category: "CONTEST", age: "Age", tshirtSize: "T-Shirt", medicalHistory: "Medical History", medicalCondition: "Medical Condition" },
      categoryMappings: { "SPRINT TRIATHLON": "sprint" },
      eventTickets: [{ id: "sprint", name: "Sprint Triathlon" }],
      replaceExisting: true, importedBy: "admin",
    });
    const stored = values.get(`raceupshot:live:event:${eventId}:participant-roster-import`) as { rows: Array<Record<string, unknown>> };
    const feed = values.get(`raceupshot:live:event:${eventId}:participants`) as { participants: Array<Record<string, unknown>> };
    expect(stored.rows[0]).toMatchObject({ bib: "2001", name: "Athlete Full Name", nameOnBib: "PRINT NAME", age: "27", tshirtSize: "L", medicalHistory: "Private history", medicalCondition: "Private condition" });
    expect(stored.rows[0].uploadedFields).toEqual({ "BIB Number": "2001", Name: "Athlete Full Name", "Name on bib": "PRINT NAME", CONTEST: "SPRINT TRIATHLON", Age: "27", "T-Shirt": "L", "Medical History": "Private history", "Medical Condition": "Private condition", "Travel Preference": "Bus" });
    expect(feed.participants[0]).toMatchObject({ bib: "2001", nameOnBib: "PRINT NAME", tshirtSize: "L" });
    expect(feed.participants[0]).not.toHaveProperty("medicalHistory");
    expect(feed.participants[0]).not.toHaveProperty("medicalCondition");
    expect(feed.participants[0]).not.toHaveProperty("uploadedFields");
    expect(feed.participants[0]).not.toHaveProperty("uploadedFieldMappings");
  });
  it("imports an individual placeholder with only a BIB and maps optional medical contact fields", async () => {
    const eventId = "placeholder-event";
    const { kv, values } = memoryKv();
    const summary = await importParticipantRoster({
      kv,
      eventId,
      fileName: "placeholders.csv",
      rows: [
        { Bib: "3178", Category: "Sprint Triathlon" },
        { Bib: "3179", Category: "Sprint Triathlon", EmergencyName: "Parent", EmergencyNumber: "+919999999999", DOB: "1997-05-04", Blood: "O+" },
      ],
      mappings: {
        bib: "Bib",
        category: "Category",
        emergencyContactName: "EmergencyName",
        emergencyContact: "EmergencyNumber",
        dateOfBirth: "DOB",
        bloodGroup: "Blood",
      },
      categoryMappings: { "Sprint Triathlon": "sprint" },
      eventTickets: [{ id: "sprint", name: "Sprint Triathlon", participationMode: "INDIVIDUAL" }],
      replaceExisting: false,
      importedBy: "admin",
    });

    expect(summary).toMatchObject({ imported: 2, created: 2 });
    const saved = values.get(`raceupshot:live:event:${eventId}:participant-roster-import`) as { rows: Array<Record<string, unknown>> };
    expect(saved.rows[0]).toMatchObject({ bib: "3178", participantUid: `import:${eventId}:3178` });
    expect(saved.rows[0]).not.toHaveProperty("name");
    expect(saved.rows[1]).toMatchObject({
      bib: "3179",
      emergencyContactName: "Parent",
      emergencyContact: "+919999999999",
      dateOfBirth: "1997-05-04",
      dob: "1997-05-04",
      bloodGroup: "O+",
    });
  });

  it("creates a new registration identity when a reused BIB belongs to a different athlete", async () => {
    const eventId = "reused-bib-event";
    const { kv, values } = memoryKv();
    const common = {
      kv, eventId, fileName: "participants.csv", mappings: { bib: "Bib", name: "Name", email: "Email" },
      replaceExisting: false, importedBy: "admin",
    };
    await importParticipantRoster({ ...common, rows: [{ Bib: "1003", Name: "Aman Singh", Email: "aman@example.com" }] });
    const first = values.get(`raceupshot:live:event:${eventId}:participant-roster-import`) as { rows: Array<Record<string, unknown>> };
    const firstId = String(first.rows[0].participantUid);

    await importParticipantRoster({ ...common, rows: [{ Bib: "1003", Name: "Himanshi Goel", Email: "himanshi@example.com" }] });
    const second = values.get(`raceupshot:live:event:${eventId}:participant-roster-import`) as { rows: Array<Record<string, unknown>> };
    const feed = values.get(`raceupshot:live:event:${eventId}:participants`) as { participants: Array<Record<string, unknown>> };
    expect(second.rows).toHaveLength(1);
    expect(second.rows[0]).toMatchObject({ bib: "1003", name: "Himanshi Goel", waiverStatus: null });
    expect(second.rows[0].participantUid).not.toBe(firstId);
    expect(feed.participants).toHaveLength(1);
    expect(feed.participants[0].participantUid).toBe(second.rows[0].participantUid);
  });

  it("enriches a Feibot athlete without replacing provider identity or chip code", () => {
    const [merged] = mergeRegistrationDataIntoProviderParticipants(
      [{ participantUid: "feibot-1", providerParticipantUuid: "feibot-1", bib: "1001", chipCode: "FEIBOT-99", fullName: "Provider Name", contestName: "TRIATHLON" }],
      [{ participantUid: "import:event:1001", bib: "1001", chipCode: "UPLOAD-11", fullName: "Uploaded Name", email: "athlete@example.com", athleteBandCode: "BAND-1" }],
    );
    expect(merged).toMatchObject({
      participantUid: "feibot-1", providerParticipantUuid: "feibot-1", bib: "1001",
      chipCode: "FEIBOT-99", fullName: "Provider Name", contestName: "TRIATHLON",
      email: "athlete@example.com", athleteBandCode: "BAND-1",
    });
  });

  it("edits an uploaded registration without modifying published results", async () => {
    const eventId = "edit-event";
    const importKey = `raceupshot:live:event:${eventId}:participant-roster-import`;
    const feedKey = `raceupshot:live:event:${eventId}:participants`;
    const row = { participantUid: "import:edit-event:1001", bib: "1001", name: "Old Name", email: "old@example.com", rosterImportSource: "ADMIN_UPLOAD", ticketId: "ticket-a", ticketName: "Race A", uploadedFields: { "Email Address": "old@example.com", "Custom Note": "Before" }, uploadedFieldMappings: { email: "Email Address" } };
    const result = { participantUid: "result-1001", bib: "1001", name: "Official Name", publishedResultSource: "PUBLISHED_RESULTS" };
    const { kv, values } = memoryKv({ [importKey]: { schemaVersion: 1, eventId, fileName: "a.csv", importedAt: "", importedBy: "admin", rows: [row] }, [feedKey]: { participants: [row, result] } });
    await editImportedParticipant({ kv, eventId, participantId: row.participantUid, changedBy: "admin", edit: { bib: "1002", name: "New Name", email: "new@example.com", mobile: "123", registrationStatus: "Active", gender: "F", ageGroup: "31-40", club: "Club", tshirtSize: "M", dateOfBirth: "1990-10-11", bloodGroup: "O+", emergencyContactName: "Parent", emergencyContact: "+919999999999", address: "1 Main Road", city: "Pune", state: "Maharashtra", country: "India", pincode: "411001", amountPaid: "2500", transactionId: "TX-1", uploadedFields: { "Email Address": "ignored@example.com", "Custom Note": "After" }, ticketId: "ticket-a", ticketName: "Race A" } });
    expect((values.get(importKey) as { rows: Array<Record<string, unknown>> }).rows[0]).toMatchObject({ bib: "1002", name: "New Name", email: "new@example.com", dateOfBirth: "1990-10-11", bloodGroup: "O+", emergencyContactName: "Parent", emergencyContact: "+919999999999", city: "Pune", amountPaid: "2500", transactionId: "TX-1", uploadedFields: { "Email Address": "new@example.com", "Custom Note": "After" } });
    expect((values.get(feedKey) as { participants: Array<Record<string, unknown>> }).participants[0]).not.toHaveProperty("uploadedFields");
    expect((values.get(feedKey) as { participants: Array<Record<string, unknown>> }).participants[1]).toEqual(result);
  });

  it("requires an exact deletion count and preserves official result rows", async () => {
    const eventId = "delete-event";
    const importKey = `raceupshot:live:event:${eventId}:participant-roster-import`;
    const feedKey = `raceupshot:live:event:${eventId}:participants`;
    const row = { participantUid: "import:delete-event:1001", bib: "1001", rosterImportSource: "ADMIN_UPLOAD" };
    const result = { participantUid: "result-1001", bib: "1001", publishedResultSource: "PUBLISHED_RESULTS" };
    const { kv, values } = memoryKv({ [importKey]: { schemaVersion: 1, eventId, fileName: "a.csv", importedAt: "", importedBy: "admin", rows: [row] }, [feedKey]: { participants: [row, result] } });
    await expect(deleteImportedParticipants({ kv, eventId, participantIds: [row.participantUid], expectedCount: 2 })).rejects.toThrow("roster has changed");
    await deleteImportedParticipants({ kv, eventId, participantIds: [row.participantUid], expectedCount: 1 });
    expect((values.get(importKey) as { rows: unknown[] }).rows).toHaveLength(0);
    expect((values.get(feedKey) as { participants: unknown[] }).participants).toEqual([result]);
  });
  it("suggests only an unambiguous event ticket", () => {
    expect(suggestParticipantTicket("Bergman 102 Triathlon", ["BERGMAN 102 TRIATHLON", "BERGMAN OLYMPIC TRIATHLON"])).toBe("BERGMAN 102 TRIATHLON");
    expect(suggestParticipantTicket("Triathlon 113 - Team Relay", ["Triathlon 113 Relay", "Sprint Triathlon"])).toBe("Triathlon 113 Relay");
    expect(suggestParticipantTicket("Swimathon", ["SWIMATHON 1 KM", "SWIMATHON 2 KM"])).toBe("");
  });

  it("maps roster categories to tickets without changing published results", async () => {
    const eventId = "event-tickets";
    const { kv, values } = memoryKv();
    await importParticipantRoster({
      kv, eventId, fileName: "roster.csv",
      rows: [{ Bib: "1001", Name: "Viraj Mahajan", Category: "Bergman 102 Triathlon" }],
      mappings: { bib: "Bib", name: "Name", category: "Category" },
      categoryMappings: { "Bergman 102 Triathlon": "ticket-102" },
      eventTickets: [{ id: "ticket-102", name: "BERGMAN 102 TRIATHLON" }, { id: "ticket-olympic", name: "BERGMAN OLYMPIC TRIATHLON" }],
      replaceExisting: false, importedBy: "admin",
    });
    const saved = values.get(`raceupshot:live:event:${eventId}:participants`) as { participants: Array<Record<string, unknown>> };
    expect(saved.participants[0]).toMatchObject({ bib: "1001", category: "Bergman 102 Triathlon", sourceCategory: "Bergman 102 Triathlon", ticketId: "ticket-102", ticketName: "BERGMAN 102 TRIATHLON" });
    expect([...values.keys()].some((key) => key.includes(":result:"))).toBe(false);
  });

  it("rejects an unmapped roster category before writing", async () => {
    const { kv, values } = memoryKv();
    await expect(importParticipantRoster({
      kv, eventId: "event-tickets", fileName: "roster.csv",
      rows: [{ Bib: "1001", Name: "Viraj Mahajan", Category: "Unknown race" }],
      mappings: { bib: "Bib", name: "Name", category: "Category" },
      categoryMappings: {}, eventTickets: ["BERGMAN 102 TRIATHLON", "BERGMAN OLYMPIC TRIATHLON"],
      replaceExisting: false, importedBy: "admin",
    })).rejects.toThrow("map category");
    expect(values.has("raceupshot:live:event:event-tickets:participants")).toBe(false);
  });

  it("does not copy a matching published result identity or finish status into the uploaded roster", async () => {
    const eventId = "event-separate";
    const { kv, values } = memoryKv({
      [`raceupshot:live:event:${eventId}:participants`]: { participants: [{ participantUid: "result-1001", bib: "1001", email: "result@example.com", status: "FINISHED", publishedResultSource: "PUBLISHED_RESULTS" }] },
    });
    await importParticipantRoster({
      kv, eventId, fileName: "registrations.csv",
      rows: [{ Bib: "1001", Name: "Viraj Mahajan", Email: "registration@example.com", Registration: "Active" }],
      mappings: { bib: "Bib", name: "Name", email: "Email", registrationStatus: "Registration" },
      replaceExisting: false, importedBy: "admin",
    });
    const saved = values.get(`raceupshot:live:event:${eventId}:participant-roster-import`) as { rows: Array<Record<string, unknown>> };
    expect(saved.rows[0]).toMatchObject({ participantUid: `import:${eventId}:1001`, email: "registration@example.com", registrationStatus: "Active" });
    expect(saved.rows[0]).not.toHaveProperty("status");
    expect(saved.rows[0]).not.toHaveProperty("publishedResultSource");
  });

  it("replaces a legacy result-contaminated upload with a new registration identity", async () => {
    const eventId = "event-legacy";
    const { kv, values } = memoryKv({
      [`raceupshot:live:event:${eventId}:participant-roster-import`]: {
        schemaVersion: 1, eventId, fileName: "old.csv", importedAt: "2026-10-06T00:00:00.000Z", importedBy: "admin",
        rows: [{ participantUid: "result-1001", bib: "1001", email: "result@example.com", status: "FINISHED", publishedResultSource: "PUBLISHED_RESULTS", rosterImportSource: "ADMIN_UPLOAD" }],
      },
    });
    await importParticipantRoster({
      kv, eventId, fileName: "clean.csv", rows: [{ Bib: "1001", Name: "Viraj Mahajan", Email: "registered@example.com" }],
      mappings: { bib: "Bib", name: "Name", email: "Email" }, replaceExisting: false, importedBy: "admin",
    });
    const saved = values.get(`raceupshot:live:event:${eventId}:participant-roster-import`) as { rows: Array<Record<string, unknown>> };
    expect(saved.rows[0]).toMatchObject({ participantUid: `import:${eventId}:1001`, email: "registered@example.com" });
    expect(saved.rows[0]).not.toHaveProperty("publishedResultSource");
    expect(saved.rows[0]).not.toHaveProperty("status");
  });

  it("keeps the provider chip isolated from registration import while linking the athlete band by event BIB", async () => {
    const eventId = "event-a";
    const feedKey = `raceupshot:live:event:${eventId}:participants`;
    const { kv, values } = memoryKv({
      [feedKey]: { participants: [{ participantUid: "provider-1510", bib: "1510", name: "Old Name", chipCode: "OLD" }] },
    });

    const summary = await importParticipantRoster({
      kv,
      eventId,
      fileName: "participants.xlsx",
      rows: [{ BIB: "1510", Name: "Wahid Pathan", Chip: "10960", Band: "BMA1510" }],
      mappings: { bib: "BIB", name: "Name", chipCode: "Chip", athleteBandCode: "Band" },
      replaceExisting: false,
      importedBy: "admin@raceupshot.com",
    });

    expect(summary).toMatchObject({ imported: 1, created: 0, updated: 1, chipCodesAssigned: 0, athleteBandsAssigned: 1 });
    expect((values.get(feedKey) as { participants: Array<Record<string, unknown>> }).participants[0]).toMatchObject({
      participantUid: "provider-1510",
      bib: "1510",
      name: "Wahid Pathan",
      chipCode: "OLD",
      athleteBandCode: "BMA1510",
    });
  });

  it("reapplies uploaded identifiers after a provider refresh", async () => {
    const eventId = "event-b";
    const { kv } = memoryKv({
      [`raceupshot:live:event:${eventId}:participant-roster-import`]: {
        schemaVersion: 1,
        eventId,
        fileName: "participants.csv",
        importedAt: "2026-10-07T00:00:00.000Z",
        importedBy: "admin@raceupshot.com",
        rows: [{ participantUid: "old-provider-id", bib: "42", chipCode: "CHIP42", athleteBandCode: "BAND42" }],
      },
    });
    const refreshed = await applyParticipantRosterImport(kv, eventId, [{ participantUid: "new-provider-id", bib: "42", name: "Athlete" }]);
    expect(refreshed[0]).toMatchObject({ participantUid: "new-provider-id", bib: "42", athleteBandCode: "BAND42" });
    expect(refreshed[0]).not.toHaveProperty("chipCode");
  });

  it("keeps imported athletes that are not yet present in the timing-provider roster", () => {
    expect(mergeImportedParticipantRows(
      [{ participantUid: "provider-1", bib: "1" }],
      [{ participantUid: "import:event:2", bib: "2", name: "Second Athlete" }],
    )).toHaveLength(2);
  });

  it("stores signed-waiver fields on both exact registration roster copies", async () => {
    const eventId = "event-waiver";
    const importKey = `raceupshot:live:event:${eventId}:participant-roster-import`;
    const feedKey = `raceupshot:live:event:${eventId}:participants`;
    const row = { participantUid: "participant-1001", bib: "1001", email: "athlete@example.com", rosterImportSource: "ADMIN_UPLOAD" };
    const { kv, values } = memoryKv({
      [importKey]: { schemaVersion: 1, eventId, fileName: "participants.csv", rows: [row], importedAt: "2026-10-08T00:00:00.000Z", importedBy: "admin" },
      [feedKey]: { participants: [row] },
    });
    await updateParticipantRosterRegistration({
      kv, eventId, participantId: "participant-1001",
      patch: { waiverStatus: "SIGNED", waiverDocumentUrl: "https://raceupshot.com/api/v1/waivers/document?key=x", waiverAuditId: "audit-1" },
    });
    const imported = values.get(importKey) as { rows: Array<Record<string, unknown>> };
    const feed = values.get(feedKey) as { participants: Array<Record<string, unknown>> };
    expect(imported.rows[0]).toMatchObject({ participantUid: "participant-1001", waiverStatus: "SIGNED", waiverAuditId: "audit-1" });
    expect(feed.participants[0]).toMatchObject({ participantUid: "participant-1001", waiverStatus: "SIGNED", waiverAuditId: "audit-1" });
  });

  it("rejects duplicate athlete bands before writing the event roster", async () => {
    const { kv } = memoryKv();
    await expect(importParticipantRoster({
      kv,
      eventId: "event-c",
      fileName: "participants.csv",
      rows: [
        { BIB: "1", Name: "One", Band: "BAND-X" },
        { BIB: "2", Name: "Two", Band: "BAND-X" },
      ],
      mappings: { bib: "BIB", name: "Name", athleteBandCode: "Band" },
      replaceExisting: false,
      importedBy: "admin@raceupshot.com",
    })).rejects.toThrow("Athlete Band Code BAND-X is assigned to more than one participant");
  });

  it("imports a three-person relay under one shared BIB with separate identities and bands", async () => {
    const eventId = "relay-event";
    const { kv, values } = memoryKv();
    await importParticipantRoster({
      kv,
      eventId,
      fileName: "relay.csv",
      rows: [
        { BIB: "1501", Name: "Athlete One", Email: "one@example.com", Category: "Relay", Team: "Bergman Relay A", Member: "1", Band: "BAND-1001" },
        { BIB: "1501", Name: "Athlete Two", Email: "two@example.com", Category: "Relay", Team: "Bergman Relay A", Member: "2", Band: "BAND-1002" },
        { BIB: "1501", Name: "Athlete Three", Email: "three@example.com", Category: "Relay", Team: "Bergman Relay A", Member: "3", Band: "BAND-1003" },
      ],
      mappings: { bib: "BIB", name: "Name", email: "Email", category: "Category", relayTeamName: "Team", relayMemberNumber: "Member", athleteBandCode: "Band" },
      categoryMappings: { Relay: "relay-ticket" },
      eventTickets: [{ id: "relay-ticket", name: "Relay", participationMode: "RELAY", relayTeamSize: 3 }],
      replaceExisting: false,
      importedBy: "admin",
    });
    const saved = values.get(`raceupshot:live:event:${eventId}:participant-roster-import`) as { rows: Array<Record<string, unknown>> };
    expect(saved.rows).toHaveLength(3);
    expect(new Set(saved.rows.map((row) => row.participantUid)).size).toBe(3);
    expect(new Set(saved.rows.map((row) => row.bib))).toEqual(new Set(["1501"]));
    expect(saved.rows.map((row) => row.athleteBandCode)).toEqual(["BAND-1001", "BAND-1002", "BAND-1003"]);
  });

  it("infers a relay from uploaded team fields when the mapped ticket is incorrectly marked individual", async () => {
    const eventId = "relay-inferred-event";
    const { kv, values } = memoryKv();
    await importParticipantRoster({
      kv,
      eventId,
      fileName: "relay.xlsx",
      rows: [
        { BIB: "6001", Name: "Captain", Email: "captain@example.com", Category: "Relay", Team: "JUNGLEBULLS", Member: "1", Shirt: "L" },
        { BIB: "6001", Name: "Runner", Email: "runner@example.com", Category: "Relay", Team: "JUNGLEBULLS", Member: "2", Shirt: "M" },
        { BIB: "6001", Name: "Cyclist", Email: "cyclist@example.com", Category: "Relay", Team: "JUNGLEBULLS", Member: "3", Shirt: "S" },
      ],
      mappings: { bib: "BIB", name: "Name", email: "Email", category: "Category", relayTeamName: "Team", relayMemberNumber: "Member", tshirtSize: "Shirt" },
      categoryMappings: { Relay: "relay-ticket" },
      eventTickets: [{ id: "relay-ticket", name: "Triathlon 113 Relay", participationMode: "INDIVIDUAL", relayTeamSize: null }],
      replaceExisting: false,
      importedBy: "admin",
    });
    const saved = values.get(`raceupshot:live:event:${eventId}:participant-roster-import`) as { rows: Array<Record<string, unknown>> };
    expect(saved.rows).toHaveLength(3);
    expect(saved.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ bib: "6001", participationMode: "RELAY", relayTeamSize: 3, relayTeamName: "JUNGLEBULLS", tshirtSize: "L" }),
      expect.objectContaining({ bib: "6001", participationMode: "RELAY", relayTeamSize: 3, relayTeamName: "JUNGLEBULLS", tshirtSize: "M" }),
      expect.objectContaining({ bib: "6001", participationMode: "RELAY", relayTeamSize: 3, relayTeamName: "JUNGLEBULLS", tshirtSize: "S" }),
    ]));
  });

  it("rejects an incomplete relay team", async () => {
    const { kv } = memoryKv();
    await expect(importParticipantRoster({
      kv,
      eventId: "relay-event",
      fileName: "relay.csv",
      rows: [
        { BIB: "1501", Name: "Athlete One", Email: "one@example.com", Category: "Relay", Team: "Relay A", Member: "1" },
        { BIB: "1501", Name: "Athlete Two", Email: "two@example.com", Category: "Relay", Team: "Relay A", Member: "2" },
      ],
      mappings: { bib: "BIB", name: "Name", email: "Email", category: "Category", relayTeamName: "Team", relayMemberNumber: "Member" },
      categoryMappings: { Relay: "relay-ticket" },
      eventTickets: [{ id: "relay-ticket", name: "Relay", participationMode: "RELAY", relayTeamSize: 3 }],
      replaceExisting: false,
      importedBy: "admin",
    })).rejects.toThrow("must contain exactly 3");
  });

  it("expands a wide relay team spreadsheet row into separate athlete records", () => {
    expect(expandRelayTeamUploadRows([{
      "Contest Name": "Relay Triathlon", "Contest Type": "Relay - 3 Athletes", "Team Name": "Team A", "Team Bib Number": "1501",
      "Athlete 1 Name": "Rahul", "Athlete 1 Email": "rahul@example.com", "Athlete 1 Role": "Swimming",
      "Athlete 2 Name": "Amit", "Athlete 2 Email": "amit@example.com", "Athlete 2 Role": "Cycling",
      "Athlete 3 Name": "Rohit", "Athlete 3 Email": "rohit@example.com", "Athlete 3 Role": "Running",
    }])).toMatchObject([
      { "BIB Number": "1501", "Athlete Name": "Rahul", Email: "rahul@example.com", "Relay Team Name": "Team A", "Relay Member Number": 1 },
      { "BIB Number": "1501", "Athlete Name": "Amit", Email: "amit@example.com", "Relay Team Name": "Team A", "Relay Member Number": 2 },
      { "BIB Number": "1501", "Athlete Name": "Rohit", Email: "rohit@example.com", "Relay Team Name": "Team A", "Relay Member Number": 3 },
    ]);
  });

  it("expands a relay captain and numbered participants with their full details", () => {
    expect(expandRelayTeamUploadRows([{
      "BIB Number": "6001", "Team Name": "Team 1", "Group Name": "JUNGLEBULLS", "Name on bib": "SUNILKUMAR MUNIREDDY",
      "Registration Number": "UT11326-000549", "Race Category": "Triathlon 113 - Team Relay", Name: "Sunilkumar Munireddy",
      Gender: "Male", Email: "sunilkumar.ym13@gmail.com", "Mobile Number": "919590526336", "Birth Date": "1993-05-13",
      Age: "34", "Age Category": "N/A", "T-Shirt": "L", "Blood Group": "O+", "Medical History": "NA",
      "Emergency Contact Name": "Raju", "Emergency Contact Number": "919686868047", "Registration Status": "REGISTRATION CONFIRMED",
      "Participant 1": "ANANDAKUMAR B", "Participant Email 1": "bala.anand.k@gmail.com", "Participant Contact 1": "663866118",
      "Participant Gender 1": "Male", "Participant DOB 1": "18/5/1985", "Participant T-shirt 1": "L", "Participant Category 1": "Run",
      "Participant 2": "MUBEEN", "Participant Email 2": "mubyjin4@gmail.com", "Participant Contact 2": "8110032326",
      "Participant Gender 2": "Male", "Participant DOB 2": "1991-04-03T18:30:00.000Z", "Participant T-shirt 2": "M", "Participant Category 2": "Cycling",
    }])).toMatchObject([
      { "BIB Number": "6001", "Athlete Name": "Sunilkumar Munireddy", Email: "sunilkumar.ym13@gmail.com", Mobile: "919590526336", Gender: "Male", "Date of Birth": "1993-05-13", "T-Shirt Size": "L", "Relay Team Name": "JUNGLEBULLS", "Relay Member Number": 1, "Relay Member Role": "swim" },
      { "BIB Number": "6001", "Athlete Name": "ANANDAKUMAR B", Email: "bala.anand.k@gmail.com", Mobile: "663866118", Gender: "Male", "Date of Birth": "18/5/1985", "T-Shirt Size": "L", "Relay Team Name": "JUNGLEBULLS", "Relay Member Number": 2, "Relay Member Role": "Run" },
      { "BIB Number": "6001", "Athlete Name": "MUBEEN", Email: "mubyjin4@gmail.com", Mobile: "8110032326", Gender: "Male", "Date of Birth": "1991-04-03T18:30:00.000Z", "T-Shirt Size": "M", "Relay Team Name": "JUNGLEBULLS", "Relay Member Number": 3, "Relay Member Role": "Cycling" },
    ]);
    const expanded = expandRelayTeamUploadRows([{
      "BIB Number": "6001", Name: "Captain", "Name on bib": "CAPTAIN", "Registration Number": "REG-1", Email: "captain@example.com", "Mobile Number": "111", Age: "40",
      "Participant 1": "Runner", "Participant Email 1": "runner@example.com", "Participant Contact 1": "222", "Participant Category 1": "Run",
      "Participant 2": "Cyclist", "Participant Email 2": "cyclist@example.com", "Participant Contact 2": "333", "Participant Category 2": "Cycling",
    }]);
    expect(expanded[1]).toMatchObject({ Name: "Runner", "Name on bib": "", "Registration Number": "", Email: "runner@example.com", "Mobile Number": "222", Age: "", "Athlete Name": "Runner" });
    expect(expanded[2]).toMatchObject({ Name: "Cyclist", "Name on bib": "", "Registration Number": "", Email: "cyclist@example.com", "Mobile Number": "333", Age: "", "Athlete Name": "Cyclist" });
  });

  it("invalidates only the edited athlete waiver when their identity changes", async () => {
    const eventId = "relay-edit";
    const importKey = `raceupshot:live:event:${eventId}:participant-roster-import`;
    const feedKey = `raceupshot:live:event:${eventId}:participants`;
    const row = { participantUid: "member-1", bib: "1501", name: "Old Name", email: "old@example.com", rosterImportSource: "ADMIN_UPLOAD", participationMode: "RELAY", relayTeamId: "team-a", waiverStatus: "SIGNED", waiverSignedAt: "2026-10-01T00:00:00.000Z", waiverDocumentUrl: "https://example.com/waiver.pdf" };
    const { kv, values } = memoryKv({ [importKey]: { schemaVersion: 1, eventId, fileName: "relay.csv", importedAt: "", importedBy: "admin", rows: [row] }, [feedKey]: { participants: [row] } });
    await editImportedParticipant({ kv, eventId, participantId: "member-1", changedBy: "admin", edit: { bib: "1501", name: "New Name", email: "new@example.com", mobile: "", registrationStatus: "REGISTERED", gender: "", ageGroup: "", club: "", tshirtSize: "", ticketId: "", ticketName: "Relay" } });
    const updated = (values.get(importKey) as { rows: Array<Record<string, unknown>> }).rows[0];
    expect(updated).toMatchObject({ name: "New Name", email: "new@example.com", waiverStatus: null, waiverSignedAt: null, waiverDocumentUrl: null, waiverResetBy: "admin" });
  });

  it("replaces old upload-only rows without deleting provider participants", async () => {
    const eventId = "event-d";
    const feedKey = `raceupshot:live:event:${eventId}:participants`;
    const importKey = `raceupshot:live:event:${eventId}:participant-roster-import`;
    const oldRows = [
      { participantUid: "provider-1", bib: "1", chipCode: "OLD-1", athleteBandCode: "BAND-1" },
      { participantUid: `import:${eventId}:2`, bib: "2", name: "Upload Only" },
    ];
    const { kv, values } = memoryKv({
      [feedKey]: { participants: oldRows },
      [importKey]: { schemaVersion: 1, eventId, fileName: "old.csv", rows: oldRows, importedAt: "2026-10-06T00:00:00.000Z", importedBy: "admin" },
    });
    await importParticipantRoster({
      kv,
      eventId,
      fileName: "new.csv",
      rows: [{ BIB: "3", Name: "New Athlete", Chip: "NEW-3", Band: "BAND-3" }],
      mappings: { bib: "BIB", name: "Name", chipCode: "Chip", athleteBandCode: "Band" },
      replaceExisting: true,
      importedBy: "admin",
    });
    const saved = (values.get(feedKey) as { participants: Array<Record<string, unknown>> }).participants;
    expect(saved.find((row) => row.bib === "1")).toMatchObject({ participantUid: "provider-1", bib: "1" });
    expect(saved.find((row) => row.bib === "1")).toMatchObject({ chipCode: "OLD-1" });
    expect(saved.some((row) => row.bib === "2")).toBe(false);
    expect(saved.find((row) => row.bib === "3")).toMatchObject({ athleteBandCode: "BAND-3" });
    expect(saved.find((row) => row.bib === "3")).not.toHaveProperty("chipCode");
  });

  it("limits a replacement upload to its mapped ticket and snapshots the prior roster", async () => {
    const eventId = "ticket-scoped-replacement";
    const feedKey = `raceupshot:live:event:${eventId}:participants`;
    const importKey = `raceupshot:live:event:${eventId}:participant-roster-import`;
    const individual = { participantUid: "individual-2001", bib: "2001", name: "Individual Athlete", ticketId: "olympic", ticketName: "Olympic Triathlon", sourceCategory: "Olympic Triathlon", rosterImportSource: "ADMIN_UPLOAD" };
    const oldRelay = { participantUid: "old-relay-6001", bib: "6001", name: "Old Relay Athlete", ticketId: "relay", ticketName: "Triathlon 113 Relay", sourceCategory: "Triathlon 113 - Team Relay", rosterImportSource: "ADMIN_UPLOAD" };
    const previous = { schemaVersion: 1, eventId, fileName: "all-participants.xlsx", rows: [individual, oldRelay], importedAt: "2026-10-14T00:00:00.000Z", importedBy: "admin" };
    const { kv, values } = memoryKv({ [feedKey]: { participants: [individual, oldRelay] }, [importKey]: previous });

    await importParticipantRoster({
      kv,
      eventId,
      fileName: "relay-only.xlsx",
      rows: [1, 2, 3].map((member) => ({ BIB: "6002", Name: `Relay ${member}`, Email: `relay${member}@example.com`, Category: "Triathlon 113 - Team Relay", Team: "Team Two", Member: String(member) })),
      mappings: { bib: "BIB", name: "Name", email: "Email", category: "Category", relayTeamName: "Team", relayMemberNumber: "Member" },
      categoryMappings: { "Triathlon 113 - Team Relay": "relay" },
      eventTickets: [
        { id: "olympic", name: "Olympic Triathlon", participationMode: "INDIVIDUAL" },
        { id: "relay", name: "Triathlon 113 Relay", participationMode: "RELAY", relayTeamSize: 3 },
      ],
      replaceExisting: true,
      importedBy: "admin",
    });

    const saved = values.get(importKey) as { rows: Array<Record<string, unknown>> };
    expect(saved.rows).toHaveLength(4);
    expect(saved.rows).toContainEqual(expect.objectContaining({ participantUid: "individual-2001", bib: "2001" }));
    expect(saved.rows.some((row) => row.participantUid === "old-relay-6001")).toBe(false);
    expect((values.get(`${importKey}:backup`) as { fileName: string; rows: unknown[] })).toMatchObject({ fileName: "all-participants.xlsx", rows: [individual, oldRelay] });
  });
});

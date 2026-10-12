import { describe, expect, it } from "vitest";
import { projectVolunteerRosterParticipant } from "@/lib/volunteer-operations";

describe("volunteer participant roster source", () => {
  it("does not turn a published result into a registered athlete", () => {
    expect(projectVolunteerRosterParticipant({ participantUid: "result-1001", bib: "1001", status: "FINISHED", publishedResultSource: "PUBLISHED_RESULTS" })).toBeNull();
    expect(projectVolunteerRosterParticipant({ participantUid: "result-1001", bib: "1001", status: "FINISHED", publishedResultSource: "PUBLISHED_RESULTS", rosterImportSource: "ADMIN_UPLOAD" })).toBeNull();
  });

  it("uses uploaded registration data without adopting a finish status", () => {
    expect(projectVolunteerRosterParticipant({
      participantUid: "import:event:1001", bib: "1001", name: "Viraj Mahajan", email: "registration@example.com",
      registrationStatus: "Active", status: "FINISHED", resultStatus: "FINISHED", rosterImportSource: "ADMIN_UPLOAD",
    })).toMatchObject({
      id: "import:event:1001", name: "Viraj Mahajan", email: "registration@example.com",
      registrationStatus: "Active", raceStatus: "UNKNOWN",
    });
  });

  it("projects relay team and member identity without combining member state", () => {
    expect(projectVolunteerRosterParticipant({
      participantUid: "relay-member-2", bib: "1501", name: "Athlete Two", rosterImportSource: "ADMIN_UPLOAD",
      participationMode: "RELAY", relayTeamId: "relay:event:ticket:1501", relayTeamName: "Bergman Relay A",
      relayTeamSize: 3, relayMemberNumber: 2, relayMemberRole: "Cyclist", athleteBandCode: "BAND-1002",
    })).toMatchObject({
      id: "relay-member-2", bib: "1501", participationMode: "RELAY", relayTeamName: "Bergman Relay A",
      relayTeamSize: 3, relayMemberNumber: 2, relayMemberRole: "Cyclist", athleteBandCode: "BAND-1002",
    });
  });
});

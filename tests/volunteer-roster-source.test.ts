import { describe, expect, it } from "vitest";
import { projectVolunteerRosterParticipant, volunteerParticipantMatchesSearch } from "@/lib/volunteer-operations";

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
      mobile: "919999999999", gender: "Male", dateOfBirth: "1990-01-02", tshirtSize: "L", bloodGroup: "B+",
      emergencyContactName: "Emergency Person", emergencyContact: "918888888888",
    })).toMatchObject({
      id: "relay-member-2", bib: "1501", participationMode: "RELAY", relayTeamName: "Bergman Relay A",
      relayTeamSize: 3, relayMemberNumber: 2, relayMemberRole: "Cyclist", athleteBandCode: "BAND-1002",
      mobile: "919999999999", gender: "Male", dateOfBirth: "1990-01-02", tshirtSize: "L", bloodGroup: "B+",
      emergencyContactName: "Emergency Person", emergencyContact: "918888888888",
    });
  });

  it("matches BIB searches exactly without falling through to another field", () => {
    const participant = projectVolunteerRosterParticipant({
      participantUid: "relay-member-1", bib: "6001", name: "Athlete 60010", email: "6001@example.com",
      rosterImportSource: "ADMIN_UPLOAD",
    });
    expect(participant).not.toBeNull();
    expect(volunteerParticipantMatchesSearch(participant!, "6001", "BIB")).toBe(true);
    expect(volunteerParticipantMatchesSearch(participant!, "600", "BIB")).toBe(false);
    expect(volunteerParticipantMatchesSearch(participant!, "60010", "BIB")).toBe(false);
  });

  it("uses one combined mode for partial name or email searches", () => {
    const participant = projectVolunteerRosterParticipant({
      participantUid: "relay-member-2", bib: "6002", name: "Lavanya Gopal", email: "lavanya.glg@example.com",
      rosterImportSource: "ADMIN_UPLOAD",
    });
    expect(participant).not.toBeNull();
    expect(volunteerParticipantMatchesSearch(participant!, "Gopal", "NAME_EMAIL")).toBe(true);
    expect(volunteerParticipantMatchesSearch(participant!, "glg@", "NAME_EMAIL")).toBe(true);
    expect(volunteerParticipantMatchesSearch(participant!, "6002", "NAME_EMAIL")).toBe(false);
  });
});

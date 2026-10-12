import { describe, expect, it } from "vitest";
import { buildParticipantExportRows, PARTICIPANT_EXPORT_COLUMNS, participantExportCsv } from "@/lib/participant-export";

describe("full participant export", () => {
  it("exports every requested column and always takes ChipCode from Feibot", () => {
    const [row] = buildParticipantExportRows({
      registrationRows: [{
        participantUid: "import:event:1001", bib: "1001", chipCode: "UPLOAD-CHIP", athleteBandCode: "BAND-1",
        name: "Asha Rao", email: "asha@example.com", dob: "1990-10-11", amountPaid: 2500,
      }],
      providerRows: [{ participantUid: "provider-1", bib: "1001", chipCode: "FEIBOT-CHIP" }],
      states: { "import:event:1001": {
        waiverVerifiedAt: "2026-10-09T08:00:00.000Z", waiverResetAt: null, emailOtpVerifiedAt: null,
        checkedInAt: "2026-10-10T04:00:00.000Z", bikeCheckedInAt: "2026-10-10T04:30:00.000Z",
        bikeCheckedOutAt: null, helmetChecked: true, bikeRack: "A-1", medalIssuedAt: null,
        foodIssuedAt: "2026-10-10T10:00:00.000Z", lockerNumber: "L-7", updatedAt: "2026-10-10T10:00:00.000Z", updatedBy: "Volunteer One",
      } },
      eventDate: "2026-10-10",
    });
    expect(Object.keys(row)).toEqual([...PARTICIPANT_EXPORT_COLUMNS]);
    expect(row).toMatchObject({
      "BIB Number": "1001", ChipCode: "FEIBOT-CHIP", "Athlete Band": "BAND-1",
      "Waiver Check-in Status": "Checked in", "Bike Check-in": "2026-10-10T04:30:00.000Z",
      "Helmet Checked": "Yes", "Food Issued": "Yes", Age: "35",
    });
    expect(participantExportCsv([row])).toContain('"ChipCode"');
    expect(participantExportCsv([row])).not.toContain("UPLOAD-CHIP");
  });
});

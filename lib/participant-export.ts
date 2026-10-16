import type { VolunteerParticipantState } from "./volunteer-operations";

type JsonRecord = Record<string, unknown>;

export const PARTICIPANT_EXPORT_COLUMNS = [
  "Participant ID", "Registration ID", "BIB Number", "ChipCode", "Athlete Band", "Participation Mode", "Relay Team Name",
  "Relay Team Size", "Relay Member Number", "Relay Member Role", "Athlete Name", "Email Address", "Mobile",
  "BEL Season", "BEL Recognition", "Booking ID", "Ticket Name", "Distance / Sub-Category", "Session ID", "Session Name", "Scheduled Start",
  "Ticket Status", "Affiliated Club", "Ticket Price", "Amount Paid (INR)", "Balance Amount",
  "Tax Amount", "Processing Fee", "Registered At", "Actual Race Date", "Waiver Check-in Status",
  "Waiver Checked-in At", "Waiver Volunteer", "Waiver Counter", "Handover To Name",
  "Handover To Mobile", "Bike Check-in", "Bike Check-in Remarks", "Helmet Checked",
  "Bike Check-out", "Locker Number", "Medal Issued", "Finisher Jersey Issued", "Food Issued",
  "Gender", "DOB", "Age", "Age Category", "T-shirt Size", "Blood Group", "Emergency Contact",
  "Address", "City", "State", "Country", "Pincode", "Identity Proof", "Transaction ID",
  "Deferred", "Deferred from pune", "Cancellation Reason", "Updated At",
] as const;

export type ParticipantExportColumn = (typeof PARTICIPANT_EXPORT_COLUMNS)[number];
export type ParticipantExportRow = Record<ParticipantExportColumn, string>;

function text(row: JsonRecord, ...keys: string[]): string {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
  }
  return "";
}

function normalizedKey(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function truth(value: unknown): string {
  if (value === undefined || value === null || String(value).trim() === "") return "";
  const normalized = normalizedKey(String(value));
  if (["true", "yes", "1", "issued", "checked", "complete", "completed"].includes(normalized)) return "Yes";
  if (["false", "no", "0", "notissued", "unchecked", "pending"].includes(normalized)) return "No";
  return String(value).trim();
}

function ageAt(dateOfBirth: string, referenceDate: string): string {
  const birth = new Date(dateOfBirth);
  const reference = new Date(referenceDate);
  if (Number.isNaN(birth.getTime()) || Number.isNaN(reference.getTime())) return "";
  let age = reference.getUTCFullYear() - birth.getUTCFullYear();
  if (reference.getUTCMonth() < birth.getUTCMonth()
    || (reference.getUTCMonth() === birth.getUTCMonth() && reference.getUTCDate() < birth.getUTCDate())) age -= 1;
  return age >= 0 ? String(age) : "";
}

function rowIdentity(row: JsonRecord): string {
  return text(row, "participantUid", "participantUuid", "participant_uuid", "providerParticipantUuid", "uuid", "id");
}

function rowBib(row: JsonRecord): string {
  return text(row, "bib", "bibNumber", "bib_number", "raceNumber", "Unsafe_ParticipantBib");
}

function providerChip(row: JsonRecord): string {
  return text(row, "chipCode", "chip_code", "chip", "rfid", "transponder", "timingChipCode", "ParticipantChipCode", "ChipCode");
}

export function feibotChipCodesByParticipant(providerRows: JsonRecord[]): Map<string, string> {
  const chips = new Map<string, string>();
  for (const row of providerRows) {
    const chip = providerChip(row);
    if (!chip) continue;
    const id = rowIdentity(row);
    const bib = rowBib(row);
    if (id) chips.set(`id:${normalizedKey(id)}`, chip);
    if (bib) chips.set(`bib:${normalizedKey(bib)}`, chip);
  }
  return chips;
}

export function buildParticipantExportRows(input: {
  registrationRows: JsonRecord[];
  states: Record<string, VolunteerParticipantState>;
  eventDate: string;
}): ParticipantExportRow[] {
  return input.registrationRows.map((row) => {
    const id = rowIdentity(row);
    const bib = rowBib(row);
    const state = input.states[id] ?? input.states[bib];
    const dob = text(row, "dateOfBirth", "dob", "birthDate");
    const raceDate = text(row, "actualRaceDate", "raceDate") || input.eventDate;
    const assignment = row.chipAssignment && typeof row.chipAssignment === "object" && !Array.isArray(row.chipAssignment)
      ? row.chipAssignment as JsonRecord
      : {};
    const chip = text(assignment, "chipCode");
    const waiverCheckedInAt = state ? state.checkedInAt ?? "" : text(row, "checkedInAt", "waiverCheckedInAt");
    const address = text(row, "address", "addressLine1", "streetAddress");
    const emergencyName = text(row, "emergencyContactName", "emergencyName");
    const emergencyMobile = text(row, "emergencyContact", "emergency_contact", "emergencyMobile", "emergencyPhone");
    return {
      "Participant ID": text(row, "profileParticipantId", "personParticipantId", "participantId") || id,
      "Registration ID": text(row, "registrationId", "registration_id") || id,
      "BIB Number": bib,
      ChipCode: chip,
      "Athlete Band": text(row, "athleteBandCode", "athlete_band_code", "athleteBand", "bandCode"),
      "Participation Mode": text(row, "participationMode", "contestParticipationType") || "INDIVIDUAL",
      "Relay Team Name": text(row, "relayTeamName"),
      "Relay Team Size": text(row, "relayTeamSize"),
      "Relay Member Number": text(row, "relayMemberNumber"),
      "Relay Member Role": text(row, "relayMemberRole"),
      "Athlete Name": text(row, "fullName", "displayName", "name", "athleteName"),
      "Email Address": text(row, "email", "emailAddress", "rosterEmail"),
      Mobile: text(row, "mobile", "mobileNumber", "phone", "phoneNumber", "contactNumber", "whatsapp"),
      "BEL Season": text(row, "belSeason", "bel_season"),
      "BEL Recognition": text(row, "belRecognition", "bel_recognition"),
      "Booking ID": text(row, "bookingId", "bookingID", "registrationId"),
      "Ticket Name": text(row, "ticketName"),
      "Distance / Sub-Category": text(row, "distanceSubCategory", "subCategory", "sourceCategory", "contestName", "category"),
      "Session ID": text(row, "sessionId", "session_id"),
      "Session Name": text(row, "sessionName", "session"),
      "Scheduled Start": text(row, "scheduledStartAt", "sessionStartAt"),
      "Ticket Status": text(row, "ticketStatus", "registrationStatus", "bookingStatus", "participantStatus"),
      "Affiliated Club": text(row, "affiliatedClub", "club", "clubName"),
      "Ticket Price": text(row, "ticketPrice", "ticket_price"),
      "Amount Paid (INR)": text(row, "amountPaid", "amountPaidInr", "paidAmount"),
      "Balance Amount": text(row, "balanceAmount", "balance_amount"),
      "Tax Amount": text(row, "taxAmount", "tax_amount"),
      "Processing Fee": text(row, "processingFee", "processing_fee"),
      "Registered At": text(row, "registeredAt", "registrationDate", "createdAt", "rosterImportedAt"),
      "Actual Race Date": raceDate,
      "Waiver Check-in Status": waiverCheckedInAt ? "Checked in" : "Not checked in",
      "Waiver Checked-in At": waiverCheckedInAt,
      "Waiver Volunteer": text(row, "waiverVolunteer", "waiverVolunteerName", "checkedInBy") || (state?.checkedInAt ? state.updatedBy ?? "" : ""),
      "Waiver Counter": text(row, "waiverCounter", "waiverCounterName", "checkInCounter"),
      "Handover To Name": text(row, "handoverToName", "handoverName"),
      "Handover To Mobile": text(row, "handoverToMobile", "handoverMobile"),
      "Bike Check-in": state?.bikeCheckedInAt ?? text(row, "bikeCheckedInAt", "bikeCheckIn"),
      "Bike Check-in Remarks": text(row, "bikeCheckInRemarks", "bikeCheckinRemarks", "bikeRemarks"),
      "Helmet Checked": state ? (state.helmetChecked ? "Yes" : "No") : truth(row.helmetChecked),
      "Bike Check-out": state?.bikeCheckedOutAt ?? text(row, "bikeCheckedOutAt", "bikeCheckOut"),
      "Locker Number": state?.lockerNumber ?? text(row, "lockerNumber", "lockerNo"),
      "Medal Issued": state ? (state.medalIssuedAt ? "Yes" : "No") : truth(row.medalIssued),
      "Finisher Jersey Issued": truth(row.finisherJerseyIssued ?? row.jerseyIssued),
      "Food Issued": state ? (state.foodIssuedAt ? "Yes" : "No") : truth(row.foodIssued),
      Gender: text(row, "gender", "sex"),
      DOB: dob,
      Age: text(row, "age") || ageAt(dob, raceDate),
      "Age Category": text(row, "ageCategory", "ageGroup", "age_group"),
      "T-shirt Size": text(row, "tshirtSize", "tShirtSize", "t_shirt_size", "jerseySize", "shirtSize"),
      "Blood Group": text(row, "bloodGroup", "blood_group"),
      "Emergency Contact": [emergencyName, emergencyMobile].filter(Boolean).join(" · "),
      Address: address,
      City: text(row, "city", "district"),
      State: text(row, "state", "stateName"),
      Country: text(row, "country", "countryName"),
      Pincode: text(row, "pincode", "pinCode", "postalCode", "zipCode"),
      "Identity Proof": text(row, "identityProof", "idProofUrl", "idProofURL", "id_proof_url", "idProof"),
      "Transaction ID": text(row, "transactionId", "transactionID", "paymentTransactionId"),
      Deferred: truth(row.deferred),
      "Deferred from pune": truth(row.deferredFromPune ?? row.deferred_from_pune),
      "Cancellation Reason": text(row, "cancellationReason", "cancellation_reason"),
      "Updated At": state?.updatedAt ?? text(row, "updatedAt", "lastUpdatedAt", "rosterImportedAt"),
    };
  });
}

function csvCell(value: string): string {
  const safe = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}

export function participantExportCsv(rows: ParticipantExportRow[]): string {
  return [
    PARTICIPANT_EXPORT_COLUMNS.map(csvCell).join(","),
    ...rows.map((row) => PARTICIPANT_EXPORT_COLUMNS.map((column) => csvCell(row[column])).join(",")),
  ].join("\r\n");
}

import type { KVNamespace } from "@cloudflare/workers-types";

const PREFIX = "raceupshot";

export type ParticipantRosterRow = Record<string, unknown>;

export interface ParticipantRosterImportPayload {
  schemaVersion: 1;
  eventId: string;
  fileName: string;
  rows: ParticipantRosterRow[];
  importedAt: string;
  importedBy: string;
}

export interface ParticipantRosterImportSummary {
  eventId: string;
  imported: number;
  created: number;
  updated: number;
  chipCodesAssigned: number;
  athleteBandsAssigned: number;
  fileName: string;
}

export interface ParticipantRosterColumnMappings {
  bib: string;
  name?: string;
  nameOnBib?: string;
  participantId?: string;
  registrationId?: string;
  sessionId?: string;
  email?: string;
  mobile?: string;
  category?: string;
  registrationStatus?: string;
  gender?: string;
  ageGroup?: string;
  chipCode?: string;
  athleteBandCode?: string;
  emergencyContactName?: string;
  emergencyContact?: string;
  dateOfBirth?: string;
  age?: string;
  tshirtSize?: string;
  bloodGroup?: string;
  medicalHistory?: string;
  medicalCondition?: string;
  relayTeamName?: string;
  relayMemberNumber?: string;
  relayMemberRole?: string;
}

export interface ParticipantRosterTicket {
  id: string;
  name: string;
  participationMode?: "INDIVIDUAL" | "RELAY";
  relayTeamSize?: 2 | 3 | null;
  sessionId?: string;
  sessionName?: string;
  scheduledStartAt?: string;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizedHeader(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function aliasedValue(row: ParticipantRosterRow, aliases: string[]): string {
  for (const alias of aliases) {
    const entry = Object.entries(row).find(([key]) => normalizedHeader(key) === alias && text(row[key]));
    if (entry) return text(entry[1]);
  }
  return "";
}

function replaceAliasedValues(row: ParticipantRosterRow, replacements: Array<{ aliases: string[]; value: string }>): ParticipantRosterRow {
  const next = { ...row };
  for (const replacement of replacements) {
    const aliases = new Set(replacement.aliases);
    for (const key of Object.keys(next)) {
      if (aliases.has(normalizedHeader(key))) next[key] = replacement.value;
    }
  }
  return next;
}

function canonicalRelayRow(source: ParticipantRosterRow, canonical: ParticipantRosterRow): ParticipantRosterRow {
  // Insert canonical columns first for review while retaining every original
  // spreadsheet column after them. Reapply canonical values so source columns
  // with the same name cannot overwrite the selected team member.
  return { ...canonical, ...source, ...canonical };
}

/** Convert one-team-per-row relay spreadsheets into the canonical one-athlete-per-row import shape. */
export function expandRelayTeamUploadRows(rows: ParticipantRosterRow[]): ParticipantRosterRow[] {
  return rows.flatMap((row) => {
    const normalizedKeys = Object.keys(row).map(normalizedHeader);
    const hasParticipantMembers = normalizedKeys.some((key) => /^participant [123]( (name|full name|email|email address|contact|contact number|mobile|mobile number|phone|gender|dob|date of birth|birth date|t shirt|t shirt size|tshirt|tshirt size|category|role|relay leg))?$/.test(key)
      || /^participant (name|full name|email|email address|contact|contact number|mobile|mobile number|phone|gender|dob|date of birth|birth date|t shirt|t shirt size|tshirt|tshirt size|category|role|relay leg) [123]$/.test(key));
    const hasAthleteMembers = normalizedKeys.some((key) => /^athlete [123] (name|full name|email|email address|contact|contact number|mobile|mobile number|phone|gender|dob|date of birth|birth date|t shirt|t shirt size|tshirt|tshirt size|category|role|relay leg)$/.test(key));
    if (!hasParticipantMembers && !hasAthleteMembers) return [row];
    const bib = aliasedValue(row, ["team bib number", "team bib", "bib number", "bib"]);
    const teamName = aliasedValue(row, ["group name", "relay team name", "team name"]);
    const contest = aliasedValue(row, ["race category", "contest name", "contest", "category", "ticket name"]);
    const contestType = aliasedValue(row, ["contest type", "participant format"]);
    const memberRow = (prefix: string, sourceNumber: number, memberNumber: number): ParticipantRosterRow[] => {
      const name = aliasedValue(row, [`${prefix} ${sourceNumber}`, `${prefix} ${sourceNumber} name`, `${prefix} ${sourceNumber} full name`]);
      const email = aliasedValue(row, [`${prefix} ${sourceNumber} email`, `${prefix} ${sourceNumber} email address`, `${prefix} email ${sourceNumber}`, `${prefix} email address ${sourceNumber}`]);
      const mobile = aliasedValue(row, [`${prefix} ${sourceNumber} contact`, `${prefix} ${sourceNumber} contact number`, `${prefix} ${sourceNumber} mobile`, `${prefix} ${sourceNumber} mobile number`, `${prefix} ${sourceNumber} phone`, `${prefix} contact ${sourceNumber}`, `${prefix} contact number ${sourceNumber}`, `${prefix} mobile ${sourceNumber}`, `${prefix} mobile number ${sourceNumber}`, `${prefix} phone ${sourceNumber}`]);
      const gender = aliasedValue(row, [`${prefix} ${sourceNumber} gender`, `${prefix} gender ${sourceNumber}`]);
      const dateOfBirth = aliasedValue(row, [`${prefix} ${sourceNumber} dob`, `${prefix} ${sourceNumber} date of birth`, `${prefix} ${sourceNumber} birth date`, `${prefix} dob ${sourceNumber}`, `${prefix} date of birth ${sourceNumber}`, `${prefix} birth date ${sourceNumber}`]);
      const tshirtSize = aliasedValue(row, [`${prefix} ${sourceNumber} t shirt`, `${prefix} ${sourceNumber} t shirt size`, `${prefix} ${sourceNumber} tshirt`, `${prefix} ${sourceNumber} tshirt size`, `${prefix} t shirt ${sourceNumber}`, `${prefix} t shirt size ${sourceNumber}`, `${prefix} tshirt ${sourceNumber}`, `${prefix} tshirt size ${sourceNumber}`]);
      const role = aliasedValue(row, [`${prefix} ${sourceNumber} category`, `${prefix} ${sourceNumber} role`, `${prefix} ${sourceNumber} relay leg`, `${prefix} category ${sourceNumber}`, `${prefix} role ${sourceNumber}`, `${prefix} relay leg ${sourceNumber}`]);
      if (!name && !email) return [];
      const memberSource = replaceAliasedValues(row, [
        { aliases: ["name", "full name", "athlete name"], value: name },
        { aliases: ["name on bib", "bib name"], value: "" },
        { aliases: ["registration number", "registration id", "registration uid"], value: "" },
        { aliases: ["email", "email address", "e mail"], value: email },
        { aliases: ["mobile number", "mobile", "phone", "contact number"], value: mobile },
        { aliases: ["gender", "sex"], value: gender },
        { aliases: ["birth date", "date of birth", "dob"], value: dateOfBirth },
        { aliases: ["age", "athlete age", "age category", "age group"], value: "" },
        { aliases: ["t shirt", "t shirt size", "tshirt", "tshirt size"], value: tshirtSize },
        { aliases: ["blood group", "blood type", "medical history", "medical notes", "medical condition", "medical conditions"], value: "" },
        { aliases: ["emergency contact name", "emergency name", "emergency contact number", "emergency contact", "emergency number"], value: "" },
      ]);
      return [canonicalRelayRow(memberSource, {
        "BIB Number": bib,
        "Athlete Name": name,
        "Name on BIB": "",
        "Registration ID": "",
        "Email": email,
        "Mobile": mobile,
        "Gender": gender,
        "Date of Birth": dateOfBirth,
        "Age": "",
        "Age Group": "",
        "T-Shirt Size": tshirtSize,
        "Blood Group": "",
        "Medical History": "",
        "Medical Condition": "",
        "Emergency Contact Name": "",
        "Emergency Contact Number": "",
        "Category / Contest": contest,
        "Contest Type": contestType,
        "Relay Team Name": teamName,
        "Relay Member Number": memberNumber,
        "Relay Member Role": role,
      })];
    };
    const participantMembers = hasParticipantMembers
      ? [1, 2, 3].flatMap((sourceNumber) => memberRow("participant", sourceNumber, sourceNumber + 1))
      : [];
    const captainName = aliasedValue(row, ["name", "athlete name", "full name"]);
    const captainEmail = aliasedValue(row, ["email", "email address", "e mail"]);
    const participantRoles = participantMembers.map((member) => text(member["Relay Member Role"]).toLowerCase());
    const standardRelayRoles = ["swim", "cycling", "run"];
    const inferredCaptainRole = standardRelayRoles.find((role) => !participantRoles.some((value) => value === role || value.startsWith(`${role.slice(0, 3)}`))) || "";
    const captain = hasParticipantMembers && (captainName || captainEmail) ? [canonicalRelayRow(row, {
      "BIB Number": bib,
      "Athlete Name": captainName,
      "Name on BIB": aliasedValue(row, ["name on bib", "bib name"]),
      "Registration ID": aliasedValue(row, ["registration number", "registration id", "registration uid"]),
      "Email": captainEmail,
      "Mobile": aliasedValue(row, ["mobile number", "mobile", "phone", "contact number"]),
      "Gender": aliasedValue(row, ["gender", "sex"]),
      "Date of Birth": aliasedValue(row, ["birth date", "date of birth", "dob"]),
      "Age": aliasedValue(row, ["age"]),
      "Age Group": aliasedValue(row, ["age category", "age group"]),
      "T-Shirt Size": aliasedValue(row, ["t shirt", "t shirt size", "tshirt", "tshirt size"]),
      "Blood Group": aliasedValue(row, ["blood group", "blood type"]),
      "Medical History": aliasedValue(row, ["medical history", "medical notes"]),
      "Medical Condition": aliasedValue(row, ["medical condition", "medical conditions"]),
      "Emergency Contact Name": aliasedValue(row, ["emergency contact name", "emergency name"]),
      "Emergency Contact Number": aliasedValue(row, ["emergency contact number", "emergency contact", "emergency number"]),
      "Registration Status": aliasedValue(row, ["registration status", "booking status", "status"]),
      "Category / Contest": contest,
      "Contest Type": contestType,
      "Relay Team Name": teamName,
      "Relay Member Number": 1,
      "Relay Member Role": inferredCaptainRole,
    })] : [];
    const members = hasParticipantMembers
      ? [...captain, ...participantMembers]
      : [1, 2, 3].flatMap((memberNumber) => memberRow("athlete", memberNumber, memberNumber));
    return members.length ? members : [row];
  });
}

export function suggestParticipantTicket(source: string, tickets: string[]): string {
  if (tickets.length === 1) return tickets[0];
  const normalizeTicket = (value: string) => value.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const normalized = normalizeTicket(source);
  if (!normalized) return "";
  const exact = tickets.filter((ticket) => normalizeTicket(ticket) === normalized);
  if (exact.length === 1) return exact[0];
  const relayComparable = (value: string) => normalizeTicket(value).split(" ").filter((token) => token !== "team").join(" ");
  const relayMatches = tickets.filter((ticket) => relayComparable(ticket) === relayComparable(source));
  return relayMatches.length === 1 ? relayMatches[0] : "";
}

function text(value: unknown): string {
  return value === null || value === undefined ? "" : String(value).trim();
}

function rowValue(row: ParticipantRosterRow, header: string | undefined): string {
  return header ? text(row[header]) : "";
}

function participantId(row: ParticipantRosterRow): string {
  return text(row.participantUid ?? row.participantUuid ?? row.participant_uuid ?? row.uuid ?? row.id);
}

export function participantRegistrationId(row: ParticipantRosterRow): string {
  return text(row.registrationId ?? row.registration_id) || participantId(row);
}

export function participantProfileId(row: ParticipantRosterRow): string {
  return text(row.profileParticipantId ?? row.personParticipantId ?? row.participantId) || participantId(row);
}

export function participantRegistrationScope(row: ParticipantRosterRow): string {
  return [text(row.eventEditionId ?? row.eventId), text(row.ticketId ?? row.raceCategoryId), text(row.sessionId)].join(":").toLowerCase();
}

function bib(row: ParticipantRosterRow): string {
  return text(row.bib ?? row.bibNumber ?? row.bib_number ?? row.raceNumber);
}

function participationMode(row: ParticipantRosterRow): "INDIVIDUAL" | "RELAY" {
  return text(row.participationMode ?? row.contestParticipationType).toUpperCase() === "RELAY" ? "RELAY" : "INDIVIDUAL";
}

function unpack(payload: unknown): ParticipantRosterRow[] {
  if (Array.isArray(payload)) return payload.filter(isRow);
  if (!isRow(payload)) return [];
  for (const key of ["participants", "rows", "data"]) {
    const value = payload[key];
    if (Array.isArray(value)) return value.filter(isRow);
  }
  return [];
}

function isRow(value: unknown): value is ParticipantRosterRow {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function rosterImportKey(eventId: string): string {
  return `${PREFIX}:live:event:${eventId}:participant-roster-import`;
}

function participantIdentityCandidates(row: ParticipantRosterRow): string[] {
  return [...new Set([
    row.participantUid,
    row.participantUuid,
    row.participant_uuid,
    row.providerParticipantUuid,
    row.athleteUid,
    row.accountUid,
    row.firebaseUid,
    row.uuid,
    row.id,
  ].map(text).filter(Boolean))];
}

function normalizedCode(value: unknown, label: string): string {
  const code = text(value).replace(/\s+/g, "").toUpperCase();
  if (!code) return "";
  if (!/^[A-Z0-9][A-Z0-9._:-]{1,63}$/.test(code)) {
    throw new Error(`${label} must be 2-64 characters using letters, numbers, dot, dash, underscore, or colon.`);
  }
  return code;
}

function mergeDefined(base: ParticipantRosterRow, overlay: ParticipantRosterRow): ParticipantRosterRow {
  const merged = { ...base };
  for (const [key, value] of Object.entries(overlay)) {
    if (value !== undefined && value !== null && text(value) !== "") merged[key] = value;
  }
  return merged;
}

function publicRosterRow(row: ParticipantRosterRow): ParticipantRosterRow {
  const safe = { ...row };
  delete safe.medicalHistory;
  delete safe.medicalCondition;
  delete safe.uploadedFields;
  delete safe.uploadedFieldMappings;
  return safe;
}

function uploadedFields(row: ParticipantRosterRow | undefined): Record<string, string> {
  if (!row) return {};
  return Object.fromEntries(Object.entries(row).slice(0, 300).flatMap(([header, value]) => {
    const key = header.trim().slice(0, 160);
    if (!key || ["chip", "chip code", "chipcode", "timing chip", "timing chip code", "rfid"].includes(normalizedHeader(key))) return [];
    const serialized = value === null || value === undefined ? "" : String(value).slice(0, 5_000);
    return [[key, serialized]];
  }));
}

function withoutRegistrationChip(row: ParticipantRosterRow): ParticipantRosterRow {
  const safe = { ...row };
  delete safe.chipCode;
  delete safe.chip_code;
  delete safe.chip;
  delete safe.rfid;
  delete safe.chipAssignment;
  return safe;
}

function uploadedMappings(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value as ParticipantRosterRow).flatMap(([field, header]) => {
    const key = field.trim().slice(0, 80);
    const sourceHeader = text(header).slice(0, 160);
    return key && sourceHeader ? [[key, sourceHeader]] : [];
  }));
}

function priorRegistrationFields(row: ParticipantRosterRow | null | undefined): ParticipantRosterRow {
  if (!row) return {};
  const allowed = [
    "email", "mobile", "registrationId", "registration_id", "profileParticipantId", "personParticipantId", "participantId", "eventId", "eventEditionId", "raceCategoryId", "sessionId", "sessionName", "scheduledStartAt", "registrationStatus", "contestName", "category", "sourceCategory", "ticketId", "ticketName", "ticketStatus",
    "gender", "ageGroup", "athleteBandCode", "athlete_band_code",
    "emergencyContact", "emergencyContactName", "address", "city", "state", "country", "pincode",
    "dateOfBirth", "dob", "age", "bloodGroup", "tshirtSize", "nameOnBib", "medicalHistory", "medicalCondition", "idProofUrl", "identityProof", "waiverStatus", "waiverVerifiedAt", "waiverSignedAt",
    "belSeason", "belRecognition", "bookingId", "ticketPrice", "amountPaid", "balanceAmount", "taxAmount", "processingFee",
    "registeredAt", "actualRaceDate", "handoverToName", "handoverToMobile", "bikeCheckInRemarks", "transactionId",
    "deferred", "deferredFromPune", "cancellationReason", "affiliatedClub", "club",
    "waiverDocumentUrl", "waiverDocumentKey", "waiverDocumentSha256", "waiverVersion", "waiverSignatureName",
    "signatureName", "waiverSignerRelationship", "waiverAuditId", "waiverResetAt", "waiverResetBy", "waiverCoveredRegistrationIds",
    "participationMode", "contestParticipationType", "relayTeamId", "relayTeamName", "relayTeamSize", "relayMemberNumber", "relayMemberRole",
  ];
  return Object.fromEntries(allowed.filter((key) => row[key] !== undefined).map((key) => [key, row[key]]));
}

/** Persist trusted registration fields on the imported participant and live roster copies. */
export async function updateParticipantRosterRegistration(input: {
  kv: KVNamespace;
  eventId: string;
  participantId: string;
  patch: ParticipantRosterRow;
}): Promise<ParticipantRosterRow> {
  const importKey = rosterImportKey(input.eventId);
  const feedKey = `${PREFIX}:live:event:${input.eventId}:participants`;
  const [payload, feedPayload] = await Promise.all([
    input.kv.get<ParticipantRosterImportPayload>(importKey, "json"),
    input.kv.get<unknown>(feedKey, "json"),
  ]);
  if (!payload) throw new Error("The event participant roster has not been imported.");
  const importedIndex = payload.rows.findIndex((row) => participantIdentityCandidates(row).includes(input.participantId));
  if (importedIndex < 0) throw new Error("The participant is not in this event registration roster.");
  const changedAt = new Date().toISOString();
  const updated = { ...payload.rows[importedIndex], ...input.patch, lastUpdatedAt: changedAt };
  const importedRows = payload.rows.map((row, index) => index === importedIndex ? updated : row);
  const feedRows = unpack(feedPayload);
  const nextFeedRows = mergeImportedParticipantRows(feedRows, [updated]);
  await Promise.all([
    input.kv.put(importKey, JSON.stringify({ ...payload, rows: importedRows })),
    input.kv.put(feedKey, JSON.stringify({ participants: nextFeedRows.length ? nextFeedRows : importedRows })),
    input.kv.put(`${PREFIX}:live:event:${input.eventId}:updated`, changedAt),
  ]);
  return updated;
}

/** Update several exact registrations in one roster read/write cycle. */
export async function updateParticipantRosterRegistrations(input: {
  kv: KVNamespace;
  eventId: string;
  registrationIds: string[];
  patch: ParticipantRosterRow;
}): Promise<ParticipantRosterRow[]> {
  const wanted = new Set(input.registrationIds.map((value) => value.trim()).filter(Boolean));
  if (!wanted.size) throw new Error("Choose at least one registration.");
  const importKey = rosterImportKey(input.eventId);
  const feedKey = `${PREFIX}:live:event:${input.eventId}:participants`;
  const [payload, feedPayload] = await Promise.all([
    input.kv.get<ParticipantRosterImportPayload>(importKey, "json"),
    input.kv.get<unknown>(feedKey, "json"),
  ]);
  if (!payload) throw new Error("The event participant roster has not been imported.");
  const changedAt = new Date().toISOString();
  const updated: ParticipantRosterRow[] = [];
  const importedRows = payload.rows.map((row) => {
    const registrationId = participantRegistrationId(row);
    if (!wanted.has(registrationId)) return row;
    const next = { ...row, ...input.patch, lastUpdatedAt: changedAt };
    updated.push(next);
    return next;
  });
  if (updated.length !== wanted.size) throw new Error("One or more selected registrations are no longer available.");
  const nextFeedRows = mergeImportedParticipantRows(unpack(feedPayload), updated);
  await Promise.all([
    input.kv.put(importKey, JSON.stringify({ ...payload, rows: importedRows })),
    input.kv.put(feedKey, JSON.stringify({ participants: nextFeedRows.length ? nextFeedRows : importedRows })),
    input.kv.put(`${PREFIX}:live:event:${input.eventId}:updated`, changedAt),
  ]);
  return updated;
}

export interface ParticipantRosterEdit {
  bib: string;
  name: string;
  email: string;
  mobile: string;
  registrationStatus: string;
  gender: string;
  ageGroup: string;
  club: string;
  tshirtSize: string;
  dateOfBirth?: string;
  bloodGroup?: string;
  emergencyContactName?: string;
  emergencyContact?: string;
  address?: string;
  city?: string;
  state?: string;
  country?: string;
  pincode?: string;
  belSeason?: string;
  belRecognition?: string;
  bookingId?: string;
  ticketStatus?: string;
  ticketPrice?: string;
  amountPaid?: string;
  balanceAmount?: string;
  taxAmount?: string;
  processingFee?: string;
  registeredAt?: string;
  actualRaceDate?: string;
  handoverToName?: string;
  handoverToMobile?: string;
  bikeCheckInRemarks?: string;
  identityProof?: string;
  transactionId?: string;
  deferred?: string;
  deferredFromPune?: string;
  cancellationReason?: string;
  uploadedFields?: Record<string, string>;
  ticketId: string;
  ticketName: string;
}

/** Edit only the uploaded registration. Result records and timing identities are never mutated. */
export async function editImportedParticipant(input: {
  kv: KVNamespace; eventId: string; participantId: string; edit: ParticipantRosterEdit; changedBy: string;
}): Promise<ParticipantRosterRow> {
  const key = rosterImportKey(input.eventId);
  const payload = await input.kv.get<ParticipantRosterImportPayload>(key, "json");
  if (!payload || payload.eventId !== input.eventId) throw new Error("The event participant roster has not been imported.");
  const index = payload.rows.findIndex((row) => participantIdentityCandidates(row).includes(input.participantId));
  if (index < 0 || text(payload.rows[index].rosterImportSource) !== "ADMIN_UPLOAD") throw new Error("Participant not found in this event's uploaded roster.");
  const nextBib = input.edit.bib.trim();
  const nextName = input.edit.name.trim();
  if (!nextBib || !nextName) throw new Error("BIB and athlete name are required.");
  const previous = payload.rows[index];
  if (payload.rows.some((row, rowIndex) => rowIndex !== index
    && bib(row).toLowerCase() === nextBib.toLowerCase()
    && !(participationMode(previous) === "RELAY" && participationMode(row) === "RELAY" && text(previous.relayTeamId) === text(row.relayTeamId)))) {
    throw new Error(`BIB ${nextBib} is already in this event roster.`);
  }
  const changedAt = new Date().toISOString();
  const nextEmail = input.edit.email.trim();
  if (nextEmail && !EMAIL_PATTERN.test(nextEmail)) throw new Error("Enter a valid athlete email address.");
  const identityChanged = text(previous.name ?? previous.fullName) !== nextName
    || text(previous.email).toLowerCase() !== nextEmail.toLowerCase();
  const sourceFields = uploadedFields(input.edit.uploadedFields);
  const sourceMappings = uploadedMappings(previous.uploadedFieldMappings);
  const mappedEditValues: Record<string, string> = {
    bib: nextBib, name: nextName, email: nextEmail, mobile: input.edit.mobile.trim(),
    registrationStatus: input.edit.registrationStatus.trim(), gender: input.edit.gender.trim(), ageGroup: input.edit.ageGroup.trim(),
    tshirtSize: input.edit.tshirtSize.trim(), emergencyContactName: text(input.edit.emergencyContactName),
    emergencyContact: text(input.edit.emergencyContact), dateOfBirth: text(input.edit.dateOfBirth), bloodGroup: text(input.edit.bloodGroup),
    category: input.edit.ticketName.trim(), chipCode: text(previous.chipCode), athleteBandCode: text(previous.athleteBandCode),
  };
  for (const [field, header] of Object.entries(sourceMappings)) {
    if (mappedEditValues[field] !== undefined) sourceFields[header] = mappedEditValues[field];
  }
  const updated: ParticipantRosterRow = {
    ...previous, bib: nextBib, bibNumber: nextBib, name: nextName, fullName: nextName, displayName: nextName,
    email: nextEmail, mobile: input.edit.mobile.trim(), registrationStatus: input.edit.registrationStatus.trim(),
    gender: input.edit.gender.trim(), ageGroup: input.edit.ageGroup.trim(), club: input.edit.club.trim(),
    affiliatedClub: input.edit.club.trim(), tshirtSize: input.edit.tshirtSize.trim(),
    dateOfBirth: text(input.edit.dateOfBirth), dob: text(input.edit.dateOfBirth), bloodGroup: text(input.edit.bloodGroup),
    emergencyContactName: text(input.edit.emergencyContactName), emergencyContact: text(input.edit.emergencyContact),
    address: text(input.edit.address), city: text(input.edit.city), state: text(input.edit.state), country: text(input.edit.country), pincode: text(input.edit.pincode),
    belSeason: text(input.edit.belSeason), belRecognition: text(input.edit.belRecognition), bookingId: text(input.edit.bookingId),
    ticketStatus: text(input.edit.ticketStatus), ticketPrice: text(input.edit.ticketPrice), amountPaid: text(input.edit.amountPaid),
    balanceAmount: text(input.edit.balanceAmount), taxAmount: text(input.edit.taxAmount), processingFee: text(input.edit.processingFee),
    registeredAt: text(input.edit.registeredAt), actualRaceDate: text(input.edit.actualRaceDate),
    handoverToName: text(input.edit.handoverToName), handoverToMobile: text(input.edit.handoverToMobile),
    bikeCheckInRemarks: text(input.edit.bikeCheckInRemarks), identityProof: text(input.edit.identityProof),
    transactionId: text(input.edit.transactionId), deferred: text(input.edit.deferred),
    deferredFromPune: text(input.edit.deferredFromPune), cancellationReason: text(input.edit.cancellationReason),
    uploadedFields: sourceFields,
    uploadedFieldMappings: sourceMappings,
    ticketId: input.edit.ticketId.trim(), ticketName: input.edit.ticketName.trim(),
    category: input.edit.ticketName.trim(), contestName: input.edit.ticketName.trim(), sourceCategory: input.edit.ticketName.trim(),
    lastUpdatedAt: changedAt, lastUpdatedBy: input.changedBy,
  };
  if (identityChanged) Object.assign(updated, {
    waiverStatus: null,
    waiverVerifiedAt: null,
    waiverSignedAt: null,
    waiverSignatureName: null,
    signatureName: null,
    waiverDocumentUrl: null,
    waiverDocumentKey: null,
    waiverDocumentSha256: null,
    waiverAuditId: null,
    waiverResetAt: changedAt,
    waiverResetBy: input.changedBy,
  });
  const rows = payload.rows.map((row, rowIndex) => rowIndex === index ? updated : row);
  const feedKey = `${PREFIX}:live:event:${input.eventId}:participants`;
  const feed = unpack(await input.kv.get<unknown>(feedKey, "json"));
  const nextFeed = feed.map((row) => participantIdentityCandidates(row).includes(input.participantId) && text(row.rosterImportSource) === "ADMIN_UPLOAD"
    ? publicRosterRow({ ...row, ...updated }) : row);
  await input.kv.put(key, JSON.stringify({ ...payload, rows }));
  await input.kv.put(feedKey, JSON.stringify({ participants: nextFeed }));
  await input.kv.put(`${PREFIX}:live:event:${input.eventId}:updated`, changedAt);
  return updated;
}

/** Remove uploaded registrations only; preserve official results and provider timing rows. */
export async function deleteImportedParticipants(input: {
  kv: KVNamespace; eventId: string; participantIds?: string[]; expectedCount: number;
}): Promise<ParticipantRosterRow[]> {
  const key = rosterImportKey(input.eventId);
  const payload = await input.kv.get<ParticipantRosterImportPayload>(key, "json");
  if (!payload || payload.eventId !== input.eventId) throw new Error("The event participant roster has not been imported.");
  const ids = new Set(input.participantIds ?? payload.rows.map((row) => participantId(row)));
  const removed = payload.rows.filter((row) => participantIdentityCandidates(row).some((id) => ids.has(id)) && text(row.rosterImportSource) === "ADMIN_UPLOAD");
  if (removed.length !== input.expectedCount) throw new Error("The roster has changed. Refresh before confirming deletion.");
  const removedIds = new Set(removed.flatMap(participantIdentityCandidates));
  const remaining = payload.rows.filter((row) => !participantIdentityCandidates(row).some((id) => removedIds.has(id)));
  const feedKey = `${PREFIX}:live:event:${input.eventId}:participants`;
  const feed = unpack(await input.kv.get<unknown>(feedKey, "json"));
  const nextFeed = feed.flatMap((row) => {
    if (!participantIdentityCandidates(row).some((id) => removedIds.has(id)) || text(row.rosterImportSource) !== "ADMIN_UPLOAD") return [row];
    if (text(row.publishedResultSource) !== "PUBLISHED_RESULTS" && !text(row.providerParticipantUuid)) return [];
    const clean = { ...row };
    delete clean.rosterImportSource; delete clean.rosterImportedAt;
    return [clean];
  });
  const changedAt = new Date().toISOString();
  await input.kv.put(key, JSON.stringify({ ...payload, rows: remaining }));
  await input.kv.put(feedKey, JSON.stringify({ participants: nextFeed }));
  await input.kv.put(`${PREFIX}:live:event:${input.eventId}:updated`, changedAt);
  return removed;
}

export function mergeImportedParticipantRows(
  providerRows: ParticipantRosterRow[],
  importedRows: ParticipantRosterRow[],
): ParticipantRosterRow[] {
  if (!importedRows.length) return providerRows;
  const merged = providerRows.map((row) => ({ ...row }));
  for (const privateImported of importedRows.map(withoutRegistrationChip)) {
    // Keep medical disclosures in the authenticated import record, never in the live feed.
    const imported = publicRosterRow(privateImported);
    const importedId = participantId(imported).toLowerCase();
    const importedBib = bib(imported).toLowerCase();
    const index = merged.findIndex((row) =>
      (importedId && participantId(row).toLowerCase() === importedId)
      || (participationMode(imported) === "INDIVIDUAL" && importedBib && bib(row).toLowerCase() === importedBib),
    );
    if (index >= 0) {
      const providerId = participantId(merged[index]);
      const preserveProviderIdentity = text(merged[index].rosterImportSource) !== "ADMIN_UPLOAD";
      merged[index] = publicRosterRow(mergeDefined(merged[index], imported));
      if (providerId && preserveProviderIdentity) {
        merged[index].participantUid = providerId;
        merged[index].participantUuid = providerId;
      }
    } else {
      merged.push(publicRosterRow({ ...imported }));
    }
  }
  return merged;
}

export async function applyParticipantRosterImport(
  kv: KVNamespace,
  eventId: string,
  providerRows: ParticipantRosterRow[],
): Promise<ParticipantRosterRow[]> {
  const payload = await kv.get<ParticipantRosterImportPayload>(rosterImportKey(eventId), "json");
  return payload?.rows?.length ? mergeImportedParticipantRows(providerRows, payload.rows.map(withoutRegistrationChip)) : providerRows;
}

export async function getPrivateImportedParticipantRows(kv: KVNamespace, eventId: string): Promise<ParticipantRosterRow[]> {
  const payload = await kv.get<ParticipantRosterImportPayload>(rosterImportKey(eventId), "json");
  return payload?.rows?.map(withoutRegistrationChip) ?? [];
}

// Registration uploads may enrich a Feibot athlete, but they are never a
// timing-identity source. In particular, an uploaded ChipCode must not replace
// the transponder assigned by Feibot or create an upload-only canonical athlete.
const REGISTRATION_ENRICHMENT_FIELDS = [
  "email", "emailAddress", "mobile", "mobileNumber", "phone", "phoneNumber",
  "registrationStatus", "registrationType", "registeredAt", "registrationDate",
  "bookingId", "bookingID", "ticketId", "ticketName", "ticketStatus",
  "belSeason", "belRecognition", "affiliatedClub", "ticketPrice", "amountPaid",
  "balanceAmount", "taxAmount", "processingFee", "actualRaceDate",
  "athleteBandCode", "athlete_band_code", "emergencyContact", "emergencyContactName",
  "address", "city", "state", "country", "pincode", "bloodGroup", "tshirtSize",
  "dateOfBirth", "dob", "idProofUrl", "identityProof", "transactionId", "deferred",
  "deferredFromPune", "cancellationReason", "waiverStatus", "waiverVerifiedAt",
  "waiverSignedAt", "waiverDocumentUrl", "checkedInAt", "checkedInBy",
  "waiverVolunteer", "waiverCounter", "handoverToName", "handoverToMobile",
  "bikeCheckInRemarks", "finisherJerseyIssued", "updatedAt",
] as const;

export function mergeRegistrationDataIntoProviderParticipants(
  providerRows: ParticipantRosterRow[],
  importedRows: ParticipantRosterRow[],
): ParticipantRosterRow[] {
  if (!providerRows.length || !importedRows.length) return providerRows;
  return providerRows.map((provider) => {
    const providerId = participantId(provider).toLowerCase();
    const providerBib = bib(provider).toLowerCase();
    const imported = importedRows.find((row) => {
      const importedId = participantId(row).toLowerCase();
      const importedBib = bib(row).toLowerCase();
      return Boolean((providerId && importedId === providerId) || (providerBib && importedBib === providerBib));
    });
    if (!imported) return provider;
    const enrichment = Object.fromEntries(REGISTRATION_ENRICHMENT_FIELDS.flatMap((key) => {
      const value = imported[key];
      return value !== undefined && value !== null && text(value) !== "" ? [[key, value]] : [];
    }));
    return { ...provider, ...enrichment };
  });
}

export async function applyParticipantRegistrationEnrichment(
  kv: KVNamespace,
  eventId: string,
  providerRows: ParticipantRosterRow[],
): Promise<ParticipantRosterRow[]> {
  const payload = await kv.get<ParticipantRosterImportPayload>(rosterImportKey(eventId), "json");
  return payload?.rows?.length
    ? mergeRegistrationDataIntoProviderParticipants(providerRows, payload.rows)
    : providerRows;
}

function validateUnique(rows: ParticipantRosterRow[], field: "bib" | "chipCode" | "athleteBandCode", label: string) {
  const seen = new Map<string, ParticipantRosterRow>();
  for (const row of rows) {
    const value = field === "bib" ? bib(row) : text(row[field]);
    if (!value) continue;
    const key = value.toLowerCase();
    const existing = seen.get(key);
    const reusableChip = field === "chipCode" && existing && participantRegistrationScope(existing) !== participantRegistrationScope(row);
    if (existing && participantId(existing) !== participantId(row) && !reusableChip) {
      throw new Error(`${label} ${value} is assigned to more than one participant (BIB ${bib(existing) || "unknown"} and BIB ${bib(row) || "unknown"}).`);
    }
    seen.set(key, row);
  }
}

function validateBibSharing(rows: ParticipantRosterRow[]) {
  const groups = new Map<string, ParticipantRosterRow[]>();
  for (const row of rows) {
    const value = bib(row).toLowerCase();
    if (!value) continue;
    groups.set(value, [...(groups.get(value) ?? []), row]);
  }
  for (const [sharedBib, members] of groups) {
    if (members.length === 1) continue;
    const relay = members.every((row) => participationMode(row) === "RELAY");
    const teamIds = new Set(members.map((row) => text(row.relayTeamId)));
    if (!relay || teamIds.size !== 1 || ![...teamIds][0]) {
      throw new Error(`BIB ${sharedBib} is assigned to multiple athletes outside one relay team.`);
    }
    const configuredSize = Number(members[0].relayTeamSize);
    if (![2, 3].includes(configuredSize) || members.length !== configuredSize) {
      throw new Error(`Relay BIB ${sharedBib} must contain exactly ${configuredSize || 2} or 3 configured team members.`);
    }
    const positions = new Set(members.map((row) => Number(row.relayMemberNumber)));
    if (positions.size !== members.length || [...positions].some((position) => !Number.isInteger(position) || position < 1 || position > configuredSize)) {
      throw new Error(`Relay BIB ${sharedBib} must use each member number from 1 to ${configuredSize} exactly once.`);
    }
  }
}

export async function importParticipantRoster(input: {
  kv: KVNamespace;
  eventId: string;
  fileName: string;
  rows: ParticipantRosterRow[];
  mappings: ParticipantRosterColumnMappings;
  categoryMappings?: Record<string, string>;
  eventTickets?: Array<string | ParticipantRosterTicket>;
  replaceExisting: boolean;
  importedBy: string;
}): Promise<ParticipantRosterImportSummary> {
  const eventTickets = (input.eventTickets ?? []).map((ticket) => typeof ticket === "string"
    ? { id: ticket, name: ticket, participationMode: "INDIVIDUAL" as const, relayTeamSize: null }
    : ticket);
  const replacementTicketIds = new Set(input.rows.flatMap((source) => {
    const sourceCategory = rowValue(source, input.mappings.category);
    const mappedTicketId = input.categoryMappings?.[sourceCategory]
      ?? suggestParticipantTicket(sourceCategory, eventTickets.map((ticket) => ticket.name));
    return mappedTicketId ? [mappedTicketId.toLowerCase()] : [];
  }));
  const replacementSourceCategories = new Set(input.rows.flatMap((source) => {
    const sourceCategory = rowValue(source, input.mappings.category).toLowerCase();
    return sourceCategory ? [sourceCategory] : [];
  }));
  const scopedReplacement = replacementTicketIds.size > 0 || replacementSourceCategories.size > 0;
  const replacesUploadedRow = (row: ParticipantRosterRow) => !scopedReplacement
    || replacementTicketIds.has(text(row.ticketId).toLowerCase())
    || replacementSourceCategories.has(text(row.sourceCategory ?? row.contestName ?? row.category).toLowerCase());
  const storedFeed = unpack(await input.kv.get<unknown>(`${PREFIX}:live:event:${input.eventId}:participants`, "json"))
    .map((row) => text(row.rosterImportSource) === "ADMIN_UPLOAD" ? withoutRegistrationChip(row) : row);
  const previous = await input.kv.get<ParticipantRosterImportPayload>(rosterImportKey(input.eventId), "json");
  const previousRows: ParticipantRosterRow[] = (previous?.rows ?? []).map(withoutRegistrationChip);
  const previousByBib = new Map(previousRows.flatMap((row) => {
    const value = bib(row).toLowerCase();
    return value ? [[value, row] as const] : [];
  }));
  const currentFeed = input.replaceExisting ? storedFeed.flatMap((row) => {
    if (!replacesUploadedRow(row)) return [row];
    const prior = previousByBib.get(bib(row).toLowerCase());
    if (!prior) return [row];
    if (text(row.rosterImportSource) === "ADMIN_UPLOAD" || participantId(row).startsWith(`import:${input.eventId}:`)) return [];
    const cleaned = { ...row };
    if (text(cleaned.chipCode).toLowerCase() === text(prior.chipCode).toLowerCase()) {
      delete cleaned.chipCode; delete cleaned.chip_code;
    }
    if (text(cleaned.athleteBandCode).toLowerCase() === text(prior.athleteBandCode).toLowerCase()) {
      delete cleaned.athleteBandCode; delete cleaned.athlete_band_code;
    }
    delete cleaned.rosterImportSource;
    delete cleaned.rosterImportedAt;
    return [cleaned];
  }) : storedFeed;
  const currentRows = input.replaceExisting
    ? currentFeed
    : mergeImportedParticipantRows(currentFeed, previousRows);
  const retainedPreviousRows: ParticipantRosterRow[] = input.replaceExisting
    ? previousRows.filter((row) => !replacesUploadedRow(row))
    : previousRows;
  let importedRows: ParticipantRosterRow[] = [...retainedPreviousRows];
  let created = 0;
  let updated = 0;
  const uploadTeamCounts = new Map<string, number>();
  const inferredRelayTeamSize = (source: ParticipantRosterRow, nextBib: string, sourceCategory: string): 2 | 3 | null => {
    const matchingRows = input.rows.filter((candidate) => rowValue(candidate, input.mappings.bib).toLowerCase() === nextBib.toLowerCase()
      && rowValue(candidate, input.mappings.category) === sourceCategory);
    const explicitNumbers = matchingRows.map((candidate) => Number(rowValue(candidate, input.mappings.relayMemberNumber)))
      .filter((value) => Number.isInteger(value) && value > 0);
    const inferred = Math.max(matchingRows.length, ...explicitNumbers, 0);
    const hasRelayEvidence = Boolean(rowValue(source, input.mappings.relayTeamName) || explicitNumbers.length);
    return hasRelayEvidence && (inferred === 2 || inferred === 3) ? inferred : null;
  };

  input.rows.forEach((source, index) => {
    const rowNumber = index + 2;
    const nextBib = rowValue(source, input.mappings.bib);
    const name = rowValue(source, input.mappings.name);
    if (!nextBib) throw new Error(`Row ${rowNumber}: BIB is required.`);
    const key = nextBib.toLowerCase();
    const athleteBandCode = normalizedCode(rowValue(source, input.mappings.athleteBandCode), "Athlete Band Code");
    const retainedUploadedFields = uploadedFields(source);
    if (input.mappings.chipCode) delete retainedUploadedFields[input.mappings.chipCode];
    const sourceCategory = rowValue(source, input.mappings.category);
    const mappedTicketId = input.categoryMappings?.[sourceCategory] ?? suggestParticipantTicket(sourceCategory, eventTickets.map((ticket) => ticket.name));
    if (eventTickets.length && !mappedTicketId) {
      throw new Error(`Row ${rowNumber}: map ${sourceCategory ? `category “${sourceCategory}”` : "rows without a category"} to an event ticket before importing.`);
    }
    const idMatches = eventTickets.filter((ticket) => ticket.id === mappedTicketId);
    const nameMatches = eventTickets.filter((ticket) => ticket.name === mappedTicketId);
    const mappedTicket = idMatches.length === 1 ? idMatches[0] : nameMatches.length === 1 ? nameMatches[0] : undefined;
    if (mappedTicketId && eventTickets.length && !mappedTicket) {
      throw new Error(`Row ${rowNumber}: mapped ticket “${mappedTicketId}” is not configured for this event.`);
    }
    const uploadedRelayTeamSize = inferredRelayTeamSize(source, nextBib, sourceCategory);
    const mode = mappedTicket?.participationMode === "RELAY" || uploadedRelayTeamSize ? "RELAY" : "INDIVIDUAL";
    const relayTeamSize = mode === "RELAY" ? mappedTicket?.relayTeamSize ?? uploadedRelayTeamSize : null;
    if (mode === "RELAY" && relayTeamSize !== 2 && relayTeamSize !== 3) {
      throw new Error(`Row ${rowNumber}: relay ticket ${mappedTicket?.name || sourceCategory} must be configured for 2 or 3 athletes.`);
    }
    const email = rowValue(source, input.mappings.email);
    const relayTeamName = rowValue(source, input.mappings.relayTeamName);
    if (mode === "RELAY" && !name) throw new Error(`Row ${rowNumber}: every relay athlete must have a name.`);
    if (mode === "RELAY" && !relayTeamName) throw new Error(`Row ${rowNumber}: relay team name is required.`);
    if (mode === "RELAY" && !email) throw new Error(`Row ${rowNumber}: every relay athlete must have an email address.`);
    if (email && !EMAIL_PATTERN.test(email)) throw new Error(`Row ${rowNumber}: enter a valid email address for ${name}.`);
    if (mode === "INDIVIDUAL" && input.rows.slice(0, index).some((row) => rowValue(row, input.mappings.bib).toLowerCase() === key)) {
      throw new Error(`Row ${rowNumber}: individual BIB ${nextBib} appears more than once in this upload.`);
    }
    const teamKey = `${mappedTicket?.id || sourceCategory}:${key}`;
    const explicitMemberNumber = Number(rowValue(source, input.mappings.relayMemberNumber));
    const relayMemberNumber = mode === "RELAY"
      ? (Number.isInteger(explicitMemberNumber) && explicitMemberNumber > 0
        ? explicitMemberNumber
        : (uploadTeamCounts.get(teamKey) ?? 0) + 1)
      : null;
    uploadTeamCounts.set(teamKey, (uploadTeamCounts.get(teamKey) ?? 0) + 1);
    const explicitProfileId = rowValue(source, input.mappings.participantId);
    const explicitRegistrationId = rowValue(source, input.mappings.registrationId);
    const matchingRows = [...importedRows, ...currentRows, ...previousRows].filter((row) => bib(row).toLowerCase() === key && text(row.ticketId) === text(mappedTicket?.id));
    const existing = explicitRegistrationId
      ? matchingRows.find((row) => participantRegistrationId(row) === explicitRegistrationId)
      : explicitProfileId
        ? matchingRows.find((row) => participantProfileId(row) === explicitProfileId)
      : mode === "RELAY"
        ? matchingRows.find((row) => Number(row.relayMemberNumber) === relayMemberNumber)
        : matchingRows[0];
    const registeredPrevious = existing && text(existing.publishedResultSource) !== "PUBLISHED_RESULTS" ? existing : null;
    const identityChanged = Boolean(registeredPrevious) && (
      text(registeredPrevious?.name ?? registeredPrevious?.fullName) !== name
      || text(registeredPrevious?.email).toLowerCase() !== email.toLowerCase()
    );
    const repeatedProfile = Boolean(explicitProfileId) && input.rows.filter((candidate) => rowValue(candidate, input.mappings.participantId) === explicitProfileId).length > 1;
    const profileAlreadyUsed = Boolean(explicitProfileId) && [...importedRows, ...currentRows].some((candidate) => participantProfileId(candidate) === explicitProfileId);
    const id = explicitRegistrationId || (!identityChanged && registeredPrevious ? participantRegistrationId(registeredPrevious) : "") || (explicitProfileId && !repeatedProfile && !profileAlreadyUsed ? explicitProfileId : "") || (identityChanged
      ? `registration:${crypto.randomUUID()}`
      : mode === "RELAY"
      ? `import:${input.eventId}:${encodeURIComponent(nextBib)}:member-${relayMemberNumber}`
      : `import:${input.eventId}:${encodeURIComponent(nextBib)}`);
    const personId = explicitProfileId || (!identityChanged && registeredPrevious ? participantProfileId(registeredPrevious) : "") || `participant:${crypto.randomUUID()}`;
    const sessionId = rowValue(source, input.mappings.sessionId) || mappedTicket?.sessionId || "";
    const relayTeamId = mode === "RELAY" ? `relay:${input.eventId}:${mappedTicket?.id || encodeURIComponent(sourceCategory)}:${encodeURIComponent(nextBib)}` : "";
    const imported: ParticipantRosterRow = mergeDefined(priorRegistrationFields(registeredPrevious), {
      participantUid: id,
      participantUuid: id,
      registrationId: id,
      registration_id: id,
      participantId: personId,
      profileParticipantId: personId,
      personParticipantId: personId,
      eventId: input.eventId,
      eventEditionId: input.eventId,
      raceCategoryId: mappedTicket?.id || sourceCategory,
      sessionId,
      sessionName: mappedTicket?.sessionName || sessionId,
      scheduledStartAt: mappedTicket?.scheduledStartAt || "",
      bib: nextBib,
      bibNumber: nextBib,
      name,
      fullName: name,
      displayName: name,
      email,
      mobile: rowValue(source, input.mappings.mobile),
      emergencyContactName: rowValue(source, input.mappings.emergencyContactName),
      emergencyContact: rowValue(source, input.mappings.emergencyContact),
      dateOfBirth: rowValue(source, input.mappings.dateOfBirth),
      dob: rowValue(source, input.mappings.dateOfBirth),
      bloodGroup: rowValue(source, input.mappings.bloodGroup),
      age: rowValue(source, input.mappings.age),
      tshirtSize: rowValue(source, input.mappings.tshirtSize),
      nameOnBib: rowValue(source, input.mappings.nameOnBib),
      medicalHistory: rowValue(source, input.mappings.medicalHistory),
      medicalCondition: rowValue(source, input.mappings.medicalCondition),
      registrationStatus: rowValue(source, input.mappings.registrationStatus),
      contestName: sourceCategory || mappedTicket?.name,
      category: sourceCategory || mappedTicket?.name,
      sourceCategory,
      ticketId: mappedTicket?.id,
      ticketName: mappedTicket?.name,
      participationMode: mode,
      contestParticipationType: mode,
      relayTeamId,
      relayTeamName: mode === "RELAY" ? relayTeamName : "",
      relayTeamSize,
      relayMemberNumber,
      relayMemberRole: mode === "RELAY" ? rowValue(source, input.mappings.relayMemberRole) : "",
      gender: rowValue(source, input.mappings.gender),
      ageGroup: rowValue(source, input.mappings.ageGroup),
      athleteBandCode,
      athlete_band_code: athleteBandCode,
      uploadedFields: retainedUploadedFields,
      uploadedFieldMappings: Object.fromEntries(Object.entries(input.mappings).flatMap(([field, header]) => field !== "chipCode" && header ? [[field, header]] : [])),
      rosterImportSource: "ADMIN_UPLOAD",
      rosterImportedAt: new Date().toISOString(),
    });
    if (identityChanged) Object.assign(imported, {
      waiverStatus: null,
      waiverVerifiedAt: null,
      waiverSignedAt: null,
      waiverSignatureName: null,
      signatureName: null,
      waiverDocumentUrl: null,
      waiverDocumentKey: null,
      waiverDocumentSha256: null,
      waiverAuditId: null,
      waiverResetAt: new Date().toISOString(),
      waiverResetBy: input.importedBy,
    });
    importedRows = [...importedRows.filter((row) => {
      if (participantId(row) === id) return false;
      if (bib(row).toLowerCase() !== key || text(row.ticketId) !== text(mappedTicket?.id)) return true;
      return mode === "RELAY"
        ? Number(row.relayMemberNumber) !== relayMemberNumber
        : false;
    }), imported];
    if (registeredPrevious) updated += 1;
    else created += 1;
  });

  const mergedRows = mergeImportedParticipantRows(currentFeed, importedRows);
  validateBibSharing(importedRows);
  validateUnique(mergedRows, "athleteBandCode", "Athlete Band Code");

  const importedAt = new Date().toISOString();
  const payload: ParticipantRosterImportPayload = {
    schemaVersion: 1,
    eventId: input.eventId,
    fileName: input.fileName,
    rows: importedRows,
    importedAt,
    importedBy: input.importedBy,
  };
  const writes: Promise<void>[] = [
    input.kv.put(rosterImportKey(input.eventId), JSON.stringify(payload)),
    input.kv.put(`${PREFIX}:live:event:${input.eventId}:participants`, JSON.stringify({ participants: mergedRows })),
    input.kv.put(`${PREFIX}:live:event:${input.eventId}:updated`, importedAt),
  ];
  if (previous) writes.push(input.kv.put(`${rosterImportKey(input.eventId)}:backup`, JSON.stringify(previous)));
  await Promise.all(writes);

  return {
    eventId: input.eventId,
    imported: input.rows.length,
    created,
    updated,
    chipCodesAssigned: 0,
    athleteBandsAssigned: importedRows.filter((row) => text(row.athleteBandCode)).length,
    fileName: input.fileName,
  };
}

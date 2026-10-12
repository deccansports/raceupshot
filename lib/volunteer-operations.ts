import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { KVNamespace } from "@cloudflare/workers-types";
import { getLiveTrackingHubConfig } from "./live-tracking-hub-config";
import { getBikeRackConfiguration } from "./bike-racks";
import { assignedBikeRack } from "./bike-rack-ranges";
import { calculateVolunteerOperationCounters } from "./volunteer-operation-counters";
import {
  applyParticipantChipAssignments,
  getAdminParticipantRoster,
  listParticipantChipAssignmentAudits,
  replaceParticipantAthleteBand,
  replaceParticipantChip,
} from "./participant-chip-assignments";
import { updateParticipantRosterRegistration } from "./participant-roster-import";
import { getEventBySlug, getEvents } from "./raceupshot-repository";
import {
  MANUAL_GUN_FINISH_ID,
  MANUAL_GUN_FINISH_NAME,
  listVolunteerCheckIns,
  listVolunteerManualTiming,
  recordVolunteerOperation as persistVolunteerOperation,
  listVolunteers,
  type VolunteerAssignment,
  type VolunteerModule,
  type VolunteerOperationLog,
  type VolunteerProfile,
} from "./volunteer-management";
import { dispatchCounterNotifications, readCounterTemplate, scheduleCounterNotifications } from './counter-notifications';
import { signedWaiverConfirmationEmail } from './waiver-confirmation-email';
import { createVolunteerWaiverCheckInRecord, type RelayWaiverTeam } from './signed-waivers';
import { sendBergtecnoEmail } from './bergtecno-email';
import { effectiveVolunteerWaiverVerifiedAt } from './volunteer-check-in-state';
import { getFeibotContestGunStarts, resolveFeibotContestGunStart } from './feibot-integration';
import { validateConsolidatedWaiverSelection } from './multiple-registrations';

const VOLUNTEER_CHECKIN_OTP_TEMPLATE_ID = '4816d386-8040-42d6-b2c9-c08a803c6f49';

async function recordVolunteerOperation(kind: 'checkin' | 'manual-timing', input: Omit<VolunteerOperationLog, 'id'>, notificationMode: 'BACKGROUND' | 'CALLER' = 'BACKGROUND') {
  const row = await persistVolunteerOperation(kind, input);
  if (notificationMode === 'BACKGROUND') await scheduleCounterNotifications(row);
  return row;
}

function formatGunTime(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const remainder = safe % 60;
  return [hours, minutes, remainder].map((part) => String(part).padStart(2, "0")).join(":");
}

export interface VolunteerParticipantState {
  waiverVerifiedAt: string | null;
  waiverId?: string | null;
  waiverDocumentUrl?: string | null;
  waiverResetAt: string | null;
  emailOtpVerifiedAt: string | null;
  checkedInAt: string | null;
  bikeCheckedInAt: string | null;
  bikeCheckedOutAt: string | null;
  helmetChecked: boolean;
  bikeRack: string | null;
  medalIssuedAt: string | null;
  foodIssuedAt: string | null;
  lockerNumber: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
}

export interface VolunteerParticipant {
  id: string;
  registrationId: string;
  participantId: string;
  eventId: string;
  eventEditionId: string;
  bib: string;
  name: string;
  email: string | null;
  mobile: string | null;
  emergencyContact: string | null;
  emergencyContactName: string | null;
  address: string | null;
  city: string | null;
  stateName: string | null;
  country: string | null;
  pincode: string | null;
  bloodGroup: string | null;
  dateOfBirth: string | null;
  tshirtSize: string;
  idProofUrl: string | null;
  category: string;
  raceCategoryId: string;
  sessionId: string | null;
  sessionName: string | null;
  scheduledStartAt: string | null;
  gender: string;
  ageGroup: string;
  registrationStatus: string;
  raceStatus: string;
  chipCode: string;
  athleteBandCode: string;
  participationMode: "INDIVIDUAL" | "RELAY";
  relayTeamId: string | null;
  relayTeamName: string | null;
  relayTeamSize: 2 | 3 | null;
  relayMemberNumber: number | null;
  relayMemberRole: string | null;
  relayTeam?: {
    bib: string;
    name: string;
    size: 2 | 3;
    assignedBands: number;
    remainingBands: number;
    checkedInMembers: number;
    fullyCheckedIn: boolean;
    waiverCompletedMembers: number;
    teamWaiverCompleted: boolean;
    members: Array<{ id: string; name: string; email: string | null; memberNumber: number | null; memberRole: string | null; athleteBandCode: string; waiverVerified: boolean; waiverVerifiedAt: string | null; checkedIn: boolean }>;
  };
  assignedBikeRack?: string | null;
  state: VolunteerParticipantState;
}

export type VolunteerAction =
  | "CHECK_IN"
  | "BIKE_IN"
  | "BIKE_OUT"
  | "MEDAL_ISSUE"
  | "FOOD_ISSUE"
  | "LOCKER_ASSIGN";

async function kv(): Promise<KVNamespace> {
  const { env } = await getCloudflareContext({ async: true });
  if (!env.RACEUPSHOT) throw new Error("RACEUPSHOT KV binding is unavailable.");
  return env.RACEUPSHOT;
}

async function coordinator(eventId: string) {
  const { env } = await getCloudflareContext({ async: true });
  if (!env.VOLUNTEER_OPERATIONS) throw new Error("Volunteer operation coordination is unavailable.");
  return env.VOLUNTEER_OPERATIONS.getByName(eventId);
}

function emptyState(): VolunteerParticipantState {
  return {
    waiverVerifiedAt: null,
    waiverId: null,
    waiverDocumentUrl: null,
    waiverResetAt: null,
    emailOtpVerifiedAt: null,
    checkedInAt: null,
    bikeCheckedInAt: null,
    bikeCheckedOutAt: null,
    helmetChecked: false,
    bikeRack: null,
    medalIssuedAt: null,
    foodIssuedAt: null,
    lockerNumber: null,
    updatedAt: null,
    updatedBy: null,
  };
}

function normalizeScan(value: string): string {
  const raw = value.trim();
  if (!raw) return "";
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    for (const key of ["athleteBandCode", "athlete_band_code", "chipCode", "chip_code", "bib", "bibNumber", "participantUid", "participantId", "id"]) {
      if (parsed[key] !== undefined && String(parsed[key]).trim()) return String(parsed[key]).trim();
    }
  } catch { /* plain BIB, UID or URL */ }
  if (/^https?:\/\//i.test(raw)) return decodeURIComponent(raw.split("/").filter(Boolean).at(-1) || raw);
  return raw;
}

export function activeAssignment(profile: VolunteerProfile, eventId: string): VolunteerAssignment {
  if (profile.status !== "ACTIVE") throw new Error("Volunteer access is disabled.");
  const assignment = profile.assignments.find((item) => item.eventId === eventId && item.active);
  if (!assignment) throw new Error("This event is not assigned to the volunteer.");
  return assignment;
}

export function requireModule(assignment: VolunteerAssignment, module: VolunteerModule) {
  if (!assignment.modules.includes(module)) throw new Error(`The ${module.replaceAll("_", " ").toLowerCase()} function is not assigned.`);
}

type JsonRecord = Record<string, unknown>;

function rawText(row: JsonRecord, ...keys: string[]): string {
  for (const key of keys) {
    const value = row[key];
    if (value !== null && value !== undefined && String(value).trim()) return String(value).trim();
  }
  return "";
}

export function registrationWaiverVerifiedAt(row: JsonRecord): string | null {
  // Current resets persist all three canonical fields as explicit nulls. That
  // is also the compatibility marker for resets made before waiverResetAt was
  // introduced; without it, legacy import aliases can resurrect a waiver.
  const canonicalFields = ["waiverStatus", "waiverSignedAt", "waiverVerifiedAt"];
  const explicitlyReset = canonicalFields.every((key) => Object.prototype.hasOwnProperty.call(row, key) && !rawText(row, key));
  if (rawText(row, "waiverResetAt") || explicitlyReset) return null;
  const verifiedAt = rawText(row, "waiverVerifiedAt", "waiverSignedAt", "waiverAcceptedAt", "signedWaiverAt");
  if (verifiedAt) return verifiedAt;
  const status = rawText(row, "waiverStatus", "waiver_status").toLowerCase();
  return ["signed", "verified", "accepted", "complete", "completed"].includes(status) ? "REGISTRATION_VERIFIED" : null;
}

function timestamp(value: string | null | undefined): number {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Apply reset history written by both current admin tools and older Recall builds. */
export function applyWaiverResetHistory(
  states: Record<string, VolunteerParticipantState>,
  logs: VolunteerOperationLog[],
): Record<string, VolunteerParticipantState> {
  const latestReset = new Map<string, string>();
  const latestVerification = new Map<string, string>();
  for (const log of logs) {
    const participantId = log.participantUid?.trim();
    if (!participantId) continue;
    if (log.action === "WAIVER_VERIFY") {
      if (timestamp(log.capturedAt) > timestamp(latestVerification.get(participantId))) latestVerification.set(participantId, log.capturedAt);
    } else if (log.action === "ADMIN_WAIVER_CHECK_IN_RESET" || log.action === "CHECK_IN_REVERSE") {
      if (timestamp(log.capturedAt) > timestamp(latestReset.get(participantId))) latestReset.set(participantId, log.capturedAt);
    }
  }
  return Object.fromEntries(Object.entries(states).map(([participantId, state]) => {
    const resetAt = [state.waiverResetAt, latestReset.get(participantId)]
      .filter((value): value is string => Boolean(value))
      .sort((left, right) => timestamp(right) - timestamp(left))[0] ?? null;
    const verifiedAt = latestVerification.get(participantId) || state.waiverVerifiedAt;
    if (!resetAt || timestamp(verifiedAt) > timestamp(resetAt)) return [participantId, state];
    return [participantId, { ...state, waiverVerifiedAt: null, waiverId: null, waiverDocumentUrl: null, waiverResetAt: resetAt, emailOtpVerifiedAt: null, checkedInAt: null }];
  }));
}

async function eventWaiverHistory(eventId: string): Promise<VolunteerOperationLog[]> {
  return listVolunteerCheckIns(300)
    .then((logs) => logs.filter((log) => log.eventId === eventId && ["WAIVER_VERIFY", "ADMIN_WAIVER_CHECK_IN_RESET", "CHECK_IN_REVERSE"].includes(log.action)))
    .catch(() => []);
}

type RosterParticipant = Omit<VolunteerParticipant, "state"> & { registrationWaiverVerifiedAt: string | null };

export function projectVolunteerRosterParticipant(athlete: JsonRecord): RosterParticipant | null {
  if (rawText(athlete, "rosterImportSource") !== "ADMIN_UPLOAD") return null;
  if (rawText(athlete, "publishedResultSource") === "PUBLISHED_RESULTS") return null;
  const id = rawText(athlete, "participantUid", "participantUuid", "participant_uuid", "uuid", "id") || rawText(athlete, "bib", "bibNumber");
  if (!id) return null;
  const mode = rawText(athlete, "participationMode", "contestParticipationType").toUpperCase() === "RELAY" ? "RELAY" : "INDIVIDUAL";
  const configuredSize = Number(rawText(athlete, "relayTeamSize"));
  const memberNumber = Number(rawText(athlete, "relayMemberNumber"));
  return {
    id,
    registrationId: rawText(athlete, "registrationId", "registration_id") || id,
    participantId: rawText(athlete, "profileParticipantId", "personParticipantId", "participantId") || id,
    eventId: rawText(athlete, "eventId"),
    eventEditionId: rawText(athlete, "eventEditionId", "event_edition_id") || rawText(athlete, "eventId"),
    bib: rawText(athlete, "bib", "bibNumber", "raceNumber"),
    name: rawText(athlete, "fullName", "displayName", "name", "athleteName") || "Athlete",
    email: rawText(athlete, "email", "emailAddress", "participantEmail") || null,
    mobile: rawText(athlete, "mobile", "mobileNumber", "phone", "phoneNumber", "contactNumber") || null,
    emergencyContact: rawText(athlete, "emergencyContact", "emergency_contact", "emergencyMobile", "emergencyPhone", "emergency_number") || null,
    emergencyContactName: rawText(athlete, "emergencyContactName", "emergency_contact_name", "emergencyName") || null,
    address: rawText(athlete, "address", "addressLine1", "streetAddress") || null,
    city: rawText(athlete, "city", "district") || null,
    stateName: rawText(athlete, "state", "stateName") || null,
    country: rawText(athlete, "country", "countryName") || null,
    pincode: rawText(athlete, "pincode", "pinCode", "postalCode", "zipCode") || null,
    bloodGroup: rawText(athlete, "bloodGroup", "blood_group") || null,
    dateOfBirth: rawText(athlete, "dateOfBirth", "dob", "birthDate") || null,
    tshirtSize: rawText(athlete, "tshirtSize", "tShirtSize", "t_shirt_size", "jerseySize", "shirtSize"),
    idProofUrl: rawText(athlete, "idProofUrl", "idProofURL", "id_proof_url", "idProof") || null,
    category: rawText(athlete, "contestName", "ticketName", "category", "raceCategory"),
    raceCategoryId: rawText(athlete, "raceCategoryId", "ticketId", "contestId") || rawText(athlete, "contestName", "ticketName", "category", "raceCategory"),
    sessionId: rawText(athlete, "sessionId", "session_id") || null,
    sessionName: rawText(athlete, "sessionName", "session") || null,
    scheduledStartAt: rawText(athlete, "scheduledStartAt", "sessionStartAt") || null,
    gender: rawText(athlete, "gender", "sex"),
    ageGroup: rawText(athlete, "ageGroup", "age_group", "ageCategory"),
    registrationStatus: rawText(athlete, "registrationStatus", "bookingStatus", "participantStatus") || "UNKNOWN",
    raceStatus: "UNKNOWN",
    chipCode: rawText(athlete, "chipCode", "chip_code", "chip", "rfid"),
    athleteBandCode: rawText(athlete, "athleteBandCode", "athlete_band_code", "athleteBand", "bandCode"),
    participationMode: mode,
    relayTeamId: mode === "RELAY" ? rawText(athlete, "relayTeamId") || null : null,
    relayTeamName: mode === "RELAY" ? rawText(athlete, "relayTeamName") || `Relay Team ${rawText(athlete, "bib", "bibNumber")}` : null,
    relayTeamSize: mode === "RELAY" && (configuredSize === 2 || configuredSize === 3) ? configuredSize : null,
    relayMemberNumber: mode === "RELAY" && Number.isInteger(memberNumber) && memberNumber > 0 ? memberNumber : null,
    relayMemberRole: mode === "RELAY" ? rawText(athlete, "relayMemberRole") || null : null,
    registrationWaiverVerifiedAt: registrationWaiverVerifiedAt(athlete),
  };
}

async function roster(eventId: string): Promise<RosterParticipant[]> {
  const event = await getEventBySlug(eventId, { includeUnpublished: true });
  if (!event) throw new Error("Event not found.");
  const store = await kv();
  const rows = new Map<string, RosterParticipant>();
  // Volunteer operations are intentionally seeded only from the separately
  // uploaded participant roster. The shared live participant feed may contain
  // timing-provider or legacy result rows and is not an identity source here.
  const participantRows = await applyParticipantChipAssignments(store, event.id, []);
  if (!participantRows.length) return [];
  for (const athlete of participantRows) {
    const participant = projectVolunteerRosterParticipant(athlete);
    if (participant) rows.set(participant.id, participant);
  }
  return [...rows.values()];
}

export async function searchVolunteerParticipants(input: {
  profile: VolunteerProfile;
  eventId: string;
  query: string;
  includeBikeRack?: boolean;
}): Promise<{ event: { id: string; name: string; waiverRequired: boolean; waiverVersion: string; waiverPolicy: NonNullable<Awaited<ReturnType<typeof getEventBySlug>>>["waiverPolicy"] }; participants: VolunteerParticipant[]; participantProfiles: Array<{ participantId: string; name: string; email: string | null; mobile: string | null; registrations: VolunteerParticipant[] }> }> {
  const assignment = activeAssignment(input.profile, input.eventId);
  if (assignment.modules.length === 0) throw new Error("No volunteer function is assigned for this event.");
  const event = await getEventBySlug(input.eventId, { includeUnpublished: true });
  if (!event) throw new Error("Event not found.");
  const term = normalizeScan(input.query).toLowerCase();
  if (term.length < 1) return { event: { id: event.id, name: event.name, waiverRequired: Boolean(event.waiverHtml), waiverVersion: event.waiverVersion || "", waiverPolicy: event.waiverPolicy }, participants: [], participantProfiles: [] };
  const [eventRoster, rackConfiguration] = await Promise.all([roster(event.id), input.includeBikeRack ? getBikeRackConfiguration(event.id) : Promise.resolve(null)]);
  const directMatches = eventRoster.filter((participant) => [participant.id, participant.registrationId, participant.participantId, participant.bib, participant.name, participant.email || "", participant.mobile || "", participant.emergencyContact || "", participant.category, participant.sessionId || "", participant.sessionName || "", participant.chipCode, participant.athleteBandCode, participant.relayTeamName || ""]
    .some((value) => value.toLowerCase().includes(term)));
  const matchedRelayTeams = new Set(directMatches.filter((participant) => participant.participationMode === "RELAY" && participant.relayTeamId).map((participant) => participant.relayTeamId));
  const matchedProfiles = new Set(directMatches.map((participant) => participant.participantId));
  const candidates = eventRoster.filter((participant) => directMatches.includes(participant) || matchedProfiles.has(participant.participantId) || (participant.relayTeamId && matchedRelayTeams.has(participant.relayTeamId)))
    .sort((left, right) => {
      const leftExact = [left.bib, left.id, left.chipCode, left.athleteBandCode].some((value) => value.toLowerCase() === term) ? 0 : 1;
      const rightExact = [right.bib, right.id, right.chipCode, right.athleteBandCode].some((value) => value.toLowerCase() === term) ? 0 : 1;
      return leftExact - rightExact || (left.relayMemberNumber ?? 99) - (right.relayMemberNumber ?? 99) || left.name.localeCompare(right.name);
    })
    .slice(0, 25);
  const [response, waiverHistory] = await Promise.all([
    (await coordinator(event.id)).fetch("https://volunteer-operations.internal/states", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ participantIds: candidates.map((participant) => participant.id) }),
    }),
    eventWaiverHistory(event.id),
  ]);
  const statePayload = await response.json<{ ok: boolean; states?: Record<string, VolunteerParticipantState> }>();
  if (!response.ok || !statePayload.ok) throw new Error("Volunteer participant state is unavailable.");
  const states = applyWaiverResetHistory(statePayload.states ?? {}, waiverHistory);
  const participants = candidates.map(({ registrationWaiverVerifiedAt: registeredWaiver, ...participant }) => {
      const state = { ...emptyState(), ...states[participant.id] };
      state.waiverVerifiedAt = effectiveVolunteerWaiverVerifiedAt(state, registeredWaiver);
      const configuredRack = rackConfiguration ? assignedBikeRack(participant.bib, rackConfiguration.ranges) : null;
      // Older installed volunteer builds render state.bikeRack before the newer
      // assignedBikeRack field. Project the configured range into the response
      // without mutating Durable Object history so those clients also direct the
      // athlete to the authoritative admin-configured rack.
      const projectedState = configuredRack ? { ...state, bikeRack: configuredRack } : state;
      const teamMembers = participant.relayTeamId
        ? candidates.filter((member) => member.relayTeamId === participant.relayTeamId)
        : [];
      const relayTeam = participant.participationMode === "RELAY" && participant.relayTeamSize
        ? {
          bib: participant.bib,
          name: participant.relayTeamName || `Relay Team ${participant.bib}`,
          size: participant.relayTeamSize,
          assignedBands: teamMembers.filter((member) => Boolean(member.athleteBandCode)).length,
          remainingBands: Math.max(0, participant.relayTeamSize - teamMembers.filter((member) => Boolean(member.athleteBandCode)).length),
          checkedInMembers: teamMembers.filter((member) => Boolean(states[member.id]?.checkedInAt)).length,
          fullyCheckedIn: teamMembers.length === participant.relayTeamSize && teamMembers.every((member) => Boolean(states[member.id]?.checkedInAt)),
          waiverCompletedMembers: teamMembers.filter((member) => Boolean(effectiveVolunteerWaiverVerifiedAt({ ...emptyState(), ...states[member.id] }, member.registrationWaiverVerifiedAt))).length,
          teamWaiverCompleted: teamMembers.length === participant.relayTeamSize && teamMembers.every((member) => Boolean(effectiveVolunteerWaiverVerifiedAt({ ...emptyState(), ...states[member.id] }, member.registrationWaiverVerifiedAt))),
          members: teamMembers.map((member) => ({
            id: member.id,
            name: member.name,
            email: member.email,
            memberNumber: member.relayMemberNumber,
            memberRole: member.relayMemberRole,
            athleteBandCode: member.athleteBandCode,
            waiverVerified: Boolean(effectiveVolunteerWaiverVerifiedAt({ ...emptyState(), ...states[member.id] }, member.registrationWaiverVerifiedAt)),
            waiverVerifiedAt: effectiveVolunteerWaiverVerifiedAt({ ...emptyState(), ...states[member.id] }, member.registrationWaiverVerifiedAt),
            checkedIn: Boolean(states[member.id]?.checkedInAt),
          })),
        }
        : undefined;
      return { ...participant, assignedBikeRack: configuredRack, state: projectedState, ...(relayTeam ? { relayTeam } : {}) };
    });
  const profiles = new Map<string, { participantId: string; name: string; email: string | null; mobile: string | null; registrations: VolunteerParticipant[] }>();
  for (const participant of participants) {
    const profile = profiles.get(participant.participantId) ?? { participantId: participant.participantId, name: participant.name, email: participant.email, mobile: participant.mobile, registrations: [] };
    profile.registrations.push(participant);
    profiles.set(participant.participantId, profile);
  }
  return {
    event: { id: event.id, name: event.name, waiverRequired: Boolean(event.waiverHtml), waiverVersion: event.waiverVersion || "", waiverPolicy: event.waiverPolicy },
    participants,
    participantProfiles: [...profiles.values()],
  };
}

export interface VolunteerEventCheckInSummary {
  eventId: string;
  eventName: string;
  totalAthletes: number;
  checkedInAthletes: number;
  remainingAthletes: number;
}

export interface VolunteerOperationsOverviewLog {
  id: string;
  action: string;
  bib: string;
  athleteName: string;
  volunteerName: string;
  capturedAt: string;
  status: string;
  bikeRack: string | null;
}

export interface VolunteerOperationsOverview {
  totalAthletes: number;
  checkedInAthletes: number;
  remainingToCheckIn: number;
  waiverCompletedAthletes: number;
  bikesEverCheckedIn: number;
  bikesCheckedIn: number;
  bikesCheckedOut: number;
  remainingToBikeCheckIn: number;
  remainingToBikeCheckOut: number;
  chipsAssigned: number;
  remainingToAssign: number;
  chipsAssignedToBikeEntries: number;
  remainingToAssignFromBikeEntries: number;
  checkInLogs: VolunteerOperationsOverviewLog[];
  bikeCheckInLogs: VolunteerOperationsOverviewLog[];
  bikeCheckOutLogs: VolunteerOperationsOverviewLog[];
  chipAssignmentLogs: VolunteerOperationsOverviewLog[];
}

async function participantStatesForEvent(eventId: string, participants: RosterParticipant[]) {
  const states: Record<string, VolunteerParticipantState> = {};
  for (let offset = 0; offset < participants.length; offset += 50) {
    const batch = participants.slice(offset, offset + 50);
    const response = await (await coordinator(eventId)).fetch("https://volunteer-operations.internal/states", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ participantIds: batch.map((participant) => participant.id) }),
    });
    const payload = await response.json<{ ok: boolean; states?: Record<string, VolunteerParticipantState> }>();
    if (!response.ok || !payload.ok) throw new Error("Volunteer operation totals are unavailable.");
    Object.assign(states, payload.states ?? {});
  }
  return applyWaiverResetHistory(states, await eventWaiverHistory(eventId));
}

export async function getVolunteerOperationsOverview(input: {
  profile: VolunteerProfile;
  eventId: string;
}): Promise<VolunteerOperationsOverview> {
  const assignment = activeAssignment(input.profile, input.eventId);
  const supported = assignment.modules.some((module) => [
    "WAIVER_CHECK_IN",
    "ATHLETE_CHECK_IN",
    "BIKE_CHECK_IN",
    "BIKE_CHECK_OUT",
    "TIMING_CHIP_ASSIGNMENT_COUNTER",
  ].includes(module));
  if (!supported) throw new Error("An operational counter function is not assigned.");
  const event = await getEventBySlug(input.eventId, { includeUnpublished: true });
  if (!event) throw new Error("Event not found.");
  const participants = await roster(event.id);
  // Totals are the race-day critical path. A transient failure while loading
  // optional audit rows must not blank the participant and bike counters.
  const states = await participantStatesForEvent(event.id, participants);
  const [eventLogs, chipAuditResult] = await Promise.all([
    listVolunteerCheckIns(300)
      .then((rows) => rows.filter((row) => row.eventId === event.id))
      .catch(() => [] as VolunteerOperationLog[]),
    listParticipantChipAssignmentAudits(event.id, 50)
      .catch(() => ({ event: { id: event.id, name: event.name }, audits: [] })),
  ]);
  const counters = calculateVolunteerOperationCounters(participants, states);
  const projectLogs = (actions: string[]) => eventLogs
    .filter((row) => actions.includes(row.action))
    .slice(0, 50)
    .map((row) => ({
      id: row.id,
      action: row.action,
      bib: row.bib,
      athleteName: row.athleteName,
      volunteerName: row.volunteerName,
      capturedAt: row.capturedAt,
      status: row.status,
      bikeRack: row.bikeRack ?? null,
    }));
  return {
    ...counters,
    checkInLogs: projectLogs(["CHECK_IN", "CHECK_IN_REVERSE", "ADMIN_WAIVER_CHECK_IN_RESET", "WAIVER_VERIFY"]),
    bikeCheckInLogs: projectLogs(["BIKE_IN"]),
    bikeCheckOutLogs: projectLogs(["BIKE_OUT"]),
    chipAssignmentLogs: chipAuditResult.audits.length ? chipAuditResult.audits.map((row) => ({
      id: `chip-audit:${row.id}`,
      action: "TIMING_CHIP_ASSIGNED",
      bib: row.bib,
      athleteName: row.participantName,
      volunteerName: row.changedBy,
      capturedAt: row.changedAt,
      status: row.chipCode,
      bikeRack: null,
    })) : projectLogs(["TIMING_CHIP_ASSIGNED"]),
  };
}

export async function listAuthoritativeTimingChipAssignmentLogs(limit = 300): Promise<VolunteerOperationLog[]> {
  const events = await getEvents({ includeUnpublished: true });
  const results = await Promise.all(events.map((event) => listParticipantChipAssignmentAudits(event.id, limit)
    .catch(() => ({ event: { id: event.id, name: event.name }, audits: [] }))));
  return results.flatMap(({ event, audits }) => audits.map((row): VolunteerOperationLog => ({
    id: `chip-audit:${row.id}`,
    eventId: event.id,
    eventName: event.name,
    participantUid: row.participantId,
    bib: row.bib,
    athleteName: row.participantName,
    volunteerId: row.changedBy,
    volunteerName: row.changedBy,
    action: "TIMING_CHIP_ASSIGNED",
    capturedAt: row.changedAt,
    status: row.chipCode,
  }))).sort((left, right) => Date.parse(right.capturedAt) - Date.parse(left.capturedAt)).slice(0, limit);
}

export async function getAdminVolunteerParticipantStates(
  eventId: string,
  participantIds: string[],
): Promise<Record<string, VolunteerParticipantState>> {
  if (!participantIds.length) return {};
  const event = await getEventBySlug(eventId, { includeUnpublished: true });
  if (!event) throw new Error("Event not found.");
  const ids = [...new Set(participantIds)];
  const chunks = Array.from({ length: Math.ceil(ids.length / 100) }, (_value, index) => ids.slice(index * 100, (index + 1) * 100));
  const operationCoordinator = await coordinator(event.id);
  const payloads = await Promise.all(chunks.map(async (participantIdChunk) => {
    const response = await operationCoordinator.fetch("https://volunteer-operations.internal/states", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ participantIds: participantIdChunk }),
    });
    const payload = await response.json<{ ok: boolean; states?: Record<string, VolunteerParticipantState> }>();
    if (!response.ok || !payload.ok) throw new Error("Volunteer participant state is unavailable.");
    return payload.states ?? {};
  }));
  return applyWaiverResetHistory(Object.assign({}, ...payloads), await eventWaiverHistory(event.id));
}

export async function resetAdminVolunteerWaiverCheckIn(input: {
  eventId: string;
  participantId: string;
  adminName: string;
}): Promise<VolunteerParticipantState> {
  const event = await getEventBySlug(input.eventId, { includeUnpublished: true });
  if (!event) throw new Error("Event not found.");
  const participant = (await roster(event.id)).find((row) => row.id === input.participantId || row.bib === input.participantId);
  if (!participant) throw new Error("Participant not found in this event roster.");
  const registration = (await getAdminParticipantRoster(event.id))?.rows.find((row) => {
    const id = rawText(row, "participantUid", "participantUuid", "participant_uuid", "uuid", "id");
    return id === participant.id;
  });
  const capturedAt = new Date().toISOString();
  const allowRosterOnlyWaiver = registration ? Boolean(registrationWaiverVerifiedAt(registration)) : false;
  const response = await (await coordinator(event.id)).fetch("https://volunteer-operations.internal/admin/waiver-check-in/reset", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ participantId: participant.id, adminName: input.adminName, capturedAt, allowRosterOnlyWaiver }),
  });
  const payload = await response.json<{ ok: boolean; state?: VolunteerParticipantState; error?: string }>();
  if (!response.ok || !payload.ok || !payload.state) throw new Error(payload.error || "The waiver and check-in state could not be reset.");
  if (registration) {
    await updateParticipantRosterRegistration({
      kv: await kv(),
      eventId: event.id,
      participantId: participant.id,
      patch: {
        waiverStatus: null,
        waiver_status: null,
        waiverSignedAt: null,
        waiverVerifiedAt: null,
        waiverAcceptedAt: null,
        signedWaiverAt: null,
        waiverResetAt: capturedAt,
        waiverResetBy: input.adminName,
        waiverVersion: null,
        waiverSignatureName: null,
        signatureName: null,
        waiverDocumentKey: null,
        waiverDocumentUrl: null,
        waiverDocumentSha256: null,
        waiverAuditId: null,
      },
    });
    // Signed waiver artifacts are immutable audit evidence. Reset only removes
    // the registration's active coverage link; it never deletes the document.
  }
  try {
    await persistVolunteerOperation("checkin", {
      eventId: event.id,
      eventName: event.name,
      participantUid: participant.id,
      bib: participant.bib,
      athleteName: participant.name,
      volunteerId: `admin:${input.adminName}`,
      volunteerName: input.adminName,
      action: "ADMIN_WAIVER_CHECK_IN_RESET",
      capturedAt,
      bikeRack: payload.state.bikeRack,
      lockerNumber: payload.state.lockerNumber,
      status: "RESET",
    });
  } catch (error) {
    console.error(JSON.stringify({
      type: "admin_waiver_check_in_reset_audit_failed",
      eventId: event.id,
      participantId: participant.id,
      error: error instanceof Error ? error.message : "Unknown audit failure",
    }));
  }
  return payload.state;
}

export async function resetAdminVolunteerBikeCheckIn(input: {
  eventId: string;
  participantId: string;
  adminName: string;
}): Promise<VolunteerParticipantState> {
  const event = await getEventBySlug(input.eventId, { includeUnpublished: true });
  if (!event) throw new Error("Event not found.");
  const participant = (await roster(event.id)).find((row) => row.id === input.participantId || row.bib === input.participantId);
  if (!participant) throw new Error("Participant not found in this event roster.");
  const capturedAt = new Date().toISOString();
  const response = await (await coordinator(event.id)).fetch("https://volunteer-operations.internal/admin/bike-check-in/reset", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ participantId: participant.id, adminName: input.adminName, capturedAt }),
  });
  const payload = await response.json<{ ok: boolean; state?: VolunteerParticipantState; error?: string }>();
  if (!response.ok || !payload.ok || !payload.state) throw new Error(payload.error || "The bike check-in state could not be reset.");
  try {
    await persistVolunteerOperation("checkin", {
      eventId: event.id,
      eventName: event.name,
      participantUid: participant.id,
      bib: participant.bib,
      athleteName: participant.name,
      volunteerId: `admin:${input.adminName}`,
      volunteerName: input.adminName,
      action: "ADMIN_BIKE_CHECK_IN_RESET",
      capturedAt,
      bikeRack: null,
      lockerNumber: payload.state.lockerNumber,
      status: "RESET",
    });
  } catch (error) {
    console.error(JSON.stringify({
      type: "admin_bike_check_in_reset_audit_failed",
      eventId: event.id,
      participantId: participant.id,
      error: error instanceof Error ? error.message : "Unknown audit failure",
    }));
  }
  return payload.state;
}

export async function listVolunteerEventCheckInSummaries(): Promise<VolunteerEventCheckInSummary[]> {
  const volunteers = await listVolunteers();
  const assignedEvents = new Map<string, string>();
  for (const volunteer of volunteers) {
    for (const assignment of volunteer.assignments) {
      if (assignment.active) assignedEvents.set(assignment.eventId, assignment.eventName);
    }
  }
  return Promise.all([...assignedEvents].map(async ([eventId, eventName]) => {
    const participants = await roster(eventId);
    let checkedInAthletes = 0;
    for (let offset = 0; offset < participants.length; offset += 50) {
      const batch = participants.slice(offset, offset + 50);
      const response = await (await coordinator(eventId)).fetch("https://volunteer-operations.internal/states", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ participantIds: batch.map((participant) => participant.id) }),
      });
      const payload = await response.json<{ ok: boolean; states?: Record<string, VolunteerParticipantState> }>();
      if (!response.ok || !payload.ok) throw new Error(`Check-in totals are unavailable for ${eventName}.`);
      checkedInAthletes += batch.filter((participant) => Boolean(payload.states?.[participant.id]?.checkedInAt)).length;
    }
    return {
      eventId,
      eventName,
      totalAthletes: participants.length,
      checkedInAthletes,
      remainingAthletes: Math.max(0, participants.length - checkedInAthletes),
    };
  }));
}

const actionModules: Record<VolunteerAction, VolunteerModule> = {
  CHECK_IN: "ATHLETE_CHECK_IN",
  BIKE_IN: "BIKE_CHECK_IN",
  BIKE_OUT: "BIKE_CHECK_OUT",
  MEDAL_ISSUE: "MEDAL_COUNTER",
  FOOD_ISSUE: "FOOD_COUNTER",
  LOCKER_ASSIGN: "LOCKER_COUNTER",
};

const VOLUNTEER_WAIVER_OTP_SECONDS = 5 * 60;

function secureVolunteerOtp(): string {
  const value = new Uint32Array(1);
  crypto.getRandomValues(value);
  return String(value[0] % 1_000_000).padStart(6, "0");
}

async function volunteerWaiverOtpHash(eventId: string, participantId: string, code: string): Promise<string> {
  const { env } = await getCloudflareContext({ async: true });
  const secret = env.ADMIN_SESSION_SECRET?.trim();
  if (!secret) throw new Error("Waiver OTP verification is not configured.");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(eventId + ":" + participantId + ":" + code));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function maskedEmail(email: string): string {
  const [local = "", domain = ""] = email.split("@");
  return local.slice(0, 1) + "*".repeat(Math.min(6, Math.max(2, local.length - 1))) + "@" + domain;
}

export function volunteerWaiverOtpVariables(name: string, code: string): Record<string, string> {
  return { OTP: code, NAME: name.trim() || 'Athlete' };
}

async function assignedWaiverParticipant(profile: VolunteerProfile, eventId: string, participantId: string, requestedRegistrationIds?: string[]) {
  const assignment = activeAssignment(profile, eventId);
  if (!assignment.modules.some((module) => module === "WAIVER_CHECK_IN" || module === "ATHLETE_CHECK_IN")) {
    throw new Error("The athlete check-in function is not assigned to the volunteer.");
  }
  const event = await getEventBySlug(eventId, { includeUnpublished: true });
  if (!event) throw new Error("Event not found.");
  if (!event.waiverHtml) throw new Error("This event does not have a waiver configured.");
  const eventRoster = await roster(event.id);
  const participant = eventRoster.find((row) => row.id === participantId);
  if (!participant) throw new Error("Athlete is not available in this event roster.");
  const requested = [...new Set((requestedRegistrationIds?.length ? requestedRegistrationIds : [participant.registrationId]).map((value) => value.trim()).filter(Boolean))];
  const registrations = eventRoster.filter((row) => requested.includes(row.registrationId));
  if (registrations.length !== requested.length) throw new Error("One or more selected registrations are not available.");
  if (registrations.some((row) => row.participantId !== participant.participantId)) throw new Error("A consolidated waiver cannot combine different participant profiles.");
  if (registrations.some((row) => row.registrationWaiverVerifiedAt)) throw new Error("One or more selected registrations already have a valid signed waiver. Select only uncovered registrations.");
  validateConsolidatedWaiverSelection(registrations.map((row) => ({ registrationId: row.registrationId, participantId: row.participantId, eventEditionId: row.eventEditionId || event.id, raceCategoryId: row.raceCategoryId })), event.waiverPolicy!);
  let relayTeam: RelayWaiverTeam | null = null;
  if (participant.participationMode === "RELAY" && participant.relayTeamId && participant.relayTeamSize) {
    const members = eventRoster.filter((member) => member.relayTeamId === participant.relayTeamId)
      .sort((left, right) => (left.relayMemberNumber ?? 99) - (right.relayMemberNumber ?? 99));
    const completedMembers = members.filter((member) => Boolean(member.registrationWaiverVerifiedAt)).length;
    relayTeam = {
      bib: participant.bib,
      name: participant.relayTeamName || `Relay Team ${participant.bib}`,
      size: participant.relayTeamSize,
      completed: members.length === participant.relayTeamSize && completedMembers === participant.relayTeamSize,
      completedMembers,
      members: members.map((member) => ({
        participantId: member.id,
        name: member.name,
        email: member.email || "",
        role: member.relayMemberRole || "",
        memberNumber: member.relayMemberNumber || 0,
        signedAt: member.registrationWaiverVerifiedAt,
        completed: Boolean(member.registrationWaiverVerifiedAt),
      })),
    };
  }
  return { event, participant: { ...participant, relayTeam }, registrations };
}

export async function requestVolunteerWaiverOtp(input: {
  profile: VolunteerProfile;
  eventId: string;
  participantId: string;
  registrationIds?: string[];
}): Promise<{ sent: boolean; email: string; expiresInSeconds: number; message: string }> {
  const { event, participant, registrations } = await assignedWaiverParticipant(input.profile, input.eventId, input.participantId, input.registrationIds);
  const email = participant.email?.trim().toLowerCase() || "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("This athlete has no valid email address in the event registration roster.");

  const code = secureVolunteerOtp();
  const now = Math.floor(Date.now() / 1000);
  const codeHash = await volunteerWaiverOtpHash(event.id, participant.participantId, code);
  const stub = await coordinator(event.id);
  const createResponse = await stub.fetch("https://volunteer-operations.internal/waiver-otp/request", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ participantId: participant.participantId, registrationIds: registrations.map((row) => row.registrationId), waiverVersion: event.waiverVersion || "", volunteerId: input.profile.id, codeHash, now }),
  });
  const challenge = await createResponse.json<{ ok: boolean; error?: string }>();
  if (!createResponse.ok || !challenge.ok) throw new Error(challenge.error || "The waiver OTP could not be requested.");

  const delivery = await sendBergtecnoEmail({
    recipientEmail: email,
    templateId: VOLUNTEER_CHECKIN_OTP_TEMPLATE_ID,
    // Provider template #31 declares the exact, case-sensitive {{OTP}} and {{NAME}} parameters.
    variables: volunteerWaiverOtpVariables(participant.name, code),
    singleAttempt: true,
  });
  const masked = maskedEmail(email);
  return {
    sent: delivery.sent,
    email: masked,
    expiresInSeconds: VOLUNTEER_WAIVER_OTP_SECONDS,
    message: delivery.sent
      ? "A six-digit check-in code was sent to " + masked + ". It expires in 5 minutes."
      : "Email delivery could not be confirmed. If the code arrives, enter it below; otherwise request a new code after 60 seconds.",
  };
}

export async function verifyVolunteerWaiverOtp(input: {
  profile: VolunteerProfile;
  eventId: string;
  participantId: string;
  registrationIds?: string[];
  otp: string;
  origin: string;
  signerName?: string;
  signerRelationship?: string;
  deviceSessionId?: string;
}): Promise<{ waiverId: string; coveredRegistrationIds: string[]; participants: VolunteerParticipant[] }> {
  if (!/^\d{6}$/.test(input.otp)) throw new Error("Enter the complete six-digit OTP.");
  const { event, participant, registrations } = await assignedWaiverParticipant(input.profile, input.eventId, input.participantId, input.registrationIds);
  const birthDate = Date.parse(participant.dateOfBirth || "");
  const eventDate = Date.parse(event.date || "");
  const ageAtEvent = Number.isFinite(birthDate) && Number.isFinite(eventDate) ? new Date(eventDate).getUTCFullYear() - new Date(birthDate).getUTCFullYear() - (new Date(eventDate).getUTCMonth() < new Date(birthDate).getUTCMonth() || (new Date(eventDate).getUTCMonth() === new Date(birthDate).getUTCMonth() && new Date(eventDate).getUTCDate() < new Date(birthDate).getUTCDate()) ? 1 : 0) : null;
  if (event.waiverPolicy?.requireGuardianSignatureForMinors && ageAtEvent !== null && ageAtEvent < 18 && (!input.signerName?.trim() || !input.signerRelationship?.trim() || input.signerRelationship.trim().toUpperCase() === "SELF")) {
    throw new Error("A parent or legal guardian name and relationship are required for a minor.");
  }
  const capturedAt = new Date().toISOString();
  const codeHash = await volunteerWaiverOtpHash(event.id, participant.participantId, input.otp);
  const operationCoordinator = await coordinator(event.id);
  const response = await operationCoordinator.fetch("https://volunteer-operations.internal/waiver-otp/verify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      participantId: participant.participantId,
      registrationIds: registrations.map((row) => row.registrationId),
      volunteerId: input.profile.id,
      volunteerName: input.profile.name,
      codeHash,
      capturedAt,
      now: Math.floor(Date.now() / 1000),
      signerName: input.signerName || participant.name,
      signerRelationship: input.signerRelationship || "SELF",
      deviceSessionId: input.deviceSessionId,
    }),
  });
  const payload = await response.json<{ ok: boolean; waiver?: { waiverId: string }; error?: string }>();
  if (!response.ok || !payload.ok || !payload.waiver) throw new Error(payload.error || "The waiver OTP could not be verified.");
  const operation = await recordVolunteerOperation("checkin", {
    eventId: event.id,
    eventName: event.name,
    participantUid: participant.registrationId,
    bib: participant.bib,
    athleteName: participant.name,
    volunteerId: input.profile.id,
    volunteerName: input.profile.name,
    action: "WAIVER_VERIFY",
    capturedAt,
    status: "CONFIRMED",
  }, 'CALLER');
  const configuredTemplate = await readCounterTemplate(event.id, 'WAIVER_VERIFY');
  const waiverRecord = await createVolunteerWaiverCheckInRecord({
      event: {
        id: event.id,
        name: event.name,
        date: event.date,
        location: event.location,
        waiverHtml: event.waiverHtml || "",
        waiverVersion: event.waiverVersion,
        waiverParameterMappings: event.waiverParameterMappings,
        organizer: event.organizer,
        companyDescription: event.companyDescription,
        organizerAddress: event.organizerAddress,
        jurisdiction: event.jurisdiction,
      },
      participant,
      registrations: registrations.map((row) => ({ registrationId: row.registrationId, bib: row.bib, category: row.category, sessionName: row.sessionName })),
      waiverId: payload.waiver.waiverId,
      verifiedAt: capturedAt,
      volunteerId: input.profile.id,
      volunteerName: input.profile.name,
      signerName: input.signerName || participant.name,
      signerRelationship: input.signerRelationship || "SELF",
      origin: input.origin,
      });
  const finalizeResponse = await operationCoordinator.fetch("https://volunteer-operations.internal/waiver/finalize", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ waiverId: payload.waiver.waiverId, participantId: participant.participantId, registrationIds: registrations.map((row) => row.registrationId), documentUrl: waiverRecord.documentUrl, documentHash: waiverRecord.documentHash, capturedAt }),
  });
  const finalized = await finalizeResponse.json<{ ok: boolean; states?: Record<string, VolunteerParticipantState>; error?: string }>();
  if (!finalizeResponse.ok || !finalized.ok || !finalized.states) throw new Error(finalized.error || "The signed waiver could not be finalized.");
  try {
    const email = configuredTemplate.email.enabled ? {
      ...configuredTemplate.email,
      attachWaiver: Boolean(waiverRecord),
    } : {
      ...configuredTemplate.email,
      enabled: true,
      mode: 'CUSTOM' as const,
      subject: 'Waiver signed | {{event_name}}',
      body: 'Hello {{name}},\n\nYour waiver for {{event_name}} (BIB {{bib}}) is signed. Check-in is recorded separately for each registration.',
      mappings: [
        { token: 'name', variable: 'name' as const },
        { token: 'event_name', variable: 'event_name' as const },
        { token: 'bib', variable: 'bib' as const },
      ],
      attachWaiver: Boolean(waiverRecord),
    };
    await dispatchCounterNotifications(operation, {
      participant: { ...participant, ...(waiverRecord?.participant || {}) },
      template: {
        ...configuredTemplate,
        email,
        waiver: { ...configuredTemplate.waiver, allowedOrigin: new URL(input.origin).origin },
      },
      ...(waiverRecord ? { emailAttachment: waiverRecord.emailAttachment } : {}),
      emailHtml: signedWaiverConfirmationEmail({
        athleteName: participant.name,
        eventName: event.name,
        category: participant.category,
        eventDate: event.date || '',
        bib: participant.bib,
        signedAt: capturedAt,
        attachmentIncluded: Boolean(waiverRecord),
      }),
    });
  } catch (error) {
    console.error(JSON.stringify({
      type: 'volunteer_waiver_check_in_notification_failed',
      operationId: operation.id,
      eventId: event.id,
      error: error instanceof Error ? error.message : 'Unknown notification failure',
    }));
  }
  return {
    waiverId: payload.waiver.waiverId,
    coveredRegistrationIds: registrations.map((row) => row.registrationId),
    participants: registrations.map((row) => ({ ...row, state: finalized.states![row.registrationId] || emptyState() })),
  };
}

export async function performVolunteerAction(input: {
  profile: VolunteerProfile;
  eventId: string;
  participantId: string;
  action: VolunteerAction;
  helmetChecked?: boolean;
  bikeRack?: string;
  lockerNumber?: string;
}): Promise<VolunteerParticipant> {
  const assignment = activeAssignment(input.profile, input.eventId);
  const requiredModule = actionModules[input.action];
  const combinedCheckInAllowed = input.action === "CHECK_IN"
    && (assignment.modules.includes("ATHLETE_CHECK_IN") || assignment.modules.includes("WAIVER_CHECK_IN"));
  if (!combinedCheckInAllowed) requireModule(assignment, requiredModule);
  const event = await getEventBySlug(input.eventId, { includeUnpublished: true });
  if (!event) throw new Error("Event not found.");
  const participant = (await roster(event.id)).find((row) => row.id === input.participantId || row.bib === input.participantId);
  if (!participant) throw new Error("Athlete is not available in this event roster.");
  if (input.action === "CHECK_IN") {
    if (["CANCELLED", "CANCELED", "REFUNDED", "DEFERRED", "INACTIVE"].includes(participant.registrationStatus.toUpperCase())) throw new Error("This registration is not active for check-in.");
    const scheduledStart = Date.parse(participant.scheduledStartAt || "");
    if (!event.waiverPolicy?.allowCheckInBeforeScheduledSession && Number.isFinite(scheduledStart) && Date.now() < scheduledStart) throw new Error("Check-in is not open for this scheduled session yet.");
  }
  const authoritativeRegistration = (await getAdminParticipantRoster(event.id))?.rows.find((row) => rawText(row, "registrationId", "registration_id", "participantUid") === participant.registrationId);
  const rosterWaiverVersion = authoritativeRegistration ? rawText(authoritativeRegistration, "waiverVersion") : "";
  const compatibleRosterWaiver = participant.registrationWaiverVerifiedAt && (!event.waiverVersion || rosterWaiverVersion === event.waiverVersion)
    ? participant.registrationWaiverVerifiedAt
    : null;
  const configuredRack = input.action === "BIKE_IN" ? assignedBikeRack(participant.bib, (await getBikeRackConfiguration(event.id)).ranges) : null;
  const now = new Date().toISOString();
  const response = await (await coordinator(event.id)).fetch("https://volunteer-operations.internal/action", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      participantId: participant.id,
      action: input.action,
      volunteerName: input.profile.name,
      waiverRequired: Boolean(event.waiverHtml),
      registrationWaiverVerifiedAt: compatibleRosterWaiver,
      helmetChecked: input.helmetChecked,
      bikeRack: configuredRack || input.bikeRack,
      lockerNumber: input.lockerNumber,
      capturedAt: now,
    }),
  });
  const payload = await response.json<{ ok: boolean; state?: VolunteerParticipantState; error?: string }>();
  if (!response.ok || !payload.ok || !payload.state) throw new Error(payload.error || "The volunteer action could not be recorded.");
  const next = payload.state;
  await recordVolunteerOperation("checkin", {
    eventId: event.id,
    eventName: event.name,
    participantUid: participant.id,
    bib: participant.bib,
    athleteName: participant.name,
    volunteerId: input.profile.id,
    volunteerName: input.profile.name,
    action: input.action,
    capturedAt: now,
    bikeRack: next.bikeRack,
    lockerNumber: next.lockerNumber,
    status: "CONFIRMED",
  });
  return {
    ...participant,
    assignedBikeRack: configuredRack,
    state: { ...next, waiverVerifiedAt: effectiveVolunteerWaiverVerifiedAt(next, compatibleRosterWaiver) },
  };
}

export async function checkInAllEligibleRegistrations(input: { profile: VolunteerProfile; eventId: string; participantId: string }): Promise<VolunteerParticipant[]> {
  const event = await getEventBySlug(input.eventId, { includeUnpublished: true });
  if (!event) throw new Error("Event not found.");
  if (!event.waiverPolicy?.allowCheckInAll) throw new Error("Check in all is disabled for this event.");
  const registrations = (await roster(event.id)).filter((row) => row.participantId === input.participantId);
  if (!registrations.length) throw new Error("No registrations were found for this participant.");
  const results: VolunteerParticipant[] = [];
  for (const registration of registrations.filter((row) => !["CANCELLED", "CANCELED", "REFUNDED", "DEFERRED", "INACTIVE"].includes(row.registrationStatus.toUpperCase()))) {
    const current = (await getAdminVolunteerParticipantStates(event.id, [registration.id]))[registration.id];
    if (current?.checkedInAt) continue;
    results.push(await performVolunteerAction({ profile: input.profile, eventId: event.id, participantId: registration.id, action: "CHECK_IN" }));
  }
  return results;
}

export type ParticipantEquipmentKind = "chip" | "athlete-band";

export async function assignParticipantEquipment(input: {
  profile: VolunteerProfile;
  eventId: string;
  participantId: string;
  kind: ParticipantEquipmentKind;
  code: string;
}): Promise<VolunteerParticipant> {
  const assignment = activeAssignment(input.profile, input.eventId);
  const combinedAthleteBandAllowed = input.kind === "athlete-band"
    && (assignment.modules.includes("ATHLETE_BAND_ASSIGNMENT_COUNTER")
      || assignment.modules.includes("WAIVER_CHECK_IN")
      || assignment.modules.includes("ATHLETE_CHECK_IN"));
  if (!combinedAthleteBandAllowed) {
    requireModule(assignment, input.kind === "chip" ? "TIMING_CHIP_ASSIGNMENT_COUNTER" : "ATHLETE_BAND_ASSIGNMENT_COUNTER");
  }
  const code = input.code.trim().replace(/\s+/g, "").toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9._:-]{1,63}$/.test(code)) throw new Error("Assignment code must be 2-64 characters using letters, numbers, dot, dash, underscore, or colon.");
  const before = await searchVolunteerParticipants({ profile: input.profile, eventId: input.eventId, query: input.participantId });
  const participant = before.participants.find((row) => row.id === input.participantId || row.bib === input.participantId);
  if (!participant) throw new Error("Athlete is not available in this event roster.");
  const existing = input.kind === "chip" ? participant.chipCode : participant.athleteBandCode;
  if (input.kind === "chip" && existing) {
    throw new Error(`Timing chip ${existing} is already assigned. Replacement requires an authorized administrator.`);
  }
  if (existing.toLowerCase() === code.toLowerCase()) throw new Error(`This ${input.kind === "chip" ? "timing chip" : "athlete band"} is already assigned to the athlete.`);
  if (input.kind === "athlete-band" && participant.participationMode === "RELAY") {
    if (!participant.relayTeam || !participant.relayTeamSize || !participant.relayMemberNumber) {
      throw new Error("This relay registration is incomplete. Configure the team size and member number before assigning bands.");
    }
    if (!existing && participant.relayTeam.remainingBands <= 0) {
      throw new Error(`Relay BIB ${participant.bib} already has all ${participant.relayTeamSize} wristbands assigned.`);
    }
  }
  if (input.kind === "athlete-band" && participant.participationMode === "RELAY" && before.event.waiverRequired && !participant.state.waiverVerifiedAt) {
    throw new Error("This athlete must complete and verify their individual waiver before a wristband can be assigned.");
  }
  if (input.kind === "chip") {
    await replaceParticipantChip({ eventIdOrSlug: input.eventId, participantId: participant.id, chipCode: code, reason: "Volunteer counter assignment", changedBy: `${input.profile.name} (${input.profile.id})` });
  } else {
    await replaceParticipantAthleteBand({ eventIdOrSlug: input.eventId, participantId: participant.id, athleteBandCode: code, reason: "Volunteer counter assignment", changedBy: `${input.profile.name} (${input.profile.id})` });
  }
  await recordVolunteerOperation("checkin", {
    eventId: input.eventId, eventName: before.event.name, participantUid: participant.id, bib: participant.bib,
    athleteName: participant.name, volunteerId: input.profile.id, volunteerName: input.profile.name,
    action: input.kind === "chip" ? "TIMING_CHIP_ASSIGNED" : "ATHLETE_BAND_ASSIGNED", capturedAt: new Date().toISOString(), status: code,
  });
  return input.kind === "chip"
    ? { ...participant, chipCode: code }
    : { ...participant, athleteBandCode: code, relayTeam: participant.relayTeam ? {
      ...participant.relayTeam,
      assignedBands: participant.relayTeam.assignedBands + (existing ? 0 : 1),
      remainingBands: Math.max(0, participant.relayTeam.remainingBands - (existing ? 0 : 1)),
      members: participant.relayTeam.members.map((member) => member.id === participant.id ? { ...member, athleteBandCode: code } : member),
    } : undefined };
}

export interface VolunteerBandTarget {
  id: string;
  name: string;
  email: string;
  mobile: string;
  bandCode: string | null;
}

export async function searchVolunteerBandTargets(input: {
  profile: VolunteerProfile;
  eventId: string;
  query: string;
}): Promise<VolunteerBandTarget[]> {
  const operatorAssignment = activeAssignment(input.profile, input.eventId);
  requireModule(operatorAssignment, "VOLUNTEER_BAND_ASSIGNMENT_COUNTER");
  const term = input.query.trim().toLowerCase();
  if (!term) return [];
  const candidates = (await listVolunteers()).filter((volunteer) =>
    volunteer.status !== "DISABLED"
    && volunteer.assignments.some((assignment) => assignment.eventId === input.eventId && assignment.active)
    && [volunteer.id, volunteer.name, volunteer.email, volunteer.mobile].some((value) => value.toLowerCase().includes(term)),
  ).slice(0, 25);
  const response = await (await coordinator(input.eventId)).fetch("https://volunteer-operations.internal/volunteer-band/states", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ volunteerIds: candidates.map((volunteer) => volunteer.id) }),
  });
  const payload = await response.json<{ ok: boolean; assignments?: Record<string, string | null> }>();
  if (!response.ok || !payload.ok) throw new Error("Volunteer band assignments are unavailable.");
  return candidates.map((volunteer) => ({ id: volunteer.id, name: volunteer.name, email: volunteer.email, mobile: volunteer.mobile, bandCode: payload.assignments?.[volunteer.id] ?? null }));
}

export async function assignVolunteerBand(input: {
  profile: VolunteerProfile;
  eventId: string;
  volunteerId: string;
  bandCode: string;
}): Promise<VolunteerBandTarget> {
  const operatorAssignment = activeAssignment(input.profile, input.eventId);
  requireModule(operatorAssignment, "VOLUNTEER_BAND_ASSIGNMENT_COUNTER");
  const target = (await listVolunteers()).find((volunteer) => volunteer.id === input.volunteerId && volunteer.status !== "DISABLED" && volunteer.assignments.some((assignment) => assignment.eventId === input.eventId && assignment.active));
  if (!target) throw new Error("Volunteer is not assigned to this event.");
  const response = await (await coordinator(input.eventId)).fetch("https://volunteer-operations.internal/volunteer-band/assign", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ volunteerId: target.id, bandCode: input.bandCode }),
  });
  const payload = await response.json<{ ok: boolean; bandCode?: string; error?: string }>();
  if (!response.ok || !payload.ok || !payload.bandCode) throw new Error(payload.error || "Volunteer band could not be assigned.");
  const event = await getEventBySlug(input.eventId, { includeUnpublished: true });
  await recordVolunteerOperation("checkin", {
    eventId: input.eventId, eventName: event?.name || input.eventId, participantUid: target.id, bib: "",
    athleteName: target.name, volunteerId: input.profile.id, volunteerName: input.profile.name,
    action: "VOLUNTEER_BAND_ASSIGNED", capturedAt: new Date().toISOString(), status: payload.bandCode,
  });
  return { id: target.id, name: target.name, email: target.email, mobile: target.mobile, bandCode: payload.bandCode };
}

export async function captureVolunteerTiming(input: {
  profile: VolunteerProfile;
  eventId: string;
  participantId: string;
  timingPointId?: string;
  capturedAt?: string;
  gunStartAt?: string;
}): Promise<{ id: string; participant: VolunteerParticipant; timingPointId: string; timingPointName: string; capturedAt: string; timingMode: "GUN" | "TIMING_POINT"; gunStartAt: string | null; gunElapsedSeconds: number | null; gunTime: string | null }> {
  const assignment = activeAssignment(input.profile, input.eventId);
  requireModule(assignment, "MANUAL_TIMING");
  const event = await getEventBySlug(input.eventId, { includeUnpublished: true });
  if (!event) throw new Error("Event not found.");
  const hub = await getLiveTrackingHubConfig(event.id);
  if (!hub) throw new Error("Live timing configuration is unavailable for this event.");
  const requestedPointId = input.timingPointId?.trim() || "";
  const automaticTiming = assignment.timingPointIds.length === 0;
  let timingPointId = requestedPointId;
  let timingPointName = "";
  if (automaticTiming) {
    const visiblePoints = hub.timingPoints.filter((point) => point.visible !== false);
    const requestedPoint = visiblePoints.find((point) => point.id === requestedPointId);
    const finishPoint = visiblePoints.filter((point) => point.type === "FINISH").toSorted((left, right) => left.order - right.order).at(-1);
    const resolvedPoint = requestedPoint || finishPoint;
    timingPointId = resolvedPoint?.id || MANUAL_GUN_FINISH_ID;
    timingPointName = resolvedPoint?.name || MANUAL_GUN_FINISH_NAME;
  } else {
    if (!requestedPointId || !assignment.timingPointIds.includes(requestedPointId)) throw new Error("This timing point is not assigned to the volunteer.");
    const pointIndex = assignment.timingPointIds.indexOf(requestedPointId);
    timingPointName = assignment.timingPointNames[pointIndex] || requestedPointId;
  }
  const participant = (await roster(event.id)).find((row) => row.id === input.participantId || row.bib === input.participantId);
  if (!participant) throw new Error("Athlete is not available in this event roster.");
  const supplied = Date.parse(input.capturedAt || "");
  if (input.capturedAt && !Number.isFinite(supplied)) throw new Error("The device supplied an invalid finish time.");
  if (input.capturedAt && Math.abs(Date.now() - supplied) > 24 * 60 * 60 * 1_000) {
    throw new Error("The device clock differs from server time by more than 24 hours. Correct the device date and time before recording a finish.");
  }
  const capturedAt = input.capturedAt ? new Date(supplied).toISOString() : new Date().toISOString();
  const contestGunStart = resolveFeibotContestGunStart(
    participant.category,
    hub.contestMappings,
    await getFeibotContestGunStarts(event.id),
  );
  const officialContestGunStart = Date.parse(contestGunStart?.gunStartAt || "");
  const suppliedGunStart = Date.parse(input.gunStartAt || "");
  const configuredGunStart = Date.parse(hub.start.gunStartAt || "");
  const gunStartMs = Number.isFinite(officialContestGunStart)
    ? officialContestGunStart
    : Number.isFinite(suppliedGunStart)
      ? suppliedGunStart
      : configuredGunStart;
  const gunStartAt = Number.isFinite(gunStartMs) ? new Date(gunStartMs).toISOString() : null;
  const elapsed = gunStartAt ? Math.max(0, Math.floor((Date.parse(capturedAt) - Date.parse(gunStartAt)) / 1_000)) : null;
  const timingMode = timingPointId === MANUAL_GUN_FINISH_ID ? "GUN" : "TIMING_POINT";
  const row = await recordVolunteerOperation("manual-timing", {
    eventId: event.id,
    eventName: event.name,
    participantUid: participant.id,
    bib: participant.bib,
    athleteName: participant.name,
    volunteerId: input.profile.id,
    volunteerName: input.profile.name,
    action: "MANUAL_TIMING_CAPTURED",
    timingPointName,
    timingMode,
    gunStartAt,
    gunElapsedSeconds: elapsed,
    gunTime: elapsed === null ? null : formatGunTime(elapsed),
    capturedAt,
    status: elapsed === null && timingMode === "GUN" ? "RECORDED · GUN START REQUIRED" : "RECORDED",
  });
  return { id: row.id, participant: { ...participant, state: emptyState() }, timingPointId, timingPointName, capturedAt, timingMode, gunStartAt, gunElapsedSeconds: elapsed, gunTime: elapsed === null ? null : formatGunTime(elapsed) };
}

export async function listRecentVolunteerTiming(input: {
  profile: VolunteerProfile;
  eventId: string;
  limit?: number;
}): Promise<VolunteerOperationLog[]> {
  const assignment = activeAssignment(input.profile, input.eventId);
  requireModule(assignment, "MANUAL_TIMING");
  const rows = await listVolunteerManualTiming(300);
  const resetIds = new Set(rows
    .filter((row) => row.eventId === input.eventId && row.action === "MANUAL_TIMING_RESET" && row.reversesOperationId)
    .map((row) => row.reversesOperationId as string));
  return rows
    .filter((row) => row.eventId === input.eventId && row.action === "MANUAL_TIMING_CAPTURED" && !resetIds.has(row.id))
    .slice(0, Math.max(1, Math.min(input.limit ?? 25, 50)));
}

export async function resetVolunteerTiming(input: {
  profile: VolunteerProfile;
  eventId: string;
  operationId: string;
}): Promise<VolunteerOperationLog> {
  const assignment = activeAssignment(input.profile, input.eventId);
  requireModule(assignment, "MANUAL_TIMING");
  const rows = await listVolunteerManualTiming(300);
  const original = rows.find((row) => row.id === input.operationId && row.eventId === input.eventId && row.action === "MANUAL_TIMING_CAPTURED");
  if (!original) throw new Error("The timing stamp is not available to reset.");
  if (rows.some((row) => row.eventId === input.eventId && row.action === "MANUAL_TIMING_RESET" && row.reversesOperationId === original.id)) {
    throw new Error("This timing stamp has already been reset.");
  }
  return recordVolunteerOperation("manual-timing", {
    eventId: original.eventId,
    eventName: original.eventName,
    participantUid: original.participantUid,
    bib: original.bib,
    athleteName: original.athleteName,
    volunteerId: input.profile.id,
    volunteerName: input.profile.name,
    action: "MANUAL_TIMING_RESET",
    reversesOperationId: original.id,
    timingPointName: original.timingPointName,
    timingMode: original.timingMode,
    gunStartAt: original.gunStartAt,
    gunElapsedSeconds: original.gunElapsedSeconds,
    gunTime: original.gunTime,
    capturedAt: new Date().toISOString(),
    status: "RESET",
  });
}

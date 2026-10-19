import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { KVNamespace } from "@cloudflare/workers-types";
import type { LiveParticipant } from "@/packages/contracts/src";
import { getCanonicalLiveEvent } from "./canonical-live-tracking";
import { getLiveTrackingHubConfig } from "./live-tracking-hub-config";
import { getEventPlatformSettings } from "./platform-repository";
import { getEvents } from "./raceupshot-repository";
import { mapWithConcurrency } from "./map-with-concurrency";
import { withTransientKvRetry } from "./kv-retry";
import { z } from "./zod";
import { createVolunteerPasswordCredential, volunteerPasswordKey } from "./volunteer-password";

const PREFIX = "raceupshot:volunteer";
const INDEX_KEY = `${PREFIX}:profiles:index`;
const ACTIVITY_INDEX_KEY = `${PREFIX}:activity:index`;
const GLOBAL_AUDIT_INDEX_KEY = "raceupshot:timing:audit:index";

export const VOLUNTEER_MODULES = [
  "ATHLETE_LOOKUP",
  "WAIVER_CHECK_IN",
  "ATHLETE_CHECK_IN",
  "BIKE_CHECK_IN",
  "BIKE_CHECK_OUT",
  "MEDAL_COUNTER",
  "FOOD_COUNTER",
  "PAID_FOOD_COUNTER",
  "LOCKER_COUNTER",
  "COUNTER",
  "FINISH_LINE_VOLUNTEER",
  "CUTOFF_TIME_VOLUNTEER",
  "TIMING_CHIP_ASSIGNMENT_COUNTER",
  "ATHLETE_BAND_ASSIGNMENT_COUNTER",
  "VOLUNTEER_BAND_ASSIGNMENT_COUNTER",
  "MANUAL_TIMING",
] as const;
export type VolunteerModule = (typeof VOLUNTEER_MODULES)[number];
export function normalizeVolunteerModules(modules: readonly VolunteerModule[]): VolunteerModule[] {
  return [...new Set(modules.map((module) => module === "WAIVER_CHECK_IN" ? "ATHLETE_CHECK_IN" : module))];
}
export type VolunteerStatus = "INVITED" | "ACTIVE" | "DISABLED";
export const MANUAL_GUN_FINISH_ID = "manual-gun-finish";
export const MANUAL_GUN_FINISH_NAME = "Manual Gun Finish";

export interface VolunteerAssignment {
  id: string;
  eventId: string;
  eventName: string;
  modules: VolunteerModule[];
  providerEventUuid: string | null;
  contestUuids: string[];
  timingPointIds: string[];
  timingPointNames: string[];
  customCounterIds: string[];
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface VolunteerProfile {
  id: string;
  name: string;
  email: string;
  mobile: string;
  status: VolunteerStatus;
  assignments: VolunteerAssignment[];
  createdAt: string;
  updatedAt: string;
  lastActiveAt: string | null;
  hasPassword?: boolean;
}

export interface VolunteerActivity {
  id: string;
  action: string;
  entity: string;
  volunteerId: string | null;
  eventId: string | null;
  actor: string;
  createdAt: string;
  severity: "normal" | "warning";
  detail: string;
}

export interface VolunteerOperationLog {
  id: string;
  eventId: string;
  eventName: string;
  participantUid: string;
  /** Canonical timing-provider identity resolved when the stamp was captured. */
  canonicalParticipantUid?: string | null;
  bib: string;
  athleteName: string;
  category?: string;
  gender?: string;
  ageGroup?: string;
  volunteerId: string;
  volunteerName: string;
  volunteerEmail?: string;
  action: string;
  reversesOperationId?: string;
  bikeRack?: string | null;
  lockerNumber?: string | null;
  assignedChipCode?: string | null;
  returnedChipCode?: string | null;
  returnedChipFullEpc?: string | null;
  chipReturnStatus?: "PENDING_RETURN" | "RETURNED" | "NOT_RETURNED" | "NO_CHIP_ASSIGNED";
  chipReturnMethod?: "CAMERA" | "RFID" | "MANUAL" | "OVERRIDE" | "NO_CHIP_ASSIGNED" | null;
  chipReturnReason?: string | null;
  bikeCheckoutTransactionId?: string | null;
  timingPointName?: string;
  timingMode?: "GUN" | "TIMING_POINT";
  gunStartAt?: string | null;
  gunElapsedSeconds?: number | null;
  gunTime?: string | null;
  elapsedStartAt?: string | null;
  elapsedStartSource?: "CHIP" | "GUN" | null;
  elapsedSeconds?: number | null;
  elapsedTime?: string | null;
  canReset?: boolean;
  capturedAt: string;
  serverReceivedAt?: string;
  deviceTimeZone?: string;
  clockSkewMilliseconds?: number | null;
  clockWarning?: string | null;
  configuredStartMode?: "CHIP" | "WAVE" | "GUN" | null;
  startVerification?: string | null;
  status: string;
  overallRank?: number | null;
  categoryRank?: number | null;
  genderRank?: number | null;
  ageGroupRank?: number | null;
  rankingStartAt?: string | null;
  rankingEndAt?: string | null;
  rankingElapsedMilliseconds?: number | null;
  rankingChipElapsedMilliseconds?: number | null;
  rankingGunElapsedMilliseconds?: number | null;
  manualChipElapsedMilliseconds?: number | null;
  manualGunElapsedMilliseconds?: number | null;
  rankingResultSource?: "CANONICAL" | "MANUAL" | null;
  rankingStartSource?: "CANONICAL" | "SAVED_CHIP" | "SAVED_GUN" | null;
}

export interface VolunteerEventOption {
  id: string;
  name: string;
  categories: string[];
  providerEventUuid: string | null;
  contestUuids: string[];
  timingPoints: Array<{ id: string; name: string; type: "START" | "SPLIT" | "FINISH" }>;
}

function normalizedEventIdentity(value: string | null | undefined): string {
  return (value ?? "").trim().toLocaleLowerCase("en-IN").replace(/[^a-z0-9]+/g, "");
}

/**
 * Event IDs are authoritative. Provider UUID and event-name matching preserve
 * assignments created before an event record was re-keyed or re-imported.
 */
export function volunteerAssignmentMatchesEvent(
  assignment: Pick<VolunteerAssignment, "eventId" | "eventName" | "providerEventUuid">,
  event: Pick<VolunteerEventOption, "id" | "name" | "providerEventUuid">,
): boolean {
  if (assignment.eventId.trim() === event.id.trim()) return true;
  if (assignment.providerEventUuid && event.providerEventUuid
    && assignment.providerEventUuid.trim() === event.providerEventUuid.trim()) return true;
  const assignmentName = normalizedEventIdentity(assignment.eventName);
  return Boolean(assignmentName && assignmentName === normalizedEventIdentity(event.name));
}

const assignmentInput = z.object({
  id: z.string().trim().max(150).optional(),
  eventId: z.string().trim().min(1, "Choose an event."),
  modules: z.array(z.enum(VOLUNTEER_MODULES)).min(1, "Choose at least one module."),
  timingPointIds: z.array(z.string().trim().min(1)).max(100).default([]),
  customCounterIds: z.array(z.string().trim().min(1)).max(100).default([]),
  active: z.boolean().default(true),
});

export const volunteerProfileInput = z.object({
  id: z.string().trim().max(150).optional(),
  name: z.string().trim().min(2, "Enter the volunteer name.").max(120),
  email: z.string().trim().email("Enter a valid email address.").max(180),
  mobile: z.string().trim().max(30).default(""),
  status: z.enum(["INVITED", "ACTIVE", "DISABLED"]),
  assignments: z.array(assignmentInput).max(50).default([]),
  password: z.string().max(128).optional().default("").refine((value) => !value || value.length >= 6, "Password must contain at least 6 characters."),
});

export type VolunteerProfileInput = z.infer<typeof volunteerProfileInput>;

async function getKv(): Promise<KVNamespace> {
  const { env } = await getCloudflareContext({ async: true });
  if (!env.RACEUPSHOT) throw new Error("RACEUPSHOT KV binding is unavailable.");
  return withTransientKvRetry(env.RACEUPSHOT);
}

function profileKey(id: string) {
  return `${PREFIX}:profile:${encodeURIComponent(id)}`;
}

async function readIndex(kv: KVNamespace, key: string): Promise<string[]> {
  const value = await kv.get<unknown>(key, "json");
  return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}

async function appendIndex(kv: KVNamespace, key: string, id: string) {
  const ids = await readIndex(kv, key);
  if (!ids.includes(id)) await kv.put(key, JSON.stringify([...ids, id]));
}

async function removeIndex(kv: KVNamespace, key: string, id: string) {
  const ids = await readIndex(kv, key);
  await kv.put(key, JSON.stringify(ids.filter((item) => item !== id)));
}

async function writeActivity(
  kv: KVNamespace,
  input: Omit<VolunteerActivity, "id" | "createdAt" | "actor" | "severity"> & {
    actor?: string;
    severity?: VolunteerActivity["severity"];
  },
) {
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const row: VolunteerActivity = {
    id,
    createdAt,
    actor: input.actor || "Race Upshot admin",
    severity: input.severity || "normal",
    action: input.action,
    entity: input.entity,
    volunteerId: input.volunteerId,
    eventId: input.eventId,
    detail: input.detail,
  };
  await Promise.all([
    kv.put(`${PREFIX}:activity:${id}`, JSON.stringify(row)),
    kv.put(`raceupshot:timing:audit:${id}`, JSON.stringify(row)),
    appendIndex(kv, ACTIVITY_INDEX_KEY, id),
    appendIndex(kv, GLOBAL_AUDIT_INDEX_KEY, id),
  ]);
}

export async function listVolunteerEventOptions(): Promise<VolunteerEventOption[]> {
  const events = await getEvents({ includeUnpublished: true });
  return mapWithConcurrency(events, 4, async (event) => {
    const [settings, hub] = await Promise.all([
      getEventPlatformSettings(event.id),
      getLiveTrackingHubConfig(event.id),
    ]);
    return {
      id: event.id,
      name: event.name,
      categories: [...new Set([
        ...(event.ticketDefinitions ?? []).map((ticket) => ticket.name),
        ...(event.tickets ?? []).map((ticket) => ticket.name),
        ...(event.categories ?? []),
      ].map((category) => category.trim()).filter(Boolean))],
      providerEventUuid: settings?.timingIntegration?.providerEventUuid || null,
      contestUuids: [...new Set((hub?.contestMappings ?? []).map((mapping) => mapping.providerContestUuid).filter(Boolean))],
      timingPoints: (hub?.timingPoints ?? [])
        .filter((point) => point.visible !== false)
        .toSorted((left, right) => left.order - right.order)
        .map((point) => ({ id: point.id, name: point.name, type: point.type })),
    };
  });
}

export async function listVolunteers(): Promise<VolunteerProfile[]> {
  const kv = await getKv();
  const ids = await readIndex(kv, INDEX_KEY);
  const rows = await mapWithConcurrency(ids, 4, (id) => kv.get<VolunteerProfile>(profileKey(id), "json"));
  return rows
    .filter((row): row is VolunteerProfile => Boolean(row))
    .map((row) => ({ ...row, assignments: row.assignments.map((assignment) => ({ ...assignment, modules: normalizeVolunteerModules(assignment.modules), customCounterIds: assignment.customCounterIds ?? [] })) }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

export async function getVolunteerById(id: string): Promise<VolunteerProfile | null> {
  const volunteer = await (await getKv()).get<VolunteerProfile>(profileKey(id), "json");
  return volunteer ? { ...volunteer, assignments: volunteer.assignments.map((assignment) => ({ ...assignment, modules: normalizeVolunteerModules(assignment.modules), customCounterIds: assignment.customCounterIds ?? [] })) } : null;
}

export async function getVolunteerByEmail(emailInput: string): Promise<VolunteerProfile | null> {
  const email = emailInput.trim().toLowerCase();
  return (await listVolunteers()).find((volunteer) => volunteer.email === email) ?? null;
}

export async function markVolunteerActive(id: string): Promise<VolunteerProfile> {
  const kv = await getKv();
  const volunteer = await kv.get<VolunteerProfile>(profileKey(id), "json");
  if (!volunteer) throw new Error("Volunteer not found.");
  if (volunteer.status === "DISABLED") throw new Error("Volunteer access is disabled.");
  const saved: VolunteerProfile = {
    ...volunteer,
    status: "ACTIVE",
    lastActiveAt: new Date().toISOString(),
    updatedAt: volunteer.status === "INVITED" ? new Date().toISOString() : volunteer.updatedAt,
  };
  await kv.put(profileKey(id), JSON.stringify(saved));
  return saved;
}

export async function saveVolunteer(input: VolunteerProfileInput): Promise<VolunteerProfile> {
  const kv = await getKv();
  const events = await listVolunteerEventOptions();
  const eventById = new Map(events.map((event) => [event.id, event]));
  const existingRows = await listVolunteers();
  const normalizedEmail = input.email.trim().toLowerCase();
  const duplicate = existingRows.find((row) => row.email === normalizedEmail && row.id !== input.id);
  if (duplicate) throw new Error("A volunteer with this email already exists.");

  const now = new Date().toISOString();
  const id = input.id || crypto.randomUUID();
  const existing = existingRows.find((row) => row.id === id);
  const assignments = input.assignments.map((assignment): VolunteerAssignment => {
    const event = eventById.get(assignment.eventId);
    if (!event) throw new Error("One of the selected events no longer exists.");
    const pointById = new Map(event.timingPoints.map((point) => [point.id, point]));
    const timingPointIds = [...new Set(assignment.timingPointIds)];
    if (timingPointIds.some((pointId) => !pointById.has(pointId))) {
      throw new Error(`A selected timing point is not configured for ${event.name}.`);
    }
    const prior = existing?.assignments.find((item) => item.id === assignment.id);
    return {
      id: assignment.id || crypto.randomUUID(),
      eventId: event.id,
      eventName: event.name,
      modules: normalizeVolunteerModules(assignment.modules),
      providerEventUuid: event.providerEventUuid,
      contestUuids: event.contestUuids,
      timingPointIds,
      timingPointNames: timingPointIds.map((pointId) => pointById.get(pointId)!.name),
      customCounterIds: [...new Set(assignment.customCounterIds)],
      active: assignment.active,
      createdAt: prior?.createdAt || now,
      updatedAt: now,
    };
  });
  if (new Set(assignments.map((assignment) => assignment.eventId)).size !== assignments.length) {
    throw new Error("A volunteer can have only one active assignment record per event.");
  }
  const saved: VolunteerProfile = {
    id,
    name: input.name.trim(),
    email: normalizedEmail,
    mobile: input.mobile.trim(),
    status: input.status,
    assignments,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    lastActiveAt: existing?.lastActiveAt || null,
    hasPassword: Boolean(input.password || existing?.hasPassword),
  };
  const writes: Promise<unknown>[] = [
    kv.put(profileKey(id), JSON.stringify(saved)),
    appendIndex(kv, INDEX_KEY, id),
  ];
  if (input.password) {
    writes.push(createVolunteerPasswordCredential(input.password).then((credential) => kv.put(volunteerPasswordKey(id), JSON.stringify(credential))));
  }
  await Promise.all(writes);
  await writeActivity(kv, {
    action: existing ? "VOLUNTEER_UPDATED" : "VOLUNTEER_CREATED",
    entity: saved.name,
    volunteerId: saved.id,
    eventId: assignments[0]?.eventId || null,
    detail: `${saved.status} · ${assignments.length} event assignment${assignments.length === 1 ? "" : "s"}`,
  });
  return saved;
}

export async function setVolunteerStatus(id: string, status: VolunteerStatus): Promise<VolunteerProfile> {
  const kv = await getKv();
  const existing = await kv.get<VolunteerProfile>(profileKey(id), "json");
  if (!existing) throw new Error("Volunteer not found.");
  const saved = { ...existing, status, updatedAt: new Date().toISOString() };
  await kv.put(profileKey(id), JSON.stringify(saved));
  await writeActivity(kv, {
    action: status === "DISABLED" ? "VOLUNTEER_DISABLED" : "VOLUNTEER_ENABLED",
    entity: saved.name,
    volunteerId: saved.id,
    eventId: null,
    detail: `Access status changed to ${status}.`,
    severity: status === "DISABLED" ? "warning" : "normal",
  });
  return saved;
}

export async function deleteVolunteer(id: string): Promise<VolunteerProfile> {
  const kv = await getKv();
  const existing = await kv.get<VolunteerProfile>(profileKey(id), "json");
  if (!existing) throw new Error("Volunteer not found.");
  await Promise.all([kv.delete(profileKey(id)), kv.delete(volunteerPasswordKey(id)), removeIndex(kv, INDEX_KEY, id)]);
  await writeActivity(kv, {
    action: "VOLUNTEER_REMOVED",
    entity: existing.name,
    volunteerId: existing.id,
    eventId: null,
    detail: "Volunteer profile and all event assignments were removed.",
    severity: "warning",
  });
  return existing;
}

export async function listVolunteerActivity(limit = 100): Promise<VolunteerActivity[]> {
  const kv = await getKv();
  const ids = await readIndex(kv, ACTIVITY_INDEX_KEY);
  const selected = ids.slice(-Math.max(1, Math.min(limit, 250))).reverse();
  const rows = await mapWithConcurrency(selected, 8, (id) => kv.get<VolunteerActivity>(`${PREFIX}:activity:${id}`, "json"));
  return rows.filter((row): row is VolunteerActivity => Boolean(row));
}

async function listOperationLog(kind: "checkin" | "manual-timing", limit = 150): Promise<VolunteerOperationLog[]> {
  const kv = await getKv();
  const ids = await readIndex(kv, `${PREFIX}:${kind}:index`);
  const selected = ids.slice(-Math.max(1, Math.min(limit, 300))).reverse();
  const rows = await mapWithConcurrency(selected, 8, (id) => kv.get<VolunteerOperationLog>(`${PREFIX}:${kind}:${id}`, "json"));
  return rows.filter((row): row is VolunteerOperationLog => Boolean(row));
}

export async function recordVolunteerOperation(
  kind: "checkin" | "manual-timing",
  input: Omit<VolunteerOperationLog, "id">,
): Promise<VolunteerOperationLog> {
  const kv = await getKv();
  const row: VolunteerOperationLog = { id: crypto.randomUUID(), ...input };
  await Promise.all([
    kv.put(`${PREFIX}:${kind}:${row.id}`, JSON.stringify(row)),
    appendIndex(kv, `${PREFIX}:${kind}:index`, row.id),
    writeActivity(kv, {
      action: row.action,
      entity: row.athleteName || row.bib || row.participantUid,
      volunteerId: row.volunteerId,
      eventId: row.eventId,
      actor: row.volunteerName,
      detail: `${row.eventName} · BIB ${row.bib || "—"}${row.timingPointName ? ` · ${row.timingPointName}` : ""}`,
    }),
  ]);
  return row;
}

export function listVolunteerCheckIns(limit?: number) {
  return listOperationLog("checkin", limit);
}

export async function deleteVolunteerCheckInOperations(input: {
  ids?: readonly string[];
  actions?: readonly string[];
  eventId?: string;
}): Promise<{ deletedCount: number }> {
  const kv = await getKv();
  const indexKey = `${PREFIX}:checkin:index`;
  const indexedIds = await readIndex(kv, indexKey);
  const requestedIds = new Set((input.ids ?? []).map((id) => id.trim()).filter(Boolean));
  const requestedActions = new Set((input.actions ?? []).map((action) => action.trim()).filter(Boolean));
  const requestedEventId = input.eventId?.trim() || "";
  if (!requestedIds.size && !requestedActions.size) throw new Error("Choose at least one log record to delete.");

  const rows = await mapWithConcurrency(indexedIds, 8, async (id) => ({
    id,
    row: await kv.get<VolunteerOperationLog>(`${PREFIX}:checkin:${id}`, "json"),
  }));
  const deletedIds = new Set(rows
    .filter(({ id, row }) => requestedIds.has(id) || Boolean(row && requestedActions.has(row.action) && (!requestedEventId || row.eventId === requestedEventId)))
    .map(({ id }) => id));
  if (!deletedIds.size) throw new Error("The selected volunteer log records were not found.");

  await Promise.all([
    ...[...deletedIds].map((id) => kv.delete(`${PREFIX}:checkin:${id}`)),
    kv.put(indexKey, JSON.stringify(indexedIds.filter((id) => !deletedIds.has(id)))),
    writeActivity(kv, {
      action: "VOLUNTEER_LOGS_DELETED",
      entity: `${deletedIds.size} volunteer log${deletedIds.size === 1 ? "" : "s"}`,
      volunteerId: null,
      eventId: requestedEventId || null,
      actor: "Race Upshot admin",
      severity: "warning",
      detail: requestedActions.size
        ? `Permanently cleared ${deletedIds.size} operation log record${deletedIds.size === 1 ? "" : "s"}${requestedEventId ? ` for event ${requestedEventId}` : ""}: ${[...requestedActions].join(", ")}.`
        : `Permanently deleted ${deletedIds.size} selected operation log record${deletedIds.size === 1 ? "" : "s"}.`,
    }),
  ]);
  return { deletedCount: deletedIds.size };
}

export function listVolunteerManualTiming(limit?: number) {
  return listOperationLog("manual-timing", limit);
}

function validTimestamp(value: string | null | undefined): number | null {
  const milliseconds = Date.parse(value || "");
  return Number.isFinite(milliseconds) ? milliseconds : null;
}

function firstValidTimestamp(values: Array<string | null | undefined>): { milliseconds: number; value: string } | null {
  return values
    .map((value) => ({ value: value || "", milliseconds: validTimestamp(value) }))
    .find((candidate): candidate is { value: string; milliseconds: number } => candidate.milliseconds !== null) ?? null;
}

function canonicalStarts(participant: LiveParticipant | undefined): {
  chip: { milliseconds: number; value: string } | null;
  gun: { milliseconds: number; value: string } | null;
} {
  if (!participant) return { chip: null, gun: null };
  const chip = firstValidTimestamp(participant.splits.map((split) => split.chipStartTimestamp));
  const gun = firstValidTimestamp(participant.splits.map((split) => split.gunStartTimestamp))
    ?? firstValidTimestamp(participant.splits
      .filter((split) => /(^|[^a-z])start([^a-z]|$)/i.test(`${split.splitId} ${split.name}`))
      .flatMap((split) => [split.readerTimestamp, split.timestamp]));
  return { chip, gun };
}

function canonicalStart(participant: LiveParticipant | undefined): { milliseconds: number; value: string } | null {
  if (!participant) return null;
  const starts = canonicalStarts(participant);
  return starts.chip ?? starts.gun;
}

function durationMilliseconds(value: string | null | undefined): number | null {
  if (!value) return null;
  const parts = value.trim().split(":").map(Number);
  if (parts.length < 2 || parts.some((part) => !Number.isFinite(part) || part < 0)) return null;
  return parts.reduce((seconds, part) => seconds * 60 + part, 0) * 1_000;
}

function canonicalResultAtTimingPoint(participant: LiveParticipant | undefined, timingPointName: string | undefined) {
  if (!participant) return null;
  const wanted = normalizedEventIdentity(timingPointName);
  const hasElapsed = (split: LiveParticipant["splits"][number]) => (Number.isFinite(split.chipTimeMs) && split.chipTimeMs! >= 0)
    || (Number.isFinite(split.gunTimeMs) && split.gunTimeMs! >= 0)
    || durationMilliseconds(split.splitTime) !== null;
  const exact = participant.splits.find((split) => hasElapsed(split)
    && (normalizedEventIdentity(split.name) === wanted || normalizedEventIdentity(split.splitId) === wanted));
  const split = exact ?? (/finish/.test(wanted)
    ? participant.splits.toReversed().find((candidate) => hasElapsed(candidate) && /finish/.test(normalizedEventIdentity(candidate.name)))
    : undefined);
  if (!split) return null;
  const starts = canonicalStarts(participant);
  const readMilliseconds = validTimestamp(split.readerTimestamp) ?? validTimestamp(split.timestamp);
  const storedChip = Number.isFinite(split.chipTimeMs) && split.chipTimeMs! >= 0 ? split.chipTimeMs! : durationMilliseconds(split.splitTime);
  const storedGun = Number.isFinite(split.gunTimeMs) && split.gunTimeMs! >= 0 ? split.gunTimeMs! : null;
  const chipElapsed = storedChip ?? (readMilliseconds !== null && starts.chip ? readMilliseconds - starts.chip.milliseconds : null);
  const gunElapsed = storedGun ?? (readMilliseconds !== null && starts.gun ? readMilliseconds - starts.gun.milliseconds : null);
  if ((chipElapsed === null || chipElapsed < 0) && (gunElapsed === null || gunElapsed < 0)) return null;
  return {
    chipElapsed: chipElapsed !== null && chipElapsed >= 0 ? chipElapsed : null,
    gunElapsed: gunElapsed !== null && gunElapsed >= 0 ? gunElapsed : null,
    readAt: readMilliseconds === null ? null : new Date(readMilliseconds).toISOString(),
  };
}

export function rankVolunteerManualTiming(
  rows: VolunteerOperationLog[],
  participantsByEvent: ReadonlyMap<string, readonly LiveParticipant[]>,
): VolunteerOperationLog[] {
  const participantsByIdentity = new Map<string, LiveParticipant>();
  const participantsByEventAndBib = new Map<string, LiveParticipant[]>();
  for (const [eventId, participants] of participantsByEvent) {
    for (const participant of participants) {
      participantsByIdentity.set(`${eventId}\u0000${participant.participantUid}`, participant);
      const bibKey = `${eventId}\u0000${participant.bib.trim().toLowerCase()}`;
      participantsByEventAndBib.set(bibKey, [...(participantsByEventAndBib.get(bibKey) ?? []), participant]);
    }
  }
  const resolveParticipant = (row: VolunteerOperationLog): LiveParticipant | undefined => {
    const explicitIdentity = row.canonicalParticipantUid?.trim() || row.participantUid.trim();
    const exact = participantsByIdentity.get(`${row.eventId}\u0000${explicitIdentity}`);
    if (exact) return exact;

    // Legacy roster stamps did not persist the provider UUID. Recover them only
    // when both the event BIB and contest/category identify one canonical row.
    if (!row.bib.trim()) return undefined;
    const bibMatches = participantsByEventAndBib.get(`${row.eventId}\u0000${row.bib.trim().toLowerCase()}`) ?? [];
    if (bibMatches.length === 1) return bibMatches[0];
    const category = normalizedEventIdentity(row.category);
    if (!category) return undefined;
    const contestMatches = bibMatches.filter((participant) => category === normalizedEventIdentity(participant.contestId)
      || category === normalizedEventIdentity(participant.contestName));
    return contestMatches.length === 1 ? contestMatches[0] : undefined;
  };
  const resetOperationIds = new Set(rows
    .filter((row) => row.action === "MANUAL_TIMING_RESET" && row.reversesOperationId)
    .map((row) => row.reversesOperationId as string));
  const enriched = rows.map((row) => {
    const participant = resolveParticipant(row);
    if (row.action !== "MANUAL_TIMING_CAPTURED") return { ...row, overallRank: null, categoryRank: null, genderRank: null, ageGroupRank: null };
    const endMilliseconds = validTimestamp(row.capturedAt);
    if (endMilliseconds === null) return { ...row, overallRank: null, categoryRank: null, genderRank: null, ageGroupRank: null };
    const canonical = canonicalStart(participant);
    const canonicalTimes = canonicalStarts(participant);
    const canonicalResult = canonicalResultAtTimingPoint(participant, row.timingPointName);
    const savedChipMilliseconds = row.elapsedStartSource === "CHIP" ? validTimestamp(row.elapsedStartAt) : null;
    const savedGunMilliseconds = validTimestamp(row.gunStartAt)
      ?? (row.elapsedStartSource === "GUN" ? validTimestamp(row.elapsedStartAt) : null);
    const canonicalIsUsable = canonical !== null && canonical.milliseconds <= endMilliseconds
      && !(row.elapsedStartSource === "CHIP" && savedGunMilliseconds !== null
        && !participant?.splits.some(split => validTimestamp(split.chipStartTimestamp) !== null));
    const savedGunIsUsable = savedGunMilliseconds !== null && savedGunMilliseconds <= endMilliseconds;
    const fallbackDuration = typeof row.gunElapsedSeconds === "number" && Number.isFinite(row.gunElapsedSeconds)
      ? Math.max(0, row.gunElapsedSeconds * 1_000)
      : durationMilliseconds(row.gunTime);
    const startMilliseconds = canonicalIsUsable
      ? canonical.milliseconds
      : savedGunIsUsable
        ? savedGunMilliseconds
        : fallbackDuration !== null
          ? endMilliseconds - fallbackDuration
          : null;
    const startSource = canonicalIsUsable ? "CANONICAL" as const : startMilliseconds !== null ? row.elapsedStartSource === "CHIP" ? "SAVED_CHIP" as const : "SAVED_GUN" as const : null;
    const manualChipElapsed = (canonicalTimes.chip?.milliseconds ?? savedChipMilliseconds) !== null
      && (canonicalTimes.chip?.milliseconds ?? savedChipMilliseconds)! <= endMilliseconds
      ? endMilliseconds - (canonicalTimes.chip?.milliseconds ?? savedChipMilliseconds)!
      : null;
    const manualGunElapsed = (canonicalTimes.gun?.milliseconds ?? savedGunMilliseconds) !== null
      && (canonicalTimes.gun?.milliseconds ?? savedGunMilliseconds)! <= endMilliseconds
      ? endMilliseconds - (canonicalTimes.gun?.milliseconds ?? savedGunMilliseconds)!
      : fallbackDuration;
    const rankingElapsed = canonicalResult?.chipElapsed ?? canonicalResult?.gunElapsed
      ?? (startMilliseconds === null ? null : Math.max(0, endMilliseconds - startMilliseconds));
    return {
      ...row,
      category: row.category || participant?.contestName || "",
      gender: row.gender || participant?.gender || "",
      ageGroup: row.ageGroup || participant?.ageGroup || "",
      overallRank: canonicalResult ? participant?.overallRank ?? null : null,
      categoryRank: canonicalResult ? participant?.overallRank ?? null : null,
      genderRank: canonicalResult ? participant?.genderRank ?? null : null,
      ageGroupRank: canonicalResult ? participant?.ageGroupRank ?? null : null,
      rankingStartAt: startMilliseconds === null ? null : new Date(startMilliseconds).toISOString(),
      rankingEndAt: canonicalResult?.readAt ?? new Date(endMilliseconds).toISOString(),
      rankingElapsedMilliseconds: rankingElapsed,
      // Never blend a device stamp calculation into fields presented as
      // canonical timing. Keep both sources independently auditable.
      rankingChipElapsedMilliseconds: canonicalResult?.chipElapsed ?? null,
      rankingGunElapsedMilliseconds: canonicalResult?.gunElapsed ?? null,
      manualChipElapsedMilliseconds: manualChipElapsed,
      manualGunElapsedMilliseconds: manualGunElapsed,
      rankingResultSource: canonicalResult ? "CANONICAL" as const : "MANUAL" as const,
      rankingStartSource: startSource,
    };
  });
  const rankedById = new Map(enriched.map((row) => [row.id, row]));
  const active = enriched.flatMap((row) => {
    if (row.action !== "MANUAL_TIMING_CAPTURED" || row.rankingResultSource === "CANONICAL" || resetOperationIds.has(row.id) || row.rankingElapsedMilliseconds === null || row.rankingElapsedMilliseconds === undefined) return [];
    const participant = resolveParticipant(row);
    const contest = participant?.contestId?.trim() || participant?.contestName?.trim().toLowerCase() || "__event__";
    const timingPoint = row.timingPointName?.trim().toLowerCase() || "__manual_finish__";
    return [{ row, participant, baseGroup: `${row.eventId}\u0000${contest}\u0000${timingPoint}` }];
  });
  const applyRanks = (
    key: "overallRank" | "categoryRank" | "genderRank" | "ageGroupRank",
    group: (candidate: (typeof active)[number]) => string | null,
  ) => {
    const groups = new Map<string, typeof active>();
    for (const candidate of active) {
      const groupKey = group(candidate);
      if (!groupKey) continue;
      const members = groups.get(groupKey) ?? [];
      members.push(candidate);
      groups.set(groupKey, members);
    }
    for (const members of groups.values()) {
      members.sort((left, right) => (left.row.rankingElapsedMilliseconds! - right.row.rankingElapsedMilliseconds!)
        || Date.parse(left.row.capturedAt) - Date.parse(right.row.capturedAt)
        || left.row.id.localeCompare(right.row.id));
      members.forEach((candidate, index) => {
        const current = rankedById.get(candidate.row.id)!;
        rankedById.set(candidate.row.id, { ...current, [key]: index + 1 });
      });
    }
  };
  applyRanks("overallRank", (candidate) => candidate.baseGroup);
  applyRanks("categoryRank", (candidate) => candidate.baseGroup);
  applyRanks("genderRank", (candidate) => {
    const gender = candidate.participant?.gender?.trim().toLowerCase();
    return gender ? `${candidate.baseGroup}\u0000${gender}` : null;
  });
  applyRanks("ageGroupRank", (candidate) => {
    const ageGroup = candidate.participant?.ageGroup?.trim().toLowerCase();
    return ageGroup ? `${candidate.baseGroup}\u0000${ageGroup}` : null;
  });
  return rows.map((row) => rankedById.get(row.id) ?? row);
}

export async function listVolunteerManualTimingWithRanks(limit?: number): Promise<VolunteerOperationLog[]> {
  const rows = await listVolunteerManualTiming(limit);
  const eventIds = [...new Set(rows.map((row) => row.eventId).filter(Boolean))];
  const canonicalReads = await mapWithConcurrency(eventIds, 4, async (eventId) => {
    try {
      const canonical = await getCanonicalLiveEvent(eventId);
      return [eventId, canonical?.participants ?? []] as const;
    } catch {
      // Keep the operational audit available when canonical timing storage is temporarily unavailable.
      return [eventId, [] as LiveParticipant[]] as const;
    }
  });
  return rankVolunteerManualTiming(rows, new Map(canonicalReads));
}

export async function resetVolunteerManualTimingOperation(id: string): Promise<VolunteerOperationLog> {
  const kv = await getKv();
  const original = await kv.get<VolunteerOperationLog>(`${PREFIX}:manual-timing:${id}`, "json");
  if (!original || original.action !== "MANUAL_TIMING_CAPTURED") throw new Error("Manual timing capture was not found.");
  const ids = await readIndex(kv, `${PREFIX}:manual-timing:index`);
  const rows = await mapWithConcurrency(ids, 8, (rowId) => kv.get<VolunteerOperationLog>(`${PREFIX}:manual-timing:${rowId}`, "json"));
  if (rows.some((row) => row?.action === "MANUAL_TIMING_RESET" && row.reversesOperationId === original.id)) {
    throw new Error("This manual timing capture has already been reset.");
  }
  return recordVolunteerOperation("manual-timing", {
    eventId: original.eventId,
    eventName: original.eventName,
    participantUid: original.participantUid,
    canonicalParticipantUid: original.canonicalParticipantUid,
    bib: original.bib,
    athleteName: original.athleteName,
    volunteerId: "admin",
    volunteerName: "Race Upshot admin",
    action: "MANUAL_TIMING_RESET",
    reversesOperationId: original.id,
    timingPointName: original.timingPointName,
    timingMode: original.timingMode,
    gunStartAt: original.gunStartAt,
    gunElapsedSeconds: original.gunElapsedSeconds,
    gunTime: original.gunTime,
    elapsedStartAt: original.elapsedStartAt,
    elapsedStartSource: original.elapsedStartSource,
    elapsedSeconds: original.elapsedSeconds,
    elapsedTime: original.elapsedTime,
    capturedAt: new Date().toISOString(),
    status: "RESET BY ADMIN",
  });
}

export async function deleteVolunteerManualTimingOperation(id: string): Promise<VolunteerOperationLog> {
  const kv = await getKv();
  const row = await kv.get<VolunteerOperationLog>(`${PREFIX}:manual-timing:${id}`, "json");
  if (!row) throw new Error("Manual timing record was not found.");
  const indexKey = `${PREFIX}:manual-timing:index`;
  const ids = await readIndex(kv, indexKey);
  const linkedResetRows = row.action === "MANUAL_TIMING_CAPTURED"
    ? (await mapWithConcurrency(ids, 8, (rowId) => kv.get<VolunteerOperationLog>(`${PREFIX}:manual-timing:${rowId}`, "json")))
      .filter((candidate): candidate is VolunteerOperationLog => candidate?.action === "MANUAL_TIMING_RESET" && candidate.reversesOperationId === row.id)
    : [];
  const deletedIds = new Set([row.id, ...linkedResetRows.map((candidate) => candidate.id)]);
  await Promise.all([
    ...[...deletedIds].map((deletedId) => kv.delete(`${PREFIX}:manual-timing:${deletedId}`)),
    kv.put(indexKey, JSON.stringify(ids.filter((existingId) => !deletedIds.has(existingId)))),
    writeActivity(kv, {
      action: "MANUAL_TIMING_DELETED",
      entity: row.athleteName || row.bib || row.participantUid,
      volunteerId: null,
      eventId: row.eventId,
      actor: "Race Upshot admin",
      severity: "warning",
      detail: `${row.eventName} · BIB ${row.bib || "—"} · deleted manual timing record ${row.id}${linkedResetRows.length ? ` and ${linkedResetRows.length} linked reset record` : ""}`,
    }),
  ]);
  return row;
}

import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { KVNamespace } from "@cloudflare/workers-types";
import { getCanonicalLiveManifest, publishIncrementalCanonicalParticipants } from "./canonical-live-tracking";
import { getEventBySlug } from "./raceupshot-repository";
import { getEventPlatformSettings } from "./platform-repository";
import { withTransientKvRetry } from "./kv-retry";
import { applyParticipantRosterImport, getPrivateImportedParticipantRows, participantRegistrationScope } from "./participant-roster-import";
import { mapWithConcurrency } from "./map-with-concurrency";
import { timingChipCodeForDisplay } from "./rfid-reader-assignment";
import type { Athlete } from "./types";

const PREFIX = "raceupshot";
type JsonRecord = Record<string, unknown>;

export interface ParticipantChipAssignmentAudit {
  id: string;
  eventId: string;
  providerEventUuid: string;
  participantId: string;
  bib: string;
  participantName: string;
  previousChipCode: string;
  chipCode: string;
  fullEpc?: string;
  inventoryChipId?: string;
  epcProfileId?: string;
  assignmentMethod?: "RFID_READER" | "QR" | "MANUAL" | "ADMIN";
  syncStatus?: "ASSIGNED" | "SYNC_PENDING" | "SYNCED" | "CONFLICT";
  reason: string;
  changedBy: string;
  changedAt: string;
}

export interface ParticipantAthleteBandAssignmentAudit {
  id: string;
  eventId: string;
  participantId: string;
  bib: string;
  participantName: string;
  previousAthleteBandCode: string;
  athleteBandCode: string;
  reason: string;
  changedBy: string;
  changedAt: string;
}

async function getKv(): Promise<KVNamespace> {
  const { env } = await getCloudflareContext({ async: true });
  if (!env.RACEUPSHOT) throw new Error("RACEUPSHOT KV binding is unavailable.");
  return withTransientKvRetry(env.RACEUPSHOT);
}

async function claimEquipmentCode(eventId: string, kind: "chip" | "athlete-band", id: string, code: string, scope = ""): Promise<void> {
  const { env } = await getCloudflareContext({ async: true });
  if (!env.VOLUNTEER_OPERATIONS) throw new Error("Equipment assignment coordination is unavailable.");
  const response = await env.VOLUNTEER_OPERATIONS.getByName(eventId).fetch("https://volunteer-operations.internal/equipment-code/claim", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind, participantId: id, code, scope }),
  });
  const payload = await response.json<{ ok: boolean; error?: string }>();
  if (!response.ok || !payload.ok) throw new Error(payload.error || "The assignment code is already in use.");
}

async function releaseEquipmentCode(eventId: string, kind: "chip" | "athlete-band", id: string): Promise<void> {
  const { env } = await getCloudflareContext({ async: true });
  if (!env.VOLUNTEER_OPERATIONS) throw new Error("Equipment assignment coordination is unavailable.");
  const response = await env.VOLUNTEER_OPERATIONS.getByName(eventId).fetch("https://volunteer-operations.internal/equipment-code/release", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind, participantId: id }),
  });
  const payload = await response.json<{ ok: boolean; error?: string }>();
  if (!response.ok || !payload.ok) throw new Error(payload.error || "The assignment code could not be released.");
}

function participantIdentityCandidates(row: JsonRecord): string[] {
  return [...new Set([
    row.participantUid,
    row.participantUuid,
    row.participant_uuid,
    row.athleteUid,
    row.athlete_uid,
    row.uuid,
    row.id,
  ].map((value) => String(value ?? "").trim()).filter(Boolean))];
}

function chipCode(row: JsonRecord): string {
  return String(row.chipCode ?? row.chip_code ?? row.chip ?? row.rfid ?? "").trim();
}

function athleteBandCode(row: JsonRecord): string {
  return String(row.athleteBandCode ?? row.athlete_band_code ?? row.athleteBand ?? row.bandCode ?? "").trim();
}

function relayChipGroupKey(row: JsonRecord): string {
  const mode = String(row.participationMode ?? row.contestParticipationType ?? "").trim().toUpperCase();
  if (mode !== "RELAY") return "";
  const teamId = String(row.relayTeamId ?? "").trim();
  if (teamId) return `team:${teamId}`;
  const bib = String(row.bib ?? row.bibNumber ?? row.bib_number ?? row.raceNumber ?? "").trim();
  return bib ? `fallback:${participantRegistrationScope(row)}:${bib.toLowerCase()}` : "";
}

function rows(payload: unknown): JsonRecord[] {
  if (Array.isArray(payload)) return payload.filter((item): item is JsonRecord => Boolean(item && typeof item === "object" && !Array.isArray(item)));
  if (!payload || typeof payload !== "object") return [];
  for (const key of ["participants", "rows", "data"]) {
    const value = (payload as JsonRecord)[key];
    if (Array.isArray(value)) return value.filter((item): item is JsonRecord => Boolean(item && typeof item === "object" && !Array.isArray(item)));
  }
  return [];
}

export function participantManagementRows(payload: unknown): JsonRecord[] {
  return rows(payload).filter((row) => {
    const publishedResultOnly = String(row.publishedResultSource ?? "").trim() === "PUBLISHED_RESULTS";
    const participantImport = Boolean(String(row.rosterImportSource ?? "").trim());
    return !publishedResultOnly || participantImport;
  });
}

export function publishedResultParticipantRows(athletes: Athlete[]): JsonRecord[] {
  return athletes.map((athlete) => ({
    participantUid: athlete.id,
    participantUuid: athlete.id,
    athleteUid: athlete.athleteUid || "",
    bib: athlete.bib,
    bibNumber: athlete.bib,
    name: athlete.name,
    fullName: athlete.name,
    displayName: athlete.name,
    email: athlete.email || "",
    contestName: athlete.category,
    category: athlete.category,
    gender: athlete.gender,
    ageGroup: athlete.ageGroup,
    club: athlete.club,
    country: athlete.country,
    status: athlete.status,
    resultStatus: athlete.status,
    publishedResultSource: "PUBLISHED_RESULTS",
  }));
}

async function editableParticipantRows(kv: KVNamespace, event: { id: string }): Promise<{ rows: JsonRecord[]; storedRoster: boolean }> {
  // Equipment assignments operate on registrations, not timing or result rows.
  return { rows: await applyParticipantChipAssignments(kv, event.id, []), storedRoster: false };
}

function assignmentKey(eventId: string, id: string) {
  return `${PREFIX}:live:event:${eventId}:chip-assignment:${encodeURIComponent(id)}`;
}

function assignmentIndexKey(eventId: string) {
  return `${PREFIX}:live:event:${eventId}:chip-assignment:index`;
}

function auditKey(eventId: string, id: string) {
  return `${PREFIX}:live:event:${eventId}:chip-assignment-audit:${id}`;
}

function auditIndexKey(eventId: string) {
  return `${PREFIX}:live:event:${eventId}:chip-assignment-audit:index`;
}

export async function listParticipantChipAssignmentAudits(
  eventIdOrSlug: string,
  limit = 100,
): Promise<{ event: { id: string; name: string }; audits: ParticipantChipAssignmentAudit[] }> {
  const event = await getEventBySlug(eventIdOrSlug, { includeUnpublished: true });
  if (!event) throw new Error("Event not found.");
  const kv = await getKv();
  const ids = (await kv.get<string[]>(auditIndexKey(event.id), "json") ?? [])
    .slice(0, Math.max(1, Math.min(limit, 300)));
  const audits = await mapWithConcurrency(ids, 8, (id) => kv.get<ParticipantChipAssignmentAudit>(auditKey(event.id, id), "json"));
  return {
    event: { id: event.id, name: event.name },
    audits: audits.filter((row): row is ParticipantChipAssignmentAudit => Boolean(row)),
  };
}

function athleteBandAssignmentKey(eventId: string, id: string) {
  return `${PREFIX}:live:event:${eventId}:athlete-band-assignment:${encodeURIComponent(id)}`;
}

function athleteBandAssignmentIndexKey(eventId: string) {
  return `${PREFIX}:live:event:${eventId}:athlete-band-assignment:index`;
}

function athleteBandAuditKey(eventId: string, id: string) {
  return `${PREFIX}:live:event:${eventId}:athlete-band-assignment-audit:${id}`;
}

function athleteBandAuditIndexKey(eventId: string) {
  return `${PREFIX}:live:event:${eventId}:athlete-band-assignment-audit:index`;
}

export async function applyParticipantChipAssignments(kv: KVNamespace, eventId: string, participantRows: JsonRecord[], includePrivateUploadedFields = false): Promise<JsonRecord[]> {
  const rosterRows = includePrivateUploadedFields
    ? await getPrivateImportedParticipantRows(kv, eventId)
    : await applyParticipantRosterImport(kv, eventId, participantRows);
  const [ids, bandIds] = await Promise.all([
    kv.get<string[]>(assignmentIndexKey(eventId), "json").then((value) => value ?? []),
    kv.get<string[]>(athleteBandAssignmentIndexKey(eventId), "json").then((value) => value ?? []),
  ]);
  if ((!ids.length && !bandIds.length) || !rosterRows.length) return rosterRows;
  const rosterIdentities = new Set(rosterRows.flatMap(participantIdentityCandidates));
  const activeIds = ids.filter((id) => rosterIdentities.has(id));
  const activeBandIds = bandIds.filter((id) => rosterIdentities.has(id));
  async function readAssignments<T>(assignmentIds: string[], keyForId: (id: string) => string): Promise<Array<T | null>> {
    const results: Array<T | null> = new Array(assignmentIds.length);
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(8, assignmentIds.length) }, async () => {
      while (next < assignmentIds.length) {
        const index = next++;
        results[index] = await kv.get<T>(keyForId(assignmentIds[index]), "json");
      }
    }));
    return results;
  }
  const [assignments, bandAssignments] = await Promise.all([
    readAssignments<ParticipantChipAssignmentAudit>(activeIds, (id) => assignmentKey(eventId, id)),
    readAssignments<ParticipantAthleteBandAssignmentAudit>(activeBandIds, (id) => athleteBandAssignmentKey(eventId, id)),
  ]);
  const byParticipant = new Map(assignments.filter((item): item is ParticipantChipAssignmentAudit => Boolean(item)).map((item) => [item.participantId, item]));
  const bandByParticipant = new Map(bandAssignments.filter((item): item is ParticipantAthleteBandAssignmentAudit => Boolean(item)).map((item) => [item.participantId, item]));
  const chipAssignmentByRelayTeam = new Map<string, ParticipantChipAssignmentAudit>();
  for (const row of rosterRows) {
    const teamKey = relayChipGroupKey(row);
    if (!teamKey) continue;
    const assignment = participantIdentityCandidates(row).map((id) => byParticipant.get(id)).find((item): item is ParticipantChipAssignmentAudit => Boolean(item));
    const current = chipAssignmentByRelayTeam.get(teamKey);
    if (assignment && (!current || assignment.changedAt >= current.changedAt)) chipAssignmentByRelayTeam.set(teamKey, assignment);
  }
  return rosterRows.map((row) => {
    const identities = participantIdentityCandidates(row);
    const directAssignment = identities.map((id) => byParticipant.get(id)).find((item): item is ParticipantChipAssignmentAudit => Boolean(item));
    // Relay teams share one timing chip. Resolve the newest team action first
    // so clearing the chip from any member also clears an older assignment
    // recorded against another member.
    const assignment = chipAssignmentByRelayTeam.get(relayChipGroupKey(row)) || directAssignment;
    const displayedChipCode = assignment ? timingChipCodeForDisplay(assignment.chipCode) : "";
    const legacyReaderEpc = assignment ? isReaderLikeLegacyChip(assignment.chipCode) : false;
    const displayedAssignment = assignment && (displayedChipCode !== assignment.chipCode || (legacyReaderEpc && !assignment.fullEpc)) ? {
      ...assignment,
      chipCode: displayedChipCode,
      fullEpc: assignment.fullEpc || assignment.chipCode,
    } : assignment;
    const bandAssignment = identities.map((id) => bandByParticipant.get(id)).find((item): item is ParticipantAthleteBandAssignmentAudit => Boolean(item));
    return {
      ...row,
      ...(displayedAssignment ? { chipCode: displayedAssignment.chipCode, chip_code: displayedAssignment.chipCode, chipAssignment: displayedAssignment } : {}),
      ...(bandAssignment ? { athleteBandCode: bandAssignment.athleteBandCode, athlete_band_code: bandAssignment.athleteBandCode, athleteBandAssignment: bandAssignment } : {}),
    };
  });
}

function isReaderLikeLegacyChip(value: string): boolean {
  return /^[0-9A-F]{16,}$/.test(value.trim().replace(/\s+/g, "").toUpperCase());
}

export async function getAdminParticipantRoster(eventIdOrSlug: string, options: { includeUploadedFields?: boolean } = {}): Promise<{
  event: { id: string; slug: string; name: string };
  rows: JsonRecord[];
} | null> {
  const event = await getEventBySlug(eventIdOrSlug, { includeUnpublished: true });
  if (!event) return null;
  const kv = await getKv();
  // Participant management is a registration roster, never a results fallback.
  // Uploaded rows are kept in their own event-scoped import key.
  const importedRows = await applyParticipantChipAssignments(kv, event.id, [], options.includeUploadedFields === true);
  return {
    event: { id: event.id, slug: event.slug, name: event.name },
    rows: importedRows.filter((row) => String(row.rosterImportSource ?? "") === "ADMIN_UPLOAD"
      && String(row.publishedResultSource ?? "") !== "PUBLISHED_RESULTS"),
  };
}

export async function removeParticipantAssignmentOverlays(eventId: string, participantIds: string[]): Promise<void> {
  const kv = await getKv();
  const ids = new Set(participantIds);
  const [chipIds, bandIds] = await Promise.all([
    kv.get<string[]>(assignmentIndexKey(eventId), "json").then((value) => value ?? []),
    kv.get<string[]>(athleteBandAssignmentIndexKey(eventId), "json").then((value) => value ?? []),
  ]);
  for (const id of participantIds) {
    await Promise.all([
      releaseEquipmentCode(eventId, "chip", id),
      releaseEquipmentCode(eventId, "athlete-band", id),
    ]);
    await kv.delete(assignmentKey(eventId, id));
    await kv.delete(athleteBandAssignmentKey(eventId, id));
  }
  await kv.put(assignmentIndexKey(eventId), JSON.stringify(chipIds.filter((id) => !ids.has(id))));
  await kv.put(athleteBandAssignmentIndexKey(eventId), JSON.stringify(bandIds.filter((id) => !ids.has(id))));
}

export async function replaceParticipantChip(input: {
  eventIdOrSlug: string;
  participantId: string;
  chipCode: string;
  reason: string;
  changedBy: string;
  fullEpc?: string;
  inventoryChipId?: string;
  epcProfileId?: string;
  assignmentMethod?: ParticipantChipAssignmentAudit["assignmentMethod"];
}): Promise<{ assignment: ParticipantChipAssignmentAudit; participant: JsonRecord }> {
  const event = await getEventBySlug(input.eventIdOrSlug, { includeUnpublished: true });
  if (!event) throw new Error("Event not found.");
  const kv = await getKv();
  const feedKey = `${PREFIX}:live:event:${event.id}:participants`;
  const editable = await editableParticipantRows(kv, event);
  const participantRows = editable.rows;
  const selectedIndex = participantRows.findIndex((row) => participantIdentityCandidates(row).includes(input.participantId));
  if (selectedIndex < 0) throw new Error("Participant is not available in this event-scoped live roster.");
  const nextChip = input.chipCode.trim().replace(/\s+/g, "").toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9._:-]{1,63}$/.test(nextChip)) throw new Error("Timing chip code must be 2-64 characters using letters, numbers, dot, dash, underscore, or colon.");
  const selected = participantRows[selectedIndex];
  const selectedScope = participantRegistrationScope(selected);
  const duplicate = participantRows.find((row, index) => index !== selectedIndex && chipCode(row).toLowerCase() === nextChip.toLowerCase() && participantRegistrationScope(row) === selectedScope);
  if (duplicate) throw new Error(`Chip ${nextChip} is already assigned to BIB ${String(duplicate.bib ?? duplicate.bibNumber ?? "unknown")}.`);
  const previousChipCode = chipCode(selected);
  if (previousChipCode.toLowerCase() === nextChip.toLowerCase()) throw new Error("Enter a different chip code.");
  await claimEquipmentCode(event.id, "chip", input.participantId, nextChip, selectedScope);
  const [settings, manifest] = await Promise.all([getEventPlatformSettings(event.id), getCanonicalLiveManifest(event.id)]);
  const providerEventUuid = settings?.timingIntegration?.providerEventUuid?.trim() || manifest?.providerEventUuid?.trim() || String(selected.providerEventUuid ?? selected.eventUuid ?? "").trim();
  const changedAt = new Date().toISOString();
  const assignment: ParticipantChipAssignmentAudit = {
    id: crypto.randomUUID(),
    eventId: event.id,
    providerEventUuid,
    participantId: input.participantId,
    bib: String(selected.bib ?? selected.bibNumber ?? "").trim(),
    participantName: String(selected.fullName ?? selected.name ?? "").trim(),
    previousChipCode,
    chipCode: nextChip,
    fullEpc: input.fullEpc,
    inventoryChipId: input.inventoryChipId,
    epcProfileId: input.epcProfileId,
    assignmentMethod: input.assignmentMethod || "ADMIN",
    syncStatus: providerEventUuid ? "SYNC_PENDING" : "ASSIGNED",
    reason: input.reason.trim(),
    changedBy: input.changedBy,
    changedAt,
  };
  const updatedParticipant = { ...selected, chipCode: nextChip, chip_code: nextChip, chipAssignment: assignment, lastUpdatedAt: changedAt };
  const updatedRows = participantRows.map((row, index) => index === selectedIndex ? updatedParticipant : row);
  const assignmentIds = (await kv.get<string[]>(assignmentIndexKey(event.id), "json")) ?? [];
  const auditIds = (await kv.get<string[]>(auditIndexKey(event.id), "json")) ?? [];
  const writes = [
    kv.put(assignmentKey(event.id, input.participantId), JSON.stringify(assignment)),
    kv.put(assignmentIndexKey(event.id), JSON.stringify([input.participantId, ...assignmentIds.filter((id) => id !== input.participantId)])),
    kv.put(auditKey(event.id, assignment.id), JSON.stringify(assignment)),
    kv.put(auditIndexKey(event.id), JSON.stringify([assignment.id, ...auditIds].slice(0, 2_000))),
  ];
  if (editable.storedRoster) {
    writes.push(
      kv.put(feedKey, JSON.stringify({ participants: updatedRows })),
      kv.put(`${PREFIX}:live:event:${event.id}:updated`, changedAt),
    );
  }
  await Promise.all(writes);
  if (editable.storedRoster && providerEventUuid) await publishIncrementalCanonicalParticipants({ eventId: event.id, providerEventUuid, rows: [updatedParticipant] });
  return { assignment, participant: updatedParticipant };
}

export async function removeParticipantChip(input: {
  eventIdOrSlug: string;
  participantId: string;
  reason: string;
  changedBy: string;
}): Promise<{ assignment: ParticipantChipAssignmentAudit; participant: JsonRecord }> {
  const event = await getEventBySlug(input.eventIdOrSlug, { includeUnpublished: true });
  if (!event) throw new Error("Event not found.");
  const kv = await getKv();
  const editable = await editableParticipantRows(kv, event);
  const selected = editable.rows.find((row) => participantIdentityCandidates(row).includes(input.participantId));
  if (!selected) throw new Error("Participant is not available in this event-scoped roster.");
  const previousChipCode = chipCode(selected);
  if (!previousChipCode) throw new Error("This athlete does not have a timing chip assignment to remove.");
  const [settings, manifest] = await Promise.all([getEventPlatformSettings(event.id), getCanonicalLiveManifest(event.id)]);
  const providerEventUuid = settings?.timingIntegration?.providerEventUuid?.trim() || manifest?.providerEventUuid?.trim() || String(selected.providerEventUuid ?? selected.eventUuid ?? "").trim();
  const changedAt = new Date().toISOString();
  const assignment: ParticipantChipAssignmentAudit = {
    id: crypto.randomUUID(), eventId: event.id, providerEventUuid, participantId: input.participantId,
    bib: String(selected.bib ?? selected.bibNumber ?? "").trim(), participantName: String(selected.fullName ?? selected.name ?? "").trim(),
    previousChipCode, chipCode: "", reason: input.reason.trim(), changedBy: input.changedBy, changedAt,
    assignmentMethod: "ADMIN", syncStatus: providerEventUuid ? "SYNC_PENDING" : "ASSIGNED",
  };
  const [assignmentIds, auditIds] = await Promise.all([
    kv.get<string[]>(assignmentIndexKey(event.id), "json").then((value) => value ?? []),
    kv.get<string[]>(auditIndexKey(event.id), "json").then((value) => value ?? []),
  ]);
  await Promise.all([
    kv.put(assignmentKey(event.id, input.participantId), JSON.stringify(assignment)),
    kv.put(assignmentIndexKey(event.id), JSON.stringify([input.participantId, ...assignmentIds.filter((id) => id !== input.participantId)])),
    kv.put(auditKey(event.id, assignment.id), JSON.stringify(assignment)),
    kv.put(auditIndexKey(event.id), JSON.stringify([assignment.id, ...auditIds].slice(0, 2_000))),
  ]);
  // The audited KV assignment is authoritative. A stale or temporarily
  // unavailable coordination object must not prevent an admin from clearing a
  // chip. A later assignment for this participant also replaces any stale
  // coordination claim atomically.
  try { await releaseEquipmentCode(event.id, "chip", input.participantId); }
  catch { /* Best-effort cleanup; the persisted empty assignment remains authoritative. */ }
  return { assignment, participant: { ...selected, chipCode: "", chip_code: "", chipAssignment: assignment, lastUpdatedAt: changedAt } };
}

export async function replaceParticipantAthleteBand(input: {
  eventIdOrSlug: string;
  participantId: string;
  athleteBandCode: string;
  reason: string;
  changedBy: string;
}): Promise<{ assignment: ParticipantAthleteBandAssignmentAudit; participant: JsonRecord }> {
  const event = await getEventBySlug(input.eventIdOrSlug, { includeUnpublished: true });
  if (!event) throw new Error("Event not found.");
  const kv = await getKv();
  const feedKey = `${PREFIX}:live:event:${event.id}:participants`;
  const editable = await editableParticipantRows(kv, event);
  const participantRows = editable.rows;
  const selectedIndex = participantRows.findIndex((row) => participantIdentityCandidates(row).includes(input.participantId));
  if (selectedIndex < 0) throw new Error("Participant is not available in this event-scoped live roster.");
  const nextBand = input.athleteBandCode.trim().replace(/\s+/g, "").toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9._:-]{1,63}$/.test(nextBand)) throw new Error("Athlete band code must be 2-64 characters using letters, numbers, dot, dash, underscore, or colon.");
  const duplicate = participantRows.find((row, index) => index !== selectedIndex && athleteBandCode(row).toLowerCase() === nextBand.toLowerCase());
  if (duplicate) throw new Error(`Athlete band ${nextBand} is already assigned to BIB ${String(duplicate.bib ?? duplicate.bibNumber ?? "unknown")}.`);
  const selected = participantRows[selectedIndex];
  const previousAthleteBandCode = athleteBandCode(selected);
  if (previousAthleteBandCode.toLowerCase() === nextBand.toLowerCase()) throw new Error("Enter a different athlete band code.");
  await claimEquipmentCode(event.id, "athlete-band", input.participantId, nextBand);
  const changedAt = new Date().toISOString();
  const assignment: ParticipantAthleteBandAssignmentAudit = {
    id: crypto.randomUUID(), eventId: event.id, participantId: input.participantId,
    bib: String(selected.bib ?? selected.bibNumber ?? "").trim(),
    participantName: String(selected.fullName ?? selected.name ?? "").trim(),
    previousAthleteBandCode, athleteBandCode: nextBand, reason: input.reason.trim(), changedBy: input.changedBy, changedAt,
  };
  const updatedParticipant = { ...selected, athleteBandCode: nextBand, athlete_band_code: nextBand, athleteBandAssignment: assignment, lastUpdatedAt: changedAt };
  const updatedRows = participantRows.map((row, index) => index === selectedIndex ? updatedParticipant : row);
  const [assignmentIds, auditIds] = await Promise.all([
    kv.get<string[]>(athleteBandAssignmentIndexKey(event.id), "json").then((value) => value ?? []),
    kv.get<string[]>(athleteBandAuditIndexKey(event.id), "json").then((value) => value ?? []),
  ]);
  const writes = [
    kv.put(athleteBandAssignmentKey(event.id, input.participantId), JSON.stringify(assignment)),
    kv.put(athleteBandAssignmentIndexKey(event.id), JSON.stringify([input.participantId, ...assignmentIds.filter((id) => id !== input.participantId)])),
    kv.put(athleteBandAuditKey(event.id, assignment.id), JSON.stringify(assignment)),
    kv.put(athleteBandAuditIndexKey(event.id), JSON.stringify([assignment.id, ...auditIds].slice(0, 2_000))),
  ];
  if (editable.storedRoster) {
    writes.push(
      kv.put(feedKey, JSON.stringify({ participants: updatedRows })),
      kv.put(`${PREFIX}:live:event:${event.id}:updated`, changedAt),
    );
  }
  await Promise.all(writes);
  const [settings, manifest] = await Promise.all([getEventPlatformSettings(event.id), getCanonicalLiveManifest(event.id)]);
  const providerEventUuid = settings?.timingIntegration?.providerEventUuid?.trim() || manifest?.providerEventUuid?.trim() || String(selected.providerEventUuid ?? selected.eventUuid ?? "").trim();
  if (editable.storedRoster && providerEventUuid) await publishIncrementalCanonicalParticipants({ eventId: event.id, providerEventUuid, rows: [updatedParticipant] });
  return { assignment, participant: updatedParticipant };
}

export async function removeParticipantAthleteBand(input: {
  eventIdOrSlug: string;
  participantId: string;
  reason: string;
  changedBy: string;
}): Promise<{ assignment: ParticipantAthleteBandAssignmentAudit; participant: JsonRecord }> {
  const event = await getEventBySlug(input.eventIdOrSlug, { includeUnpublished: true });
  if (!event) throw new Error("Event not found.");
  const kv = await getKv();
  const editable = await editableParticipantRows(kv, event);
  const selected = editable.rows.find((row) => participantIdentityCandidates(row).includes(input.participantId));
  if (!selected) throw new Error("Participant is not available in this event-scoped roster.");
  const previousAthleteBandCode = athleteBandCode(selected);
  if (!previousAthleteBandCode) throw new Error("This athlete does not have a wristband assignment to remove.");
  const changedAt = new Date().toISOString();
  const assignment: ParticipantAthleteBandAssignmentAudit = {
    id: crypto.randomUUID(), eventId: event.id, participantId: input.participantId,
    bib: String(selected.bib ?? selected.bibNumber ?? "").trim(), participantName: String(selected.fullName ?? selected.name ?? "").trim(),
    previousAthleteBandCode, athleteBandCode: "", reason: input.reason.trim(), changedBy: input.changedBy, changedAt,
  };
  const [assignmentIds, auditIds] = await Promise.all([
    kv.get<string[]>(athleteBandAssignmentIndexKey(event.id), "json").then((value) => value ?? []),
    kv.get<string[]>(athleteBandAuditIndexKey(event.id), "json").then((value) => value ?? []),
  ]);
  await Promise.all([
    kv.put(athleteBandAssignmentKey(event.id, input.participantId), JSON.stringify(assignment)),
    kv.put(athleteBandAssignmentIndexKey(event.id), JSON.stringify([input.participantId, ...assignmentIds.filter((id) => id !== input.participantId)])),
    kv.put(athleteBandAuditKey(event.id, assignment.id), JSON.stringify(assignment)),
    kv.put(athleteBandAuditIndexKey(event.id), JSON.stringify([assignment.id, ...auditIds].slice(0, 2_000))),
  ]);
  try { await releaseEquipmentCode(event.id, "athlete-band", input.participantId); }
  catch { /* Best-effort cleanup; the persisted empty assignment remains authoritative. */ }
  return { assignment, participant: { ...selected, athleteBandCode: "", athlete_band_code: "", athleteBandAssignment: assignment, lastUpdatedAt: changedAt } };
}

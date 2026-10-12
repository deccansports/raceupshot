import { requireAdmin } from "@/lib/admin-guard";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { apiFailure, apiSuccess } from "@/lib/api-response";
import { getAdminParticipantRoster, removeParticipantAssignmentOverlays } from "@/lib/participant-chip-assignments";
import { deleteImportedParticipants } from "@/lib/participant-roster-import";
import { getEventBySlug } from "@/lib/raceupshot-repository";
import { getAdminParticipantVisibilityOverrides, normalizeLiveRecord } from "@/lib/platform-repository";
import { getFeibotProviderParticipantRows } from "@/lib/feibot-integration";
import { feibotChipCodesByParticipant } from "@/lib/participant-export";

export const dynamic = "force-dynamic";

type JsonRecord = Record<string, unknown>;

function text(row: JsonRecord, ...keys: string[]): string {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
  }
  return "";
}

function source(row: JsonRecord): string {
  if (text(row, "rosterImportSource")) return "Admin upload";
  if (text(row, "publishedResultSource") === "PUBLISHED_RESULTS") return "Published results";
  if (text(row, "providerParticipantUuid", "providerEventUuid", "eventUuid")) return "Timing provider";
  return "Worker/KV";
}

function normalizedIdentity(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function record(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : null;
}

const legacyUploadedFieldExclusions = new Set([
  "participantUid", "participantUuid", "participant_uuid", "participantId", "profileParticipantId", "personParticipantId",
  "eventId", "eventEditionId", "raceCategoryId", "rosterImportSource", "rosterImportedAt", "publishedResultSource",
  "chipAssignment", "athleteBandAssignment", "uploadedFields", "uploadedFieldMappings",
  "waiverDocumentKey", "waiverDocumentSha256", "waiverAuditId", "waiverResetAt", "waiverResetBy", "waiverCoveredRegistrationIds",
]);

function adminUploadedFields(row: JsonRecord): Record<string, string> {
  const stored = record(row.uploadedFields);
  const source = stored ?? Object.fromEntries(Object.entries(row).filter(([key, value]) => !legacyUploadedFieldExclusions.has(key) && (value === null || ["string", "number", "boolean"].includes(typeof value))));
  return Object.fromEntries(Object.entries(source).slice(0, 300).map(([key, value]) => [key.slice(0, 160), value === null || value === undefined ? "" : String(value).slice(0, 5_000)]));
}

function adminUploadedFieldMappings(row: JsonRecord): Record<string, string> {
  const mappings = record(row.uploadedFieldMappings) ?? {};
  return Object.fromEntries(Object.entries(mappings).flatMap(([key, value]) => {
    const sourceHeader = value === null || value === undefined ? "" : String(value).trim().slice(0, 160);
    return sourceHeader ? [[key.slice(0, 80), sourceHeader]] : [];
  }));
}

export async function GET(_request: Request, { params }: { params: Promise<{ eventId: string }> }) {
  const denied = await requireAdmin();
  if (denied) return denied;
  try {
    const { eventId } = await params;
    const [roster, providerRows] = await Promise.all([
      getAdminParticipantRoster(eventId, { includeUploadedFields: true }),
      getFeibotProviderParticipantRows(eventId).catch(() => []),
    ]);
    if (!roster) return apiFailure("Event not found.", 404);
    const overrides = await getAdminParticipantVisibilityOverrides(roster.event.id);
    const providerChips = feibotChipCodesByParticipant(providerRows);
    const rosterRows = roster.rows.flatMap((raw) => {
      try {
        const participant = { ...normalizeLiveRecord(raw, roster.event.id), raceStatus: "UNKNOWN" as const, resultStatus: undefined, splits: [], elapsedTime: undefined };
        const rawId = text(raw, "participantUid", "participantUuid", "participant_uuid", "providerParticipantUuid", "uuid", "id");
        const explicitAssignment = record(raw.chipAssignment);
        const chipCode = text(explicitAssignment ?? {}, "chipCode")
          || providerChips.get(`id:${normalizedIdentity(rawId)}`)
          || providerChips.get(`bib:${normalizedIdentity(participant.bib)}`)
          || "";
        return [{
          participant,
          override: overrides[participant.participantUid] ?? null,
          email: text(raw, "email", "emailAddress", "rosterEmail"),
          phone: text(raw, "phone", "phoneNumber", "mobile", "mobileNumber", "whatsapp"),
          chipCode,
          athleteBandCode: text(raw, "athleteBandCode", "athlete_band_code", "athleteBand", "bandCode"),
          registrationStatus: text(raw, "registrationStatus", "bookingStatus", "participantStatus") || "Unknown",
          registrationType: text(raw, "registrationType", "participantType", "bookingType") || "Individual",
          registeredAt: text(raw, "registeredAt", "registrationDate", "createdAt", "rosterImportedAt"),
          source: source(raw),
          ticketId: text(raw, "ticketId"),
          ticketName: text(raw, "ticketName", "contestName", "category"),
          tshirtSize: text(raw, "tshirtSize", "tShirtSize", "shirtSize"),
          dateOfBirth: text(raw, "dateOfBirth", "dob", "birthDate"),
          bloodGroup: text(raw, "bloodGroup", "blood_group"),
          emergencyContactName: text(raw, "emergencyContactName", "emergencyName"),
          emergencyContact: text(raw, "emergencyContact", "emergency_contact", "emergencyMobile", "emergencyPhone"),
          address: text(raw, "address", "addressLine1", "streetAddress"),
          city: text(raw, "city", "district"), state: text(raw, "state", "stateName"),
          country: text(raw, "country", "countryName"), pincode: text(raw, "pincode", "pinCode", "postalCode", "zipCode"),
          belSeason: text(raw, "belSeason", "bel_season"), belRecognition: text(raw, "belRecognition", "bel_recognition"),
          bookingId: text(raw, "bookingId", "bookingID", "registrationId"), ticketStatus: text(raw, "ticketStatus"),
          ticketPrice: text(raw, "ticketPrice", "ticket_price"), amountPaid: text(raw, "amountPaid", "amountPaidInr", "paidAmount"),
          balanceAmount: text(raw, "balanceAmount", "balance_amount"), taxAmount: text(raw, "taxAmount", "tax_amount"),
          processingFee: text(raw, "processingFee", "processing_fee"), actualRaceDate: text(raw, "actualRaceDate", "raceDate"),
          handoverToName: text(raw, "handoverToName", "handoverName"), handoverToMobile: text(raw, "handoverToMobile", "handoverMobile"),
          bikeCheckInRemarks: text(raw, "bikeCheckInRemarks", "bikeCheckinRemarks", "bikeRemarks"),
          identityProof: text(raw, "identityProof", "idProofUrl", "idProofURL", "id_proof_url", "idProof"),
          transactionId: text(raw, "transactionId", "transactionID", "paymentTransactionId"),
          deferred: text(raw, "deferred"), deferredFromPune: text(raw, "deferredFromPune", "deferred_from_pune"),
          cancellationReason: text(raw, "cancellationReason", "cancellation_reason"),
          waiverStatus: text(raw, "waiverStatus", "waiver_status"),
          waiverCheckedInAt: text(raw, "checkedInAt", "waiverCheckedInAt", "waiverVerifiedAt"),
          waiverVolunteer: text(raw, "waiverVolunteer", "waiverVolunteerName", "checkedInBy"),
          waiverCounter: text(raw, "waiverCounter", "waiverCounterName", "checkInCounter"),
          bikeCheckIn: text(raw, "bikeCheckedInAt", "bikeCheckIn"), bikeCheckOut: text(raw, "bikeCheckedOutAt", "bikeCheckOut"),
          helmetChecked: text(raw, "helmetChecked"), lockerNumber: text(raw, "lockerNumber", "lockerNo"),
          medalIssued: text(raw, "medalIssued"), finisherJerseyIssued: text(raw, "finisherJerseyIssued", "jerseyIssued"),
          foodIssued: text(raw, "foodIssued"), updatedAt: text(raw, "updatedAt", "lastUpdatedAt", "rosterImportedAt"),
          participationMode: text(raw, "participationMode", "contestParticipationType") === "RELAY" ? "RELAY" : "INDIVIDUAL",
          relayTeamId: text(raw, "relayTeamId"),
          relayTeamName: text(raw, "relayTeamName"),
          relayTeamSize: Number(raw.relayTeamSize) || null,
          relayMemberNumber: Number(raw.relayMemberNumber) || null,
          relayMemberRole: text(raw, "relayMemberRole"),
          uploadedFields: adminUploadedFields(raw),
          uploadedFieldMappings: adminUploadedFieldMappings(raw),
        }];
      } catch {
        return [];
      }
    });
    return apiSuccess({ event: roster.event, rows: rosterRows }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    return apiFailure(error instanceof Error ? error.message : "Unable to load participants.", 503);
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ eventId: string }> }) {
  const denied = await requireAdmin();
  if (denied) return denied;
  try {
    const { eventId } = await params;
    const event = await getEventBySlug(eventId, { includeUnpublished: true });
    if (!event) return apiFailure("Event not found.", 404);
    const body = await request.json() as {
      confirmEventName?: string;
      confirmSelection?: string;
      expectedCount?: number;
      participantIds?: unknown;
    };
    const roster = await getAdminParticipantRoster(event.id);
    if (!roster) return apiFailure("Event participant roster not found.", 404);
    const selectedParticipantIds = body.participantIds;
    let participantIds: string[];
    if (Array.isArray(selectedParticipantIds)) {
      if (!selectedParticipantIds.every((value): value is string => typeof value === "string" && Boolean(value.trim()))) {
        return apiFailure("The selected participant list is invalid. Refresh and select the participants again.", 400);
      }
      participantIds = selectedParticipantIds.map((value) => value.trim());
      if (body.confirmSelection !== "DELETE" || !Number.isSafeInteger(body.expectedCount) || body.expectedCount !== participantIds.length || participantIds.length < 1 || participantIds.length > 5_000) {
        return apiFailure("Confirm the selected participant count and type DELETE exactly.", 400);
      }
      if (new Set(participantIds).size !== participantIds.length) return apiFailure("The selected participant list contains duplicate identities.", 400);
      const rosterIds = new Set(roster.rows.map((row) => text(row, "participantUid", "participantUuid", "id")));
      if (participantIds.some((id) => !rosterIds.has(id))) return apiFailure("The roster changed. Refresh before confirming deletion.", 409);
    } else {
      if (body.confirmEventName !== event.name || !Number.isSafeInteger(body.expectedCount) || (body.expectedCount ?? 0) < 1) {
        return apiFailure("Type the exact event name and confirm the displayed participant count.", 400);
      }
      if (roster.rows.length !== body.expectedCount) return apiFailure("The roster changed. Refresh before confirming deletion.", 409);
      participantIds = roster.rows.map((row) => text(row, "participantUid", "participantUuid", "id"));
    }
    if (participantIds.some((id) => !id) || new Set(participantIds).size !== participantIds.length) return apiFailure("The roster has ambiguous participant identities. Resolve them before deleting all.", 409);
    const { env } = await getCloudflareContext({ async: true });
    if (!env.RACEUPSHOT) return apiFailure("Participant storage is unavailable.", 503);
    await deleteImportedParticipants({ kv: env.RACEUPSHOT, eventId: event.id, participantIds, expectedCount: participantIds.length });
    let assignmentWarning = "";
    try { await removeParticipantAssignmentOverlays(event.id, participantIds); }
    catch { assignmentWarning = "The uploaded roster was removed, but assignment cleanup needs admin review."; }
    return apiSuccess({ deleted: participantIds.length, warning: assignmentWarning }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) { return apiFailure(error instanceof Error ? error.message : "Unable to delete event participants.", 400); }
}

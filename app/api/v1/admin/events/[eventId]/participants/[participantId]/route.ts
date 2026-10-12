import { getAuthenticatedAdminEmail } from "@/lib/admin-auth";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { apiFailure, apiSuccess } from "@/lib/api-response";
import { getAdminParticipantRoster, removeParticipantAssignmentOverlays } from "@/lib/participant-chip-assignments";
import { deleteImportedParticipants, editImportedParticipant } from "@/lib/participant-roster-import";
import { z } from "@/lib/zod";
import { normalizeLiveRecord } from "@/lib/platform-repository";
import { getEventBySlug } from "@/lib/raceupshot-repository";
import { getAdminVolunteerParticipantStates, resetAdminVolunteerWaiverCheckIn, type VolunteerParticipantState } from "@/lib/volunteer-operations";
import { notifyFinalizedRegistration } from "@/lib/registration-transactional-notifications";

export const dynamic = "force-dynamic";

const editSchema = z.object({
  bib: z.string().trim().min(1).max(40), name: z.string().trim().min(1).max(160),
  email: z.string().trim().max(254), mobile: z.string().trim().max(40),
  registrationStatus: z.string().trim().max(80), gender: z.string().trim().max(40),
  ageGroup: z.string().trim().max(80), club: z.string().trim().max(160), tshirtSize: z.string().trim().max(40),
  dateOfBirth: z.string().trim().max(80), bloodGroup: z.string().trim().max(40),
  emergencyContactName: z.string().trim().max(160), emergencyContact: z.string().trim().max(80),
  address: z.string().trim().max(500), city: z.string().trim().max(120), state: z.string().trim().max(120),
  country: z.string().trim().max(120), pincode: z.string().trim().max(30),
  belSeason: z.string().trim().max(120), belRecognition: z.string().trim().max(160), bookingId: z.string().trim().max(120),
  ticketStatus: z.string().trim().max(80), ticketPrice: z.string().trim().max(40), amountPaid: z.string().trim().max(40),
  balanceAmount: z.string().trim().max(40), taxAmount: z.string().trim().max(40), processingFee: z.string().trim().max(40),
  registeredAt: z.string().trim().max(80), actualRaceDate: z.string().trim().max(80),
  handoverToName: z.string().trim().max(160), handoverToMobile: z.string().trim().max(80),
  bikeCheckInRemarks: z.string().trim().max(500), identityProof: z.string().trim().max(1000),
  transactionId: z.string().trim().max(160), deferred: z.string().trim().max(40),
  deferredFromPune: z.string().trim().max(40), cancellationReason: z.string().trim().max(500),
  uploadedFields: z.record(z.string().max(160), z.string().max(5_000)).optional().default({}),
  ticketId: z.string().trim().min(1), ticketName: z.string().trim().min(1),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ eventId: string; participantId: string }> }) {
  const changedBy = await getAuthenticatedAdminEmail();
  if (!changedBy) return apiFailure("Admin authentication required.", 401);
  try {
    const parsed = editSchema.safeParse(await request.json());
    if (!parsed.success) return apiFailure(parsed.error.issues[0]?.message || "Check the participant details.", 400);
    const { eventId, participantId } = await params;
    const event = await getEventBySlug(eventId, { includeUnpublished: true });
    if (!event) return apiFailure("Event not found.", 404);
    const configuredTickets = event.tickets?.length ? event.tickets : event.categories.map((name) => ({ id: name, name }));
    const ticket = configuredTickets.find((item) => item.id === parsed.data.ticketId && item.name === parsed.data.ticketName);
    if (!ticket) return apiFailure("Select a ticket configured for this event.", 400);
    const { env } = await getCloudflareContext({ async: true });
    if (!env.RACEUPSHOT) return apiFailure("Participant storage is unavailable.", 503);
    const beforeRoster = await getAdminParticipantRoster(event.id);
    const previous = beforeRoster?.rows.find((row) => text(row, 'participantUid', 'participantUuid', 'id') === participantId);
    const updated = await editImportedParticipant({ kv: env.RACEUPSHOT, eventId: event.id, participantId, edit: parsed.data, changedBy });
    let notificationWarning = '';
    const identityChanged = Boolean(previous) && (text(previous, 'name', 'fullName') !== parsed.data.name || text(previous, 'email')?.toLowerCase() !== parsed.data.email.toLowerCase());
    if (identityChanged) {
      try { await resetAdminVolunteerWaiverCheckIn({ eventId: event.id, participantId, adminName: changedBy }); }
      catch (error) {
        if (!/no waiver or check-in state/i.test(error instanceof Error ? error.message : '')) throw error;
      }
    }
    if (previous) {
      try { await notifyFinalizedRegistration({ eventId: event.id, contestId: parsed.data.ticketId, participantId, previous, current: updated, eventName: event.name }); }
      catch (error) { notificationWarning = error instanceof Error ? error.message : 'Registration notification requires review.'; }
    }
    return apiSuccess({ participant: updated, notificationWarning }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) { return apiFailure(error instanceof Error ? error.message : "Unable to edit participant.", 400); }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ eventId: string; participantId: string }> }) {
  if (!await getAuthenticatedAdminEmail()) return apiFailure("Admin authentication required.", 401);
  try {
    const { eventId, participantId } = await params;
    const event = await getEventBySlug(eventId, { includeUnpublished: true });
    if (!event) return apiFailure("Event not found.", 404);
    const body = await request.json() as { confirmBib?: string };
    const roster = await getAdminParticipantRoster(event.id);
    const row = roster?.rows.find((item) => text(item, "participantUid", "participantUuid", "id") === participantId);
    if (!row) return apiFailure("Participant not found in this event roster.", 404);
    if (!body.confirmBib || body.confirmBib !== text(row, "bib", "bibNumber")) return apiFailure("Confirm this participant's exact BIB before deletion.", 400);
    const { env } = await getCloudflareContext({ async: true });
    if (!env.RACEUPSHOT) return apiFailure("Participant storage is unavailable.", 503);
    await deleteImportedParticipants({ kv: env.RACEUPSHOT, eventId: event.id, participantIds: [participantId], expectedCount: 1 });
    let assignmentWarning = "";
    try { await removeParticipantAssignmentOverlays(event.id, [participantId]); }
    catch { assignmentWarning = "The roster row was removed, but assignment cleanup needs admin review."; }
    return apiSuccess({ deleted: 1, warning: assignmentWarning }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) { return apiFailure(error instanceof Error ? error.message : "Unable to delete participant.", 400); }
}

type JsonRecord = Record<string, unknown>;

function text(row: JsonRecord | null | undefined, ...keys: string[]): string | null {
  if (!row) return null;
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
  }
  return null;
}

function truth(row: JsonRecord | null, ...keys: string[]): boolean | null {
  const value = text(row, ...keys);
  if (value === null) return null;
  if (["true", "yes", "1", "accepted", "checked", "checkedin"].includes(value.toLowerCase().replaceAll("_", ""))) return true;
  if (["false", "no", "0", "declined", "notaccepted"].includes(value.toLowerCase().replaceAll("_", ""))) return false;
  return null;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ eventId: string; participantId: string }> },
) {
  if (!await getAuthenticatedAdminEmail()) return apiFailure("Admin authentication required.", 401);
  try {
    const { eventId, participantId } = await params;
    const roster = await getAdminParticipantRoster(eventId);
    if (!roster) return apiFailure("Event not found.", 404);
    const raw = roster?.rows.find((row) => {
      const id = text(row, "participantUid", "participantUuid", "participant_uuid", "providerParticipantUuid", "uuid", "id");
      const bib = text(row, "bib", "bibNumber", "bib_number");
      return id === participantId || bib === participantId;
    }) ?? null;
    if (!raw) return apiFailure("Participant not found in this event registration roster.", 404);
    const normalized = normalizeLiveRecord(raw, roster.event.id);
    const participant = { ...normalized, raceStatus: "UNKNOWN" as const, resultStatus: undefined, splits: [], elapsedTime: undefined };
    const stateParticipantId = text(raw, "participantUid", "participantUuid", "participant_uuid", "providerParticipantUuid", "uuid", "id")
      ?? participant.participantUid;
    const states = await getAdminVolunteerParticipantStates(eventId, [stateParticipantId])
      .catch((): Record<string, VolunteerParticipantState> => ({}));
    const state = states[stateParticipantId] ?? null;
    return apiSuccess({
      event: roster.event,
      participant,
      identity: {
        email: text(raw, "email", "emailAddress"),
        chipCode: text(raw, "chipCode", "chip_code", "chip", "rfid"),
        providerEventUuid: text(raw, "providerEventUuid", "eventUuid"),
        providerParticipantUuid: text(raw, "providerParticipantUuid", "participantUuid"),
        contestUuid: text(raw, "contestUuid", "providerContestUuid"),
        dateOfBirth: text(raw, "dateOfBirth", "dob"),
        waveStartTime: null,
        acceptedStartTime: null,
        finishTime: null,
        currentSplit: null,
        statusDetail: null,
      },
      canonical: { buildVersion: null, updatedAt: null, courseVersion: null, timingVersion: null, leaderboardVersion: null },
      registration: {
        mobile: text(raw, "mobile", "mobileNumber", "phone", "phoneNumber", "contactNumber", "whatsapp"),
        emergencyContact: text(raw, "emergencyContact", "emergency_contact", "emergencyMobile", "emergencyPhone"),
        address: text(raw, "address", "addressLine1", "streetAddress"),
        city: text(raw, "city", "district"),
        state: text(raw, "state", "stateName"),
        country: text(raw, "country", "countryName") ?? participant.country ?? null,
        pincode: text(raw, "pincode", "pinCode", "postalCode", "zipCode"),
        bloodGroup: text(raw, "bloodGroup", "blood_group"),
        tshirtSize: text(raw, "tshirtSize", "tShirtSize", "t_shirt_size", "jerseySize", "shirtSize"),
        athleteBandCode: text(raw, "athleteBandCode", "athlete_band_code", "athleteBand", "bandCode"),
        idProofUrl: text(raw, "idProofUrl", "idProofURL", "id_proof_url", "idProof"),
        waiverDocumentUrl: text(raw, "waiverDocumentUrl", "signedWaiverUrl", "waiverPdfUrl", "waiver_url"),
        filledFormUrl: text(raw, "filledFormUrl", "registrationFormUrl", "formPdfUrl"),
        signatureName: text(raw, "signatureName", "signedBy", "waiverSignatureName"),
        invoiceNumber: text(raw, "invoiceNumber", "invoiceNo", "invoice_id"),
        waiverStatus: text(raw, "waiverStatus", "waiver_status"),
        checkedInAt: state?.checkedInAt ?? text(raw, "checkedInAt", "checkInTime"),
        checkedInBy: state?.updatedBy ?? text(raw, "checkedInBy", "checkInHandledBy"),
        waiverVerifiedAt: state?.waiverResetAt ? null : state ? state.waiverVerifiedAt : text(raw, "waiverVerifiedAt"),
        rulesAccepted: truth(raw, "rulesAccepted", "rules_accepted"),
        cutoffAccepted: truth(raw, "cutoffAccepted", "cutoff_accepted"),
        cancellationPolicyAccepted: truth(raw, "cancellationPolicyAccepted", "deferralPolicyAccepted", "cancellation_policy_accepted"),
        marketingConsent: truth(raw, "marketingConsent", "marketing_consent"),
        registrationStatus: text(raw, "registrationStatus", "bookingStatus", "participantStatus") ?? "Unknown",
        registrationType: text(raw, "registrationType", "participantType", "bookingType") ?? "Individual",
        registeredAt: text(raw, "registeredAt", "registrationDate", "createdAt", "rosterImportedAt"),
      },
      operations: {
        bikeCheckedInAt: state?.bikeCheckedInAt ?? null,
        bikeCheckedOutAt: state?.bikeCheckedOutAt ?? null,
        helmetChecked: state?.helmetChecked ?? false,
        bikeRack: state?.bikeRack ?? null,
        updatedBy: state?.updatedBy ?? null,
      },
    }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    return apiFailure(error instanceof Error ? error.message : "Unable to load participant details.", 500);
  }
}

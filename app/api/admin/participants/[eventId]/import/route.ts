import { getCloudflareContext } from "@opennextjs/cloudflare";

import { requireAdmin } from "@/lib/admin-guard";
import { getAuthenticatedAdminEmail } from "@/lib/admin-auth";
import { apiFailure, apiSuccess } from "@/lib/api-response";
import { importParticipantRoster } from "@/lib/participant-roster-import";
import { getEventBySlug } from "@/lib/raceupshot-repository";
import { z } from "@/lib/zod";

export const dynamic = "force-dynamic";

const importInput = z.object({
  fileName: z.string().trim().min(1).max(240),
  replaceExisting: z.boolean().default(false),
  categoryMappings: z.record(z.string(), z.string().trim().max(240)).optional(),
  mappings: z.object({
    bib: z.string().trim().min(1).max(160),
    name: z.string().trim().max(160).optional(),
    nameOnBib: z.string().trim().max(160).optional(),
    participantId: z.string().trim().max(160).optional(),
    registrationId: z.string().trim().max(160).optional(),
    sessionId: z.string().trim().max(160).optional(),
    email: z.string().trim().max(160).optional(),
    mobile: z.string().trim().max(160).optional(),
    category: z.string().trim().max(160).optional(),
    registrationStatus: z.string().trim().max(160).optional(),
    gender: z.string().trim().max(160).optional(),
    ageGroup: z.string().trim().max(160).optional(),
    chipCode: z.string().trim().max(160).optional(),
    athleteBandCode: z.string().trim().max(160).optional(),
    emergencyContactName: z.string().trim().max(160).optional(),
    emergencyContact: z.string().trim().max(160).optional(),
    dateOfBirth: z.string().trim().max(160).optional(),
    age: z.string().trim().max(160).optional(),
    tshirtSize: z.string().trim().max(160).optional(),
    bloodGroup: z.string().trim().max(160).optional(),
    medicalHistory: z.string().trim().max(160).optional(),
    medicalCondition: z.string().trim().max(160).optional(),
    relayTeamName: z.string().trim().max(160).optional(),
    relayMemberNumber: z.string().trim().max(160).optional(),
    relayMemberRole: z.string().trim().max(160).optional(),
  }),
  rows: z.array(z.record(z.string(), z.unknown())).min(1).max(10_000),
});

export async function POST(request: Request, { params }: { params: Promise<{ eventId: string }> }) {
  const denied = await requireAdmin();
  if (denied) return denied;
  try {
    const parsed = importInput.safeParse(await request.json());
    if (!parsed.success) return apiFailure(parsed.error.issues[0]?.message || "Check the participant spreadsheet.", 400);
    const { eventId } = await params;
    const event = await getEventBySlug(eventId, { includeUnpublished: true });
    if (!event) return apiFailure("Event not found.", 404);
    if (!event.categories.length) return apiFailure("Configure event tickets before importing participants.", 400);
    const { env } = await getCloudflareContext({ async: true });
    if (!env.RACEUPSHOT) return apiFailure("Race Upshot participant storage is unavailable.", 503);
    const importedBy = await getAuthenticatedAdminEmail() || "Race Upshot admin";
    return apiSuccess(await importParticipantRoster({
      kv: env.RACEUPSHOT,
      eventId: event.id,
      fileName: parsed.data.fileName,
      rows: parsed.data.rows,
      mappings: parsed.data.mappings,
      categoryMappings: parsed.data.categoryMappings,
      eventTickets: event.ticketDefinitions?.length ? event.ticketDefinitions : event.tickets?.length ? event.tickets : event.categories,
      replaceExisting: parsed.data.replaceExisting,
      importedBy,
    }), { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    return apiFailure(error instanceof Error ? error.message : "Unable to import participants.", 400);
  }
}

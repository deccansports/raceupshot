import { getAuthenticatedAdminEmail } from "@/lib/admin-auth";
import { getAdminParticipantRoster } from "@/lib/participant-chip-assignments";
import { getWaiverDocument } from "@/lib/signed-waivers";
import { registrationWaiverVerifiedAt } from "@/lib/volunteer-operations";

export const dynamic = "force-dynamic";

type JsonRecord = Record<string, unknown>;

function text(row: JsonRecord, ...keys: string[]): string {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
  }
  return "";
}

function fileSegment(value: string, fallback: string): string {
  return value.trim().replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || fallback;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ eventId: string; participantId: string }> },
) {
  if (!await getAuthenticatedAdminEmail()) return new Response("Admin authentication required.", { status: 401 });
  try {
    const { eventId, participantId } = await params;
    const roster = await getAdminParticipantRoster(eventId);
    if (!roster) return new Response("Event not found.", { status: 404 });
    const participant = roster.rows.find((row) => [
      row.participantUid, row.participantUuid, row.participant_uuid, row.providerParticipantUuid, row.uuid, row.id,
    ].some((value) => String(value ?? "").trim() === participantId));
    if (!participant) return new Response("Participant not found.", { status: 404 });
    if (!registrationWaiverVerifiedAt(participant)) return new Response("The participant has no OTP-verified signed waiver.", { status: 409 });
    const key = text(participant, "waiverDocumentKey");
    if (!key.startsWith("signed-waivers/")) return new Response("Signed waiver PDF is unavailable.", { status: 404 });
    const object = await getWaiverDocument(key);
    if (!object) return new Response("Signed waiver PDF is unavailable.", { status: 404 });
    const bib = fileSegment(text(participant, "bib", "bibNumber"), "no-bib");
    const name = fileSegment(text(participant, "name", "fullName", "displayName"), "athlete");
    return new Response(await object.arrayBuffer(), {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename="signed-waiver-${bib}-${name}.pdf"`,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
        etag: object.httpEtag,
      },
    });
  } catch {
    return new Response("Unable to download the signed waiver PDF.", { status: 500 });
  }
}

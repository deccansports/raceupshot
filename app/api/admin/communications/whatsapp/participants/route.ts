import { requireAdmin } from "@/lib/admin-guard";
import { apiFailure, apiSuccess } from "@/lib/api-response";
import { getAdminParticipantRoster } from "@/lib/participant-chip-assignments";

function value(row: Record<string, unknown>, ...keys: string[]) { for (const key of keys) if (row[key] !== null && row[key] !== undefined && String(row[key]).trim()) return String(row[key]).trim(); return ""; }
export async function GET(request: Request) {
  const denied = await requireAdmin(); if (denied) return denied;
  try {
    const url = new URL(request.url); const eventId = url.searchParams.get("eventId")?.trim() || ""; const query = url.searchParams.get("q")?.trim().toLowerCase() || "";
    if (!eventId || query.length < 2) return apiSuccess([]);
    const roster = await getAdminParticipantRoster(eventId, { includeUploadedFields: true });
    const rows = (roster?.rows ?? []).map((row) => {
      const bib = value(row, "bib", "bibNumber", "BIB Number");
      const mobile = value(row, "mobile", "mobileNumber", "phone", "whatsapp");
      return { id: value(row, "id", "participantUid", "participantId", "registrationId", "bookingId") || bib || mobile, name: value(row, "fullName", "name", "athleteName"), bib, mobile, email: value(row, "email", "emailAddress"), category: value(row, "category", "ticketName", "contestName") };
    }).filter((row) => `${row.id} ${row.name} ${row.bib} ${row.mobile} ${row.email}`.toLowerCase().includes(query)).slice(0, 20);
    return apiSuccess(rows, { headers: { "cache-control": "private, no-store" } });
  } catch (error) { return apiFailure(error instanceof Error ? error.message : "Unable to search participants.", 503); }
}

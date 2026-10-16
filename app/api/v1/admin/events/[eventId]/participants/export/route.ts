import { requireAdmin } from "@/lib/admin-guard";
import { buildParticipantExportRows, participantExportCsv } from "@/lib/participant-export";
import { getAdminParticipantRoster } from "@/lib/participant-chip-assignments";
import { getEventBySlug } from "@/lib/raceupshot-repository";
import { getAdminVolunteerParticipantStates, type VolunteerParticipantState } from "@/lib/volunteer-operations";

export const dynamic = "force-dynamic";

type JsonRecord = Record<string, unknown>;

function text(row: JsonRecord, ...keys: string[]): string {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
  }
  return "";
}

function safeFileName(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "event";
}

export async function GET(_request: Request, { params }: { params: Promise<{ eventId: string }> }) {
  const denied = await requireAdmin();
  if (denied) return denied;
  try {
    const { eventId } = await params;
    const [event, roster] = await Promise.all([
      getEventBySlug(eventId, { includeUnpublished: true }),
      getAdminParticipantRoster(eventId),
    ]);
    if (!event || !roster) return new Response("Event not found.", { status: 404 });
    const participantIds = roster.rows.map((row) =>
      text(row, "participantUid", "participantUuid", "participant_uuid", "providerParticipantUuid", "uuid", "id")
      || text(row, "bib", "bibNumber", "bib_number"),
    ).filter(Boolean);
    const states = await getAdminVolunteerParticipantStates(event.id, participantIds)
      .catch((): Record<string, VolunteerParticipantState> => ({}));
    const rows = buildParticipantExportRows({
      registrationRows: roster.rows,
      states,
      eventDate: event.dateIso,
    });
    const csv = `\uFEFF${participantExportCsv(rows)}`;
    return new Response(csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${safeFileName(event.slug || event.name)}-participants.csv"`,
        "cache-control": "private, no-store",
      },
    });
  } catch (error) {
    return new Response(error instanceof Error ? error.message : "Unable to export participants.", {
      status: 503,
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "private, no-store" },
    });
  }
}

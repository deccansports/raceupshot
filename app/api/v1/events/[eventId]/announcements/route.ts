import { platformFailure, platformSuccess } from "@/lib/platform-api-response";
import { getEventAnnouncements } from "@/lib/platform-repository";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ eventId: string }> }) {
  try {
    const { eventId } = await params;
    const read = await getEventAnnouncements(eventId);
    return read
      ? platformSuccess(read.data, { ...read, eventId })
      : platformFailure("EVENT_NOT_FOUND", "Event not found", 404);
  } catch (error) {
    return platformFailure("ANNOUNCEMENTS_UNAVAILABLE", error instanceof Error ? error.message : "Unable to load announcements", 503);
  }
}

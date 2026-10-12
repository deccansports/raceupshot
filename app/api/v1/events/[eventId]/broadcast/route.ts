import { getPublicLiveBroadcast } from "@/lib/live-broadcast";
import { platformFailure, platformSuccess } from "@/lib/platform-api-response";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ eventId: string }> }) {
  try {
    const { eventId } = await params;
    const broadcast = await getPublicLiveBroadcast(eventId);
    return broadcast
      ? platformSuccess(broadcast, {
          eventId: broadcast.eventId,
          lastUpdatedAt: broadcast.updatedAt,
          cacheSeconds: broadcast.status === "LIVE" ? 5 : 30,
        })
      : platformFailure("BROADCAST_NOT_FOUND", "Broadcast event not found", 404);
  } catch (error) {
    return platformFailure("BROADCAST_UNAVAILABLE", error instanceof Error ? error.message : "Unable to load live broadcast", 503);
  }
}

import { platformFailure, platformSuccess } from "@/lib/platform-api-response";
import { getPlatformEvents } from "@/lib/platform-repository";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const requestUrl = new URL(request.url);
    const section = requestUrl.searchParams.get("section")?.toUpperCase();
    const events = await getPlatformEvents({ mobileOnly: true });
    const filtered = section && ["UPCOMING", "LIVE", "PAST"].includes(section)
      ? events.filter((event) => event.section === section)
      : events;
    // Event cards render banners, but uploaded base64 media must not inflate the
    // list payload. Point those cards at the cached, event-scoped media route.
    const lightweightEvents = filtered.map(({ logoUrl, bannerUrl, ...event }) => {
      const publicMediaUrl = (kind: "logo" | "banner") =>
        `${requestUrl.origin}/api/v1/events/${encodeURIComponent(event.eventId)}/media/${kind}`;
      return {
        ...event,
        ...(logoUrl ? { logoUrl: logoUrl.startsWith("data:") ? publicMediaUrl("logo") : logoUrl } : {}),
        ...(bannerUrl ? { bannerUrl: bannerUrl.startsWith("data:") ? publicMediaUrl("banner") : bannerUrl } : {}),
      };
    });
    return platformSuccess(lightweightEvents, { cacheSeconds: 30 });
  } catch (error) {
    return platformFailure("EVENTS_UNAVAILABLE", error instanceof Error ? error.message : "Unable to load events", 503);
  }
}

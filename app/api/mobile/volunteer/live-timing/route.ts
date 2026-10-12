import { apiFailure, apiSuccess } from "@/lib/api-response";
import { mobileCorsHeaders, mobileCorsPreflight } from "@/lib/mobile-cors";
import { requireVolunteer } from "@/lib/volunteer-auth";
import { getVolunteerLiveTiming } from "@/lib/volunteer-live-timing";

export const dynamic = "force-dynamic";
export const OPTIONS = mobileCorsPreflight;

export async function GET(request: Request) {
  try {
    const { profile } = await requireVolunteer(request);
    const url = new URL(request.url);
    const eventId = url.searchParams.get("eventId")?.trim() || "";
    const mode = url.searchParams.get("mode") === "cutoff" ? "cutoff" : "finish";
    if (!eventId) return apiFailure("Event ID is required.", 400, { headers: mobileCorsHeaders });
    return apiSuccess(await getVolunteerLiveTiming(profile, eventId, mode), {
      headers: { ...mobileCorsHeaders, "cache-control": "no-store" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Finish-line timing is unavailable.";
    const status = message === "VOLUNTEER_AUTH_REQUIRED" ? 401 : /not assigned|disabled/i.test(message) ? 403 : 503;
    return apiFailure(message, status, { headers: mobileCorsHeaders });
  }
}

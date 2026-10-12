import { apiFailure, apiSuccess } from "@/lib/api-response";
import { mobileCorsHeaders, mobileCorsPreflight } from "@/lib/mobile-cors";
import { requireVolunteer } from "@/lib/volunteer-auth";
import { activeAssignment, requireModule } from "@/lib/volunteer-operations";
import { getVolunteerCutoffTiming } from "@/lib/volunteer-cutoff-timing";

export const dynamic = "force-dynamic";
export const OPTIONS = mobileCorsPreflight;
export async function GET(request: Request) {
  try {
    const { profile } = await requireVolunteer(request);
    const eventId = new URL(request.url).searchParams.get("eventId")?.trim() || "";
    if (!eventId) return apiFailure("Event ID is required.", 400, { headers: mobileCorsHeaders });
    requireModule(activeAssignment(profile, eventId), "CUTOFF_TIME_VOLUNTEER");
    return apiSuccess(await getVolunteerCutoffTiming(eventId), { headers: { ...mobileCorsHeaders, "cache-control": "private, no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Cutoff timing is unavailable.";
    const status = message === "VOLUNTEER_AUTH_REQUIRED" ? 401 : /not assigned|disabled|function is not assigned/i.test(message) ? 403 : 503;
    return apiFailure(message, status, { headers: mobileCorsHeaders });
  }
}

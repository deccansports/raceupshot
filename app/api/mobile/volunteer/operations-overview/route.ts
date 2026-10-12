import { apiFailure, apiSuccess } from "@/lib/api-response";
import { mobileCorsHeaders, mobileCorsPreflight } from "@/lib/mobile-cors";
import { requireVolunteer } from "@/lib/volunteer-auth";
import { getVolunteerOperationsOverview } from "@/lib/volunteer-operations";

export const dynamic = "force-dynamic";
export const OPTIONS = mobileCorsPreflight;

export async function GET(request: Request) {
  try {
    const { profile } = await requireVolunteer(request);
    const eventId = new URL(request.url).searchParams.get("eventId")?.trim() || "";
    if (!eventId) return apiFailure("Event ID is required.", 400, { headers: mobileCorsHeaders });
    return apiSuccess(await getVolunteerOperationsOverview({ profile, eventId }), {
      headers: { ...mobileCorsHeaders, "cache-control": "private, no-store" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Volunteer operation totals are unavailable.";
    const status = message === "VOLUNTEER_AUTH_REQUIRED" ? 401 : /not assigned|disabled|function is not assigned/i.test(message) ? 403 : 503;
    return apiFailure(message, status, { headers: mobileCorsHeaders });
  }
}

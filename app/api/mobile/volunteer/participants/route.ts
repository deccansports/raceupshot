import { apiFailure, apiSuccess } from "@/lib/api-response";
import { mobileCorsHeaders, mobileCorsPreflight } from "@/lib/mobile-cors";
import { requireVolunteer } from "@/lib/volunteer-auth";
import { searchVolunteerParticipants, type VolunteerParticipantSearchMode } from "@/lib/volunteer-operations";

export const dynamic = "force-dynamic";
export const OPTIONS = mobileCorsPreflight;

export async function GET(request: Request) {
  try {
    const { profile } = await requireVolunteer(request);
    const url = new URL(request.url);
    const eventId = url.searchParams.get("eventId")?.trim() || "";
    const query = url.searchParams.get("query")?.trim() || "";
    const requestedMode = url.searchParams.get("mode")?.trim().toUpperCase() || "ANY";
    const searchMode: VolunteerParticipantSearchMode = ["BIB", "REGISTRATION_ID", "ATHLETE_BAND", "NAME_EMAIL", "MOBILE"].includes(requestedMode)
      ? requestedMode as VolunteerParticipantSearchMode
      : "ANY";
    if (!eventId) return apiFailure("Event ID is required.", 400, { headers: mobileCorsHeaders });
    return apiSuccess(await searchVolunteerParticipants({ profile, eventId, query, searchMode, includeBikeRack: url.searchParams.get("rack") === "1" }), { headers: { ...mobileCorsHeaders, "cache-control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to search athletes.";
    const status = message === "VOLUNTEER_AUTH_REQUIRED" ? 401 : /not assigned|disabled/i.test(message) ? 403 : 400;
    return apiFailure(message, status, { headers: mobileCorsHeaders });
  }
}

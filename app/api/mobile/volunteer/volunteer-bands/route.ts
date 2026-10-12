import { apiFailure, apiSuccess } from "@/lib/api-response";
import { mobileCorsHeaders, mobileCorsPreflight } from "@/lib/mobile-cors";
import { requireVolunteer } from "@/lib/volunteer-auth";
import { assignVolunteerBand, searchVolunteerBandTargets } from "@/lib/volunteer-operations";
import { z } from "@/lib/zod";

const assignSchema = z.object({
  eventId: z.string().trim().min(1).max(160),
  volunteerId: z.string().trim().min(1).max(250),
  bandCode: z.string().trim().min(2).max(64),
});

export const dynamic = "force-dynamic";
export const OPTIONS = mobileCorsPreflight;

export async function GET(request: Request) {
  try {
    const { profile } = await requireVolunteer(request);
    const url = new URL(request.url);
    const eventId = url.searchParams.get("eventId")?.trim() || "";
    const query = url.searchParams.get("query")?.trim() || "";
    if (!eventId || !query) return apiFailure("Event and volunteer search are required.", 400, { headers: mobileCorsHeaders });
    return apiSuccess({ volunteers: await searchVolunteerBandTargets({ profile, eventId, query }) }, { headers: { ...mobileCorsHeaders, "cache-control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to search event volunteers.";
    const status = message === "VOLUNTEER_AUTH_REQUIRED" ? 401 : /not assigned|disabled/i.test(message) ? 403 : 400;
    return apiFailure(message, status, { headers: mobileCorsHeaders });
  }
}

export async function POST(request: Request) {
  try {
    const { profile } = await requireVolunteer(request);
    const input = assignSchema.safeParse(await request.json());
    if (!input.success) return apiFailure(input.error.issues[0]?.message || "Check the volunteer band details.", 400, { headers: mobileCorsHeaders });
    return apiSuccess(await assignVolunteerBand({ profile, ...input.data }), { headers: { ...mobileCorsHeaders, "cache-control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to assign the volunteer band.";
    const status = message === "VOLUNTEER_AUTH_REQUIRED" ? 401 : /not assigned|disabled/i.test(message) ? 403 : 400;
    return apiFailure(message, status, { headers: mobileCorsHeaders });
  }
}

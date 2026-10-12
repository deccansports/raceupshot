import { apiFailure, apiSuccess } from "@/lib/api-response";
import { mobileCorsHeaders, mobileCorsPreflight } from "@/lib/mobile-cors";
import { requireVolunteer } from "@/lib/volunteer-auth";
import { checkInAllEligibleRegistrations } from "@/lib/volunteer-operations";
import { z } from "@/lib/zod";

const inputSchema = z.object({ eventId: z.string().trim().min(1).max(160), participantId: z.string().trim().min(1).max(250) });
export const dynamic = "force-dynamic";
export const OPTIONS = mobileCorsPreflight;

export async function POST(request: Request) {
  try {
    const { profile } = await requireVolunteer(request);
    const input = inputSchema.safeParse(await request.json());
    if (!input.success) return apiFailure(input.error.issues[0]?.message || "Invalid check-in selection.", 400, { headers: mobileCorsHeaders });
    return apiSuccess({ participants: await checkInAllEligibleRegistrations({ profile, ...input.data }) }, { headers: { ...mobileCorsHeaders, "cache-control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to check in the selected registrations.";
    return apiFailure(message, message === "VOLUNTEER_AUTH_REQUIRED" ? 401 : /not assigned|disabled/i.test(message) ? 403 : 400, { headers: mobileCorsHeaders });
  }
}

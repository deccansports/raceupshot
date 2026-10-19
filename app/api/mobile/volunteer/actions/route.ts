import { apiFailure, apiSuccess } from "@/lib/api-response";
import { mobileCorsHeaders, mobileCorsPreflight } from "@/lib/mobile-cors";
import { requireVolunteer } from "@/lib/volunteer-auth";
import { performVolunteerAction } from "@/lib/volunteer-operations";
import { z } from "@/lib/zod";

const inputSchema = z.object({
  eventId: z.string().trim().min(1).max(160),
  participantId: z.string().trim().min(1).max(250),
  action: z.enum(["CHECK_IN", "BIKE_IN", "BIKE_OUT", "MEDAL_ISSUE", "FOOD_ISSUE", "LOCKER_ASSIGN"]),
  helmetChecked: z.boolean().optional(),
  bikeRack: z.string().trim().max(80).optional(),
  lockerNumber: z.string().trim().max(80).optional(),
  scannedChipCode: z.string().trim().max(500).optional(),
  chipReturnMethod: z.enum(["CAMERA", "RFID", "MANUAL", "OVERRIDE", "NO_CHIP_ASSIGNED"]).optional(),
  chipReturnReason: z.string().trim().max(250).optional(),
});

export const dynamic = "force-dynamic";
export const OPTIONS = mobileCorsPreflight;

export async function POST(request: Request) {
  try {
    const { profile } = await requireVolunteer(request);
    const input = inputSchema.safeParse(await request.json());
    if (!input.success) return apiFailure(input.error.issues[0]?.message || "Invalid volunteer action.", 400, { headers: mobileCorsHeaders });
    return apiSuccess(await performVolunteerAction({ profile, ...input.data }), { headers: { ...mobileCorsHeaders, "cache-control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to record the volunteer action.";
    const status = message === "VOLUNTEER_AUTH_REQUIRED" ? 401 : /not assigned|disabled|not assigned to the volunteer/i.test(message) ? 403 : 400;
    return apiFailure(message, status, { headers: mobileCorsHeaders });
  }
}

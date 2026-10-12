import { apiFailure, apiSuccess } from "@/lib/api-response";
import { mobileCorsHeaders, mobileCorsPreflight } from "@/lib/mobile-cors";
import { requireVolunteer } from "@/lib/volunteer-auth";
import { verifyVolunteerWaiverOtp } from "@/lib/volunteer-operations";
import { z } from "@/lib/zod";

const inputSchema = z.object({
  eventId: z.string().trim().min(1).max(160),
  participantId: z.string().trim().min(1).max(250),
  registrationIds: z.array(z.string().trim().min(1).max(250)).min(1).max(25).optional(),
  otp: z.string().trim().regex(/^\d{6}$/, "Enter the complete six-digit OTP."),
  signerName: z.string().trim().min(1).max(200).optional(),
  signerRelationship: z.string().trim().min(1).max(100).optional(),
  deviceSessionId: z.string().trim().max(250).optional(),
});

export const dynamic = "force-dynamic";
export const OPTIONS = mobileCorsPreflight;

export async function POST(request: Request) {
  try {
    const { profile } = await requireVolunteer(request);
    const input = inputSchema.safeParse(await request.json());
    if (!input.success) return apiFailure(input.error.issues[0]?.message || "Check the waiver OTP.", 400, { headers: mobileCorsHeaders });
    return apiSuccess(await verifyVolunteerWaiverOtp({ profile, ...input.data, origin: new URL(request.url).origin }), {
      headers: { ...mobileCorsHeaders, "cache-control": "no-store" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to verify the waiver OTP.";
    const status = message === "VOLUNTEER_AUTH_REQUIRED" ? 401 : /not assigned|disabled/i.test(message) ? 403 : 400;
    return apiFailure(message, status, { headers: mobileCorsHeaders });
  }
}

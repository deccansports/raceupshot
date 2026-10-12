import { apiFailure, apiSuccess } from "@/lib/api-response";
import { mobileCorsHeaders, mobileCorsPreflight } from "@/lib/mobile-cors";
import { verifyVolunteerOtp } from "@/lib/volunteer-auth";
import { z } from "@/lib/zod";

const inputSchema = z.object({
  email: z.string().trim().email().max(180),
  otp: z.string().trim().regex(/^\d{6}$/, "Enter the six-digit OTP."),
});

export const dynamic = "force-dynamic";
export const OPTIONS = mobileCorsPreflight;

export async function POST(request: Request) {
  try {
    const input = inputSchema.safeParse(await request.json());
    if (!input.success) return apiFailure(input.error.issues[0]?.message || "Check the OTP.", 400, { headers: mobileCorsHeaders });
    return apiSuccess(await verifyVolunteerOtp(input.data.email, input.data.otp), { headers: { ...mobileCorsHeaders, "cache-control": "no-store" } });
  } catch (error) {
    return apiFailure(error instanceof Error ? error.message : "Unable to verify the volunteer OTP.", 401, { headers: mobileCorsHeaders });
  }
}

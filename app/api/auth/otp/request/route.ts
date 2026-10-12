import { apiFailure, apiSuccess } from "@/lib/api-response";
import { requestAthleteOtp } from "@/lib/athlete-otp";
import { mobileCorsPreflight } from "@/lib/mobile-cors";
import { z } from "@/lib/zod";

const requestInput = z.object({
  email: z.string().trim().email().max(160),
  surface: z.enum(["ATHLETE", "ADMIN"]).optional().default("ATHLETE"),
});

export const OPTIONS = mobileCorsPreflight;

export async function POST(request: Request) {
  try {
    const input = requestInput.safeParse(await request.json());
    if (!input.success) return apiFailure("Enter a valid email address.", 400);
    return apiSuccess(await requestAthleteOtp(input.data.email, input.data.surface), {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    return apiFailure(error instanceof Error ? error.message : "Unable to send OTP.", 503);
  }
}

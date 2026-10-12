import { apiFailure, apiSuccess } from "@/lib/api-response";
import { verifyAthleteOtp } from "@/lib/athlete-otp";
import { mobileCorsPreflight } from "@/lib/mobile-cors";
import { z } from "@/lib/zod";

const verifyInput = z.object({
  email: z.string().trim().email().max(160),
  otp: z.string().trim().regex(/^\d{6}$/, "Enter the six-digit OTP."),
  surface: z.enum(["WEB", "MOBILE", "ADMIN"]).optional().default("WEB"),
});

export const OPTIONS = mobileCorsPreflight;

export async function POST(request: Request) {
  try {
    const input = verifyInput.safeParse(await request.json());
    if (!input.success) return apiFailure(input.error.issues[0]?.message || "Check the OTP.", 400);
    return apiSuccess(await verifyAthleteOtp(
      input.data.email,
      input.data.otp,
      input.data.surface === "MOBILE",
      input.data.surface === "ADMIN" ? "ADMIN" : "ATHLETE",
    ), {
      headers: { "cache-control": "private, no-store" },
    });
  } catch (error) {
    return apiFailure(error instanceof Error ? error.message : "Unable to verify OTP.", 401);
  }
}

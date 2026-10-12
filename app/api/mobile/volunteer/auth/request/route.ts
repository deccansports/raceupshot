import { apiFailure, apiSuccess } from "@/lib/api-response";
import { mobileCorsHeaders, mobileCorsPreflight } from "@/lib/mobile-cors";
import { requestVolunteerOtp } from "@/lib/volunteer-auth";
import { z } from "@/lib/zod";

const inputSchema = z.object({ email: z.string().trim().email().max(180) });

export const dynamic = "force-dynamic";
export const OPTIONS = mobileCorsPreflight;

export async function POST(request: Request) {
  try {
    const input = inputSchema.safeParse(await request.json());
    if (!input.success) return apiFailure("Enter a valid volunteer email address.", 400, { headers: mobileCorsHeaders });
    return apiSuccess(await requestVolunteerOtp(input.data.email), { headers: { ...mobileCorsHeaders, "cache-control": "no-store" } });
  } catch (error) {
    return apiFailure(error instanceof Error ? error.message : "Unable to send the volunteer OTP.", 503, { headers: mobileCorsHeaders });
  }
}

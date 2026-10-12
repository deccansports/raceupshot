import { requireAthleteRequest } from "@/lib/athlete-request-auth";
import { FirebaseAuthenticationError } from "@/lib/firebase-auth-server";
import { platformFailure, platformSuccess } from "@/lib/platform-api-response";
import { requestWaiverOtp } from "@/lib/signed-waivers";
import { z } from "@/lib/zod";

const inputSchema = z.object({
  participantId: z.string().trim().min(1).max(250),
  signatureName: z.string().trim().min(2).max(120),
  accepted: z.literal(true),
});

export async function POST(request: Request, { params }: { params: Promise<{ eventId: string }> }) {
  try {
    const athlete = await requireAthleteRequest(request);
    const input = inputSchema.safeParse(await request.json());
    if (!input.success) return platformFailure("INVALID_WAIVER_ACCEPTANCE", input.error.issues[0]?.message || "Accept the waiver before continuing.", 400);
    const { eventId } = await params;
    return platformSuccess(await requestWaiverOtp({ athlete, eventId, ...input.data }), { cacheSeconds: 0 }, {
      headers: { "cache-control": "private, no-store" },
    });
  } catch (error) {
    if (error instanceof FirebaseAuthenticationError) return platformFailure("AUTHENTICATION_REQUIRED", error.message, 401);
    return platformFailure("WAIVER_OTP_REQUEST_FAILED", error instanceof Error ? error.message : "Unable to send the waiver OTP.", 400);
  }
}

import { requireAthleteRequest } from "@/lib/athlete-request-auth";
import { FirebaseAuthenticationError } from "@/lib/firebase-auth-server";
import { platformFailure, platformSuccess } from "@/lib/platform-api-response";
import { verifyAndSignWaiver } from "@/lib/signed-waivers";
import { z } from "@/lib/zod";

const inputSchema = z.object({
  participantId: z.string().trim().min(1).max(250),
  otp: z.string().trim().regex(/^\d{6}$/, "Enter the six-digit OTP."),
});

export async function POST(request: Request, { params }: { params: Promise<{ eventId: string }> }) {
  try {
    const athlete = await requireAthleteRequest(request);
    const input = inputSchema.safeParse(await request.json());
    if (!input.success) return platformFailure("INVALID_WAIVER_OTP", input.error.issues[0]?.message || "Check the OTP.", 400);
    const { eventId } = await params;
    const userAgent = request.headers.get("user-agent") || "unknown";
    const forwardedFor = request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for") || "unknown";
    const result = await verifyAndSignWaiver({
      athlete, eventId, ...input.data, origin: new URL(request.url).origin,
      evidence: `${forwardedFor}\n${userAgent}`,
    });
    return platformSuccess(result, { cacheSeconds: 0 }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    if (error instanceof FirebaseAuthenticationError) return platformFailure("AUTHENTICATION_REQUIRED", error.message, 401);
    return platformFailure("WAIVER_SIGNING_FAILED", error instanceof Error ? error.message : "Unable to sign the waiver.", 400);
  }
}

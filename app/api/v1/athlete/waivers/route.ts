import { requireAthleteRequest } from "@/lib/athlete-request-auth";
import { FirebaseAuthenticationError } from "@/lib/firebase-auth-server";
import { platformFailure, platformSuccess } from "@/lib/platform-api-response";
import { listAthleteWaivers } from "@/lib/signed-waivers";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const athlete = await requireAthleteRequest(request);
    return platformSuccess(await listAthleteWaivers(athlete), { cacheSeconds: 0 }, {
      headers: { "cache-control": "private, no-store" },
    });
  } catch (error) {
    if (error instanceof FirebaseAuthenticationError) return platformFailure("AUTHENTICATION_REQUIRED", error.message, 401);
    return platformFailure("ATHLETE_WAIVERS_FAILED", error instanceof Error ? error.message : "Unable to load waivers.", 500);
  }
}

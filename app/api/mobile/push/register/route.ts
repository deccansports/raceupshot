import { FirebaseAuthenticationError } from "@/lib/firebase-auth-server";
import { registerMobilePushDevice } from "@/lib/mobile-watchlist";
import { mobileCorsHeaders, mobileCorsPreflight } from "@/lib/mobile-cors";
import { platformFailure, platformSuccess } from "@/lib/platform-api-response";

export const dynamic = "force-dynamic";
export const OPTIONS = mobileCorsPreflight;

export async function POST(request: Request) {
  try {
    const registration = await registerMobilePushDevice(request, await request.json() as Record<string, unknown>);
    return platformSuccess(registration, { cacheSeconds: 0 }, { headers: { ...mobileCorsHeaders, "cache-control": "private, no-store" } });
  } catch (error) {
    if (error instanceof FirebaseAuthenticationError) return platformFailure("AUTHENTICATION_REQUIRED", error.message, 401);
    return platformFailure("PUSH_REGISTRATION_FAILED", error instanceof Error ? error.message : "Unable to register this device.", 400);
  }
}

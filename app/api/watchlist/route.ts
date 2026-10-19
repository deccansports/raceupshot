import { FirebaseAuthenticationError } from "@/lib/firebase-auth-server";
import { listMobileWatchlist, saveMobileWatchlistItem } from "@/lib/mobile-watchlist";
import { mobileCorsHeaders, mobileCorsPreflight } from "@/lib/mobile-cors";
import { platformFailure, platformSuccess } from "@/lib/platform-api-response";

export const dynamic = "force-dynamic";
export const OPTIONS = mobileCorsPreflight;

export async function GET(request: Request) {
  try {
    const subscriptions = await listMobileWatchlist(request);
    return platformSuccess({ subscriptions }, { cacheSeconds: 0 }, { headers: { ...mobileCorsHeaders, "cache-control": "private, no-store" } });
  } catch (error) {
    if (error instanceof FirebaseAuthenticationError) return platformFailure("AUTHENTICATION_REQUIRED", error.message, 401);
    return platformFailure("WATCHLIST_LOAD_FAILED", "Unable to load the watchlist.", 500);
  }
}

export async function POST(request: Request) {
  try {
    const subscription = await saveMobileWatchlistItem(request, await request.json() as Record<string, unknown>);
    return platformSuccess({ subscription }, { cacheSeconds: 0 }, { status: 201, headers: { ...mobileCorsHeaders, "cache-control": "private, no-store" } });
  } catch (error) {
    if (error instanceof FirebaseAuthenticationError) return platformFailure("AUTHENTICATION_REQUIRED", error.message, 401);
    return platformFailure("WATCHLIST_SAVE_FAILED", error instanceof Error ? error.message : "Unable to save the watchlist.", 400);
  }
}

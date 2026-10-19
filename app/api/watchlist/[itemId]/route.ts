import { FirebaseAuthenticationError } from "@/lib/firebase-auth-server";
import { deleteMobileWatchlistItem } from "@/lib/mobile-watchlist";
import { mobileCorsHeaders, mobileCorsPreflight } from "@/lib/mobile-cors";
import { platformFailure, platformSuccess } from "@/lib/platform-api-response";

export const dynamic = "force-dynamic";
export const OPTIONS = mobileCorsPreflight;

export async function DELETE(request: Request, context: { params: Promise<{ itemId: string }> }) {
  try {
    const { itemId } = await context.params;
    await deleteMobileWatchlistItem(request, itemId);
    return platformSuccess({ deleted: true }, { cacheSeconds: 0 }, { headers: { ...mobileCorsHeaders, "cache-control": "private, no-store" } });
  } catch (error) {
    if (error instanceof FirebaseAuthenticationError) return platformFailure("AUTHENTICATION_REQUIRED", error.message, 401);
    return platformFailure("WATCHLIST_DELETE_FAILED", error instanceof Error ? error.message : "Unable to remove the watchlist item.", 400);
  }
}

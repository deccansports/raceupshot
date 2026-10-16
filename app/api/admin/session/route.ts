import { apiFailure, apiSuccess } from "@/lib/api-response";
import { clearAdminSession, createAdminSession, isAdminAuthenticated, isConfiguredAdminEmail } from "@/lib/admin-auth";
import { FirebaseAuthenticationError, requireFirebaseAthlete } from "@/lib/firebase-auth-server";

export const dynamic = "force-dynamic";

export async function GET() {
  return apiSuccess(
    { authenticated: await isAdminAuthenticated() },
    { headers: { "cache-control": "private, no-store" } },
  );
}

export async function POST(request: Request) {
  try {
    const identity = await requireFirebaseAthlete(request);
    if (!identity.emailVerified) {
      return apiFailure("Verify the configured admin email before opening the admin account.", 403);
    }
    if (!await isConfiguredAdminEmail(identity.email)) {
      return apiFailure("This Firebase account is not authorized for admin access.", 403);
    }
    await createAdminSession(identity.email!);
    return apiSuccess(
      { authenticated: true, role: "admin" },
      { headers: { "cache-control": "private, no-store" } },
    );
  } catch (error) {
    if (error instanceof FirebaseAuthenticationError) {
      return apiFailure(error.message, 401);
    }
    return apiFailure("Unable to create the admin session.", 500);
  }
}

export async function DELETE() {
  await clearAdminSession();
  return apiSuccess(
    { authenticated: false },
    { headers: { "cache-control": "private, no-store" } },
  );
}

import { athleteProfileInput, getAthleteProfile, saveAthleteProfile, saveAthleteTrackingVisibility } from "@/lib/athlete-profile";
import { FirebaseAuthenticationError, requireFirebaseAthlete } from "@/lib/firebase-auth-server";
import { readOtpAthleteSession, readOtpAthleteToken } from "@/lib/athlete-session";
import { mobileCorsPreflight } from "@/lib/mobile-cors";
import { platformFailure, platformSuccess } from "@/lib/platform-api-response";

export const OPTIONS = mobileCorsPreflight;

async function requireAthlete(request: Request) {
  const authorization = request.headers.get("authorization") || "";
  if (authorization.startsWith("Otp ")) {
    const athlete = await readOtpAthleteToken(authorization.slice(4).trim());
    if (!athlete) throw new FirebaseAuthenticationError("The athlete OTP session is invalid or expired.");
    return athlete;
  }
  if (authorization.startsWith("Bearer ")) return requireFirebaseAthlete(request);
  const athlete = await readOtpAthleteSession();
  if (!athlete) throw new FirebaseAuthenticationError();
  return athlete;
}

export async function GET(request: Request) {
  try {
    const athlete = await requireAthlete(request);
    const profile = await getAthleteProfile(athlete.uid);
    return platformSuccess({ ...athlete, profile }, { cacheSeconds: 0 }, {
      headers: { "cache-control": "private, no-store" },
    });
  } catch (error) {
    if (error instanceof FirebaseAuthenticationError) {
      return platformFailure("AUTHENTICATION_REQUIRED", error.message, 401);
    }
    return platformFailure("ATHLETE_ACCOUNT_FAILED", "Unable to load the athlete account.", 500);
  }
}

export async function PUT(request: Request) {
  try {
    const athlete = await requireAthlete(request);
    const body = await request.json() as Record<string, unknown>;
    const requestedVisibility = String(body.trackingVisibility ?? body.liveTrackingPrivacy ?? "").trim().toUpperCase();
    const privacyOnly = Object.keys(body).every((key) => key === "trackingVisibility" || key === "liveTrackingPrivacy");
    if (privacyOnly && (requestedVisibility === "PUBLIC" || requestedVisibility === "ANONYMOUS")) {
      const profile = await saveAthleteTrackingVisibility(athlete.uid, athlete.email, requestedVisibility);
      return platformSuccess({ ...athlete, profile }, { cacheSeconds: 0 }, {
        headers: { "cache-control": "private, no-store" },
      });
    }
    const input = athleteProfileInput.safeParse(body);
    if (!input.success) {
      return platformFailure("INVALID_ATHLETE_PROFILE", input.error.issues[0]?.message || "Invalid account details.", 400);
    }
    const profile = await saveAthleteProfile(athlete.uid, athlete.email, input.data);
    return platformSuccess({ ...athlete, profile }, { cacheSeconds: 0 }, {
      headers: { "cache-control": "private, no-store" },
    });
  } catch (error) {
    if (error instanceof FirebaseAuthenticationError) {
      return platformFailure("AUTHENTICATION_REQUIRED", error.message, 401);
    }
    return platformFailure("ATHLETE_PROFILE_UPDATE_FAILED", "Unable to update the athlete account.", 500);
  }
}

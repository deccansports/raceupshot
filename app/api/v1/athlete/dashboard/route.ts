import { getAthleteDashboard } from "@/lib/athlete-dashboard";
import { readOtpAthleteSession, readOtpAthleteToken } from "@/lib/athlete-session";
import { FirebaseAuthenticationError, requireFirebaseAthlete } from "@/lib/firebase-auth-server";
import { mobileCorsPreflight } from "@/lib/mobile-cors";
import { platformFailure, platformSuccess } from "@/lib/platform-api-response";

export const dynamic = "force-dynamic";
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
    const dashboard = await getAthleteDashboard(athlete);
    const origin = new URL(request.url).origin;
    const withLightweightMedia = {
      upcoming: dashboard.upcoming.map((race) => ({
        ...race,
        event: {
          ...race.event,
          ...(race.event.logoUrl?.startsWith("data:")
            ? { logoUrl: `${origin}/api/v1/events/${encodeURIComponent(race.event.eventId)}/media/logo` }
            : {}),
          ...(race.event.bannerUrl?.startsWith("data:")
            ? { bannerUrl: `${origin}/api/v1/events/${encodeURIComponent(race.event.eventId)}/media/banner` }
            : {}),
        },
      })),
      past: dashboard.past.map((race) => ({
        ...race,
        event: {
          ...race.event,
          ...(race.event.logoUrl?.startsWith("data:")
            ? { logoUrl: `${origin}/api/v1/events/${encodeURIComponent(race.event.eventId)}/media/logo` }
            : {}),
          ...(race.event.bannerUrl?.startsWith("data:")
            ? { bannerUrl: `${origin}/api/v1/events/${encodeURIComponent(race.event.eventId)}/media/banner` }
            : {}),
        },
      })),
    };
    return platformSuccess(withLightweightMedia, { cacheSeconds: 0 }, {
      headers: { "cache-control": "private, no-store" },
    });
  } catch (error) {
    if (error instanceof FirebaseAuthenticationError) {
      return platformFailure("AUTHENTICATION_REQUIRED", error.message, 401);
    }
    return platformFailure(
      "ATHLETE_DASHBOARD_FAILED",
      error instanceof Error ? error.message : "Unable to load the athlete dashboard.",
      500,
    );
  }
}

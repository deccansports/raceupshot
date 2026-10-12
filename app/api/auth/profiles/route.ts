import { apiFailure, apiSuccess } from "@/lib/api-response";
import { getAthleteProfile, getAthleteProfileByEmail } from "@/lib/athlete-profile";
import { createOtpAthleteSession, readOtpAthleteSession } from "@/lib/athlete-session";
import { FirebaseAuthenticationError, requireFirebaseAthlete } from "@/lib/firebase-auth-server";
import { getVolunteerByEmail } from "@/lib/volunteer-management";
import { createVolunteerSessionForEmail, readVolunteerToken } from "@/lib/volunteer-auth";
import { z } from "@/lib/zod";

export const dynamic = "force-dynamic";

type ProfileIdentity = {
  uid: string | null;
  email: string;
  name: string | null;
  source: "ATHLETE_FIREBASE" | "ATHLETE_OTP" | "VOLUNTEER";
  emailVerified: boolean;
};

const switchInput = z.object({ target: z.enum(["ATHLETE", "VOLUNTEER"]) });

async function currentIdentity(request: Request): Promise<ProfileIdentity | null> {
  const authorization = request.headers.get("authorization") || "";
  if (authorization.startsWith("Bearer ")) {
    try {
      const athlete = await requireFirebaseAthlete(request);
      if (!athlete.email) return null;
      return { uid: athlete.uid, email: athlete.email.trim().toLowerCase(), name: athlete.name, source: "ATHLETE_FIREBASE", emailVerified: athlete.emailVerified };
    } catch (error) {
      if (!(error instanceof FirebaseAuthenticationError)) throw error;
      return null;
    }
  }
  if (authorization.startsWith("Volunteer ")) {
    const volunteer = await readVolunteerToken(authorization.slice("Volunteer ".length).trim());
    return volunteer ? { uid: null, email: volunteer.email, name: volunteer.name, source: "VOLUNTEER", emailVerified: true } : null;
  }
  const athlete = await readOtpAthleteSession();
  return athlete?.email
    ? { uid: athlete.uid, email: athlete.email.trim().toLowerCase(), name: athlete.name, source: "ATHLETE_OTP", emailVerified: true }
    : null;
}

export async function GET(request: Request) {
  try {
    const identity = await currentIdentity(request);
    if (!identity) return apiSuccess({ authenticated: false, athlete: null, volunteer: null }, { headers: { "cache-control": "private, no-store" } });
    const [athleteProfile, volunteerProfile] = await Promise.all([
      identity.uid
        ? getAthleteProfile(identity.uid)
        : getAthleteProfileByEmail(identity.email),
      identity.emailVerified ? getVolunteerByEmail(identity.email) : Promise.resolve(null),
    ]);
    const volunteer = volunteerProfile
      && volunteerProfile.status !== "DISABLED"
      && volunteerProfile.assignments.some((assignment) => assignment.active)
      ? { id: volunteerProfile.id, name: volunteerProfile.name, email: volunteerProfile.email }
      : null;
    const athlete = athleteProfile
      ? { uid: athleteProfile.uid, name: athleteProfile.name, email: athleteProfile.email || identity.email }
      : identity.source === "ATHLETE_OTP"
        ? { uid: null, name: identity.name, email: identity.email }
        : null;
    const activeProfile = identity.source === "VOLUNTEER"
      ? "VOLUNTEER"
      : athlete
        ? "ATHLETE"
        : volunteer
          ? "VOLUNTEER"
          : undefined;
    return apiSuccess({ authenticated: true, activeProfile, athlete, volunteer }, {
      headers: { "cache-control": "private, no-store" },
    });
  } catch {
    return apiFailure("Unable to load linked profiles.", 503);
  }
}

export async function POST(request: Request) {
  try {
    const input = switchInput.safeParse(await request.json());
    if (!input.success) return apiFailure("Choose Athlete or Volunteer.", 400);
    const identity = await currentIdentity(request);
    if (!identity) return apiFailure("Sign in before changing profile.", 401);

    if (input.data.target === "VOLUNTEER") {
      if (!identity.emailVerified) return apiFailure("Verify your email before opening the volunteer profile.", 403);
      return apiSuccess(await createVolunteerSessionForEmail(identity.email), { headers: { "cache-control": "private, no-store" } });
    }

    if (identity.source !== "VOLUNTEER") {
      return apiSuccess({ authenticated: true, profile: "ATHLETE" }, { headers: { "cache-control": "private, no-store" } });
    }
    const athlete = await getAthleteProfileByEmail(identity.email);
    if (!athlete) return apiFailure("No athlete profile is linked to this account.", 403);
    await createOtpAthleteSession(athlete.uid, identity.email, athlete.name);
    return apiSuccess({ authenticated: true, profile: "ATHLETE" }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    return apiFailure(error instanceof Error ? error.message : "Unable to change profile.", 403);
  }
}

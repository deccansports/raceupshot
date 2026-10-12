import { accountDestination, type AccountRole } from "@/lib/account-access";
import { createAdminSession, isConfiguredAdminEmail } from "@/lib/admin-auth";
import { apiFailure, apiSuccess } from "@/lib/api-response";
import { getAthleteProfile } from "@/lib/athlete-profile";
import { FirebaseAuthenticationError, requireFirebaseAthlete } from "@/lib/firebase-auth-server";
import { createVolunteerSessionForEmail } from "@/lib/volunteer-auth";
import { getVolunteerByEmail } from "@/lib/volunteer-management";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const identity = await requireFirebaseAthlete(request);
    const email = identity.email?.trim().toLowerCase() || null;
    const [athlete, volunteer, configuredAdminEmail] = await Promise.all([
      getAthleteProfile(identity.uid),
      email && identity.emailVerified ? getVolunteerByEmail(email) : Promise.resolve(null),
      email ? isConfiguredAdminEmail(email) : Promise.resolve(false),
    ]);
    const activeVolunteer = volunteer
      && volunteer.status !== "DISABLED"
      && volunteer.assignments.some((assignment) => assignment.active)
      ? volunteer
      : null;
    const roles: AccountRole[] = [];
    if (configuredAdminEmail && identity.emailVerified) roles.push("ADMIN");
    if (athlete) roles.push("ATHLETE");
    if (activeVolunteer) roles.push("VOLUNTEER");

    if (!roles.length) {
      if (configuredAdminEmail && !identity.emailVerified) {
        return apiFailure("Verify the configured admin email before opening the admin account.", 403);
      }
      return apiFailure("No active admin, athlete, or volunteer profile is linked to this account.", 403);
    }

    const destination = accountDestination(roles);
    if (!destination) return apiFailure("No account portal is available.", 403);

    if (roles.includes("ADMIN") && email) await createAdminSession(email);
    const volunteerSession = destination === "/volunteer" && email
      ? await createVolunteerSessionForEmail(email)
      : null;

    return apiSuccess({
      authenticated: true,
      roles,
      destination,
      volunteerSessionToken: volunteerSession?.sessionToken || null,
    }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    if (error instanceof FirebaseAuthenticationError) {
      return apiFailure(error.message, 401);
    }
    return apiFailure("Unable to verify account access.", 500);
  }
}

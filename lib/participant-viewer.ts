import { isAdminAuthenticated } from "./admin-auth";
import { readOtpAthleteSession, readOtpAthleteToken } from "./athlete-session";
import { requireFirebaseAthlete } from "./firebase-auth-server";
import type { ParticipantViewer } from "./platform-repository";

export async function participantViewerFromRequest(request: Request): Promise<ParticipantViewer | undefined> {
  try {
    if (await isAdminAuthenticated()) return { revealAll: true };
  } catch {
    // Public tracking remains available if admin session configuration is absent.
  }

  try {
    const authorization = request.headers.get("authorization") || "";
    const athlete = authorization.startsWith("Otp ")
      ? await readOtpAthleteToken(authorization.slice(4).trim())
      : authorization.startsWith("Bearer ")
        ? await requireFirebaseAthlete(request)
        : await readOtpAthleteSession();
    return athlete
      ? { athleteUid: athlete.uid, athleteEmail: athlete.email }
      : undefined;
  } catch {
    return undefined;
  }
}

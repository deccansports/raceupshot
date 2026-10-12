import { readOtpAthleteSession, readOtpAthleteToken } from "./athlete-session";
import { FirebaseAuthenticationError, requireFirebaseAthlete } from "./firebase-auth-server";

export async function requireAthleteRequest(request: Request) {
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

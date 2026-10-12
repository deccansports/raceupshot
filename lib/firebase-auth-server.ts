import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";

const FIREBASE_PROJECT_ID = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "raceupshot";
const FIREBASE_ISSUER = `https://securetoken.google.com/${FIREBASE_PROJECT_ID}`;
const FIREBASE_JWKS = createRemoteJWKSet(
  new URL("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com"),
);

export interface FirebaseAthleteIdentity {
  uid: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
  picture: string | null;
  signInProvider: string | null;
}

export class FirebaseAuthenticationError extends Error {
  constructor(message = "A valid Firebase ID token is required.") {
    super(message);
    this.name = "FirebaseAuthenticationError";
  }
}

function bearerToken(request: Request) {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) throw new FirebaseAuthenticationError();
  const token = authorization.slice(7).trim();
  if (!token) throw new FirebaseAuthenticationError();
  return token;
}

export function identityFromFirebaseClaims(payload: JWTPayload): FirebaseAthleteIdentity {
  const now = Math.floor(Date.now() / 1000);
  const authTime = payload.auth_time;
  if (
    typeof payload.sub !== "string"
    || payload.sub.length === 0
    || payload.sub.length > 128
    || typeof authTime !== "number"
    || authTime > now
  ) {
    throw new FirebaseAuthenticationError("The Firebase ID token contains invalid identity claims.");
  }

  const firebase = payload.firebase as { sign_in_provider?: unknown } | undefined;
  return {
    uid: payload.sub,
    email: typeof payload.email === "string" ? payload.email : null,
    emailVerified: payload.email_verified === true,
    name: typeof payload.name === "string" ? payload.name : null,
    picture: typeof payload.picture === "string" ? payload.picture : null,
    signInProvider: typeof firebase?.sign_in_provider === "string" ? firebase.sign_in_provider : null,
  };
}

export async function requireFirebaseAthlete(request: Request): Promise<FirebaseAthleteIdentity> {
  try {
    const { payload } = await jwtVerify(bearerToken(request), FIREBASE_JWKS, {
      algorithms: ["RS256"],
      audience: FIREBASE_PROJECT_ID,
      issuer: FIREBASE_ISSUER,
    });
    return identityFromFirebaseClaims(payload);
  } catch (error) {
    if (error instanceof FirebaseAuthenticationError) throw error;
    throw new FirebaseAuthenticationError("The Firebase ID token is invalid or expired.");
  }
}

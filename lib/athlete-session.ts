import { getCloudflareContext } from "@opennextjs/cloudflare";
import { cookies } from "next/headers";
import type { FirebaseAthleteIdentity } from "./firebase-auth-server";

const COOKIE_NAME = "raceupshot_athlete";
const SESSION_SECONDS = 60 * 60 * 24 * 7;

function bytesToHex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function safeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

async function sessionSecret(): Promise<string> {
  const { env } = await getCloudflareContext({ async: true });
  const secret = env.ATHLETE_SESSION_SECRET || env.ADMIN_SESSION_SECRET || "";
  if (!secret) throw new Error("Athlete session signing is not configured.");
  return secret;
}

async function sign(value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(await sessionSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return bytesToHex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)));
}

export async function createOtpAthleteSession(uid: string, email: string, name: string | null): Promise<string> {
  const expires = Math.floor(Date.now() / 1000) + SESSION_SECONDS;
  const payload = [encodeURIComponent(uid), encodeURIComponent(email.toLowerCase()), encodeURIComponent(name || ""), expires].join("|");
  const signature = await sign(payload);
  const token = `${payload}|${signature}`;
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_SECONDS,
  });
  return token;
}

export async function readOtpAthleteToken(token: string): Promise<FirebaseAthleteIdentity | null> {
  const [uidRaw, emailRaw, nameRaw, expiresRaw, signature] = token.split("|");
  const expires = Number(expiresRaw);
  if (!uidRaw || !emailRaw || !signature || !Number.isFinite(expires) || expires <= Date.now() / 1000) return null;
  const payload = [uidRaw, emailRaw, nameRaw, expiresRaw].join("|");
  if (!safeEqual(signature, await sign(payload))) return null;
  return {
    uid: decodeURIComponent(uidRaw),
    email: decodeURIComponent(emailRaw),
    emailVerified: true,
    name: decodeURIComponent(nameRaw) || null,
    picture: null,
    signInProvider: "email-otp",
  };
}

export async function readOtpAthleteSession(): Promise<FirebaseAthleteIdentity | null> {
  return readOtpAthleteToken((await cookies()).get(COOKIE_NAME)?.value || "");
}

export async function clearOtpAthleteSession() {
  (await cookies()).delete(COOKIE_NAME);
}

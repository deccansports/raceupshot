import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { KVNamespace } from "@cloudflare/workers-types";
import { sendBergtecnoEmail } from "./bergtecno-email";
import { BERGTECNO_TEMPLATES } from "./email-templates";
import { getVolunteerByEmail, getVolunteerById, markVolunteerActive, type VolunteerProfile } from "./volunteer-management";
import { verifyVolunteerPasswordCredential, volunteerPasswordKey, type VolunteerPasswordCredential } from "./volunteer-password";

const OTP_PREFIX = "raceupshot:volunteer:auth:otp:";
const OTP_SECONDS = 5 * 60;
const SESSION_SECONDS = 7 * 24 * 60 * 60;
const RESEND_SECONDS = 60;
const MAX_ATTEMPTS = 5;
const PASSWORD_ATTEMPT_PREFIX = "raceupshot:volunteer:auth:password-attempt:";
const PASSWORD_ATTEMPT_WINDOW_SECONDS = 15 * 60;
const MAX_PASSWORD_ATTEMPTS = 5;

interface VolunteerOtpRecord {
  volunteerId: string;
  email: string;
  codeHash: string;
  createdAt: number;
  expiresAt: number;
  attempts: number;
}

interface VolunteerPasswordAttemptRecord {
  attempts: number;
  startedAt: number;
  blockedUntil: number;
}

export interface VolunteerIdentity {
  id: string;
  email: string;
  name: string;
}

async function kv(): Promise<KVNamespace> {
  const { env } = await getCloudflareContext({ async: true });
  if (!env.RACEUPSHOT) throw new Error("RACEUPSHOT KV binding is unavailable.");
  return env.RACEUPSHOT;
}

async function secret(): Promise<string> {
  const { env } = await getCloudflareContext({ async: true });
  const value = env.ATHLETE_SESSION_SECRET || env.ADMIN_SESSION_SECRET || "";
  if (!value) throw new Error("Volunteer session signing is not configured.");
  return value;
}

function bytesToHex(value: ArrayBuffer): string {
  return [...new Uint8Array(value)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function digest(value: string): Promise<string> {
  return bytesToHex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

async function sign(value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(await secret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return bytesToHex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)));
}

async function safeEqual(left: string, right: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [leftHash, rightHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(left)),
    crypto.subtle.digest("SHA-256", encoder.encode(right)),
  ]);
  const leftBytes = new Uint8Array(leftHash);
  const rightBytes = new Uint8Array(rightHash);
  let difference = leftBytes.length ^ rightBytes.length;
  const length = Math.max(leftBytes.length, rightBytes.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }
  return difference === 0;
}

function code(): string {
  const random = new Uint32Array(1);
  crypto.getRandomValues(random);
  return String(random[0] % 1_000_000).padStart(6, "0");
}

async function otpKey(email: string): Promise<string> {
  return `${OTP_PREFIX}${await digest(email.trim().toLowerCase())}`;
}

export async function requestVolunteerOtp(emailInput: string) {
  const email = emailInput.trim().toLowerCase();
  const volunteer = await getVolunteerByEmail(email);
  const generic = { requested: true, message: "If an enabled volunteer account exists, a six-digit OTP has been sent." };
  if (!volunteer || volunteer.status === "DISABLED" || !volunteer.assignments.some((assignment) => assignment.active)) return generic;

  const store = await kv();
  const key = await otpKey(email);
  const existing = await store.get<VolunteerOtpRecord>(key, "json");
  const now = Math.floor(Date.now() / 1000);
  if (existing && now - existing.createdAt < RESEND_SECONDS) {
    throw new Error(`Please wait ${RESEND_SECONDS - (now - existing.createdAt)} seconds before requesting another OTP.`);
  }
  const otp = code();
  const record: VolunteerOtpRecord = {
    volunteerId: volunteer.id,
    email,
    codeHash: await digest(`${email}:${otp}:${await secret()}`),
    createdAt: now,
    expiresAt: now + OTP_SECONDS,
    attempts: 0,
  };
  await store.put(key, JSON.stringify(record), { expirationTtl: OTP_SECONDS + 60 });
  const delivery = await sendBergtecnoEmail({
    recipientEmail: email,
    templateId: BERGTECNO_TEMPLATES.loginOtp.uuid,
    variables: { otp, year: new Date().getFullYear() },
  });
  if (!delivery.sent) {
    await store.delete(key);
    throw new Error(delivery.error || "The volunteer OTP email could not be sent.");
  }
  return { requested: true, message: "Your six-digit volunteer OTP has been sent. It is valid for 5 minutes." };
}

async function createVolunteerSession(volunteer: VolunteerProfile): Promise<string> {
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_SECONDS;
  const payload = ["v1", encodeURIComponent(volunteer.id), encodeURIComponent(volunteer.email), expiresAt].join("|");
  return `${payload}|${await sign(payload)}`;
}

export async function createVolunteerSessionForEmail(emailInput: string) {
  const email = emailInput.trim().toLowerCase();
  const volunteer = await getVolunteerByEmail(email);
  if (!volunteer || volunteer.status === "DISABLED" || !volunteer.assignments.some((assignment) => assignment.active)) {
    throw new Error("No active volunteer profile is linked to this account.");
  }
  const activeVolunteer = await markVolunteerActive(volunteer.id);
  return {
    authenticated: true,
    sessionToken: await createVolunteerSession(activeVolunteer),
    expiresInSeconds: SESSION_SECONDS,
    volunteer: { id: activeVolunteer.id, name: activeVolunteer.name, email: activeVolunteer.email },
  };
}

export async function verifyVolunteerOtp(emailInput: string, otp: string) {
  const email = emailInput.trim().toLowerCase();
  const store = await kv();
  const key = await otpKey(email);
  const record = await store.get<VolunteerOtpRecord>(key, "json");
  const now = Math.floor(Date.now() / 1000);
  if (!record || record.email !== email || record.expiresAt <= now) {
    if (record) await store.delete(key);
    throw new Error("This OTP has expired. Request a new code.");
  }
  if (record.attempts >= MAX_ATTEMPTS) {
    await store.delete(key);
    throw new Error("Too many incorrect attempts. Request a new OTP.");
  }
  const supplied = await digest(`${email}:${otp}:${await secret()}`);
  if (!await safeEqual(supplied, record.codeHash)) {
    record.attempts += 1;
    await store.put(key, JSON.stringify(record), { expirationTtl: Math.max(60, record.expiresAt - now) });
    throw new Error("The OTP is incorrect.");
  }
  await store.delete(key);
  const volunteer = await markVolunteerActive(record.volunteerId);
  return {
    authenticated: true,
    sessionToken: await createVolunteerSession(volunteer),
    expiresInSeconds: SESSION_SECONDS,
    volunteer: { id: volunteer.id, name: volunteer.name, email: volunteer.email },
  };
}

export async function verifyVolunteerPassword(emailInput: string, password: string) {
  const email = emailInput.trim().toLowerCase();
  const store = await kv();
  const attemptKey = `${PASSWORD_ATTEMPT_PREFIX}${await digest(email)}`;
  const now = Math.floor(Date.now() / 1000);
  const attempt = await store.get<VolunteerPasswordAttemptRecord>(attemptKey, "json");
  if (attempt?.blockedUntil && attempt.blockedUntil > now) {
    throw new Error(`Too many sign-in attempts. Try again in ${Math.ceil((attempt.blockedUntil - now) / 60)} minute(s).`);
  }

  const volunteer = await getVolunteerByEmail(email);
  const credential = volunteer
    ? await store.get<VolunteerPasswordCredential>(volunteerPasswordKey(volunteer.id), "json")
    : null;
  const valid = volunteer
    && volunteer.status !== "DISABLED"
    && volunteer.assignments.some((assignment) => assignment.active)
    && await verifyVolunteerPasswordCredential(password, credential);

  if (!valid || !volunteer) {
    const withinWindow = attempt && now - attempt.startedAt < PASSWORD_ATTEMPT_WINDOW_SECONDS;
    const attempts = withinWindow ? attempt.attempts + 1 : 1;
    const blockedUntil = attempts >= MAX_PASSWORD_ATTEMPTS ? now + PASSWORD_ATTEMPT_WINDOW_SECONDS : 0;
    await store.put(attemptKey, JSON.stringify({ attempts, startedAt: withinWindow ? attempt.startedAt : now, blockedUntil }), {
      expirationTtl: PASSWORD_ATTEMPT_WINDOW_SECONDS,
    });
    throw new Error(blockedUntil ? "Too many sign-in attempts. Try again in 15 minutes." : "Email or password is incorrect.");
  }

  await store.delete(attemptKey);
  const activeVolunteer = await markVolunteerActive(volunteer.id);
  return {
    authenticated: true,
    sessionToken: await createVolunteerSession(activeVolunteer),
    expiresInSeconds: SESSION_SECONDS,
    volunteer: { id: activeVolunteer.id, name: activeVolunteer.name, email: activeVolunteer.email },
  };
}

export async function readVolunteerToken(token: string): Promise<VolunteerIdentity | null> {
  const [version, idRaw, emailRaw, expiresRaw, signature] = token.split("|");
  const expiresAt = Number(expiresRaw);
  if (version !== "v1" || !idRaw || !emailRaw || !signature || !Number.isFinite(expiresAt) || expiresAt <= Date.now() / 1000) return null;
  const payload = [version, idRaw, emailRaw, expiresRaw].join("|");
  if (!await safeEqual(signature, await sign(payload))) return null;
  const volunteer = await getVolunteerById(decodeURIComponent(idRaw));
  const email = decodeURIComponent(emailRaw).toLowerCase();
  if (!volunteer || volunteer.email !== email || volunteer.status !== "ACTIVE") return null;
  return { id: volunteer.id, email, name: volunteer.name };
}

export async function requireVolunteer(request: Request): Promise<{ identity: VolunteerIdentity; profile: VolunteerProfile }> {
  const authorization = request.headers.get("authorization") || "";
  const token = authorization.startsWith("Volunteer ") ? authorization.slice("Volunteer ".length).trim() : "";
  const identity = token ? await readVolunteerToken(token) : null;
  if (!identity) throw new Error("VOLUNTEER_AUTH_REQUIRED");
  const profile = await getVolunteerById(identity.id);
  if (!profile || profile.status !== "ACTIVE") throw new Error("VOLUNTEER_ACCESS_DISABLED");
  return { identity, profile };
}

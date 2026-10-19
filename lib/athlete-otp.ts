import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { KVNamespace } from "@cloudflare/workers-types";
import { getAthleteProfileByEmail } from "./athlete-profile";
import { createOtpAthleteSession } from "./athlete-session";
import { sendBergtecnoEmail } from "./bergtecno-email";
import { BERGTECNO_TEMPLATES } from "./email-templates";
import { createAdminSession, isConfiguredAdminEmail } from "./admin-auth";
import { normalizeAiSensyPhone, sendAiSensyOtpWhatsApp } from "./aisensy-whatsapp";

const PREFIX = "raceupshot:auth:otp:";
const OTP_SECONDS = 5 * 60;
const RESEND_SECONDS = 60;
const MAX_ATTEMPTS = 5;

interface OtpRecord {
  email: string;
  uid?: string;
  name: string;
  audience?: "ATHLETE" | "ADMIN";
  codeHash: string;
  createdAt: number;
  expiresAt: number;
  attempts: number;
}

async function getKv(): Promise<KVNamespace> {
  const { env } = await getCloudflareContext({ async: true });
  if (!env.RACEUPSHOT) throw new Error("RACEUPSHOT KV binding is unavailable.");
  return env.RACEUPSHOT;
}

async function secret(): Promise<string> {
  const { env } = await getCloudflareContext({ async: true });
  const value = env.ATHLETE_SESSION_SECRET || env.ADMIN_SESSION_SECRET || "";
  if (!value) throw new Error("Athlete OTP signing is not configured.");
  return value;
}

async function digest(value: string): Promise<string> {
  const data = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(data)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function emailKey(email: string) {
  return `${PREFIX}${await digest(email.trim().toLowerCase())}`;
}

function secureCode(): string {
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return String(values[0] % 1_000_000).padStart(6, "0");
}

function maskedMobile(value: string): string {
  const normalized = normalizeAiSensyPhone(value).replace(/^\+/, "");
  return normalized ? `${"*".repeat(Math.max(0, normalized.length - 4))}${normalized.slice(-4)}` : "";
}

function safeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

export async function requestAthleteOtp(emailInput: string, audience: "ATHLETE" | "ADMIN" = "ATHLETE") {
  const email = emailInput.trim().toLowerCase();
  const [profile, configuredAdmin] = await Promise.all([
    audience === "ATHLETE" ? getAthleteProfileByEmail(email) : Promise.resolve(null),
    audience === "ADMIN" ? isConfiguredAdminEmail(email) : Promise.resolve(false),
  ]);
  if ((audience === "ATHLETE" && !profile) || (audience === "ADMIN" && !configuredAdmin)) {
    return { requested: true, message: "If a matching account exists, an OTP has been sent." };
  }

  const kv = await getKv();
  const key = await emailKey(email);
  const existing = await kv.get<OtpRecord>(key, "json");
  const now = Math.floor(Date.now() / 1000);
  if (existing && now - existing.createdAt < RESEND_SECONDS) {
    throw new Error(`Please wait ${RESEND_SECONDS - (now - existing.createdAt)} seconds before requesting another OTP.`);
  }

  const code = secureCode();
  const record: OtpRecord = {
    email,
    ...(profile?.uid ? { uid: profile.uid } : {}),
    name: profile?.name || "Administrator",
    audience,
    codeHash: await digest(`${email}:${code}:${await secret()}`),
    createdAt: now,
    expiresAt: now + OTP_SECONDS,
    attempts: 0,
  };
  await kv.put(key, JSON.stringify(record), { expirationTtl: OTP_SECONDS + 60 });
  const mobile = audience === "ATHLETE" && profile ? `${profile.phoneCountryCode}${profile.mobileNumber}` : "";
  const [whatsapp, emailDelivery] = await Promise.all([
    audience === "ATHLETE" && profile
      ? sendAiSensyOtpWhatsApp({ recipientPhone: mobile, recipientName: profile.name, otp: code })
      : Promise.resolve({ accepted: false, error: "WhatsApp OTP is not used for administrator login." }),
    sendBergtecnoEmail({
      recipientEmail: email,
      templateId: BERGTECNO_TEMPLATES.loginOtp.uuid,
      variables: { otp: code, year: new Date().getFullYear() },
    }),
  ]);
  if (!whatsapp.accepted && !emailDelivery.sent) {
    await kv.delete(key);
    throw new Error(whatsapp.error || emailDelivery.error || "The OTP could not be sent.");
  }
  const channels = [emailDelivery.sent ? "email" : "", whatsapp.accepted ? `WhatsApp to ${maskedMobile(mobile)}` : ""].filter(Boolean).join(" and ");
  return {
    requested: true,
    message: `Your six-digit OTP was sent by ${channels}. ${whatsapp.accepted ? "Use the WhatsApp copy-code button or enter it manually. " : ""}It is valid for 5 minutes.`,
  };
}

export async function verifyAthleteOtp(emailInput: string, code: string, includeMobileToken = false, audience: "ATHLETE" | "ADMIN" = "ATHLETE") {
  const email = emailInput.trim().toLowerCase();
  const kv = await getKv();
  const key = await emailKey(email);
  const record = await kv.get<OtpRecord>(key, "json");
  const now = Math.floor(Date.now() / 1000);
  if (!record || record.email !== email || (record.audience ?? "ATHLETE") !== audience || record.expiresAt <= now) {
    if (record) await kv.delete(key);
    throw new Error("This OTP has expired. Request a new code.");
  }
  if (record.attempts >= MAX_ATTEMPTS) {
    await kv.delete(key);
    throw new Error("Too many incorrect attempts. Request a new OTP.");
  }
  const suppliedHash = await digest(`${email}:${code}:${await secret()}`);
  if (!safeEqual(suppliedHash, record.codeHash)) {
    record.attempts += 1;
    await kv.put(key, JSON.stringify(record), { expirationTtl: Math.max(60, record.expiresAt - now) });
    throw new Error("The OTP is incorrect.");
  }
  await kv.delete(key);
  if (audience === "ADMIN") {
    if (!await isConfiguredAdminEmail(email)) throw new Error("This admin account is no longer authorized.");
    await createAdminSession(email);
    return { authenticated: true, destination: "/admin" };
  }
  if (!record.uid) throw new Error("This athlete account is no longer available.");
  const sessionToken = await createOtpAthleteSession(record.uid, email, record.name);
  return {
    authenticated: true,
    ...(includeMobileToken ? { sessionToken, expiresInSeconds: 60 * 60 * 24 * 7 } : {}),
  };
}

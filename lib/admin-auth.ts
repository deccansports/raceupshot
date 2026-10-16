import { getCloudflareContext } from "@opennextjs/cloudflare";
import { cookies } from "next/headers";

const COOKIE_NAME = "raceupshot_admin";
const SESSION_SECONDS = 60 * 60 * 12;

function bytesToHex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sign(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return bytesToHex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)));
}

function safeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

async function getAdminConfig() {
  const { env } = await getCloudflareContext({ async: true });
  return {
    email: env.ADMIN_EMAIL?.trim().toLowerCase() ?? "",
    password: env.ADMIN_PASSWORD ?? "",
    secret: env.ADMIN_SESSION_SECRET ?? "",
  };
}

export async function isConfiguredAdminEmail(email: string | null | undefined): Promise<boolean> {
  if (!email) return false;
  const config = await getAdminConfig();
  return Boolean(config.email) && safeEqual(email.trim().toLowerCase(), config.email);
}

export async function authenticateAdmin(email: string, password: string): Promise<boolean> {
  const config = await getAdminConfig();
  if (!config.email || !config.password || !config.secret) return false;
  return safeEqual(email.trim().toLowerCase(), config.email) && safeEqual(password, config.password);
}

export async function createAdminSession(email: string) {
  const config = await getAdminConfig();
  const expires = Math.floor(Date.now() / 1000) + SESSION_SECONDS;
  const payload = `${email.trim().toLowerCase()}|${expires}`;
  const signature = await sign(payload, config.secret);
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, `${payload}|${signature}`, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_SECONDS,
  });
}

export async function clearAdminSession() {
  (await cookies()).delete(COOKIE_NAME);
}

export async function getAuthenticatedAdminEmail(): Promise<string | null> {
  const config = await getAdminConfig();
  if (!config.email || !config.secret) return null;
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value ?? "";
  const [email, expiresRaw, signature] = token.split("|");
  const expires = Number(expiresRaw);
  if (
    !email
    || !safeEqual(email, config.email)
    || !signature
    || !Number.isFinite(expires)
    || expires <= Date.now() / 1000
  ) return null;
  return safeEqual(signature, await sign(`${email}|${expires}`, config.secret)) ? email : null;
}

export async function isAdminAuthenticated(): Promise<boolean> {
  return Boolean(await getAuthenticatedAdminEmail());
}

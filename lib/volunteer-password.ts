const PASSWORD_VERSION = 1;
// Cloudflare Workers Web Crypto rejects PBKDF2 counts above 100,000.
const PBKDF2_ITERATIONS = 100_000;
const MAX_PBKDF2_ITERATIONS = 100_000;
const HASH_BITS = 256;

export interface VolunteerPasswordCredential {
  version: 1;
  algorithm: "PBKDF2-SHA-256";
  iterations: number;
  saltHex: string;
  hashHex: string;
  updatedAt: string;
}

export function volunteerPasswordKey(volunteerId: string): string {
  return `raceupshot:volunteer:password:${encodeURIComponent(volunteerId)}`;
}

function bytesToHex(value: ArrayBuffer | Uint8Array): string {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(value: string): Uint8Array<ArrayBuffer> {
  if (!/^[0-9a-f]+$/i.test(value) || value.length % 2 !== 0) throw new Error("Invalid password credential.");
  return Uint8Array.from(value.match(/.{2}/g) || [], (pair) => Number.parseInt(pair, 16));
}

async function derivePasswordHash(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    key,
    HASH_BITS,
  );
  return bytesToHex(bits);
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
  for (let index = 0; index < Math.max(leftBytes.length, rightBytes.length); index += 1) {
    difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }
  return difference === 0;
}

export async function createVolunteerPasswordCredential(password: string): Promise<VolunteerPasswordCredential> {
  if (password.length < 6 || password.length > 128) throw new Error("Password must be between 6 and 128 characters.");
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  return {
    version: PASSWORD_VERSION,
    algorithm: "PBKDF2-SHA-256",
    iterations: PBKDF2_ITERATIONS,
    saltHex: bytesToHex(salt),
    hashHex: await derivePasswordHash(password, salt, PBKDF2_ITERATIONS),
    updatedAt: new Date().toISOString(),
  };
}

export async function verifyVolunteerPasswordCredential(
  password: string,
  credential: VolunteerPasswordCredential | null,
): Promise<boolean> {
  if (!credential || credential.version !== PASSWORD_VERSION || credential.algorithm !== "PBKDF2-SHA-256") return false;
  if (!Number.isInteger(credential.iterations) || credential.iterations < 100_000 || credential.iterations > MAX_PBKDF2_ITERATIONS) return false;
  try {
    const suppliedHash = await derivePasswordHash(password, hexToBytes(credential.saltHex), credential.iterations);
    return safeEqual(suppliedHash, credential.hashHex);
  } catch {
    return false;
  }
}

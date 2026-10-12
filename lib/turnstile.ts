import { getCloudflareContext } from "@opennextjs/cloudflare";

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const CONTACT_ACTION = "contact_enquiry";
const TEST_SITE_KEY = "1x00000000000000000000AA";
const TEST_SECRET_KEY = "1x0000000000000000000000000000000AA";

interface TurnstileSiteverifyResponse {
  success?: boolean;
  hostname?: string;
  action?: string;
  "error-codes"?: string[];
}

export function isValidContactTurnstileResponse(
  result: TurnstileSiteverifyResponse,
  expectedHostname: string,
): boolean {
  return Boolean(
    result.success
    && result.action === CONTACT_ACTION
    && result.hostname
    && result.hostname.toLowerCase() === expectedHostname.toLowerCase(),
  );
}

export class TurnstileVerificationError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "TurnstileVerificationError";
    this.status = status;
  }
}

export async function getTurnstileSiteKey(): Promise<string> {
  const { env } = await getCloudflareContext({ async: true });
  return env.TURNSTILE_SITE_KEY?.trim()
    || (process.env.NODE_ENV === "production" ? "" : TEST_SITE_KEY);
}

export async function verifyContactTurnstile(
  token: string,
  request: Request,
): Promise<void> {
  const { env } = await getCloudflareContext({ async: true });
  const secret = env.TURNSTILE_SECRET_KEY?.trim()
    || (process.env.NODE_ENV === "production" ? "" : TEST_SECRET_KEY);
  if (!secret) {
    throw new TurnstileVerificationError("Security verification is not configured. Please contact Race Upshot directly.", 503);
  }
  if (!token || token.length > 2048) {
    throw new TurnstileVerificationError("Please complete the security verification and try again.");
  }

  const remoteIp = request.headers.get("cf-connecting-ip")?.trim();
  const response = await fetch(SITEVERIFY_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      secret,
      response: token,
      ...(remoteIp ? { remoteip: remoteIp } : {}),
      idempotency_key: crypto.randomUUID(),
    }),
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) {
    throw new TurnstileVerificationError("Security verification is temporarily unavailable. Please try again.", 503);
  }
  const result = await response.json() as TurnstileSiteverifyResponse;
  const expectedHostname = new URL(request.url).hostname.toLowerCase();
  const valid = secret === TEST_SECRET_KEY
    ? Boolean(result.success && result.action === CONTACT_ACTION)
    : isValidContactTurnstileResponse(result, expectedHostname);
  if (!valid) {
    throw new TurnstileVerificationError("Security verification failed or expired. Please verify again.");
  }
}

export const turnstileContactAction = CONTACT_ACTION;

import { getCloudflareContext } from '@opennextjs/cloudflare';

const AISENSY_ENDPOINT = 'https://backend.aisensy.com/campaign/t1/api/v2';
const AISENSY_TIMEOUT_MS = 30_000;

export function normalizeAiSensyPhone(value: string): string {
  const raw = value.trim().replace(/[\s().-]/g, '');
  if (/^\+[1-9]\d{7,14}$/.test(raw)) return raw;
  if (/^00[1-9]\d{7,14}$/.test(raw)) return `+${raw.slice(2)}`;
  if (/^[6-9]\d{9}$/.test(raw)) return `+91${raw}`;
  if (/^[1-9]\d{10,14}$/.test(raw)) return `+${raw}`;
  return '';
}

/** Server-only campaign API. Never return provider bodies: they may echo credentials. */
export async function sendAiSensyWhatsApp(input: {
  recipientPhone: string; userName: string; campaignName: string;
  parameters: string[]; document?: { link: string; filename: string };
}): Promise<{ accepted: boolean; status?: number; error?: string; ambiguous?: boolean }> {
  const { env } = await getCloudflareContext({ async: true });
  const apiKey = env.AISENSY_API_KEY?.trim();
  if (!apiKey) return { accepted: false, error: 'AiSensy is not configured. Set the server-only AISENSY_API_KEY secret.' };
  const destination = normalizeAiSensyPhone(input.recipientPhone);
  if (!destination || !input.userName.trim() || !input.campaignName.trim()) return { accepted: false, error: 'AiSensy requires a valid mobile number, athlete name and live API campaign name.' };
  if (input.document) {
    try {
      const url = new URL(input.document.link);
      if (url.protocol !== 'https:' || url.username || url.password) throw new Error();
    } catch { return { accepted: false, error: 'AiSensy requires an HTTPS document URL.' }; }
  }
  const startedAt = Date.now();
  const timeoutSignal = AbortSignal.timeout(AISENSY_TIMEOUT_MS);
  try {
    const response = await fetch(AISENSY_ENDPOINT, {
      // Cloudflare Workers supports `follow` and `manual`, but throws before
      // sending when `redirect: "error"` is used. Keep redirects manual so the
      // API key is never forwarded to a different location automatically.
      method: 'POST', redirect: 'manual', signal: timeoutSignal,
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({ apiKey, campaignName: input.campaignName.trim(), destination,
        userName: input.userName.trim(), source: 'Race Upshot Volunteer', templateParams: input.parameters,
        ...(input.document ? { media: { url: input.document.link, filename: input.document.filename } } : {}) }),
    });
    // HTTP acceptance is not a delivery receipt. Do not retry ambiguous failures.
    const payload = await response.json().catch(() => null) as { success?: boolean; status?: string; error?: unknown } | null;
    const accepted = response.status === 200 && payload?.success !== false && !payload?.error && !['error', 'failed', 'failure'].includes(String(payload?.status).toLowerCase());
    console.info(JSON.stringify({
      type: 'aisensy_request_completed',
      accepted,
      status: response.status,
      durationMs: Date.now() - startedAt,
      providerRequestId: response.headers.get('request-id') || undefined,
      campaignName: input.campaignName.trim(),
      parameterCount: input.parameters.length,
      hasMedia: Boolean(input.document),
    }));
    return { accepted, status: response.status, ...(!accepted ? { error: `AiSensy did not confirm acceptance (HTTP ${response.status}). Check the campaign and provider dashboard.` } : {}) };
  } catch (error) {
    const errorName = error instanceof Error ? error.name : 'UnknownError';
    const timedOut = timeoutSignal.aborted || errorName === 'TimeoutError';
    console.error(JSON.stringify({
      type: 'aisensy_request_failed',
      reason: timedOut ? 'TIMEOUT' : 'NETWORK',
      errorName,
      durationMs: Date.now() - startedAt,
      campaignName: input.campaignName.trim(),
      parameterCount: input.parameters.length,
      hasMedia: Boolean(input.document),
    }));
    return {
      accepted: false,
      ambiguous: true,
      error: timedOut
        ? 'AiSensy did not respond within 30 seconds; acceptance is unconfirmed. Check the provider dashboard before resending.'
        : 'AiSensy could not be reached; acceptance is unconfirmed. Check the provider dashboard before resending.',
    };
  }
}

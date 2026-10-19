import { getCloudflareContext } from '@opennextjs/cloudflare';

const AISENSY_ENDPOINT = 'https://backend.aisensy.com/campaign/t1/api/v2';
const AISENSY_TIMEOUT_MS = 30_000;

type AiSensyPayload = { success?: boolean; status?: string; error?: unknown; message?: unknown; msg?: unknown; display?: unknown } | null;

function rejectionCategory(payload: AiSensyPayload): 'CAMPAIGN' | 'PARAMETERS' | 'DESTINATION' | 'AUTH' | 'MEDIA' | 'UNKNOWN' {
  const values = payload ? [payload.error, payload.message, payload.msg, payload.display] : [];
  const summary = values.flatMap(value => typeof value === 'string' ? [value] : value && typeof value === 'object' ? Object.values(value as Record<string, unknown>).filter(item => typeof item === 'string') as string[] : []).join(' ').toLowerCase();
  if (/campaign|not live|inactive/.test(summary)) return 'CAMPAIGN';
  if (/param|variable|placeholder|template/.test(summary)) return 'PARAMETERS';
  if (/destination|mobile|phone|number/.test(summary)) return 'DESTINATION';
  if (/api.?key|auth|unauthor|forbidden/.test(summary)) return 'AUTH';
  if (/media|document|file|header/.test(summary)) return 'MEDIA';
  return 'UNKNOWN';
}

function rejectionMessage(status: number, category: ReturnType<typeof rejectionCategory>, parameterCount: number): string {
  const prefix = `AiSensy rejected the request (HTTP ${status}).`;
  if (category === 'CAMPAIGN') return `${prefix} Verify the exact campaignName from AiSensy's generated API curl and confirm that the API campaign is live.`;
  if (category === 'PARAMETERS') return `${prefix} The live campaign template does not accept ${parameterCount} body parameter${parameterCount === 1 ? '' : 's'} in this order.`;
  if (category === 'DESTINATION') return `${prefix} Check that the athlete mobile number includes its country code.`;
  if (category === 'AUTH') return `${prefix} The AISENSY_API_KEY does not match the AiSensy project containing this campaign.`;
  if (category === 'MEDIA') return `${prefix} The selected campaign media/header configuration does not match this request.`;
  return `${prefix} Verify the generated API curl, API-key project, and ${parameterCount} configured body parameter${parameterCount === 1 ? '' : 's'}.`;
}

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
  if (!destination || !input.campaignName.trim()) return { accepted: false, error: 'AiSensy requires a valid mobile number and API campaign name.' };
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
      body: JSON.stringify({
        apiKey,
        campaignName: input.campaignName.trim(),
        destination: destination.replace(/^\+/, ''),
        userName: 'Race Upshot',
        templateParams: input.parameters,
        source: 'new-landing-page form',
        media: input.document ? { url: input.document.link, filename: input.document.filename } : {},
        buttons: [],
        carouselCards: [],
        location: {},
        attributes: {},
        paramsFallbackValue: { FirstName: 'user' },
      }),
    });
    // HTTP acceptance is not a delivery receipt. Do not retry ambiguous failures.
    const payload = await response.json().catch(() => null) as AiSensyPayload;
    const accepted = response.status === 200 && payload?.success !== false && !payload?.error && !['error', 'failed', 'failure'].includes(String(payload?.status).toLowerCase());
    const rejection = accepted ? undefined : rejectionCategory(payload);
    console.info(JSON.stringify({
      type: 'aisensy_request_completed',
      accepted,
      status: response.status,
      durationMs: Date.now() - startedAt,
      providerRequestId: response.headers.get('request-id') || undefined,
      campaignName: input.campaignName.trim(),
      parameterCount: input.parameters.length,
      hasMedia: Boolean(input.document),
      ...(rejection ? { rejection } : {}),
    }));
    return { accepted, status: response.status, ...(!accepted ? { error: rejectionMessage(response.status, rejection!, input.parameters.length) } : {}) };
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

/**
 * Sends the approved AiSensy `otp` campaign. The OTP is supplied to the
 * template's body parameter and dynamic button. Both must contain the OTP,
 * never the recipient's name. This keeps the copy-code button tied to the code
 * is stored for server-side verification.
 */
export async function sendAiSensyOtpWhatsApp(input: {
  recipientPhone: string;
  recipientName: string;
  otp: string;
}): Promise<{ accepted: boolean; status?: number; error?: string; ambiguous?: boolean }> {
  const { env } = await getCloudflareContext({ async: true });
  const apiKey = env.AISENSY_API_KEY?.trim();
  if (!apiKey) return { accepted: false, error: 'AiSensy is not configured. Set the server-only AISENSY_API_KEY secret.' };
  const normalizedPhone = normalizeAiSensyPhone(input.recipientPhone);
  const otp = input.otp.trim();
  if (!normalizedPhone || !/^\d{6}$/.test(otp)) return { accepted: false, error: 'AiSensy OTP delivery requires a valid mobile number and six-digit code.' };
  const timeoutSignal = AbortSignal.timeout(AISENSY_TIMEOUT_MS);
  const startedAt = Date.now();
  try {
    const response = await fetch(AISENSY_ENDPOINT, {
      method: 'POST',
      redirect: 'manual',
      signal: timeoutSignal,
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({
        apiKey,
        campaignName: 'otp',
        destination: normalizedPhone.replace(/^\+/, ''),
        userName: 'Race Upshot',
        templateParams: [otp],
        source: 'Race Upshot OTP',
        media: {},
        buttons: [{
          type: 'button',
          sub_type: 'url',
          index: 0,
          parameters: [{ type: 'text', text: otp }],
        }],
        carouselCards: [],
        location: {},
        attributes: {},
        paramsFallbackValue: {},
      }),
    });
    const payload = await response.json().catch(() => null) as { success?: boolean; status?: string; error?: unknown } | null;
    const accepted = response.status === 200 && payload?.success !== false && !payload?.error && !['error', 'failed', 'failure'].includes(String(payload?.status).toLowerCase());
    console.info(JSON.stringify({
      type: 'aisensy_otp_request_completed',
      accepted,
      status: response.status,
      durationMs: Date.now() - startedAt,
      campaignName: 'otp',
      hasCopyCodeButton: true,
    }));
    return { accepted, status: response.status, ...(!accepted ? { error: `AiSensy did not confirm OTP acceptance (HTTP ${response.status}). Check the otp campaign and provider dashboard.` } : {}) };
  } catch (error) {
    const errorName = error instanceof Error ? error.name : 'UnknownError';
    const timedOut = timeoutSignal.aborted || errorName === 'TimeoutError';
    console.error(JSON.stringify({
      type: 'aisensy_otp_request_failed',
      reason: timedOut ? 'TIMEOUT' : 'NETWORK',
      errorName,
      durationMs: Date.now() - startedAt,
      campaignName: 'otp',
    }));
    return {
      accepted: false,
      ambiguous: true,
      error: timedOut
        ? 'AiSensy did not respond within 30 seconds; OTP acceptance is unconfirmed.'
        : 'AiSensy could not be reached; OTP acceptance is unconfirmed.',
    };
  }
}

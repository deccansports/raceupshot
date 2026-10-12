import { getCloudflareContext } from "@opennextjs/cloudflare";

export interface BergtecnoWhatsAppResult {
  accepted: boolean;
  status?: number;
  providerStatus?: string;
  conversationId?: string;
  error?: string;
}

function joinUrl(base: string, path: string) {
  return `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

function payloadError(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== "object") return fallback;
  const value = payload as { message?: unknown; error?: unknown };
  if (typeof value.message === "string" && value.message.trim()) return value.message;
  if (typeof value.error === "string" && value.error.trim()) return value.error;
  if (value.error && typeof value.error === "object") {
    const message = (value.error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return fallback;
}

export function normalizeWhatsAppNumber(value: string): string {
  const raw = value.trim();
  if (!raw) return "";
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `+91${digits}`;
  return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : "";
}

export function buildFinisherWhatsAppComponents(values: string[]) {
  return values.length ? [{ type: "body", parameters: values.map((text) => ({ type: "text", text })) }] : [];
}

export async function sendBergtecnoWhatsApp(input: {
  recipientPhone: string;
  templateName: string;
  parameters: string[];
  language?: string;
  document?: { link: string; filename: string };
}): Promise<BergtecnoWhatsAppResult> {
  const { env } = await getCloudflareContext({ async: true });
  const baseUrl = (env.BERGTECHNO_WHATSAPP_API_BASE_URL || env.BERGTECHNO_EMAIL_API_BASE_URL || "https://bergtecno.com/api").trim();
  const apiKey = (env.BERGTECHNO_WHATSAPP_API_KEY || env.BERGTECHNO_EMAIL_API_KEY || "").trim();
  const headerName = (env.BERGTECHNO_WHATSAPP_API_KEY_HEADER || env.BERGTECHNO_EMAIL_API_KEY_HEADER || "x-api-key").trim();
  const sendPath = (env.BERGTECHNO_WHATSAPP_SEND_PATH || "/wa/send").trim();
  if (!apiKey) return { accepted: false, error: "Bergtecno WhatsApp API is not configured in Worker secrets." };
  const recipient = normalizeWhatsAppNumber(input.recipientPhone);
  if (!recipient) return { accepted: false, error: "A valid WhatsApp number is required." };
  if (!input.templateName.trim()) return { accepted: false, error: "A Bergtecno WhatsApp template name is required." };
  const authValue = headerName.toLowerCase() === "authorization" && !apiKey.toLowerCase().startsWith("bearer ") ? `Bearer ${apiKey}` : apiKey;
  try {
    const response = await fetch(joinUrl(baseUrl, sendPath), {
      method: "POST",
      headers: { "content-type": "application/json", [headerName]: authValue },
      body: JSON.stringify({
        to: recipient,
        type: "template",
        templateName: input.templateName.trim(),
        templateLanguage: input.language || "en",
        templateComponents: [
          ...(input.document ? [{ type: 'header', parameters: [{ type: 'document', document: input.document }] }] : []),
          ...buildFinisherWhatsAppComponents(input.parameters),
        ],
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const payload = await response.json().catch(() => null) as { success?: boolean; status?: string; data?: { status?: string; conversationId?: string } } | null;
    const accepted = response.status === 201 && payload?.success !== false && payload?.data?.status === "queued";
    return {
      accepted,
      status: response.status,
      providerStatus: payload?.data?.status || payload?.status,
      conversationId: payload?.data?.conversationId,
      ...(!accepted ? { error: payloadError(payload, `Bergtecno returned HTTP ${response.status}.`) } : {}),
    };
  } catch (error) {
    return { accepted: false, error: error instanceof Error ? error.message : "Bergtecno WhatsApp request failed." };
  }
}

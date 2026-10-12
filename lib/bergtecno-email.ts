import { getCloudflareContext } from "@opennextjs/cloudflare";
import juice from "juice";
import { resolveBergtecnoTemplateId } from "./email-templates";

export interface BergtecnoEmailInput {
  recipientEmail: string;
  subject?: string;
  html?: string;
  templateId?: string;
  variables?: Record<string, unknown>;
  attachments?: Array<{ filename: string; contentType: string; data: string }>;
  singleAttempt?: boolean;
}

export interface BergtecnoEmailResult {
  sent: boolean;
  status?: number;
  error?: string;
  ambiguous?: boolean;
}

export type BergtecnoBulkDeliveryStatus =
  | "queued"
  | "processing"
  | "ses_accepted"
  | "delivered"
  | "bounced"
  | "complained"
  | "failed"
  | "suppressed"
  | "rejected";

export interface BergtecnoBulkMessage {
  clientMessageId: string;
  to: string | { email: string; name?: string };
  subject: string;
  html: string;
  variables?: Record<string, unknown>;
}

export interface BergtecnoBulkItem {
  clientMessageId: string;
  emailLogId?: string;
  toEmail?: string;
  status: BergtecnoBulkDeliveryStatus;
  reason?: string;
  errorMessage?: string | null;
  sesMessageId?: string | null;
}

export interface BergtecnoBulkCounts {
  total?: number;
  queued?: number;
  processing?: number;
  sesAccepted?: number;
  delivered?: number;
  bounced?: number;
  complained?: number;
  failed?: number;
  suppressed?: number;
}

export interface BergtecnoBulkSubmissionResult {
  accepted: boolean;
  status: number;
  providerStatus?: string;
  queued: number;
  suppressed: number;
  rejected: number;
  attachmentRef?: string | null;
  items: BergtecnoBulkItem[];
  retryable: boolean;
  error?: string;
}

export interface BergtecnoBulkStatusResult {
  campaignId: string;
  counts: BergtecnoBulkCounts;
  items: BergtecnoBulkItem[];
}

function joinUrl(base: string, path: string) {
  return `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

function errorMessage(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== "object") return fallback;
  const body = payload as { message?: unknown; error?: unknown };
  if (typeof body.message === "string" && body.message.trim()) return body.message;
  if (typeof body.error === "string" && body.error.trim()) return body.error;
  if (body.error && typeof body.error === "object") {
    const message = (body.error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return fallback;
}

async function getBergtecnoBulkConfig() {
  const { env } = await getCloudflareContext({ async: true });
  const baseUrl = (env.BERGTECHNO_EMAIL_API_BASE_URL || env.BERGTECNO_EMAIL_API_BASE_URL || "https://bergtecno.com/api").trim();
  const apiKey = (env.BERGTECHNO_EMAIL_API_KEY || env.BERGTECNO_EMAIL_API_KEY || "").trim();
  const headerName = (env.BERGTECHNO_EMAIL_API_KEY_HEADER || env.BERGTECNO_EMAIL_API_KEY_HEADER || "authorization").trim();
  const bulkPath = (env.BERGTECHNO_EMAIL_BULK_SEND_PATH || env.BERGTECNO_EMAIL_BULK_SEND_PATH || "/email/send-bulk").trim();
  const senderEmail = (env.BERGTECHNO_SENDER_EMAIL || env.BERGTECNO_SENDER_EMAIL || "info@raceupshot.com").trim();
  const senderName = (env.BERGTECHNO_SENDER_NAME || env.BERGTECNO_SENDER_NAME || "Race Upshot").trim();
  const authValue = headerName.toLowerCase() === "authorization" && !apiKey.toLowerCase().startsWith("bearer ")
    ? `Bearer ${apiKey}`
    : apiKey;
  return { baseUrl, apiKey, headerName, authValue, bulkPath, senderEmail, senderName };
}

export async function submitBergtecnoBulkCampaign(input: {
  campaignId: string;
  messages: BergtecnoBulkMessage[];
  replyTo?: string;
  attachment?: { filename: string; contentType?: string; data: string };
  attachmentRef?: string;
}): Promise<BergtecnoBulkSubmissionResult> {
  const config = await getBergtecnoBulkConfig();
  if (!config.baseUrl || !config.apiKey) {
    return { accepted: false, status: 0, queued: 0, suppressed: 0, rejected: 0, items: [], retryable: false, error: "Bergtecno email API is not configured in Worker secrets." };
  }

  const seen = new Set<string>();
  const messages = input.messages.flatMap((message) => {
    const email = (typeof message.to === "string" ? message.to : message.to.email).trim().toLowerCase();
    if (seen.has(email)) return [];
    seen.add(email);
    return [{
      ...message,
      to: typeof message.to === "string" ? email : { ...message.to, email },
      html: prepareEmailHtml(message.html),
    }];
  });

  try {
    const response = await fetch(joinUrl(config.baseUrl, config.bulkPath), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [config.headerName]: config.authValue,
      },
      body: JSON.stringify({
        sender: { email: config.senderEmail, name: config.senderName },
        replyTo: input.replyTo || config.senderEmail,
        campaignId: input.campaignId,
        messages,
        ...(input.attachment ? { attachment: input.attachment } : {}),
        ...(input.attachmentRef ? { attachmentRef: input.attachmentRef } : {}),
      }),
      signal: AbortSignal.timeout(30_000),
    });
    const payload = await response.json().catch(() => null) as {
      success?: boolean;
      status?: string;
      queued?: number;
      suppressed?: number;
      rejected?: number;
      attachmentRef?: string | null;
      items?: BergtecnoBulkItem[];
    } | null;
    const accepted = response.status === 202 && payload?.success !== false;
    return {
      accepted,
      status: response.status,
      providerStatus: payload?.status,
      queued: payload?.queued ?? 0,
      suppressed: payload?.suppressed ?? 0,
      rejected: payload?.rejected ?? 0,
      attachmentRef: payload?.attachmentRef,
      items: Array.isArray(payload?.items) ? payload.items : [],
      retryable: response.status === 429 || response.status === 503,
      ...(!accepted ? { error: errorMessage(payload, `Bergtecno returned HTTP ${response.status}.`) } : {}),
    };
  } catch (error) {
    return {
      accepted: false,
      status: 0,
      queued: 0,
      suppressed: 0,
      rejected: 0,
      items: [],
      retryable: true,
      error: error instanceof Error ? error.message : "Bergtecno bulk email request failed.",
    };
  }
}

export async function getBergtecnoBulkCampaignStatus(campaignId: string): Promise<BergtecnoBulkStatusResult> {
  const config = await getBergtecnoBulkConfig();
  if (!config.baseUrl || !config.apiKey) throw new Error("Bergtecno email API is not configured in Worker secrets.");
  const path = `/email/bulk/${encodeURIComponent(campaignId)}/status`;
  const response = await fetch(joinUrl(config.baseUrl, path), {
    method: "GET",
    headers: { [config.headerName]: config.authValue },
    signal: AbortSignal.timeout(15_000),
  });
  const payload = await response.json().catch(() => null) as {
    success?: boolean;
    data?: BergtecnoBulkStatusResult;
  } | null;
  if (!response.ok || payload?.success === false || !payload?.data) {
    throw new Error(errorMessage(payload, `Bergtecno returned HTTP ${response.status}.`));
  }
  return payload.data;
}

function candidateUrls(baseUrl: string, rawPath: string): string[] {
  const cleanBase = baseUrl.replace(/\/+$/, "");
  const origin = cleanBase.replace(/\/api$/i, "");
  const path = `/${rawPath.replace(/^\/+/, "")}`;
  const withoutApi = path.replace(/^\/api(?=\/)/i, "");
  const pluralPath = path.replace("/email/", "/emails/");
  return [...new Set([
    cleanBase.toLowerCase().endsWith("/api") && path.toLowerCase().startsWith("/api/")
      ? joinUrl(origin, path)
      : joinUrl(cleanBase, path),
    joinUrl(origin, `/api${withoutApi}`),
    joinUrl(cleanBase, withoutApi),
    joinUrl(cleanBase, pluralPath),
    joinUrl(origin, `/api${pluralPath}`),
  ])].slice(0, 4);
}

export function buildBergtecnoTemplatePayloads(input: {
  recipientEmail: string;
  templateId: string;
  variables: Record<string, unknown>;
  senderEmail: string;
  senderName: string;
}): Array<Record<string, unknown>> {
  const recipient = input.recipientEmail.trim().toLowerCase();
  const templateId = resolveBergtecnoTemplateId(input.templateId);
  const flat = { ...input.variables };
  const nestedAndFlat = {
    ...flat,
    params: flat,
    variables: flat,
    data: flat,
    templateData: flat,
  };
  return [
    {
      templateId,
      template_id: templateId,
      to: [{ email: recipient }],
      recipientEmail: recipient,
      params: nestedAndFlat,
      variables: nestedAndFlat,
      data: nestedAndFlat,
      templateData: nestedAndFlat,
      sender: { email: input.senderEmail, name: input.senderName },
      senderEmail: input.senderEmail,
      senderName: input.senderName,
    },
    {
      templateId,
      template_id: templateId,
      to: recipient,
      recipientEmail: recipient,
      params: nestedAndFlat,
      variables: nestedAndFlat,
      data: nestedAndFlat,
      templateData: nestedAndFlat,
      sender: { email: input.senderEmail, name: input.senderName },
      senderEmail: input.senderEmail,
      senderName: input.senderName,
    },
  ];
}

export function prepareEmailHtml(html: string): string {
  const normalized = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, "")
    .replace(/<meta\b[^>]*name\s*=\s*["']?color-scheme["']?[^>]*>/gi, "")
    .replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .trimStart();
  const wrapped = /^<!doctype|^<html[\s>]/i.test(normalized)
    ? normalized
    : `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>${html}</body></html>`;
  return juice(wrapped, {
    applyAttributesTableElements: true,
    applyHeightAttributes: true,
    applyStyleTags: true,
    applyWidthAttributes: true,
    inlineDuplicateProperties: true,
    preserveFontFaces: true,
    preserveImportant: true,
    preserveKeyFrames: true,
    preserveMediaQueries: true,
    preservePseudos: true,
    removeStyleTags: false,
    resolveCSSVariables: true,
    extraCss: "body{margin:0}img{max-width:100%;height:auto}table{border-collapse:collapse;border-spacing:0}",
  });
}

export async function sendBergtecnoEmail(input: BergtecnoEmailInput): Promise<BergtecnoEmailResult> {
  const { env } = await getCloudflareContext({ async: true });
  const baseUrl = (env.BERGTECHNO_EMAIL_API_BASE_URL || env.BERGTECNO_EMAIL_API_BASE_URL || "https://bergtecno.com/api").trim();
  const apiKey = (env.BERGTECHNO_EMAIL_API_KEY || env.BERGTECNO_EMAIL_API_KEY || "").trim();
  const headerName = (env.BERGTECHNO_EMAIL_API_KEY_HEADER || env.BERGTECNO_EMAIL_API_KEY_HEADER || "x-api-key").trim();
  const rawPath = (env.BERGTECHNO_EMAIL_RAW_SEND_PATH || env.BERGTECNO_EMAIL_RAW_SEND_PATH || "/email/send").trim();
  const templatePath = (env.BERGTECHNO_EMAIL_TEMPLATE_SEND_PATH || env.BERGTECNO_EMAIL_TEMPLATE_SEND_PATH || "/email/send-template").trim();
  const senderEmail = (env.BERGTECHNO_SENDER_EMAIL || env.BERGTECNO_SENDER_EMAIL || "info@raceupshot.com").trim();
  const senderName = (env.BERGTECHNO_SENDER_NAME || env.BERGTECNO_SENDER_NAME || "Race Upshot").trim();

  if (!baseUrl || !apiKey) {
    return { sent: false, error: "Bergtecno email API is not configured in Worker secrets." };
  }
  if (!input.templateId && !input.html?.trim()) {
    return { sent: false, error: "Email HTML or a Bergtecno template ID is required." };
  }

  const authValue = headerName.toLowerCase() === "authorization" && !apiKey.toLowerCase().startsWith("bearer ")
    ? `Bearer ${apiKey}`
    : apiKey;
  const preparedHtml = input.html ? prepareEmailHtml(input.html) : undefined;

  let lastError = "Bergtecno email request failed.";
  let ambiguous = false;
  const payloads: Array<Record<string, unknown>> = input.templateId
    ? buildBergtecnoTemplatePayloads({
        recipientEmail: input.recipientEmail,
        templateId: input.templateId,
        variables: input.variables ?? {},
        senderEmail,
        senderName,
      })
    : [{
          to: input.recipientEmail.trim().toLowerCase(),
          ...(input.subject ? { subject: input.subject } : {}),
          ...(preparedHtml ? { html: preparedHtml, htmlContent: preparedHtml, html_content: preparedHtml } : {}),
          from: senderEmail,
          from_name: senderName,
          sender_name: senderName,
          replyTo: senderEmail,
          sender: { email: senderEmail, name: senderName },
        }];
  const path = input.templateId ? templatePath : rawPath;

  for (const url of candidateUrls(baseUrl, path).slice(0, input.singleAttempt ? 1 : undefined)) {
    for (const requestPayload of payloads.slice(0, input.singleAttempt ? 1 : undefined)) {
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            [headerName]: authValue,
          },
          body: JSON.stringify({ ...requestPayload, ...(input.attachments?.length ? { attachments: input.attachments } : {}) }),
          signal: AbortSignal.timeout(15_000),
        });
        const payload = await response.json().catch(() => null) as {
          success?: boolean;
          message?: string;
          error?: string | { message?: string };
        } | null;
        if (!response.ok || payload?.success === false) {
          lastError = payload?.message
            || (typeof payload?.error === "string" ? payload.error : payload?.error?.message)
            || `Bergtecno returned HTTP ${response.status}.`;
          continue;
        }
        return { sent: true, status: response.status };
      } catch (error) {
        lastError = error instanceof Error ? error.message : "Bergtecno email request failed.";
        ambiguous = true;
      }
    }
  }
  return { sent: false, error: lastError, ambiguous };
}

export function escapeEmailHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function textToEmailHtml(value: string): string {
  return escapeEmailHtml(value).replace(/\r?\n/g, "<br>");
}

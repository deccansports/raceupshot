import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { KVNamespace } from "@cloudflare/workers-types";
import { z } from "./zod";
import {
  escapeEmailHtml,
  getBergtecnoBulkCampaignStatus,
  submitBergtecnoBulkCampaign,
  textToEmailHtml,
  type BergtecnoBulkDeliveryStatus,
  type BergtecnoBulkCounts,
} from "./bergtecno-email";
import { getEventBySlug } from "./raceupshot-repository";

const PREFIX = "raceupshot";
const PROFILE_PREFIX = `${PREFIX}:athlete-profile:`;

type JsonRecord = Record<string, unknown>;

export const audienceFiltersInput = z.object({
  country: z.string().trim().max(80).default(""),
  state: z.string().trim().max(80).default(""),
  city: z.string().trim().max(80).default(""),
  category: z.string().trim().max(120).default(""),
});

export const campaignInput = z.object({
  scope: z.enum(["GLOBAL", "EVENT"]),
  eventId: z.string().trim().max(160).default(""),
  subject: z.string().trim().min(3).max(180),
  message: z.string().trim().min(3).max(500_000),
  contentType: z.enum(["TEXT", "HTML"]).default("TEXT"),
  variables: z.record(z.string().max(80), z.string().max(10_000)).default({}),
  attachment: z.object({
    filename: z.string().trim().min(1).max(180),
    contentType: z.enum(["image/jpeg", "image/png", "image/webp", "application/pdf"]),
    data: z.string().min(1).max(14_000_000),
  }).optional(),
  filters: audienceFiltersInput,
}).refine((value) => value.scope === "GLOBAL" || Boolean(value.eventId), {
  message: "Choose an event for event communications.",
  path: ["eventId"],
});

export type AudienceFilters = z.infer<typeof audienceFiltersInput>;
export type CampaignInput = z.infer<typeof campaignInput>;

export interface AudienceMember {
  email: string;
  name: string;
  country: string;
  state: string;
  city: string;
  categories: string[];
  eventIds: string[];
}

export interface CampaignRecipient extends AudienceMember {
  clientMessageId?: string;
  emailLogId?: string;
  providerStatus?: BergtecnoBulkDeliveryStatus;
  status: "PENDING" | "QUEUED" | "PROCESSING" | "SES_ACCEPTED" | "DELIVERED" | "BOUNCED" | "COMPLAINED" | "SUPPRESSED" | "SENT" | "FAILED";
  error?: string;
}

export interface CommunicationCampaign extends CampaignInput {
  id: string;
  providerCampaignId?: string;
  attachmentRef?: string;
  status: "SUBMITTING" | "QUEUED" | "PROCESSING" | "SES_ACCEPTED" | "COMPLETED" | "SENDING" | "SENT" | "PARTIAL_FAILURE" | "FAILED" | "EMPTY";
  createdAt: string;
  updatedAt: string;
  lastStatusCheckedAt?: string;
  recipients: CampaignRecipient[];
  providerCounts?: BergtecnoBulkCounts;
  queuedCount?: number;
  sesAcceptedCount?: number;
  deliveredCount?: number;
  suppressedCount?: number;
  sentCount: number;
  failedCount: number;
}

function recipientStatus(status: BergtecnoBulkDeliveryStatus): CampaignRecipient["status"] {
  return ({
    queued: "QUEUED",
    processing: "PROCESSING",
    ses_accepted: "SES_ACCEPTED",
    delivered: "DELIVERED",
    bounced: "BOUNCED",
    complained: "COMPLAINED",
    failed: "FAILED",
    suppressed: "SUPPRESSED",
    rejected: "FAILED",
  } as const)[status];
}

export function summarizeCommunicationCampaign(campaign: CommunicationCampaign): CommunicationCampaign {
  const count = (statuses: CampaignRecipient["status"][]) => campaign.recipients.filter((recipient) => statuses.includes(recipient.status)).length;
  const pendingCount = count(["PENDING"]);
  const queuedCount = count(["QUEUED"]);
  const processingCount = count(["PROCESSING"]);
  const acceptedNow = count(["SES_ACCEPTED"]);
  const deliveredCount = count(["DELIVERED", "SENT"]);
  const suppressedCount = count(["SUPPRESSED"]);
  const failedCount = count(["FAILED", "BOUNCED", "COMPLAINED"]);
  const sesAcceptedCount = acceptedNow + deliveredCount + count(["BOUNCED", "COMPLAINED"]);
  let status: CommunicationCampaign["status"];
  if (!campaign.recipients.length) status = "EMPTY";
  else if (pendingCount) status = "SUBMITTING";
  else if (processingCount) status = "PROCESSING";
  else if (queuedCount) status = "QUEUED";
  else if (acceptedNow) status = "SES_ACCEPTED";
  else if (failedCount && deliveredCount + suppressedCount) status = "PARTIAL_FAILURE";
  else if (failedCount) status = "FAILED";
  else status = "COMPLETED";
  return {
    ...campaign,
    status,
    queuedCount,
    sesAcceptedCount,
    deliveredCount,
    suppressedCount,
    failedCount,
  };
}

export function renderCommunicationEmail(
  message: string,
  contentType: "TEXT" | "HTML" = "TEXT",
  recipientName = "Athlete",
  variables: Record<string, string> = {},
): string {
  const rawName = recipientName || "Athlete";
  const values: Record<string, string> = { name: rawName, recipient_name: rawName, ...variables };
  const replaceVariables = (source: string, escapeValues: boolean) => source.replace(
    /\{\{\s*(?:params\.)?([a-zA-Z0-9_]+)\s*\}\}/g,
    (placeholder, key: string) => key in values
      ? (escapeValues ? escapeEmailHtml(values[key]) : values[key])
      : placeholder,
  );
  const personalizedMessage = replaceVariables(message, contentType === "HTML");
  if (contentType === "HTML") {
    const documentStart = personalizedMessage.search(/<!doctype\s+html|<html[\s>]/i);
    if (documentStart >= 0) return personalizedMessage.slice(documentStart).trim();
  }
  const content = contentType === "HTML"
    ? personalizedMessage
    : `<p>${textToEmailHtml(replaceVariables(message, false))}</p>`;
  const greetingName = escapeEmailHtml(rawName);
  return `<!doctype html>
    <html>
      <head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
      <body style="margin:0;background:#f3f5f8;font-family:Arial,sans-serif;color:#17223a;line-height:1.65">
        <div style="max-width:640px;margin:auto;padding:28px 16px">
          <div style="background:#ffffff;border:1px solid #dfe5ec;border-radius:12px;padding:30px">
            <div style="color:#ff6b22;font-size:22px;font-weight:800;margin-bottom:20px">Race Upshot</div>
            <p>Hello ${greetingName},</p>
            ${content}
            <p style="color:#687188;font-size:13px;margin-top:28px">Race Upshot · info@raceupshot.com</p>
          </div>
        </div>
      </body>
    </html>`;
}

function record(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : null;
}

function value(row: JsonRecord, ...keys: string[]): string {
  for (const key of keys) {
    const raw = row[key];
    if (typeof raw === "string" && raw.trim()) return raw.trim();
  }
  return "";
}

function normalize(valueToNormalize: string) {
  return valueToNormalize.trim().toLocaleLowerCase("en");
}

function unpackRows(payload: unknown): JsonRecord[] {
  if (Array.isArray(payload)) return payload.map(record).filter((row): row is JsonRecord => Boolean(row));
  const wrapper = record(payload);
  if (!wrapper) return [];
  for (const key of ["participants", "athletes", "rows", "data"]) {
    if (Array.isArray(wrapper[key])) return (wrapper[key] as unknown[]).map(record).filter((row): row is JsonRecord => Boolean(row));
  }
  return [];
}

async function getKv(): Promise<KVNamespace> {
  const { env } = await getCloudflareContext({ async: true });
  return env.RACEUPSHOT;
}

async function listKeys(kv: KVNamespace, prefix: string): Promise<string[]> {
  const keys: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await kv.list({ prefix, cursor, limit: 1000 });
    keys.push(...page.keys.map((key) => key.name));
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return keys;
}

function addMember(target: Map<string, AudienceMember>, row: JsonRecord, eventId = "") {
  const email = value(
    row,
    "email",
    "Email",
    "emailAddress",
    "Email Address",
    "athleteEmail",
    "userEmail",
    "contactEmail",
  ).toLowerCase();
  if (!z.string().email().safeParse(email).success) return;
  const existing = target.get(email);
  const nextEventIds = new Set([...(existing?.eventIds || []), ...(eventId ? [eventId] : [])]);
  const category = value(row, "category", "Category", "raceCategory", "RACE CAT", "distance");
  const categories = new Set([...(existing?.categories || []), ...(category ? [category] : [])]);
  target.set(email, {
    email,
    name: existing?.name || value(row, "name", "fullName", "displayName", "athleteName") || "Athlete",
    country: existing?.country || value(row, "country", "countryCode"),
    state: existing?.state || value(row, "state", "region"),
    city: existing?.city || value(row, "city", "location"),
    categories: [...categories],
    eventIds: [...nextEventIds],
  });
}

function eventIdFromResultKey(key: string): string {
  const match = key.match(/^raceupshot:event:([^:]+):result:/);
  return match?.[1] || "";
}

function eventIdFromParticipantKey(key: string): string {
  const match = key.match(/^raceupshot:live:event:([^:]+):participants$/);
  return match?.[1] || "";
}

export async function getCommunicationAudience(scope: "GLOBAL" | "EVENT", eventId: string, filters: AudienceFilters): Promise<AudienceMember[]> {
  const kv = await getKv();
  const members = new Map<string, AudienceMember>();
  const profileKeys = await listKeys(kv, PROFILE_PREFIX);
  const profiles = await Promise.all(profileKeys.map((key) => kv.get<JsonRecord>(key, "json")));
  profiles.forEach((profile) => { if (profile) addMember(members, profile); });

  const participantKeys = scope === "EVENT"
    ? [`${PREFIX}:live:event:${eventId}:participants`]
    : await listKeys(kv, `${PREFIX}:live:event:`).then((keys) => keys.filter((key) => key.endsWith(":participants")));
  const participantPayloads = await Promise.all(participantKeys.map((key) => kv.get<unknown>(key, "json")));
  participantPayloads.forEach((payload, index) => {
    const keyEventId = eventIdFromParticipantKey(participantKeys[index]);
    unpackRows(payload).forEach((row) => addMember(members, row, keyEventId));
  });

  const resultKeys = scope === "EVENT"
    ? await listKeys(kv, `${PREFIX}:event:${eventId}:result:`)
    : await listKeys(kv, `${PREFIX}:event:`).then((keys) => keys.filter((key) => eventIdFromResultKey(key)));
  const results = await Promise.all(resultKeys.map((key) => kv.get<JsonRecord>(key, "json")));
  results.forEach((row, index) => {
    if (row) addMember(members, row, eventIdFromResultKey(resultKeys[index]));
  });

  return [...members.values()]
    .filter((member) => scope === "GLOBAL" || member.eventIds.includes(eventId))
    .filter((member) => !filters.country || normalize(member.country) === normalize(filters.country))
    .filter((member) => !filters.state || normalize(member.state) === normalize(filters.state))
    .filter((member) => !filters.city || normalize(member.city) === normalize(filters.city))
    .filter((member) => !filters.category || member.categories.some((category) => normalize(category) === normalize(filters.category)))
    .sort((left, right) => left.email.localeCompare(right.email));
}

async function getCampaignIndex(kv: KVNamespace): Promise<string[]> {
  return (await kv.get<string[]>(`${PREFIX}:communications:index`, "json")) ?? [];
}

export async function createCommunicationCampaign(input: CampaignInput): Promise<CommunicationCampaign> {
  const kv = await getKv();
  const audience = await getCommunicationAudience(input.scope, input.eventId, input.filters);
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const campaign: CommunicationCampaign = {
    ...input,
    id,
    providerCampaignId: `raceupshot-${id}`,
    status: audience.length ? "SUBMITTING" : "EMPTY",
    createdAt: now,
    updatedAt: now,
    recipients: audience.map((member, index) => ({
      ...member,
      clientMessageId: `raceupshot-${id}-${index + 1}-v1`,
      status: "PENDING",
    })),
    sentCount: 0,
    failedCount: 0,
  };
  const ids = await getCampaignIndex(kv);
  await Promise.all([
    kv.put(`${PREFIX}:communication:${campaign.id}`, JSON.stringify(campaign)),
    kv.put(`${PREFIX}:communications:index`, JSON.stringify([campaign.id, ...ids.filter((id) => id !== campaign.id)])),
  ]);
  return campaign;
}

export async function sendCommunicationBatch(id: string, batchSize = 200, retryFailed = false): Promise<CommunicationCampaign> {
  const kv = await getKv();
  const key = `${PREFIX}:communication:${id}`;
  const campaign = await kv.get<CommunicationCampaign>(key, "json");
  if (!campaign) throw new Error("Communication campaign not found.");
  if (retryFailed) {
    campaign.recipients = campaign.recipients.map((recipient) => recipient.status === "FAILED"
      ? { ...recipient, status: "PENDING" as const, error: undefined }
      : recipient);
    campaign.failedCount = 0;
    campaign.status = campaign.recipients.some((recipient) => recipient.status === "PENDING") ? "SUBMITTING" : campaign.status;
  }
  const payloadSafeBatchSize = Math.max(1, Math.min(
    batchSize,
    Math.floor(4_000_000 / Math.max(campaign.message.length, 1)),
  ));
  const pending = campaign.recipients.filter((recipient) => recipient.status === "PENDING").slice(0, payloadSafeBatchSize);
  if (!pending.length) return campaign;

  campaign.status = "SUBMITTING";
  campaign.updatedAt = new Date().toISOString();
  await kv.put(key, JSON.stringify(campaign));
  const event = campaign.eventId
    ? await getEventBySlug(campaign.eventId, { includeUnpublished: true })
    : null;
  const eventVariables: Record<string, string> = event ? {
    event_id: event.id,
    event_name: event.name,
    event_date: event.date,
    event_location: event.location,
    event_type: event.sport,
  } : {};
  const emailVariables = { ...eventVariables, ...(campaign.variables ?? {}) };

  const providerCampaignId = campaign.providerCampaignId || `raceupshot-${campaign.id}`;
  const submission = await submitBergtecnoBulkCampaign({
    campaignId: providerCampaignId,
    ...(campaign.attachmentRef
      ? { attachmentRef: campaign.attachmentRef }
      : campaign.attachment
        ? { attachment: campaign.attachment }
        : {}),
    messages: pending.map((recipient, index) => ({
      clientMessageId: recipient.clientMessageId || `${providerCampaignId}-${campaign.recipients.indexOf(recipient) || index + 1}-v1`,
      to: { email: recipient.email, name: recipient.name },
      subject: campaign.subject,
      html: renderCommunicationEmail(campaign.message, campaign.contentType || "TEXT", recipient.name, emailVariables),
      variables: {
        recipientName: recipient.name,
        eventIds: recipient.eventIds,
        categories: recipient.categories,
      },
    })),
  });
  const byMessageId = new Map(submission.items.map((item) => [item.clientMessageId, item]));
  const pendingEmails = new Set(pending.map((recipient) => recipient.email));
  campaign.recipients = campaign.recipients.map((recipient) => {
    if (!pendingEmails.has(recipient.email)) return recipient;
    const item = recipient.clientMessageId ? byMessageId.get(recipient.clientMessageId) : undefined;
    if (!submission.accepted) {
      return { ...recipient, status: "FAILED" as const, error: submission.error || "Bulk submission failed." };
    }
    const providerStatus = item?.status || "queued";
    return {
      ...recipient,
      status: recipientStatus(providerStatus),
      providerStatus,
      emailLogId: item?.emailLogId,
      error: providerStatus === "rejected" || providerStatus === "failed"
        ? item?.reason || item?.errorMessage || "Bergtecno rejected this message."
        : undefined,
    };
  });
  campaign.providerCampaignId = providerCampaignId;
  if (submission.attachmentRef) {
    campaign.attachmentRef = submission.attachmentRef;
    campaign.attachment = undefined;
  }
  campaign.updatedAt = new Date().toISOString();
  const summarized = summarizeCommunicationCampaign(campaign);
  await kv.put(key, JSON.stringify(summarized));
  return summarized;
}

export async function refreshCommunicationCampaignStatus(id: string): Promise<CommunicationCampaign> {
  const kv = await getKv();
  const key = `${PREFIX}:communication:${id}`;
  const campaign = await kv.get<CommunicationCampaign>(key, "json");
  if (!campaign) throw new Error("Communication campaign not found.");
  if (!campaign.providerCampaignId) return summarizeCommunicationCampaign(campaign);
  const status = await getBergtecnoBulkCampaignStatus(campaign.providerCampaignId);
  const byMessageId = new Map(status.items.map((item) => [item.clientMessageId, item]));
  campaign.recipients = campaign.recipients.map((recipient) => {
    const item = recipient.clientMessageId ? byMessageId.get(recipient.clientMessageId) : undefined;
    if (!item) return recipient;
    return {
      ...recipient,
      status: recipientStatus(item.status),
      providerStatus: item.status,
      emailLogId: item.emailLogId || recipient.emailLogId,
      error: item.errorMessage || item.reason || undefined,
    };
  });
  campaign.providerCounts = status.counts;
  campaign.lastStatusCheckedAt = new Date().toISOString();
  campaign.updatedAt = campaign.lastStatusCheckedAt;
  const summarized = summarizeCommunicationCampaign(campaign);
  await kv.put(key, JSON.stringify(summarized));
  return summarized;
}

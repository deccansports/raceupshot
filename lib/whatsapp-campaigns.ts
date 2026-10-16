import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { KVNamespace } from "@cloudflare/workers-types";
import { normalizeAiSensyPhone, sendAiSensyWhatsApp } from "./aisensy-whatsapp";
import { getAdminParticipantRoster } from "./participant-chip-assignments";
import { getEvents } from "./raceupshot-repository";
import { z } from "./zod";

const PREFIX = "raceupshot:whatsapp-campaign";
const INDEX_KEY = `${PREFIX}:index`;

export const WHATSAPP_CAMPAIGN_TOKEN_OPTIONS = [
  { value: "{{name}}", label: "Athlete name" }, { value: "{{bib}}", label: "BIB number" },
  { value: "{{category}}", label: "Ticket / category" }, { value: "{{event_name}}", label: "Event name" },
  { value: "{{email}}", label: "Email" }, { value: "{{mobile}}", label: "Mobile" },
  { value: "{{participant_id}}", label: "Participant ID" },
] as const;

export const whatsappCampaignInput = z.object({
  eventId: z.string().trim().min(1, "Choose the test event.").max(160),
  participantId: z.string().trim().max(250).default(""),
  targetType: z.enum(["EVENT", "SINGLE_PARTICIPANT"]),
  campaignLabel: z.string().trim().min(2).max(160),
  campaignName: z.string().trim().min(1, "Enter the approved AiSensy API campaign name.").max(160),
  categories: z.array(z.string().trim().min(1).max(160)).max(100).default([]),
  parameters: z.array(z.object({ value: z.string().trim().max(500) })).min(1).max(30),
  mediaUrl: z.string().trim().url().max(2_000).or(z.literal("")).default(""),
  mediaFilename: z.string().trim().max(180).default(""),
}).superRefine((value, ctx) => {
  if (value.targetType === "SINGLE_PARTICIPANT" && !value.participantId) ctx.addIssue({ code: "custom", path: ["participantId"], message: "Choose one participant." });
  if (value.mediaUrl && !value.mediaUrl.startsWith("https://")) ctx.addIssue({ code: "custom", path: ["mediaUrl"], message: "WhatsApp media must use HTTPS." });
});

export type WhatsAppCampaignInput = z.infer<typeof whatsappCampaignInput>;
export type WhatsAppRecipientStatus = "PENDING" | "ACCEPTED" | "FAILED" | "UNCONFIRMED";
export interface WhatsAppCampaignRecipient { id: string; name: string; email: string; mobile: string; bib: string; category: string; eventName: string; status: WhatsAppRecipientStatus; attemptedAt?: string; providerStatus?: number; error?: string; resolvedParameters?: string[]; }
export interface WhatsAppCampaign extends WhatsAppCampaignInput { id: string; status: "DRAFT" | "SUBMITTING" | "COMPLETED" | "PARTIAL_FAILURE" | "FAILED" | "EMPTY"; createdAt: string; updatedAt: string; recipients: WhatsAppCampaignRecipient[]; acceptedCount: number; failedCount: number; unconfirmedCount: number; }

type JsonRecord = Record<string, unknown>;
export function isAuthorizedWhatsAppCampaignEvent(eventName: string): boolean { return /test/i.test(eventName); }
function text(row: JsonRecord, ...keys: string[]) { for (const key of keys) if (row[key] !== null && row[key] !== undefined && String(row[key]).trim()) return String(row[key]).trim(); return ""; }
async function kv(): Promise<KVNamespace> { const { env } = await getCloudflareContext({ async: true }); if (!env.RACEUPSHOT) throw new Error("RACEUPSHOT KV binding is unavailable."); return env.RACEUPSHOT; }
function key(id: string) { return `${PREFIX}:${encodeURIComponent(id)}`; }
async function index(store: KVNamespace) { return (await store.get<string[]>(INDEX_KEY, "json")) ?? []; }

function projectParticipant(row: JsonRecord, eventName: string): Omit<WhatsAppCampaignRecipient, "status"> | null {
  const mobile = normalizeAiSensyPhone(text(row, "mobile", "mobileNumber", "phone", "phoneNumber", "contactNumber", "whatsapp"));
  if (!mobile) return null;
  const bib = text(row, "bib", "bibNumber", "BIB NO.", "BIB Number");
  return { id: text(row, "id", "participantUid", "participantId", "registrationId", "bookingId") || bib || mobile, name: text(row, "fullName", "name", "athleteName") || "Athlete", email: text(row, "email", "emailAddress"), mobile, bib, category: text(row, "category", "ticketName", "raceCategory", "contestName"), eventName };
}

export async function getWhatsAppAudience(input: Pick<WhatsAppCampaignInput, "eventId" | "targetType" | "participantId" | "categories">): Promise<WhatsAppCampaignRecipient[]> {
  const event = (await getEvents({ includeUnpublished: true })).find((row) => row.id === input.eventId || row.slug === input.eventId);
  if (!event) throw new Error("The selected event was not found.");
  if (!isAuthorizedWhatsAppCampaignEvent(event.name)) throw new Error("WhatsApp campaigns are currently authorized for test events only.");
  const roster = await getAdminParticipantRoster(event.id, { includeUploadedFields: true });
  const rows = (roster?.rows ?? []).flatMap((row) => {
    const participant = projectParticipant(row, event.name); if (!participant) return [];
    if (input.targetType === "SINGLE_PARTICIPANT" && ![participant.id, participant.bib, text(row, "registrationId", "bookingId")].includes(input.participantId)) return [];
    if (input.categories.length && !input.categories.some((category) => category.toLowerCase() === participant.category.toLowerCase())) return [];
    return [{ ...participant, status: "PENDING" as const }];
  });
  const unique = new Map<string, WhatsAppCampaignRecipient>(); for (const row of rows) if (!unique.has(row.mobile)) unique.set(row.mobile, row);
  return [...unique.values()].sort((left, right) => left.name.localeCompare(right.name));
}

export function resolveWhatsAppParameter(value: string, recipient: WhatsAppCampaignRecipient): string {
  return ({ "{{name}}": recipient.name, "{{bib}}": recipient.bib || "N/A", "{{category}}": recipient.category || "N/A", "{{event_name}}": recipient.eventName, "{{email}}": recipient.email || "N/A", "{{mobile}}": recipient.mobile, "{{participant_id}}": recipient.id } as Record<string, string>)[value] ?? value;
}

export async function listWhatsAppCampaigns(): Promise<WhatsAppCampaign[]> { const store = await kv(); const ids = await index(store); const rows = await Promise.all(ids.slice(0, 100).map((id) => store.get<WhatsAppCampaign>(key(id), "json"))); return rows.filter((row): row is WhatsAppCampaign => Boolean(row)); }
export async function createWhatsAppCampaign(input: WhatsAppCampaignInput): Promise<WhatsAppCampaign> {
  const store = await kv(); const recipients = await getWhatsAppAudience(input); const now = new Date().toISOString();
  const row: WhatsAppCampaign = { ...input, id: crypto.randomUUID(), status: recipients.length ? "DRAFT" : "EMPTY", createdAt: now, updatedAt: now, recipients, acceptedCount: 0, failedCount: 0, unconfirmedCount: 0 };
  const ids = await index(store); await Promise.all([store.put(key(row.id), JSON.stringify(row)), store.put(INDEX_KEY, JSON.stringify([row.id, ...ids.filter((id) => id !== row.id)].slice(0, 100)))]); return row;
}
function summarize(campaign: WhatsAppCampaign): WhatsAppCampaign {
  const pending = campaign.recipients.filter((row) => row.status === "PENDING").length; const acceptedCount = campaign.recipients.filter((row) => row.status === "ACCEPTED").length; const failedCount = campaign.recipients.filter((row) => row.status === "FAILED").length; const unconfirmedCount = campaign.recipients.filter((row) => row.status === "UNCONFIRMED").length;
  const status = pending ? "SUBMITTING" : failedCount || unconfirmedCount ? acceptedCount ? "PARTIAL_FAILURE" : "FAILED" : acceptedCount ? "COMPLETED" : "EMPTY";
  return { ...campaign, status, acceptedCount, failedCount, unconfirmedCount, updatedAt: new Date().toISOString() };
}
export async function sendWhatsAppCampaignBatch(id: string, retryFailed = false): Promise<WhatsAppCampaign> {
  const store = await kv(); const campaign = await store.get<WhatsAppCampaign>(key(id), "json"); if (!campaign) throw new Error("WhatsApp campaign was not found.");
  if (retryFailed) campaign.recipients = campaign.recipients.map((row) => ["FAILED", "UNCONFIRMED"].includes(row.status) ? { ...row, status: "PENDING" as const, error: undefined } : row);
  const deliveries = await Promise.all(campaign.recipients.filter((row) => row.status === "PENDING").slice(0, 10).map(async (recipient) => {
    const parameters = campaign.parameters.map((parameter) => resolveWhatsAppParameter(parameter.value, recipient));
    const delivery = await sendAiSensyWhatsApp({ recipientPhone: recipient.mobile, userName: recipient.name, campaignName: campaign.campaignName, parameters, ...(campaign.mediaUrl ? { document: { link: campaign.mediaUrl, filename: campaign.mediaFilename || "attachment" } } : {}) });
    const status: WhatsAppRecipientStatus = delivery.accepted ? "ACCEPTED" : delivery.ambiguous ? "UNCONFIRMED" : "FAILED";
    return { recipient, status, delivery, parameters };
  }));
  const byMobile = new Map(deliveries.map((row) => [row.recipient.mobile, row]));
  campaign.recipients = campaign.recipients.map((recipient) => {
    const result = byMobile.get(recipient.mobile);
    return result ? { ...recipient, status: result.status, attemptedAt: new Date().toISOString(), providerStatus: result.delivery.status, error: result.delivery.error, resolvedParameters: result.parameters } : recipient;
  });
  const result = summarize(campaign); await store.put(key(id), JSON.stringify(result)); return result;
}
export async function sendWhatsAppCampaignTest(input: WhatsAppCampaignInput & { mobile: string }) {
  const sample: WhatsAppCampaignRecipient = { id: "TEST-PARTICIPANT", name: "Test Athlete", email: "test@raceupshot.com", mobile: normalizeAiSensyPhone(input.mobile), bib: "1001", category: "Test Category", eventName: "Race Upshot Test Event", status: "PENDING" };
  if (!sample.mobile) throw new Error("Enter a valid test WhatsApp number."); const parameters = input.parameters.map((parameter) => resolveWhatsAppParameter(parameter.value, sample));
  const result = await sendAiSensyWhatsApp({ recipientPhone: sample.mobile, userName: sample.name, campaignName: input.campaignName, parameters, ...(input.mediaUrl ? { document: { link: input.mediaUrl, filename: input.mediaFilename || "attachment" } } : {}) }); return { ...result, parameters };
}

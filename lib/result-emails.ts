import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { KVNamespace } from "@cloudflare/workers-types";
import { sendBergtecnoEmail } from "./bergtecno-email";
import { normalizeAiSensyPhone, sendAiSensyWhatsApp } from "./aisensy-whatsapp";
import { DEFAULT_RESULTS_CAMPAIGN, resultWhatsAppParameters, resultRaceBreakdown, resultFinishTime, resultLegTimes, validFinishTime, resultPassageIdentity, type ResultLeg } from './finisher-result-template';
import { BERGTECNO_TEMPLATES } from "./email-templates";
import { getLiveTrackingHubConfig } from "./live-tracking-hub-config";
import { getEventBySlug } from "./raceupshot-repository";
import { normalizeRaceStatus } from "@/packages/timing-core/src";
import { z } from "./zod";
import { resultNotificationClaim, completeResultNotification } from './automatic-result-notifications';
import { acceptedConfiguredTerminalSplit, resolveConfiguredFinishers } from './live-leaderboard';

const PREFIX = "raceupshot";
const RESULT_EMAIL_SCHEMA_VERSION = 3;
const FINISHER_NOTIFICATION_SCHEMA_VERSION = 4;
type JsonRecord = Record<string, unknown>;
export type FinisherNotificationChannel = "EMAIL" | "WHATSAPP";

export interface FinisherChannelSummary {
  eligible: number;
  accepted: number;
  failed: number;
  pending: number;
  ineligible: number;
}

export interface ResultEmailSummary {
  eventId: string;
  eventName: string;
  category: string;
  total: number;
  sent: number;
  failed: number;
  pending: number;
  campaignName?: string;
  channels?: { email: FinisherChannelSummary; whatsapp: FinisherChannelSummary };
  finishers?: FinisherTraceRow[];
}

export interface FinisherTraceRow {
  id: string;
  resultId?: string;
  identity?: string;
  contestId?: string;
  eligibilityReason?: string;
  contactAudit?: Array<Record<string, string>>;
  emailAttempts?: Array<{ at: string; state: string; providerStatus?: string; providerResponse?: string; reason?: string; actor: string }>;
  whatsappAttempts?: Array<{ at: string; state: string; providerStatus?: string; providerResponse?: string; reason?: string; actor: string }>;
  bib: string;
  name: string;
  category: string;
  finishTime: string;
  email: string;
  mobile: string;
  emailStatus: "ACCEPTED" | "PENDING" | "FAILED" | "UNCONFIRMED" | "MISSING_CONTACT" | "INELIGIBLE" | "REVIEW_REQUIRED";
  whatsappStatus: "ACCEPTED" | "PENDING" | "FAILED" | "UNCONFIRMED" | "MISSING_CONTACT" | "INELIGIBLE" | "REVIEW_REQUIRED";
  emailError?: string;
  whatsappError?: string;
  emailAttemptedAt?: string;
  whatsappAttemptedAt?: string;
  lastAttemptedAt?: string;
  trigger: "automatic" | "manual";
  actor: "System" | "Admin";
}

export interface ResultEmailRecipient {
  id: string;
  email: string;
  mobile?: string;
  name: string;
  bib: string;
  category: string;
  finishTime: string;
  overallRank: string;
  genderRank: string;
  categoryRank: string;
  gender: string;
  legTimes?: ResultLeg[];
}

interface DeliveryRecord {
  status: "SENT" | "ACCEPTED" | "FAILED" | "SENDING";
  attemptedAt: string;
  error?: string;
  schemaVersion?: number;
  channel?: FinisherNotificationChannel;
  campaignName?: string;
  providerStatus?: string;
  trigger?: "automatic" | "manual";
  actor?: "System" | "Admin";
}

async function getKv(): Promise<KVNamespace> {
  const { env } = await getCloudflareContext({ async: true });
  if (!env.RACEUPSHOT) throw new Error("RACEUPSHOT KV binding is unavailable.");
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

function text(row: JsonRecord, ...keys: string[]): string {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
  }
  return "";
}

function rank(row: JsonRecord, ...keys: string[]): string {
  const value = text(row, ...keys);
  const numeric = Number(value.replace(/,/g, ""));
  return Number.isFinite(numeric) && numeric > 0 ? String(Math.trunc(numeric)) : value;
}

function finishTime(row: JsonRecord): string {
  const storedSeconds = Number(text(row, "overallTime", "chipTime"));
  if (Number.isFinite(storedSeconds) && storedSeconds > 0) {
    const seconds = Math.round(storedSeconds);
    return [Math.floor(seconds / 3600), Math.floor((seconds % 3600) / 60), seconds % 60]
      .map((part) => String(part).padStart(2, "0"))
      .join(":");
  }
  const raw = text(row, "finishTime", "finish_time", "Chip Time", "chip time", "netTime", "Gun Time");
  if (!raw) return "";
  const numeric = Number(raw);
  if (Number.isFinite(numeric) && numeric > 0) {
    const seconds = Math.round(numeric < 2 ? numeric * 86400 : numeric);
    return [Math.floor(seconds / 3600), Math.floor((seconds % 3600) / 60), seconds % 60]
      .map((part) => String(part).padStart(2, "0"))
      .join(":");
  }
  const parts = raw.split(":");
  return parts.length === 2 ? `00:${parts.map((part) => part.padStart(2, "0")).join(":")}` : raw;
}

function isFinishedResult(row: JsonRecord): boolean {
  const rawStatus = text(row, "status", "Status", "raceStatus");
  const normalized = normalizeRaceStatus(rawStatus);
  return normalized === "FINISHED" && validFinishTime(finishTime(row));
}

function legacyNotificationKey(eventId: string, resultId: string) {
  return `${PREFIX}:notification:results:${eventId}:${encodeURIComponent(resultId)}`;
}

export function finisherNotificationKey(eventId: string, resultId: string, channel: FinisherNotificationChannel) {
  return `${legacyNotificationKey(eventId, resultId)}:${channel.toLowerCase()}`;
}

async function recipients(eventId: string, category: string): Promise<ResultEmailRecipient[]> {
  const kv = await getKv();
  const prefix = `${PREFIX}:event:${eventId}:result:`;
  const keys = await listKeys(kv, prefix);
  const rows = await Promise.all(keys.map((key) => kv.get<JsonRecord>(key, "json")));
  const members = rows.flatMap((row, index) => {
    if (!row) return [];
    const email = text(row, "email", "Email", "emailAddress", "Email Address", "athleteEmail", "userEmail").toLowerCase();
    const mobile = normalizeAiSensyPhone(text(row, "mobile", "Mobile", "phone", "Phone", "whatsapp", "WhatsApp", "mobileNumber", "phoneNumber"));
    const resultCategory = text(row, "category", "Category", "RACE CAT", "raceCategory");
    if (!isFinishedResult(row) || (category && category !== "Overall" && resultCategory.toLowerCase() !== category.toLowerCase())) return [];
    return [{
      id: keys[index].slice(prefix.length),
      email,
      mobile,
      name: text(row, "name", "Name", "athleteName", "fullName") || "Athlete",
      bib: text(row, "bib", "Bib Number", "bibNumber"),
      category: resultCategory,
      finishTime: finishTime(row),
      overallRank: rank(row, "overallRank", "overall_rank", "O Rank", "rank"),
      genderRank: rank(row, "genderRank", "gender_rank", "G Rank"),
      categoryRank: rank(row, "categoryRank", "category_rank", "C Rank"),
      gender: text(row, "gender", "Gender", "sex"),
      legTimes: Array.isArray(row.legTimes) ? row.legTimes as ResultLeg[] : [],
    }];
  });
  // Published results and live timing can complete at different times. Merge
  // both sources so one uploaded result can never hide other canonical
  // finishers. The contest+BIB identity is also the provider deduplication key.
  const published = uniqueRaceRecipients(members);
  const canonical = await canonicalRecipients(eventId, category);
  const merged = new Map<string, ResultEmailRecipient>();
  for (const member of canonical) {
    const identity = resultPassageIdentity(member.bib, member.category);
    if (identity) merged.set(identity, member);
  }
  for (const member of published) {
    const identity = resultPassageIdentity(member.bib, member.category);
    if (!identity) continue;
    const live = merged.get(identity);
    merged.set(identity, {
      ...live,
      ...member,
      email: member.email || live?.email || '',
      mobile: member.mobile || live?.mobile,
      legTimes: mergeResultLegTimes(member.legTimes, live?.legTimes),
    });
  }
  return [...merged.values()];
}

function mergeResultLegTimes(published?: ResultLeg[], live?: ResultLeg[]): ResultLeg[] | undefined {
  if (!published?.length) return live;
  if (!live?.length) return published;
  const publishedByName = new Map(published.map(leg => [leg.name.trim().toLowerCase(), leg]));
  // Keep published sport times, but do not let a partial upload erase verified live transitions.
  const merged = live.map(leg => publishedByName.get(leg.name.trim().toLowerCase()) ?? leg);
  const liveNames = new Set(live.map(leg => leg.name.trim().toLowerCase()));
  return [...merged, ...published.filter(leg => !liveNames.has(leg.name.trim().toLowerCase()))];
}

function uniqueRaceRecipients(members: ResultEmailRecipient[]) {
  const counts = new Map<string, number>();
  for (const member of members) {
    const identity = resultPassageIdentity(member.bib, member.category);
    if (identity) counts.set(identity, (counts.get(identity) || 0) + 1);
  }
  // No BIB-only deduplication or guessing across contests.
  return members.filter(member => counts.get(resultPassageIdentity(member.bib, member.category) || '') === 1);
}

async function canonicalRecipients(eventId: string, category: string): Promise<ResultEmailRecipient[]> {
  const [{ getCanonicalLiveEvent }, { applyParticipantRegistrationEnrichment }] = await Promise.all([import('./canonical-live-tracking'), import('./participant-roster-import')]);
  const [canonical, config, kv] = await Promise.all([getCanonicalLiveEvent(eventId), getLiveTrackingHubConfig(eventId), getKv()]);
  if (!canonical || !config) return [];
  const orderedSplits = [...config.splits].sort((a, b) => a.order - b.order);
  const configuredFinishPointIds = new Set((config.timingPoints ?? [])
    .filter(point => point.type === 'FINISH')
    .map(point => point.id));
  // The physical race finish is authoritative. It is not necessarily the last
  // row in the split editor: imported rules can contain hidden/diagnostic rows
  // after it, and a shared mat can be used by earlier passages as well.
  const explicitlyConfiguredFinalSplits = orderedSplits.filter(split => split.isFinalRaceSplit === true);
  const configuredFinalSplit = explicitlyConfiguredFinalSplits.length === 1
    ? explicitlyConfiguredFinalSplits[0]
    : configuredFinishPointIds.size > 0
      ? orderedSplits.filter(split => configuredFinishPointIds.has(split.timingPointId ?? '')).at(-1)
      : orderedSplits.at(-1); // Legacy configurations pre-date explicit final splits.
  if (!configuredFinalSplit) return [];
  const finalSplitIndex = orderedSplits.findIndex(split => split.id === configuredFinalSplit.id);
  const finishSequence = orderedSplits.slice(0, finalSplitIndex + 1);
  const participants = resolveConfiguredFinishers(canonical.participants, finishSequence, { preserveDnf: true });
  // Registration rows intentionally remain separate from the canonical timing
  // roster. Reuse the event's validated, unique-BIB enrichment path solely to
  // attach delivery contacts to the matching canonical athlete.
  const enriched = await applyParticipantRegistrationEnrichment(kv, eventId, participants as unknown as JsonRecord[]);
  return uniqueRaceRecipients(participants.flatMap((participant, participantIndex) => {
    const terminalSplit = acceptedConfiguredTerminalSplit(participant, finishSequence);
    if (participant.raceStatus !== 'FINISHED'
      || !validFinishTime(participant.elapsedTime || '')
      || !terminalSplit
      || !(terminalSplit.timestamp || terminalSplit.readerTimestamp)) return [];
    if (category !== 'Overall' && participant.contestName.toLowerCase() !== category.toLowerCase()) return [];
    const row = enriched[participantIndex] ?? {};
    const legTimes = resultLegTimes(config.legs, config.splits, participant.splits);
    return [{ id: participant.participantUid, name: participant.fullName || participant.displayName,
      email: text(row, 'email', 'emailAddress').toLowerCase(), mobile: normalizeAiSensyPhone(text(row, 'mobile', 'phone', 'mobileNumber')),
      bib: participant.bib, category: participant.contestName, finishTime: participant.elapsedTime!, gender: participant.gender || '',
      overallRank: String(participant.overallRank || ''), genderRank: String(participant.genderRank || ''), categoryRank: String(participant.ageGroupRank || ''), legTimes }];
  }));
}

function validEmail(email: string): boolean {
  return z.string().email().safeParse(email).success;
}

function eligible(member: ResultEmailRecipient, channel: FinisherNotificationChannel): boolean {
  if (!validFinishTime(member.finishTime)) return false;
  return channel === "EMAIL" ? validEmail(member.email) : Boolean(member.mobile);
}

async function deliveryRecord(kv: KVNamespace, eventId: string, memberId: string, channel: FinisherNotificationChannel): Promise<DeliveryRecord | null> {
  const current = await kv.get<DeliveryRecord>(finisherNotificationKey(eventId, memberId, channel), "json");
  if (current) return current;
  return channel === "EMAIL" ? kv.get<DeliveryRecord>(legacyNotificationKey(eventId, memberId), "json") : null;
}

function accepted(record: DeliveryRecord | null): boolean {
  return record?.status === "ACCEPTED" || (record?.schemaVersion === RESULT_EMAIL_SCHEMA_VERSION && record.status === "SENT");
}

function traceStatus(member: ResultEmailRecipient, record: DeliveryRecord | null, channel: FinisherNotificationChannel): FinisherTraceRow["emailStatus"] {
  if (!eligible(member, channel)) return "MISSING_CONTACT";
  if (accepted(record)) return "ACCEPTED";
  if (record?.status === "FAILED") return "FAILED";
  if (record?.status === "SENDING") return "UNCONFIRMED";
  return "PENDING";
}

function summarizeChannel(members: ResultEmailRecipient[], records: Array<DeliveryRecord | null>, channel: FinisherNotificationChannel): FinisherChannelSummary {
  const indexes = members.map((member, index) => ({ member, index })).filter(({ member }) => eligible(member, channel));
  return {
    eligible: indexes.length,
    accepted: indexes.filter(({ index }) => accepted(records[index])).length,
    failed: indexes.filter(({ index }) => ['FAILED', 'SENDING'].includes(records[index]?.status || '')).length,
    pending: indexes.filter(({ index }) => !records[index]).length,
    ineligible: members.length - indexes.length,
  };
}

function notificationSummary(
  event: { id: string; name: string },
  category: string,
  members: ResultEmailRecipient[],
  emailRecords: Array<DeliveryRecord | null>,
  whatsappRecords: Array<DeliveryRecord | null>,
  channels: FinisherNotificationChannel[],
  campaignName?: string,
): ResultEmailSummary {
  const email = summarizeChannel(members, emailRecords, "EMAIL");
  const whatsapp = summarizeChannel(members, whatsappRecords, "WHATSAPP");
  const selected = channels.map((channel) => channel === "EMAIL" ? email : whatsapp);
  return {
    eventId: event.id,
    eventName: event.name,
    category,
    total: members.length,
    sent: selected.reduce((sum, item) => sum + item.accepted, 0),
    failed: selected.reduce((sum, item) => sum + item.failed, 0),
    pending: selected.reduce((sum, item) => sum + item.pending, 0),
    campaignName,
    channels: { email, whatsapp },
    finishers: members.map((member, index) => {
      const emailRecord = emailRecords[index];
      const whatsappRecord = whatsappRecords[index];
      const latestRecord = [emailRecord, whatsappRecord]
        .filter((record): record is DeliveryRecord => Boolean(record))
        .sort((left, right) => left.attemptedAt.localeCompare(right.attemptedAt))
        .at(-1);
      return {
        id: member.id,
        bib: member.bib,
        name: member.name,
        category: member.category,
        finishTime: member.finishTime,
        email: member.email,
        mobile: member.mobile || "",
        emailStatus: traceStatus(member, emailRecord, "EMAIL"),
        whatsappStatus: traceStatus(member, whatsappRecord, "WHATSAPP"),
        emailAttemptedAt: emailRecord?.attemptedAt,
        whatsappAttemptedAt: whatsappRecord?.attemptedAt,
        lastAttemptedAt: latestRecord?.attemptedAt,
        trigger: latestRecord?.trigger ?? "automatic",
        actor: latestRecord?.actor ?? "System",
        ...(emailRecord?.error ? { emailError: emailRecord.error } : {}),
        ...(whatsappRecord?.error ? { whatsappError: whatsappRecord.error } : {}),
      };
    }),
  };
}

export async function getFinisherNotificationSummary(
  eventId: string,
  category = "Overall",
  channels: FinisherNotificationChannel[] = ["EMAIL", "WHATSAPP"],
): Promise<ResultEmailSummary> {
  return (await import('./safe-finisher-notifications')).safeFinisherSummary(eventId, category, channels);
}

export async function getFinisherNotificationSummaries(
  eventId: string,
  categories: string[],
  channels: FinisherNotificationChannel[] = ["EMAIL", "WHATSAPP"],
): Promise<Record<string, ResultEmailSummary>> {
  return (await import('./safe-finisher-notifications')).safeFinisherSummaries(eventId, categories, channels);
}

export function buildResultEmailTemplateVariables(
  member: ResultEmailRecipient,
  event: { name: string; slug: string; date?: string; location?: string },
): Record<string, unknown> {
  return {
    athletename: member.name,
    athleteName: member.name,
    athlete_name: member.name,
    eventname: event.name,
    eventName: event.name,
    event_name: event.name,
    bib: member.bib,
    bib_number: member.bib,
    category: member.category,
    race_category: member.category,
    gender: member.gender,
    finishTime: resultFinishTime(member.finishTime),
    finish_time: resultFinishTime(member.finishTime),
    name: member.name,
    race_breakdown: resultRaceBreakdown(member.legTimes),
    results_url: `https://raceupshot.com/results/${event.slug}`,
    overallRank: member.overallRank,
    overall_rank: member.overallRank,
    genderRank: member.genderRank,
    gender_rank: member.genderRank,
    categoryRank: member.categoryRank,
    category_rank: member.categoryRank,
    event_date: event.date || "",
    event_location: event.location || "",
    resultUrl: `https://raceupshot.com/results/${event.slug}`,
    result_url: `https://raceupshot.com/results/${event.slug}`,
    year: new Date().getFullYear(),
  };
}

export async function getResultEmailSummary(eventId: string, category = "Overall"): Promise<ResultEmailSummary> {
  const summary = await getFinisherNotificationSummary(eventId, category, ["EMAIL"]);
  const email = summary.channels!.email;
  return { ...summary, total: email.eligible, sent: email.accepted, failed: email.failed, pending: email.pending };
}

export async function sendResultEmailBatch(_eventId: string, _category = "Overall", _retryFailed = false): Promise<ResultEmailSummary> {
  throw new Error('Use the confirmed finisher notification action with an explicit channel and dry-run preview.');
}

export async function sendFinisherNotificationBatch(
  eventId: string,
  category: string,
  channels: FinisherNotificationChannel[],
  retryFailed = false,
  options: { bib?: string; resultId?: string; trigger?: "automatic" | "manual"; forceResend?: boolean; confirmed?: boolean } = {},
): Promise<ResultEmailSummary> {
  if (options.bib) throw new Error('Select an exact result row; BIB alone cannot identify a recipient.');
  return (await import('./safe-finisher-notifications')).safeSendFinisherBatch(eventId, category, channels, retryFailed, options);
}

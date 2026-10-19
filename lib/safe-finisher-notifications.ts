import { getCloudflareContext } from '@opennextjs/cloudflare';
import type { KVNamespace } from '@cloudflare/workers-types';
import { z } from './zod';
import { getAdminParticipantRoster } from './participant-chip-assignments';
import { getEventBySlug } from './raceupshot-repository';
import { getLiveTrackingHubConfig, type LiveTrackingHubConfig } from './live-tracking-hub-config';
import { finisherEligibility, notificationIdentity, type NotificationActor, type NotificationLedgerRecord, type TransactionalChannel } from './transactional-notification-contract';
import { assertTransactionalSendsEnabled } from './transactional-notification-gate';
import { claimNotification, completeNotification, correctNotificationContact, readNotificationContacts, readNotificationLedger, recordNotificationSkip } from './transactional-notification-ledger';
import { sendBergtecnoEmail } from './bergtecno-email';
import { normalizeAiSensyPhone, sendAiSensyWhatsApp } from './aisensy-whatsapp';
import { resultWhatsAppParameters, resultRaceBreakdown, resultFinishTime, type ResultLeg } from './finisher-result-template';
import type { FinisherNotificationChannel, FinisherTraceRow, ResultEmailRecipient, ResultEmailSummary } from './result-emails';
import { reconcileCanonicalFinisherResults } from './canonical-finisher-publication';

type Row = Record<string, unknown>;
type Event = NonNullable<Awaited<ReturnType<typeof getEventBySlug>>>;
type Contact = { email: string; mobile: string; audit: Array<Record<string, string>> };
interface Recipient extends ResultEmailRecipient { identity: string; resultId: string; ledgerParticipantId: string; rawSourceId: string; stableSourceIdentity: boolean; contestId: string; eligible: boolean; eligibilityReason: string; triathlon: boolean; legacyEmailAccepted: boolean; legacyWhatsappAccepted: boolean; contactAudit: Array<Record<string, string>> }

const text = (row: Row, ...keys: string[]) => keys.map((key) => row[key]).find((item) => item !== null && item !== undefined && String(item).trim())?.toString().trim() ?? '';
const isEmail = (value: string) => z.string().email().safeParse(value).success;
const ledgerKey = (identity: string, channel: TransactionalChannel) => `${channel}:${identity}`;
const notificationKey = (eventId: string, resultId: string, channel: TransactionalChannel) => `raceupshot:notification:results:${eventId}:${encodeURIComponent(resultId)}:${channel.toLowerCase()}`;

async function getKv(): Promise<KVNamespace> {
  const { env } = await getCloudflareContext({ async: true });
  if (!env.RACEUPSHOT) throw new Error('Result storage is unavailable.');
  return env.RACEUPSHOT;
}

function notificationContest(event: Event, config: LiveTrackingHubConfig | null, row: Row, category: string): { contestId: string; category: string } {
  const explicit = text(row, 'ticketId', 'contestId', 'providerContestUuid');
  const mapping = config?.contestMappings?.find((item) => item.providerContestUuid === explicit || item.contestId === explicit || item.contestId.toLowerCase() === category.toLowerCase());
  const mappedCategory = mapping?.contestId || category;
  const candidates = [...(event.tickets ?? []), ...(event.ticketDefinitions ?? [])].filter((ticket) => ticket.name.toLowerCase() === mappedCategory.toLowerCase() || ticket.id.toLowerCase() === mappedCategory.toLowerCase());
  return { contestId: candidates.length === 1 ? candidates[0].id : mapping?.contestId || explicit || category, category: candidates.length === 1 ? candidates[0].name : mappedCategory };
}

function isTriathlon(event: Event, contestId: string, category: string, providerCategory: string, row: Row): boolean {
  const resultLegs = Array.isArray(row.legTimes) ? row.legTimes as ResultLeg[] : [];
  const resultLegNames = new Set(resultLegs.map((leg) => leg.name.trim().toUpperCase()));
  if (['SWIM', 'BIKE', 'RUN'].every((name) => resultLegNames.has(name))) return true;
  const ticket = (event.ticketDefinitions ?? []).find((item) => item.id === contestId || item.name.toLowerCase() === category.toLowerCase());
  if (ticket?.legs.length) return ['SWIM', 'BIKE', 'RUN'].every((type) => ticket.legs.some((leg) => leg.type === type));
  return /triathlon|ironman/i.test(`${category} ${providerCategory}`);
}

function duration(row: Row): string {
  const seconds = Number(row.overallTime ?? row.chipTime ?? 0);
  if (Number.isFinite(seconds) && seconds > 0) {
    const rounded = Math.round(seconds);
    return [Math.floor(rounded / 3600), Math.floor(rounded % 3600 / 60), rounded % 60].map((part) => String(part).padStart(2, '0')).join(':');
  }
  return resultFinishTime(text(row, 'finishTime', 'finish_time'));
}

function legacyAccepted(record: unknown): boolean {
  if (!record || typeof record !== 'object') return false;
  const value = record as { status?: string; schemaVersion?: number };
  return value.status === 'ACCEPTED' || (value.status === 'SENT' && value.schemaVersion === 3);
}

async function loadRecipients(event: Event, config: LiveTrackingHubConfig | null, filterCategory: string, contacts: Record<string, Contact>): Promise<Recipient[]> {
  if (!event.hasResults || ['draft', 'archived'].includes(String(event.status ?? '').toLowerCase())) return [];
  const kv = await getKv();
  const ids = await kv.get<string[]>(`raceupshot:event:${event.id}:results:index`, 'json') ?? [];
  const [rawRows, roster] = await Promise.all([
    Promise.all(ids.map((id) => kv.get<Row>(`raceupshot:event:${event.id}:result:${id}`, 'json'))),
    getAdminParticipantRoster(event.id).catch(() => null),
  ]);
  const registrationById = new Map((roster?.rows ?? []).flatMap((row) => {
    const id = text(row, 'participantUid', 'participantUuid', 'id');
    return id ? [[id, row] as const] : [];
  }));
  const sourceCounts = new Map<string, number>();
  for (const row of rawRows) {
    if (!row) continue;
    const sourceId = text(row, 'notificationSourceId');
    if (!sourceId) continue;
    const rawCategory = text(row, 'category', 'Category', 'contestName');
    const key = `${notificationContest(event, config, row, rawCategory).contestId}:${sourceId}`;
    sourceCounts.set(key, (sourceCounts.get(key) ?? 0) + 1);
  }
  const rows = rawRows.flatMap((row, index) => {
    if (!row) return [];
    const resultId = ids[index];
    const providerCategory = text(row, 'providerContestName', 'category', 'Category', 'contestName');
    const rawCategory = text(row, 'category', 'Category', 'contestName');
    if (!rawCategory) return [];
    const contest = notificationContest(event, config, row, rawCategory);
    const { contestId, category } = contest;
    if (filterCategory !== 'Overall' && category.toLowerCase() !== filterCategory.toLowerCase() && rawCategory.toLowerCase() !== filterCategory.toLowerCase()) return [];
    const claimedSourceId = text(row, 'notificationSourceId');
    const bib = text(row, 'bib', 'Bib Number', 'bibNumber');
    const sourceId = claimedSourceId && claimedSourceId.toLowerCase() !== bib.toLowerCase()
      && sourceCounts.get(`${contestId}:${claimedSourceId}`) === 1 ? claimedSourceId : '';
    const ledgerParticipantId = sourceId || `${resultId}:${text(row, 'importedAt') || 'legacy'}`;
    const identity = notificationIdentity(event.id, contestId, ledgerParticipantId, 'FINISHER');
    if (!identity) return [];
    const participantId = text(row, 'participantUid', 'participantUuid', 'participantId');
    const registered = participantId ? registrationById.get(participantId) : undefined;
    const matchingRegistration = registered && (text(registered, 'ticketId') === contestId || text(registered, 'ticketName').toLowerCase() === category.toLowerCase()) ? registered : undefined;
    const override = contacts[identity];
    const email = (override?.email ?? (text(row, 'email', 'Email', 'emailAddress') || text(matchingRegistration ?? {}, 'email'))).toLowerCase();
    const mobile = normalizeAiSensyPhone(override?.mobile ?? (text(row, 'mobile', 'Mobile', 'phone', 'whatsapp') || text(matchingRegistration ?? {}, 'mobile')));
    const triathlon = isTriathlon(event, contestId, category, providerCategory, row);
    const eligibility = finisherEligibility(row, triathlon);
    const legTimes = Array.isArray(row.legTimes) ? row.legTimes as ResultLeg[] : [];
    return [{ id: resultId, resultId, ledgerParticipantId, rawSourceId: claimedSourceId, stableSourceIdentity: Boolean(sourceId), identity, contestId, email, mobile, name: text(row, 'name', 'Name', 'fullName') || 'Athlete', bib, category,
      finishTime: duration(row), overallRank: text(row, 'overallRank'), genderRank: text(row, 'genderRank'), categoryRank: text(row, 'categoryRank'), gender: text(row, 'gender'), legTimes,
      eligible: eligibility.eligible, eligibilityReason: eligibility.reason, triathlon, legacyEmailAccepted: false, legacyWhatsappAccepted: false, contactAudit: override?.audit ?? [] } satisfies Recipient];
  });
  const acceptedRecords = await Promise.all(rows.flatMap((member) => [
    kv.get(notificationKey(event.id, member.resultId, 'EMAIL'), 'json'),
    kv.get(notificationKey(event.id, member.resultId, 'WHATSAPP'), 'json'),
    kv.get(`raceupshot:notification:results:${event.id}:${encodeURIComponent(member.resultId)}`, 'json'),
  ]));
  return rows.map((member, index) => ({ ...member, legacyEmailAccepted: legacyAccepted(acceptedRecords[index * 3]) || legacyAccepted(acceptedRecords[index * 3 + 2]), legacyWhatsappAccepted: legacyAccepted(acceptedRecords[index * 3 + 1]) }));
}

function stateFor(member: Recipient, channel: TransactionalChannel, record: NotificationLedgerRecord | undefined): FinisherTraceRow['emailStatus'] {
  if (record?.status === 'PROVIDER_ACCEPTED' || record?.attempts.some((attempt) => attempt.state === 'PROVIDER_ACCEPTED') || (channel === 'EMAIL' ? member.legacyEmailAccepted : member.legacyWhatsappAccepted)) return 'ACCEPTED';
  if (!member.eligible) return 'INELIGIBLE';
  if (channel === 'EMAIL' ? !isEmail(member.email) : !member.mobile) return 'MISSING_CONTACT';
  if (record?.status === 'FAILED') return 'FAILED';
  if (record?.status === 'UNCONFIRMED' || record?.status === 'CLAIMED') return 'UNCONFIRMED';
  if (!member.stableSourceIdentity) return 'REVIEW_REQUIRED';
  return 'PENDING';
}

function channelSummary(rows: FinisherTraceRow[], channel: TransactionalChannel) {
  const statuses = rows.map((row) => channel === 'EMAIL' ? row.emailStatus : row.whatsappStatus);
  return { eligible: statuses.filter((status) => !['INELIGIBLE', 'MISSING_CONTACT'].includes(status)).length,
    accepted: statuses.filter((status) => status === 'ACCEPTED').length,
    failed: statuses.filter((status) => status === 'FAILED' || status === 'UNCONFIRMED').length,
    pending: statuses.filter((status) => status === 'PENDING').length,
    ineligible: statuses.filter((status) => status === 'INELIGIBLE' || status === 'MISSING_CONTACT' || status === 'REVIEW_REQUIRED').length };
}

async function loaded(eventId: string, category: string) {
  await reconcileCanonicalFinisherResults(eventId).catch((error) => console.error(JSON.stringify({ type: 'canonical_finisher_reconciliation_failed', eventId, error: error instanceof Error ? error.message : String(error) })));
  const event = await getEventBySlug(eventId, { includeUnpublished: true });
  if (!event) throw new Error('Event not found.');
  const [ledger, contacts, config] = await Promise.all([readNotificationLedger(event.id), readNotificationContacts(event.id), getLiveTrackingHubConfig(event.id)]);
  const members = await loadRecipients(event, config, category, contacts);
  const byKey = new Map(ledger.map((record) => [ledgerKey(record.identity, record.channel), record]));
  return { event, config, members, byKey };
}

function summaryFromLoaded(data: Awaited<ReturnType<typeof loaded>>, category: string, channels: TransactionalChannel[]): ResultEmailSummary {
  const { event, members, byKey } = data;
  const finishers: FinisherTraceRow[] = members.map((member) => {
    const email = byKey.get(ledgerKey(member.identity, 'EMAIL'));
    const whatsapp = byKey.get(ledgerKey(member.identity, 'WHATSAPP'));
    const latest = [email, whatsapp].filter((record): record is NotificationLedgerRecord => Boolean(record)).sort((a, b) => a.updatedAt.localeCompare(b.updatedAt)).at(-1);
    return { id: member.id, resultId: member.resultId, identity: member.identity, contestId: member.contestId, bib: member.bib, name: member.name, category: member.category, finishTime: member.finishTime, contactAudit: member.contactAudit,
      email: member.email, mobile: member.mobile || '', eligibilityReason: member.eligibilityReason,
      emailStatus: stateFor(member, 'EMAIL', email), whatsappStatus: stateFor(member, 'WHATSAPP', whatsapp),
      emailAttemptedAt: email?.updatedAt, whatsappAttemptedAt: whatsapp?.updatedAt, lastAttemptedAt: latest?.updatedAt,
      emailError: email?.attempts.at(-1)?.reason, whatsappError: whatsapp?.attempts.at(-1)?.reason,
      emailAttempts: email?.attempts.map(({ at, state, providerStatus, providerResponse, reason, actor }) => ({ at, state, providerStatus, providerResponse, reason, actor })),
      whatsappAttempts: whatsapp?.attempts.map(({ at, state, providerStatus, providerResponse, reason, actor }) => ({ at, state, providerStatus, providerResponse, reason, actor })),
      trigger: latest?.attempts.at(-1)?.actor === 'ADMIN' ? 'manual' : 'automatic', actor: latest?.attempts.at(-1)?.actor === 'ADMIN' ? 'Admin' : 'System' };
  });
  const email = channelSummary(finishers, 'EMAIL');
  const whatsapp = channelSummary(finishers, 'WHATSAPP');
  const selected = channels.map((channel) => channel === 'EMAIL' ? email : whatsapp);
  return { eventId: event.id, eventName: event.name, category, total: finishers.length, sent: selected.reduce((sum, item) => sum + item.accepted, 0), failed: selected.reduce((sum, item) => sum + item.failed, 0), pending: selected.reduce((sum, item) => sum + item.pending, 0), channels: { email, whatsapp }, finishers, campaignName: data.config?.notifications.campaignName };
}

export async function safeFinisherSummary(eventId: string, category = 'Overall', channels: TransactionalChannel[] = ['EMAIL', 'WHATSAPP']): Promise<ResultEmailSummary> {
  return summaryFromLoaded(await loaded(eventId, category), category, channels);
}

export async function safeFinisherSummaries(eventId: string, categories: string[], channels: TransactionalChannel[]): Promise<Record<string, ResultEmailSummary>> {
  const data = await loaded(eventId, 'Overall');
  const publishedCategories = data.members.map((member) => member.category).filter(Boolean);
  return Object.fromEntries([...new Set(['Overall', ...categories, ...publishedCategories])].map((category) => [category, summaryFromLoaded({ ...data, members: category === 'Overall' ? data.members : data.members.filter((member) => member.category.toLowerCase() === category.toLowerCase()) }, category, channels)]));
}

function templateFor(config: NonNullable<Awaited<ReturnType<typeof getLiveTrackingHubConfig>>>, channel: TransactionalChannel, triathlon: boolean): string {
  const notifications = config.notifications;
  if (channel === 'EMAIL') return (triathlon ? notifications.emailTriathlonTemplateId : notifications.emailSingleSportTemplateId) || notifications.emailTemplateId || '';
  return (triathlon ? notifications.whatsappTriathlonCampaignName : notifications.whatsappSingleSportCampaignName) || notifications.whatsappCampaignName || '';
}

export async function safeSendFinisherBatch(eventId: string, category: string, channels: FinisherNotificationChannel[], retryFailed = false, options: { resultId?: string; trigger?: 'automatic' | 'manual'; forceResend?: boolean; confirmed?: boolean } = {}): Promise<ResultEmailSummary> {
  const data = await loaded(eventId, category);
  const { event, config, members, byKey } = data;
  if (!config?.notifications.enabled || !config.notifications.finishersEnabled) throw new Error('Enable finisher notifications for this event before sending.');
  const selected = [...new Set(channels)];
  if (!selected.length) throw new Error('Select email, WhatsApp, or both.');
  for (const channel of selected) {
    if (channel === 'EMAIL' && !config.notifications.emailEnabled) throw new Error('Email is not enabled for this event.');
    if (channel === 'WHATSAPP' && !config.notifications.whatsappEnabled) throw new Error('WhatsApp is not enabled for this event.');
  }
  const target = options.resultId ? members.filter((member) => member.resultId === options.resultId) : members;
  if (options.resultId && target.length !== 1) throw new Error('The exact selected result was not found in this event and contest.');
  if (options.trigger !== 'automatic' && !options.confirmed) throw new Error('Confirm the dry-run count before sending.');
  await assertTransactionalSendsEnabled();
  const actor: NotificationActor = options.trigger === 'automatic' ? 'SYSTEM' : 'ADMIN';
  for (const channel of selected) for (const member of target) {
    const reason = !member.eligible ? member.eligibilityReason : channel === 'EMAIL' && !isEmail(member.email) ? 'MISSING_EMAIL' : channel === 'WHATSAPP' && !member.mobile ? 'MISSING_WHATSAPP' : '';
    const effectiveReason = reason || (!member.stableSourceIdentity && !options.resultId ? 'MISSING_STABLE_RESULT_ID' : '');
    if (effectiveReason) await recordNotificationSkip({ eventId: event.id, contestId: member.contestId, participantId: member.ledgerParticipantId, identity: member.identity, kind: 'FINISHER', channel, recipient: (channel === 'EMAIL' ? member.email : member.mobile) || '', actor, reason: effectiveReason });
  }
  const jobs = selected.flatMap((channel) => target.filter((member) => {
    if (!member.eligible || (!member.stableSourceIdentity && !options.resultId) || !(channel === 'EMAIL' ? isEmail(member.email) : member.mobile)) return false;
    const current = byKey.get(ledgerKey(member.identity, channel));
    if (!current) return !(channel === 'EMAIL' ? member.legacyEmailAccepted : member.legacyWhatsappAccepted) || (actor === 'ADMIN' && options.forceResend && options.confirmed);
    const everAccepted = current.attempts.some((attempt) => attempt.state === 'PROVIDER_ACCEPTED');
    if (everAccepted) return actor === 'ADMIN' && options.forceResend && options.confirmed;
    return current.status === 'FAILED' ? actor === 'ADMIN' && (retryFailed || options.forceResend) && options.confirmed
      : current.status === 'PROVIDER_ACCEPTED' ? actor === 'ADMIN' && options.forceResend && options.confirmed : current.status === 'PENDING' || current.status === 'SKIPPED';
  }).slice(0, 10).map((member) => ({ channel, member })));
  for (const { channel, member } of jobs) {
    const template = templateFor(config, channel, member.triathlon);
    if (!template) throw new Error(`${channel} ${member.triathlon ? 'triathlon' : 'single-sport'} template/campaign is not configured.`);
    const recipient = channel === 'EMAIL' ? member.email : member.mobile || '';
    const claim = await claimNotification({ eventId: event.id, contestId: member.contestId, participantId: member.ledgerParticipantId, identity: member.identity, kind: 'FINISHER', channel, recipient, actor,
      retryFailed, forceResend: options.forceResend, confirmed: options.confirmed, legacyAccepted: channel === 'EMAIL' ? member.legacyEmailAccepted : member.legacyWhatsappAccepted });
    if (!claim.token) continue;
    const [latest, activeEvent, freshContacts] = await Promise.all([
      (await getKv()).get<Row>(`raceupshot:event:${event.id}:result:${member.resultId}`, 'json'),
      getEventBySlug(event.id, { includeUnpublished: true }),
      readNotificationContacts(event.id),
    ]);
    const currentContact = freshContacts[member.identity];
    const latestEmail = latest ? text(latest, 'email', 'Email', 'emailAddress').toLowerCase() : '';
    const latestMobile = latest ? normalizeAiSensyPhone(text(latest, 'mobile', 'Mobile', 'phone', 'whatsapp')) : '';
    const contactUnchanged = channel === 'EMAIL'
      ? (currentContact?.email ?? (latestEmail || member.email)).toLowerCase() === recipient
      : normalizeAiSensyPhone(currentContact?.mobile ?? (latestMobile || member.mobile)) === recipient;
    const sourceUnchanged = latest && text(latest, 'notificationSourceId') === member.rawSourceId
      && text(latest, 'name', 'Name', 'fullName') === member.name
      && text(latest, 'bib', 'Bib Number', 'bibNumber') === member.bib;
    const latestContest = latest ? notificationContest(event, config, latest, text(latest, 'category', 'Category', 'contestName')) : null;
    const stillEligible = activeEvent?.hasResults && !['draft', 'archived'].includes(String(activeEvent.status ?? '').toLowerCase()) && latest && finisherEligibility(latest, member.triathlon).eligible
      && latestContest?.category.toLowerCase() === member.category.toLowerCase() && sourceUnchanged && contactUnchanged;
    if (!stillEligible) {
      await completeNotification({ eventId: event.id, identity: member.identity, channel, token: claim.token, state: 'SKIPPED', actor, recipient, reason: 'RESULT_OR_CONTACT_CHANGED_BEFORE_SEND' });
      continue;
    }
    const variables = buildSafeFinisherVariables(member, event);
    const result = channel === 'EMAIL'
      ? await sendBergtecnoEmail({ recipientEmail: recipient, templateId: template, variables, singleAttempt: true })
      : await sendAiSensyWhatsApp({ recipientPhone: recipient, userName: member.name, campaignName: template, parameters: resultWhatsAppParameters(member, event.name) });
    const accepted = channel === 'EMAIL' ? 'sent' in result && result.sent : 'accepted' in result && result.accepted;
    const state = accepted ? 'PROVIDER_ACCEPTED' : result.ambiguous ? 'UNCONFIRMED' : 'FAILED';
    await completeNotification({ eventId: event.id, identity: member.identity, channel, token: claim.token, state, actor, recipient,
      providerStatus: accepted ? 'provider_accepted' : result.status ? `HTTP_${result.status}` : 'unconfirmed', providerResponse: accepted ? 'Provider API accepted the request; final delivery is not confirmed.' : result.error || '', reason: accepted ? '' : result.error || 'Provider did not accept the request.' });
  }
  return safeFinisherSummary(event.id, category, selected);
}

export function buildSafeFinisherVariables(member: ResultEmailRecipient, event: Pick<Event, 'name' | 'slug' | 'date' | 'location'>): Record<string, unknown> {
  return { athletename: member.name, athleteName: member.name, athlete_name: member.name, eventname: event.name, eventName: event.name, event_name: event.name,
    bib: member.bib, bib_number: member.bib, category: member.category, race_category: member.category, gender: member.gender,
    finishTime: resultFinishTime(member.finishTime), finish_time: resultFinishTime(member.finishTime), name: member.name, race_breakdown: resultRaceBreakdown(member.legTimes),
    results_url: `https://raceupshot.com/results/${event.slug}`, resultUrl: `https://raceupshot.com/results/${event.slug}`, result_url: `https://raceupshot.com/results/${event.slug}`,
    overallRank: member.overallRank, overall_rank: member.overallRank, genderRank: member.genderRank, gender_rank: member.genderRank,
    categoryRank: member.categoryRank, category_rank: member.categoryRank, event_date: event.date || '', event_location: event.location || '', year: new Date().getFullYear() };
}

export async function updateFinisherContact(input: { eventId: string; category: string; resultId: string; email: string; mobile: string; actor: string; reason: string }) {
  const data = await loaded(input.eventId, input.category);
  const member = data.members.find((item) => item.resultId === input.resultId && item.category.toLowerCase() === input.category.toLowerCase());
  if (!member) throw new Error('The exact published result was not found in this event and contest.');
  if (input.email && !isEmail(input.email)) throw new Error('Enter a valid email address.');
  if (input.mobile && !normalizeAiSensyPhone(input.mobile)) throw new Error('Enter a valid WhatsApp number.');
  return correctNotificationContact({ eventId: data.event.id, contestId: member.contestId, participantId: member.ledgerParticipantId, identity: member.identity,
    email: input.email.trim().toLowerCase(), mobile: input.mobile.trim(), previousEmail: member.email || '', previousMobile: member.mobile || '', actor: input.actor, reason: input.reason });
}

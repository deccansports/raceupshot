import { getCloudflareContext } from '@opennextjs/cloudflare';
import { Buffer } from 'node:buffer';
import { counterActions, counterEmailVariables, counterTemplateSchema, emptyCounterTemplate, renderCounterEmail, withKnownEmailTemplateMappings, type CounterTemplate, type CounterVariable } from './counter-notification-contract';
import { sendBergtecnoEmail, textToEmailHtml } from './bergtecno-email';
import { sendAiSensyWhatsApp } from './aisensy-whatsapp';
import { getAdminParticipantRoster } from './participant-chip-assignments';
import { getEventBySlug } from './raceupshot-repository';
import type { VolunteerOperationLog } from './volunteer-management';

export const counterConfigKey = (action: string) => `raceupshot:counter-notifications:v1:global:config:${action}`;
export const legacyCounterConfigKey = (eventId: string, action: string) => `raceupshot:counter-notifications:v1:${encodeURIComponent(eventId)}:config:${action}`;
const logPrefix = (eventId: string) => `raceupshot:counter-notifications:v1:${encodeURIComponent(eventId)}:delivery:`;
const AISENSY_TEST_DOCUMENT = {
  link: 'https://d3jt6ku4g6z5l8.cloudfront.net/FILE/6353da2e153a147b991dd812/4079142_dummy.pdf',
  filename: 'sample_media',
};
const actionDateFormatter = new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeZone: 'Asia/Kolkata' });
const actionTimeFormatter = new Intl.DateTimeFormat('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' });

function actionDateTime(timestamp: string) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return { action_date: timestamp, action_time: timestamp };
  return { action_date: actionDateFormatter.format(date), action_time: actionTimeFormatter.format(date) };
}

async function counterTemplateCoordinator(action: string, method: 'GET' | 'PUT', body?: Record<string, unknown>) {
  const { env } = await getCloudflareContext({ async: true });
  const namespace = env.VOLUNTEER_OPERATIONS;
  if (!namespace) return null;
  const stub = namespace.getByName(`counter-notification-config:v1:${action}`);
  const url = new URL('https://volunteer-operations.internal/counter-notifications/template');
  url.searchParams.set('action', action);
  const response = await stub.fetch(url.href, {
    method,
    ...(body ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}),
  });
  const result = await response.json() as { ok?: boolean; record?: { template: unknown; updatedAt: string; updatedBy: string } | null; error?: string };
  if (!response.ok || !result.ok) throw new Error(result.error || 'Counter template storage is unavailable.');
  return result.record ?? null;
}

export async function readCounterTemplate(eventId: string, action: string) {
  const { env } = await getCloudflareContext({ async: true });
  const record = await counterTemplateCoordinator(action, 'GET');
  if (record?.template) return withKnownEmailTemplateMappings(action, counterTemplateSchema.parse(record.template));
  const shared = await env.RACEUPSHOT.get(counterConfigKey(action), 'json');
  if (shared) return withKnownEmailTemplateMappings(action, counterTemplateSchema.parse(shared));
  const legacy = await env.RACEUPSHOT.get(legacyCounterConfigKey(eventId, action), 'json');
  return legacy
    ? withKnownEmailTemplateMappings(action, counterTemplateSchema.parse(legacy))
    : emptyCounterTemplate(action as keyof typeof counterActions);
}

export async function saveCounterTemplate(action: string, template: CounterTemplate, updatedBy: string) {
  template = withKnownEmailTemplateMappings(action, template);
  const updatedAt = new Date().toISOString();
  const record = await counterTemplateCoordinator(action, 'PUT', { template, updatedAt, updatedBy });
  if (!record) {
    const { env } = await getCloudflareContext({ async: true });
    if (!env.RACEUPSHOT) throw new Error('Counter template storage is unavailable.');
    await env.RACEUPSHOT.put(counterConfigKey(action), JSON.stringify({ ...template, scope: 'ALL_EVENTS', updatedAt, updatedBy }));
    return template;
  }
  // Keep the historical KV record as a compatibility mirror. The DO is the
  // authoritative source because KV reads can return stale values after writes.
  try {
    const { env } = await getCloudflareContext({ async: true });
    await env.RACEUPSHOT.put(counterConfigKey(action), JSON.stringify({ ...template, scope: 'ALL_EVENTS', updatedAt, updatedBy }));
  } catch {
    console.warn(JSON.stringify({ type: 'counter_template_kv_mirror_failed', action }));
  }
  return counterTemplateSchema.parse(record.template);
}
export async function listCounterDeliveries(eventId: string) {
  const { env } = await getCloudflareContext({ async: true });
  const keys = await env.RACEUPSHOT.list({ prefix: logPrefix(eventId), limit: 50 });
  const rows = await Promise.all(keys.keys.map((key) => env.RACEUPSHOT.get(key.name, 'json')));
  return rows.filter(Boolean);
}
function text(row: Record<string, unknown>, ...fields: string[]) {
  for (const field of fields) if (row[field] !== undefined && row[field] !== null && String(row[field]).trim()) return String(row[field]).trim();
  return '';
}
export function savedWaiverUrl(raw: Record<string, unknown>, field: string, origin: string) {
  const value = text(raw, field);
  if (!value) throw new Error('The participant has no saved signed-waiver PDF in the selected field.');
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.origin !== origin || url.username || url.password) throw new Error('Saved waiver URL does not match the trusted document origin.');
  return url.href;
}
async function pdfAttachment(url: string) {
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(10000) });
  if (!response.ok || !response.body) throw new Error('Saved waiver PDF could not be downloaded.');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > 5 * 1024 * 1024) throw new Error('Saved waiver exceeds the 5 MB attachment limit.');
      chunks.push(value);
    }
  } finally { await reader.cancel(); }
  const bytes = Buffer.concat(chunks);
  if (bytes.subarray(0, 5).toString() !== '%PDF-') throw new Error('Saved waiver document is not a PDF.');
  return { filename: 'signed-waiver.pdf', contentType: 'application/pdf', data: bytes.toString('base64') };
}

/** Called once for a newly persisted successful counter operation. No automatic resend after ambiguous provider responses. */
export async function dispatchCounterNotifications(operation: VolunteerOperationLog, options: {
  participant?: Record<string, unknown>;
  template?: CounterTemplate;
  emailAttachment?: { filename: string; contentType: string; data: string };
  emailHtml?: string;
} = {}) {
  if (!(operation.action in counterActions)) return;
  const { env } = await getCloudflareContext({ async: true });
  const template = options.template ?? await readCounterTemplate(operation.eventId, operation.action);
  if (!template.email.enabled && !template.whatsapp.enabled) return;
  const [roster, event] = await Promise.all([
    options.participant ? Promise.resolve(null) : getAdminParticipantRoster(operation.eventId),
    getEventBySlug(operation.eventId, { includeUnpublished: true }),
  ]);
  // Never resolve a recipient by BIB or published race results.
  const raw = options.participant ?? roster?.rows.find((row) => text(row, 'participantUid', 'participantUuid', 'participant_uuid', 'uuid', 'id') === operation.participantUid);
  const values: Partial<Record<CounterVariable, string>> = raw ? {
    name: text(raw, 'fullName', 'name', 'athleteName'), email: text(raw, 'email', 'emailAddress'), mobile: text(raw, 'mobile', 'phone', 'mobileNumber'),
    bib: operation.bib, category: text(raw, 'category', 'contestName', 'ticketName'), event_name: event?.name || operation.eventName,
    event_date: event?.date || '', event_location: event?.location || '', volunteer_name: operation.volunteerName,
    counter: counterActions[operation.action as keyof typeof counterActions], action_at: operation.capturedAt, ...actionDateTime(operation.capturedAt),
    bike_rack: operation.bikeRack || '', locker_number: operation.lockerNumber || '',
    athlete_band: text(raw, 'athleteBandCode', 'athlete_band_code'), chip: text(raw, 'chipCode', 'chip_code'),
    timing_point: operation.timingPointName || '', gun_time: operation.gunTime || '', waiver_url: text(raw, template.waiver.urlField),
  } : {};
  await Promise.all((['email', 'whatsapp'] as const).map(async (channel) => {
    if (!template[channel].enabled) return;
    const key = `${logPrefix(operation.eventId)}${String(9999999999999 - Date.parse(operation.capturedAt)).padStart(13, '0')}:${operation.id}:${channel}`;
    const base = { schemaVersion: 1, operationId: operation.id, eventId: operation.eventId, participantId: operation.participantUid, bib: operation.bib, action: operation.action, channel, createdAt: new Date().toISOString(), ...(channel === 'whatsapp' && template.whatsapp.campaignName.trim() ? { campaignName: template.whatsapp.campaignName.trim() } : {}) };
    await env.RACEUPSHOT.put(key, JSON.stringify({ ...base, status: 'SENDING' }));
    try {
      if (!raw) throw new Error('Exact participant identity is missing from the registration roster.');
      let documentUrl: string | undefined;
      if (template[channel].attachWaiver) documentUrl = savedWaiverUrl(raw, template.waiver.urlField, template.waiver.allowedOrigin);
      if (channel === 'email') {
        if (!values.email) throw new Error('Participant email is missing.');
        const result = await sendBergtecnoEmail({ recipientEmail: values.email,
          ...(template.email.mode === 'PROVIDER_TEMPLATE'
            ? { templateId: template.email.templateId, variables: counterEmailVariables(template.email.mappings, values) }
            : { subject: renderCounterEmail(template.email.subject, template.email.mappings, values), html: options.emailHtml ?? textToEmailHtml(renderCounterEmail(template.email.body, template.email.mappings, values)) }),
          ...(documentUrl ? { attachments: [options.emailAttachment ?? await pdfAttachment(documentUrl)] } : {}), singleAttempt: true });
        if (!result.sent) throw new Error(result.error || 'Email provider did not accept the message.');
      } else {
        if (!values.mobile) throw new Error('Participant mobile number is missing.');
        const parameters = template.whatsapp.parameters.map((variable, i) => {
          if (!values[variable]?.trim()) throw new Error(`Missing value for WhatsApp {{${i + 1}}}: ${variable}.`);
          return values[variable]!;
        });
        const result = await sendAiSensyWhatsApp({ recipientPhone: values.mobile, userName: values.name || '', campaignName: template.whatsapp.campaignName, parameters,
          ...(documentUrl ? { document: { link: documentUrl, filename: 'signed-waiver.pdf' } } : {}) });
        if (!result.accepted) throw new Error(result.error || 'WhatsApp provider did not accept the message.');
      }
      await env.RACEUPSHOT.put(key, JSON.stringify({ ...base, status: 'PROVIDER_ACCEPTED' }));
    } catch (error) {
      await env.RACEUPSHOT.put(key, JSON.stringify({ ...base, status: 'FAILED_OR_UNCONFIRMED', error: error instanceof Error ? error.message : 'Notification failed.' }));
    }
  }));
}

export async function sendCounterNotificationTest(input: {
  channel: 'EMAIL' | 'WHATSAPP';
  recipient: string;
  template: CounterTemplate;
  event: { name: string; date?: string | null; location?: string | null };
  action: keyof typeof counterActions;
}) {
  input = { ...input, template: withKnownEmailTemplateMappings(input.action, input.template) };
  const now = new Date().toISOString();
  const values: Record<CounterVariable, string> = {
    name: 'Test Athlete', email: input.channel === 'EMAIL' ? input.recipient : 'athlete@example.com', mobile: input.channel === 'WHATSAPP' ? input.recipient : '+919999999999',
    bib: 'TEST-001', category: 'Test Category', event_name: input.event.name, event_date: input.event.date || 'Race date', event_location: input.event.location || 'Race venue',
    volunteer_name: 'Admin test', counter: counterActions[input.action], action_at: now, ...actionDateTime(now), bike_rack: 'A-01', locker_number: 'L-01', athlete_band: 'BAND-TEST', chip: 'CHIP-TEST',
    timing_point: 'Test timing point', gun_time: '01:23:45', waiver_url: 'https://example.com/test-waiver.pdf',
  };
  if (input.channel === 'EMAIL') {
    const result = await sendBergtecnoEmail({ recipientEmail: input.recipient,
      ...(input.template.email.mode === 'PROVIDER_TEMPLATE'
        ? { templateId: input.template.email.templateId, variables: counterEmailVariables(input.template.email.mappings, values) }
        : { subject: renderCounterEmail(input.template.email.subject, input.template.email.mappings, values), html: textToEmailHtml(renderCounterEmail(input.template.email.body, input.template.email.mappings, values)) }),
      singleAttempt: true });
    if (!result.sent) throw new Error(result.error || 'Email provider did not accept the test.');
    return { channel: input.channel, recipient: input.recipient, status: 'PROVIDER_ACCEPTED' as const };
  }
  const parameters = input.template.whatsapp.parameters.map((variable, index) => {
    const value = values[variable]?.trim();
    if (!value) throw new Error(`Missing value for WhatsApp {{${index + 1}}}: ${variable}.`);
    return value;
  });
  const result = await sendAiSensyWhatsApp({
    recipientPhone: input.recipient,
    userName: values.name,
    campaignName: input.template.whatsapp.campaignName,
    parameters,
    ...(input.template.whatsapp.attachWaiver ? { document: AISENSY_TEST_DOCUMENT } : {}),
  });
  if (!result.accepted) throw new Error(result.error || 'WhatsApp provider did not accept the test.');
  return { channel: input.channel, recipient: input.recipient, campaignName: input.template.whatsapp.campaignName, status: 'PROVIDER_ACCEPTED' as const };
}

export async function scheduleCounterNotifications(operation: VolunteerOperationLog) {
  if (!(operation.action in counterActions)) return;
  try {
    const { ctx } = await getCloudflareContext({ async: true });
    ctx.waitUntil(dispatchCounterNotifications(operation).catch(() => {
      console.error(JSON.stringify({ type: 'counter_notification_dispatch_failed', operationId: operation.id, eventId: operation.eventId }));
    }));
  } catch {
    console.error(JSON.stringify({ type: 'counter_notification_schedule_failed', operationId: operation.id, eventId: operation.eventId }));
  }
}

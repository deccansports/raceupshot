import { getLiveTrackingHubConfig } from './live-tracking-hub-config';
import { isFinalizedRegistration, notificationIdentity, type TransactionalChannel } from './transactional-notification-contract';
import { assertTransactionalSendsEnabled } from './transactional-notification-gate';
import { claimNotification, completeNotification } from './transactional-notification-ledger';
import { sendBergtecnoEmail } from './bergtecno-email';
import { normalizeAiSensyPhone, sendAiSensyWhatsApp } from './aisensy-whatsapp';

type Row = Record<string, unknown>;
const value = (row: Row, key: string) => String(row[key] ?? '').trim();

/** Called only after a persisted admin finalization transition, never from result uploads or roster imports. */
export async function notifyFinalizedRegistration(input: { eventId: string; contestId: string; participantId: string; previous: Row; current: Row; eventName: string }): Promise<{ attempted: number; warning?: string }> {
  if (isFinalizedRegistration(value(input.previous, 'registrationStatus'), input.previous)
    || !isFinalizedRegistration(value(input.current, 'registrationStatus'), input.current)) return { attempted: 0 };
  const config = await getLiveTrackingHubConfig(input.eventId);
  if (!config?.notifications.enabled || !config.notifications.registrationEnabled) return { attempted: 0 };
  const identity = notificationIdentity(input.eventId, input.contestId, input.participantId, 'REGISTRATION');
  if (!identity) return { attempted: 0, warning: 'Registration identity is incomplete; no notification sent.' };
  await assertTransactionalSendsEnabled();
  const email = value(input.current, 'email').toLowerCase();
  const mobile = normalizeAiSensyPhone(value(input.current, 'mobile'));
  const name = value(input.current, 'name') || 'Athlete';
  const bib = value(input.current, 'bib');
  const ticketName = value(input.current, 'ticketName');
  const channels: TransactionalChannel[] = [];
  if (config.notifications.emailEnabled && email) channels.push('EMAIL');
  if (config.notifications.whatsappEnabled && mobile) channels.push('WHATSAPP');
  let attempted = 0;
  for (const channel of channels) {
    const template = channel === 'EMAIL' ? config.notifications.registrationEmailTemplateId : config.notifications.registrationWhatsAppCampaignName;
    if (!template) throw new Error(`${channel} registration template/campaign is not configured.`);
    const recipient = channel === 'EMAIL' ? email : mobile;
    const claim = await claimNotification({ eventId: input.eventId, contestId: input.contestId, participantId: input.participantId, identity, kind: 'REGISTRATION', channel, recipient, actor: 'SYSTEM' });
    if (!claim.token) continue;
    attempted += 1;
    const result = channel === 'EMAIL'
      ? await sendBergtecnoEmail({ recipientEmail: email, templateId: template, variables: { athleteName: name, eventName: input.eventName, ticketName, bib }, singleAttempt: true })
      : await sendAiSensyWhatsApp({ recipientPhone: mobile, userName: name, campaignName: template, parameters: [name, input.eventName, ticketName, bib] });
    const accepted = channel === 'EMAIL' ? 'sent' in result && result.sent : 'accepted' in result && result.accepted;
    await completeNotification({ eventId: input.eventId, identity, channel, token: claim.token, state: accepted ? 'PROVIDER_ACCEPTED' : result.ambiguous ? 'UNCONFIRMED' : 'FAILED', actor: 'SYSTEM', recipient,
      providerStatus: accepted ? 'provider_accepted' : result.status ? `HTTP_${result.status}` : 'unconfirmed', providerResponse: accepted ? 'Provider API accepted the request; final delivery is not confirmed.' : result.error || '', reason: accepted ? '' : result.error || 'Provider did not accept the registration confirmation.' });
  }
  return { attempted };
}

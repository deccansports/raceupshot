import { getCloudflareContext } from '@opennextjs/cloudflare';
import { getLiveTrackingHubConfig } from '@/lib/live-tracking-hub-config';
import { sendFinisherNotificationBatch, type FinisherNotificationChannel } from '@/lib/result-emails';
import { assertTransactionalSendsEnabled } from '@/lib/transactional-notification-gate';

export async function POST(request: Request, context: { params: Promise<{ eventId: string }> }) {
  const { env } = await getCloudflareContext({ async: true });
  if (!env.ADMIN_SESSION_SECRET || request.headers.get('x-raceupshot-internal-secret') !== env.ADMIN_SESSION_SECRET) return new Response('Forbidden', { status: 403 });
  const { eventId } = await context.params;
  const config = await getLiveTrackingHubConfig(eventId);
  if (!config?.notifications.enabled || !config.notifications.finishersEnabled) return Response.json({ pending: 0 });
  try { await assertTransactionalSendsEnabled(); } catch { return Response.json({ pending: 0, disabled: true }); }
  const channels: FinisherNotificationChannel[] = [];
  if (config.notifications.emailEnabled && (config.notifications.emailTemplateId || (config.notifications.emailTriathlonTemplateId && config.notifications.emailSingleSportTemplateId))) channels.push('EMAIL');
  if (config.notifications.whatsappEnabled && (config.notifications.whatsappCampaignName || (config.notifications.whatsappTriathlonCampaignName && config.notifications.whatsappSingleSportCampaignName))) channels.push('WHATSAPP');
  if (!channels.length) return Response.json({ pending: 0 });
  const summary = await sendFinisherNotificationBatch(eventId, 'Overall', channels, false, { trigger: 'automatic' });
  return Response.json({ pending: summary.pending });
}

import { getCloudflareContext } from '@opennextjs/cloudflare';

export async function scheduleAutomaticResultNotifications(eventId: string) {
  try {
    const { env, ctx } = await getCloudflareContext({ async: true });
    ctx.waitUntil(env.CANONICAL_CHANGE_HUB.getByName(`result-notifications:${eventId}`).fetch('https://notifications.internal/schedule-results', {
      method: 'POST', body: JSON.stringify({ eventId }),
    }).then(response => { if (!response.ok) throw new Error('Scheduling failed'); }).catch(() => {
      console.error(JSON.stringify({ type: 'result_notification_schedule_failed', eventId }));
    }));
  } catch {
    console.error(JSON.stringify({ type: 'result_notification_schedule_failed', eventId }));
  }
}

export async function resultNotificationClaim(eventId: string, identity: string, channel: string, retryFailed = false, forceResend = false): Promise<string | null> {
  const { env } = await getCloudflareContext({ async: true });
  const response = await env.CANONICAL_CHANGE_HUB.getByName(`result-notifications:${eventId}`).fetch('https://notifications.internal/claim-result', {
    method: 'POST', body: JSON.stringify({ identity, channel, retryFailed, forceResend }),
  });
  if (!response.ok) throw new Error('Notification claim unavailable; no message sent.');
  return (await response.json() as { token: string | null }).token;
}

export async function completeResultNotification(eventId: string, identity: string, channel: string, token: string, status: 'ACCEPTED' | 'FAILED') {
  const { env } = await getCloudflareContext({ async: true });
  const response = await env.CANONICAL_CHANGE_HUB.getByName(`result-notifications:${eventId}`).fetch('https://notifications.internal/complete-result', {
    method: 'POST', body: JSON.stringify({ identity, channel, token, status }),
  });
  if (!response.ok) throw new Error('Notification completion could not be recorded.');
}

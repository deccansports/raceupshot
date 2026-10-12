import { getCloudflareContext } from '@opennextjs/cloudflare';

/** A server-only, deliberately absent-by-default kill switch. Never set in local .dev.vars. */
export async function assertTransactionalSendsEnabled(): Promise<void> {
  const { env } = await getCloudflareContext({ async: true });
  if (process.env.NODE_ENV !== 'production' || env.APP_ENV !== 'production' || env.TRANSACTIONAL_NOTIFICATIONS_LIVE_ENABLED !== 'true') {
    throw new Error('Live transactional sending is disabled. Configure production providers and explicitly enable TRANSACTIONAL_NOTIFICATIONS_LIVE_ENABLED after a controlled test.');
  }
}

import { getCloudflareContext } from '@opennextjs/cloudflare';
import { syncFeibotLiveResults } from '@/lib/feibot-integration';
import { platformFailure, platformSuccess } from '@/lib/platform-api-response';

export async function POST(request: Request, context: { params: Promise<{ eventId: string }> }) {
  try {
    const { env } = await getCloudflareContext({ async: true });
    const expected = env.ADMIN_SESSION_SECRET || '';
    const supplied = request.headers.get('x-raceupshot-internal-secret') || '';
    if (!expected || supplied !== expected) return platformFailure('FORBIDDEN', 'Internal live sync authorization failed.', 403);
    const { eventId } = await context.params;
    const state = await syncFeibotLiveResults(eventId);
    return platformSuccess(state, { cacheSeconds: 0 }, { headers: { 'cache-control': 'private, no-store' } });
  } catch (error) {
    return platformFailure('FEIBOT_LIVE_SYNC_FAILED', error instanceof Error ? error.message : 'Unable to synchronize Feibot live results.', 502);
  }
}

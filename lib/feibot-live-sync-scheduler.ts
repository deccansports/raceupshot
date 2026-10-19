import { getCloudflareContext } from '@opennextjs/cloudflare';

export async function ensureFeibotLiveSyncSchedule(eventId: string, enabled: boolean): Promise<void> {
  // next dev cannot host the Worker's internal Durable Object classes, and a
  // read-only admin page must never mutate the production alarm schedule.
  if (process.env.NODE_ENV === 'development') return;
  try {
    const { env } = await getCloudflareContext({ async: true });
    if (!env.CANONICAL_CHANGE_HUB) return;
    const response = await env.CANONICAL_CHANGE_HUB.getByName(eventId).fetch('https://canonical-change.internal/configure-live-sync', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // Feibot applies a shared request limit across result endpoints. Per-feed
      // pacing in the sync worker plus a one-minute alarm prevents 429 bursts.
      body: JSON.stringify({ eventId, enabled, intervalMs: 60_000 }),
    });
    if (!response.ok) throw new Error(`Canonical change hub returned ${response.status}`);
  } catch (error) {
    console.error(JSON.stringify({ type: 'feibot_live_sync_schedule_failed', eventId, error: error instanceof Error ? error.message : String(error) }));
  }
}

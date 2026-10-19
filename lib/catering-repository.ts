import { getCloudflareContext } from '@opennextjs/cloudflare';

// Reuse the event-scoped coordinator; never mix event data or migrate legacy logs.
export async function cateringRequest<T>(eventId: string, path: string, body?: object): Promise<T> {
  if (!eventId.trim()) throw new Error('Choose an event.');
  const { env } = await getCloudflareContext({ async: true });
  if (!env.VOLUNTEER_OPERATIONS) throw new Error('Catering coordination is unavailable.');
  const response = await env.VOLUNTEER_OPERATIONS.getByName(eventId).fetch(`https://volunteer-operations.internal${path}`, {
    method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const result = await response.json<{ ok: boolean; data: T; error?: string }>();
  if (!response.ok || !result.ok) throw new Error(result.error || 'Catering request failed.');
  return result.data;
}

import openNextWorker from '../.open-next/worker.js';
export { CanonicalChangeHub } from './canonical-change-hub';
export { VolunteerOperationCoordinator } from './volunteer-operation-coordinator';
export { DOQueueHandler, DOShardedTagCache, BucketCachePurge } from '../.open-next/worker.js';

const streamPattern = /^\/api\/(?:v1\/)?live\/events\/([^/]+)\/stream\/?$/;

export default {
  async fetch(request: Request, env: CloudflareEnv, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const match = url.pathname.match(streamPattern);
    if (match) {
      if (request.method !== 'GET') return new Response('Method Not Allowed', { status: 405 });
      if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
        return new Response('Expected Upgrade: websocket', { status: 426 });
      }
      const eventId = decodeURIComponent(match[1] || '').trim();
      if (!eventId) return new Response('eventId is required', { status: 400 });
      const target = new URL('https://canonical-change.internal/connect');
      target.searchParams.set('eventId', eventId);
      return env.CANONICAL_CHANGE_HUB.getByName(eventId).fetch(new Request(target, request));
    }
    return openNextWorker.fetch(request, env, ctx);
  },
} satisfies ExportedHandler<CloudflareEnv>;

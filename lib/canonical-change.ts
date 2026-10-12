import { getCloudflareContext } from '@opennextjs/cloudflare';
import {
  canonicalManifestVersion,
  type CanonicalChangeEvent,
  type CanonicalChangeReason,
} from '@/packages/live-tracking-contracts/src';

export interface PublishCanonicalChangeInput {
  eventId: string;
  participantUuid?: string;
  contestUuid?: string;
  canonicalVersion: string;
  timingVersion: number;
  revision: number;
  reason: CanonicalChangeReason;
  updatedAt: string;
  canonicalWriteCompletedAt: string;
  manifestPersistedAt: string;
  feibotReadAcceptedAt?: string;
}

export async function publishCanonicalChange(input: PublishCanonicalChangeInput): Promise<CanonicalChangeEvent | null> {
  const publishedAt = new Date().toISOString();
  const event: CanonicalChangeEvent = {
    type: 'canonical_change',
    ...input,
    manifestVersion: canonicalManifestVersion(input.canonicalVersion, input.timingVersion),
    publishedAt,
  };
  try {
    const { env } = await getCloudflareContext({ async: true });
    if (!env.CANONICAL_CHANGE_HUB) throw new Error('CANONICAL_CHANGE_HUB binding is unavailable');
    const response = await env.CANONICAL_CHANGE_HUB.getByName(input.eventId).fetch('https://canonical-change.internal/publish', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(event),
    });
    if (!response.ok) throw new Error(`Canonical change hub returned ${response.status}`);
    const acceptedAt = input.feibotReadAcceptedAt ? Date.parse(input.feibotReadAcceptedAt) : Number.NaN;
    const canonicalAt = Date.parse(input.canonicalWriteCompletedAt);
    console.info(JSON.stringify({
      type: 'canonical_change_published', eventId: input.eventId,
      participantUuid: input.participantUuid ?? null, contestUuid: input.contestUuid ?? null,
      canonicalVersion: input.canonicalVersion, timingVersion: input.timingVersion,
      canonicalWriteCompletedAt: input.canonicalWriteCompletedAt,
      manifestPersistedAt: input.manifestPersistedAt, canonicalUpdatePublishedAt: publishedAt,
      accepted_to_canonical_ms: Number.isFinite(acceptedAt) ? canonicalAt - acceptedAt : null,
      canonical_to_push_ms: Date.parse(publishedAt) - canonicalAt,
    }));
    return event;
  } catch (error) {
    console.error(JSON.stringify({ type: 'canonical_change_publish_failed', eventId: input.eventId, error: error instanceof Error ? error.message : String(error) }));
    return null;
  }
}

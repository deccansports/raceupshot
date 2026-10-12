import { expect, test } from 'vitest';

import { canonicalManifestVersion, compareManifestVersions, isCanonicalChangeEvent } from './canonical-change';

test('canonical manifest versions advance monotonically within one active build', () => {
  expect(compareManifestVersions(canonicalManifestVersion('build-a', 3), canonicalManifestVersion('build-a', 2))).toBe(1);
  expect(compareManifestVersions(canonicalManifestVersion('build-a', 3), canonicalManifestVersion('build-a', 3))).toBe(0);
});

test('canonical change parser rejects raw provider payloads and accepts invalidation metadata', () => {
  expect(isCanonicalChangeEvent({ type: 'feibot_read', chipCode: 'secret' })).toBe(false);
  expect(isCanonicalChangeEvent({
    type: 'canonical_change', eventId: 'event-1', canonicalVersion: 'build-a',
    manifestVersion: 'build-a:4', timingVersion: 4, revision: 4, reason: 'split_updated',
    updatedAt: '2026-08-28T00:00:00.000Z', canonicalWriteCompletedAt: '2026-08-28T00:00:00.000Z',
    manifestPersistedAt: '2026-08-28T00:00:00.000Z', publishedAt: '2026-08-28T00:00:00.001Z',
  })).toBe(true);
});

import assert from 'node:assert/strict';
import test from 'node:test';

import { CANONICAL_SCHEMA_VERSION } from './contracts';
import { activeVersionKey, buildStatusKey, canonicalBuildSummaryKey, eventManifestKey } from './storage-keys';
import { finalizeCanonicalBuild, resolveActiveVersion } from './versioning';

function memoryStore(initial: Record<string, unknown> = {}) {
  const values = new Map(Object.entries(initial).map(([key, value]) => [key, JSON.stringify(value)]));
  const statusHistory: string[] = [];
  return {
    values,
    statusHistory,
    store: {
      async get(key: string) { return values.get(key) ?? null; },
      async put(key: string, value: string) {
        values.set(key, value);
        if (key.endsWith(':build:status')) statusHistory.push(JSON.parse(value).status);
      },
    },
  };
}

function validation(eventId: string, buildVersion: string, valid: boolean) {
  return {
    schemaVersion: CANONICAL_SCHEMA_VERSION,
    eventId,
    buildVersion,
    updatedAt: '2026-08-18T04:20:10.234Z',
    valid,
    errors: valid ? [] : [{ severity: 'error' as const, eventId, code: 'invalid_test', message: 'invalid' }],
    warnings: [],
  };
}

test('finalization moves a valid first build through READY to ACTIVE and publishes the manifest', async () => {
  const state = memoryStore();
  const result = await finalizeCanonicalBuild(state.store, {
    eventId: 'event-1', buildVersion: 'build-1', provider: 'feibot', source: 'feibot_cloud',
    courseVersion: 1, validation: validation('event-1', 'build-1', true), completeBuildValid: true,
    participantCount: 1, expectedParticipants: 1, writtenParticipants: 1,
    expectedContests: 1, writtenContests: 1, publishedAt: '2026-08-18T04:20:10.234Z',
  });

  assert.equal(result.published, true);
  assert.deepEqual(state.statusHistory, ['ready', 'active']);
  assert.equal(JSON.parse(state.values.get(eventManifestKey('event-1'))!).activeVersion, 'build-1');
  assert.equal(JSON.parse(state.values.get(activeVersionKey('event-1'))!), 'build-1');
  assert.equal(JSON.parse(state.values.get(canonicalBuildSummaryKey('event-1', 'build-1'))!).active, true);
});

test('failed validation preserves the previous active build', async () => {
  const existingManifest = {
    schemaVersion: CANONICAL_SCHEMA_VERSION, eventId: 'event-1', activeVersion: 'build-1',
    previousVersion: null, provider: 'feibot', courseVersion: 1, participantVersion: 1,
    timingVersion: 0, leaderboardVersion: 1, completeBuildValid: true,
    publishedAt: '2026-08-18T04:00:00.000Z', updatedAt: '2026-08-18T04:00:00.000Z',
  };
  const state = memoryStore({ [eventManifestKey('event-1')]: existingManifest });
  const result = await finalizeCanonicalBuild(state.store, {
    eventId: 'event-1', buildVersion: 'build-2', provider: 'feibot', source: 'feibot_cloud',
    courseVersion: 1, validation: validation('event-1', 'build-2', false), completeBuildValid: false,
    publishedAt: '2026-08-18T04:20:10.234Z',
  });

  assert.equal(result.published, false);
  assert.equal(result.manifest?.activeVersion, 'build-1');
  assert.equal(JSON.parse(state.values.get(eventManifestKey('event-1'))!).activeVersion, 'build-1');
  assert.equal(JSON.parse(state.values.get(buildStatusKey('event-1', 'build-2'))!).status, 'failed');
});

test('a build started before a canonical reset cannot publish afterward', async () => {
  const resetManifest = {
    schemaVersion: CANONICAL_SCHEMA_VERSION, eventId: 'event-1', activeVersion: null,
    previousVersion: null, provider: 'feibot', courseVersion: 0, participantVersion: 0,
    timingVersion: 0, leaderboardVersion: 0, completeBuildValid: false, status: 'archived',
    publishedAt: '2026-08-25T13:16:58.253Z', updatedAt: '2026-08-25T13:16:58.253Z',
  };
  const state = memoryStore({ [eventManifestKey('event-1')]: resetManifest });
  const result = await finalizeCanonicalBuild(state.store, {
    eventId: 'event-1', buildVersion: 'build-before-reset', provider: 'feibot', source: 'feibot_cloud',
    courseVersion: 1, validation: validation('event-1', 'build-before-reset', true), completeBuildValid: true,
    participantCount: 1, expectedParticipants: 1, writtenParticipants: 1,
    expectedContests: 1, writtenContests: 1,
    startedAt: '2026-08-25T12:41:56.748Z', publishedAt: '2026-08-25T13:17:10.000Z',
  });

  assert.equal(result.published, false);
  assert.equal(result.manifest, null);
  assert.equal(JSON.parse(state.values.get(buildStatusKey('event-1', 'build-before-reset'))!).error, 'canonical_reset_during_build');
  assert.equal(JSON.parse(state.values.get(eventManifestKey('event-1'))!).activeVersion, null);
});

test('activeVersion resolves from adapters that return a decoded scalar string', async () => {
  const store = {
    async get(key: string) { return key === activeVersionKey('event-1') ? 'build-legacy' : null; },
    async put() {},
  };
  assert.equal(await resolveActiveVersion(store, 'event-1'), 'build-legacy');
});

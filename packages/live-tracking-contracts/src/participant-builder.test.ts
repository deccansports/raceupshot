import assert from 'node:assert/strict';
import test from 'node:test';

import {
  authoritativeRaceParticipantUuid,
  hasOrphanedEffectiveStart,
  resolveCanonicalSnapshotTimingVersion,
  writeCanonicalParticipantArtifacts,
} from './participant-builder';

test('authoritative participant identity isolates identical bibs and provider UUIDs across Feibot events', () => {
  const common = {
    providerContestUuid: 'contest-1',
    contestUuid: 'contest-1',
    bib: '101',
    participantUuid: 'provider-row-1',
    providerParticipantUuid: 'provider-row-1',
  };
  assert.equal(authoritativeRaceParticipantUuid({ ...common, providerEventUuid: '6QTff6CR' }), 'race:6qtff6cr:contest1:101');
  assert.equal(authoritativeRaceParticipantUuid({ ...common, providerEventUuid: '1xajVfM0' }), 'race:1xajvfm0:contest1:101');
  assert.notEqual(
    authoritativeRaceParticipantUuid({ ...common, providerEventUuid: '6QTff6CR' }),
    authoritativeRaceParticipantUuid({ ...common, providerEventUuid: '1xajVfM0' }),
  );
});

test('detects a synthetic START whose downstream anchor was removed by a course rebuild', () => {
  assert.equal(hasOrphanedEffectiveStart({
    start: {
      readId: 'participant:bike-start:123:2026-08-08T06:04:01.000Z:effective-start',
    } as any,
    bikeStart: null,
  }, 'participant:bike-start:123:2026-08-08T06:04:01.000Z'), true);
});

test('keeps a synthetic START while its accepted downstream anchor is retained', () => {
  const anchor = 'participant:bike-start:123:2026-08-08T06:04:01.000Z';
  assert.equal(hasOrphanedEffectiveStart({
    start: { readId: `${anchor}:effective-start` } as any,
    bikeStart: { readId: anchor } as any,
}, anchor), false);
});

test('canonical timing builds advance the athlete timing generation', () => {
  const existing = {
    timingVersion: 7,
    versions: { timing: 7 },
  } as any;

  assert.equal(resolveCanonicalSnapshotTimingVersion(existing, 8), 8);
  assert.equal(resolveCanonicalSnapshotTimingVersion(existing, 6), 7);
  assert.equal(resolveCanonicalSnapshotTimingVersion(null, 3), 3);
});

test('verifies large snapshot builds in bounded batches', async () => {
  const values = new Map<string, string>();
  let putCount = 0;
  let putsBeforeFirstVersionedSnapshotVerification: number | null = null;
  const store = {
    async get(key: string) {
      const value = values.get(key) ?? null;
      if (
        value !== null
        && key.includes(':v:build-1:athlete:')
        && putsBeforeFirstVersionedSnapshotVerification === null
      ) {
        putsBeforeFirstVersionedSnapshotVerification = putCount;
      }
      return value;
    },
    async put(key: string, value: string) {
      putCount += 1;
      values.set(key, value);
    },
  };
  const snapshots = Array.from({ length: 60 }, (_, index) => ({
    eventId: 'event-1',
    buildVersion: 'build-1',
    identity: { participantUuid: `participant-${index + 1}` },
  }));

  const result = await writeCanonicalParticipantArtifacts(store, {
    index: {
      eventId: 'event-1',
      buildVersion: 'build-1',
      rows: [],
      participantCount: snapshots.length,
    },
    snapshots,
    aliases: [],
    reverseIndexes: {},
  } as any);

  assert.equal(result.verifiedSnapshotCount, snapshots.length);
  assert.equal(result.missingSnapshotCount, 0);
  assert.ok(putsBeforeFirstVersionedSnapshotVerification !== null);
  assert.ok(putsBeforeFirstVersionedSnapshotVerification <= 50);
});

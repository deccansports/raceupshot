import {
  canonicalAthleteSnapshotSchema,
  canonicalCourseBundleSchema,
  canonicalLeaderboardManifestSchema,
  canonicalLeaderboardSchema,
  canonicalParticipantIndexSchema,
  canonicalSplitLeaderboardSchema,
  canonicalSplitSummarySchema,
} from '../canonicalTracking.repository';

export const CANONICAL_FIXTURE_VERSION = '2026-07-12T180032.123Z-a1b2c3';
export const canonicalFixtures = {
  course: { eventId: 'fixture-event', buildVersion: CANONICAL_FIXTURE_VERSION, validation: { complete: true }, contests: [{ contestUuid: 'contest-102', name: 'Bergman 102', legs: [], sections: [], splits: [] }] },
  participants: { eventId: 'fixture-event', buildVersion: CANONICAL_FIXTURE_VERSION, count: 1, participants: [{ participantUuid: 'participant-1', providerUuid: 'provider-1', bib: '1001', name: 'Fixture Athlete', contestUuid: 'contest-102' }] },
  athlete: { eventId: 'fixture-event', buildVersion: CANONICAL_FIXTURE_VERSION, participantUuid: 'participant-1', bib: '1001', calculated: { swimSeconds: 3600, t1Seconds: null, bikeSeconds: null, t2Seconds: null, runSeconds: null }, sections: [{ sectionKey: 'swim', durationSeconds: 3600 }, { sectionKey: 't1', durationSeconds: null }, { sectionKey: 'bike', durationSeconds: null }, { sectionKey: 't2', durationSeconds: null }, { sectionKey: 'run', durationSeconds: null }], splitRankings: [{ splitKey: 'swim-finish', rank: 7, status: 'DNF' }] },
  manifest: { eventId: 'fixture-event', buildVersion: CANONICAL_FIXTURE_VERSION, contestUuid: 'contest-102', raceModes: ['overall', 'gender', 'age', 'club'], splitModes: ['overall', 'gender', 'age'], genderKeys: ['male', 'female'], ageGroups: ['16-30'], clubAvailable: true, splitKeys: ['swim-finish'] },
  leaderboard: { eventId: 'fixture-event', buildVersion: CANONICAL_FIXTURE_VERSION, contestUuid: 'contest-102', mode: 'overall', entries: [{ participantUuid: 'participant-1', rank: 1, overallSeconds: 7200 }] },
  splitSummary: { eventId: 'fixture-event', buildVersion: CANONICAL_FIXTURE_VERSION, contestUuid: 'contest-102', splits: [{ splitKey: 'swim-finish', completedCount: 1, stillRacingCount: 0 }] },
  splitLeaderboard: { eventId: 'fixture-event', buildVersion: CANONICAL_FIXTURE_VERSION, contestUuid: 'contest-102', splitKey: 'swim-finish', mode: 'overall', entries: [{ participantUuid: 'participant-1', rank: 7, status: 'DNF' }] },
} as const;

export function validateCanonicalFixtures(): true {
  canonicalCourseBundleSchema.parse(canonicalFixtures.course);
  canonicalParticipantIndexSchema.parse(canonicalFixtures.participants);
  canonicalAthleteSnapshotSchema.parse(canonicalFixtures.athlete);
  canonicalLeaderboardManifestSchema.parse(canonicalFixtures.manifest);
  canonicalLeaderboardSchema.parse(canonicalFixtures.leaderboard);
  canonicalSplitSummarySchema.parse(canonicalFixtures.splitSummary);
  canonicalSplitLeaderboardSchema.parse(canonicalFixtures.splitLeaderboard);
  return true;
}

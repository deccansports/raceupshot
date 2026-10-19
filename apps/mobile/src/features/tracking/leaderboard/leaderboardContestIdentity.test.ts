import assert from 'node:assert/strict';
import test from 'node:test';

import {
  leaderboardContestKey,
  leaderboardResultContestKeys,
  leaderboardResultMatchesContest,
} from './leaderboardContestIdentity';

test('configured Swimathon names and uploaded distance labels share identity', () => {
  assert.equal(
    leaderboardContestKey('BERGMAN Swimathon - 2 Km'),
    leaderboardContestKey('2 KM'),
  );
});

test('all supported uploaded result category fields participate in matching', () => {
  const row = {
    contestName: 'Stale category',
    raceCategory: 'BERGMAN Swimathon - 4 Km',
  };
  assert.deepEqual(leaderboardResultContestKeys(row), [
    'stale category',
    'swimathon:4km',
  ]);
  assert.equal(
    leaderboardResultMatchesContest(row, 'swimathon:4km'),
    true,
  );
});

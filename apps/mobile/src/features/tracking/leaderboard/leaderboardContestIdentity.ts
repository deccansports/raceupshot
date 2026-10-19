export type LeaderboardContestIdentity = { key: string; label: string };

function compactLabel(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

/** Resolve configured and uploaded-result spellings to one contest identity. */
export function leaderboardContestIdentity(value: unknown): LeaderboardContestIdentity | null {
  const label = compactLabel(value);
  if (!label) return null;
  const normalized = label.toUpperCase().replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim();
  const isSwimathon = normalized.includes('SWIMATHON');
  const isBareDistance = /^(?:KIDS\s*)?500\s*(?:M|MTR|MTRS|METRE|METRES)|^[124]\s*KM$/.test(normalized);
  if (isSwimathon || isBareDistance) {
    if (/\b(?:KIDS\s*)?500\s*(?:M|MTR|MTRS|METRE|METRES)\b/.test(normalized)) {
      return { key: 'swimathon:kids-500m', label: 'Kids 500 Mtrs' };
    }
    if (/\b1\s*KM\b/.test(normalized)) return { key: 'swimathon:1km', label: '1 Km' };
    if (/\b2\s*KM\b/.test(normalized)) return { key: 'swimathon:2km', label: '2 Km' };
    if (/\b4\s*KM\b/.test(normalized)) return { key: 'swimathon:4km', label: '4 Km' };
  }
  return { key: label.toLowerCase(), label };
}

export function leaderboardContestKey(value: unknown): string {
  return leaderboardContestIdentity(value)?.key ?? '';
}

export function leaderboardResultContestKeys(row: Record<string, unknown>): string[] {
  return [row.contestName, row.contest, row.raceCategory, row.eventCategory, row.ticketName]
    .map(leaderboardContestKey)
    .filter((key, index, keys) => Boolean(key) && keys.indexOf(key) === index);
}

export function leaderboardResultMatchesContest(
  row: Record<string, unknown>,
  contestKey: string,
): boolean {
  return leaderboardResultContestKeys(row).includes(contestKey);
}

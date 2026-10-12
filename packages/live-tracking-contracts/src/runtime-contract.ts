import type { CanonicalCourseBundle } from './contracts';

export type CanonicalContractIssue = {
  path: Array<string | number>;
  code: 'required' | 'invalid_type' | 'invalid_value';
  message: string;
  expected?: string;
  received?: unknown;
};

export type CanonicalContractResult<T> =
  | { success: true; data: T; issues: [] }
  | { success: false; data: null; issues: CanonicalContractIssue[] };

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function text(...values: unknown[]): string {
  for (const value of values) {
    const candidate = String(value ?? '').trim();
    if (candidate) return candidate;
  }
  return '';
}

function finite(value: unknown): boolean {
  return Number.isFinite(Number(value));
}

function issue(
  path: Array<string | number>,
  code: CanonicalContractIssue['code'],
  message: string,
  expected: string,
  received: unknown,
): CanonicalContractIssue {
  return { path, code, message, expected, received };
}

/**
 * Runtime validation shared by the BERGMAN API, web and mobile consumers.
 * It validates the normalized canonical model, not Feibot's raw field names.
 * Optional provider/map/cutoff fields may be null or absent.
 */
export function validateCanonicalCourseContract(value: unknown): CanonicalContractResult<CanonicalCourseBundle> {
  const issues: CanonicalContractIssue[] = [];
  const bundle = record(value);
  if (!bundle) {
    return {
      success: false,
      data: null,
      issues: [issue([], 'invalid_type', 'Canonical course must be an object.', 'object', value)],
    };
  }

  if (!text(bundle.eventId)) {
    issues.push(issue(['eventId'], 'required', 'Canonical eventId is required.', 'non-empty string', bundle.eventId));
  }
  if (!text(bundle.buildVersion)) {
    issues.push(issue(['buildVersion'], 'required', 'Canonical buildVersion is required.', 'non-empty string', bundle.buildVersion));
  }
  const contests = Array.isArray(bundle.contests) ? bundle.contests : [];
  if (contests.length === 0) {
    issues.push(issue(['contests'], 'required', 'Canonical course must contain at least one contest.', 'non-empty array', bundle.contests));
  }

  contests.forEach((candidate, contestIndex) => {
    const contest = record(candidate);
    const base = ['contests', contestIndex] as Array<string | number>;
    if (!contest) {
      issues.push(issue(base, 'invalid_type', 'Contest must be an object.', 'object', candidate));
      return;
    }
    const contestUuid = text(
      contest.providerContestUuid,
      contest.contestUuid,
      contest.contest_uuid,
      contest.contestId,
      contest.id,
      contest.UUID,
      contest.uuid,
    );
    if (!contestUuid) {
      issues.push(issue([...base, 'providerContestUuid'], 'required', 'Contest UUID is required.', 'non-empty string', contest.providerContestUuid));
    }
    const contestName = text(contest.displayName, contest.name, contest.contestName, contest.contest_name);
    if (!contestName) {
      issues.push(issue([...base, 'displayName'], 'required', 'Contest display name is required.', 'non-empty string', contest.displayName));
    }
    const splits = Array.isArray(contest.splits) ? contest.splits : [];
    if (splits.length === 0) {
      issues.push(issue([...base, 'splits'], 'required', 'Contest must contain ordered timing splits.', 'non-empty array', contest.splits));
      return;
    }
    let hasStart = false;
    let hasFinish = false;
    splits.forEach((splitCandidate, splitIndex) => {
      const split = record(splitCandidate);
      const splitBase = [...base, 'splits', splitIndex];
      if (!split) {
        issues.push(issue(splitBase, 'invalid_type', 'Split must be an object.', 'object', splitCandidate));
        return;
      }
      if (!text(split.key, split.providerSplitId, split.id, split.splitUuid, split.split_uuid)) {
        issues.push(issue([...splitBase, 'key'], 'required', 'Split identity is required.', 'non-empty string', split.key));
      }
      if (!finite(split.order)) {
        issues.push(issue([...splitBase, 'order'], 'invalid_type', 'Split order must be numeric.', 'finite number', split.order));
      }
      if (!finite(split.cumulativeDistanceKm ?? split.distanceKm ?? split.distanceMeters)) {
        issues.push(issue([...splitBase, 'cumulativeDistanceKm'], 'invalid_type', 'Split distance must be numeric.', 'finite number', split.cumulativeDistanceKm));
      }
      hasStart ||= split.isStart === true || text(split.timingPointType, split.type).toUpperCase() === 'START';
      hasFinish ||= split.isFinish === true || text(split.timingPointType, split.type).toUpperCase() === 'FINISH';
    });
    if (!hasStart) {
      issues.push(issue([...base, 'splits'], 'invalid_value', 'Contest must contain a logical START split.', 'START split', contest.splits));
    }
    if (!hasFinish) {
      issues.push(issue([...base, 'splits'], 'invalid_value', 'Contest must contain a logical FINISH split.', 'FINISH split', contest.splits));
    }
  });

  return issues.length > 0
    ? { success: false, data: null, issues }
    : { success: true, data: value as CanonicalCourseBundle, issues: [] };
}

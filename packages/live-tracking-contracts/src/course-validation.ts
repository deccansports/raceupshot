import {
  CANONICAL_SCHEMA_VERSION,
  type CanonicalContestCourse,
  type CanonicalCourseBundle,
  type CanonicalLegType,
  type CanonicalValidationIssue,
  type CanonicalValidationResult,
} from './contracts';

const REQUIRED_BOUNDARIES: Record<string, string[]> = {
  triathlon: ['swim_start', 'swim_finish', 'bike_start', 'bike_finish', 'run_start', 'run_finish'],
  aquathlon: ['swim_start', 'swim_finish', 'run_start', 'run_finish'],
  duathlon: ['run_1_start', 'run_1_finish', 'bike_start', 'bike_finish', 'run_2_start', 'run_2_finish'],
  swimathon: ['swim_start', 'swim_finish'],
  running: ['run_start', 'run_finish'],
};

function issue(
  severity: CanonicalValidationIssue['severity'],
  code: string,
  message: string,
  bundle: Pick<CanonicalCourseBundle, 'eventId'>,
  contest?: Pick<CanonicalContestCourse, 'providerContestUuid'>,
  path?: string,
  providerId?: string,
): CanonicalValidationIssue {
  return {
    severity,
    code,
    message,
    eventId: bundle.eventId,
    contestUuid: contest?.providerContestUuid,
    path,
    providerId,
  };
}

function pushIssue(target: CanonicalValidationIssue[], value: CanonicalValidationIssue): void {
  target.push(value);
}

function validateContest(
  bundle: CanonicalCourseBundle,
  contest: CanonicalContestCourse,
  errors: CanonicalValidationIssue[],
  warnings: CanonicalValidationIssue[],
  finishToleranceKm: number,
): void {
  if (!contest.providerContestUuid) {
    pushIssue(errors, issue('error', 'provider_contest_unmapped', 'Provider contest UUID is required.', bundle, contest, 'providerContestUuid'));
  }
  if (!contest.bergmanTicketId) {
    pushIssue(errors, issue('error', 'bergman_ticket_unmapped', 'BERGMAN ticket mapping is required.', bundle, contest, 'bergmanTicketId'));
  }

  const splitKeys = new Set<string>();
  const splitOrders = new Set<number>();
  let previousOrder = Number.NEGATIVE_INFINITY;
  let previousDistance = Number.NEGATIVE_INFINITY;
  const timingPointUsage = new Map<string, typeof contest.splits>();
  const timingPointPassUsage = new Map<string, typeof contest.splits>();

  for (const split of contest.splits) {
    if (contest.providerEventUuid) {
      const expectedIdentityKey = [bundle.eventId, contest.providerEventUuid, contest.providerContestUuid, split.providerSplitId]
        .map((value) => String(value || '').trim().toLowerCase())
        .join(':');
      if (
        split.bergmanEventId !== bundle.eventId
        || split.providerEventUuid !== contest.providerEventUuid
        || split.contestUuid !== contest.providerContestUuid
        || split.splitUuid !== split.providerSplitId
        || split.canonicalIdentityKey !== expectedIdentityKey
      ) {
        pushIssue(errors, issue(
          'error',
          'split_scope_identity_mismatch',
          `Split ${split.key} does not retain its Bergman event, provider event, contest, and provider split identity.`,
          bundle,
          contest,
          `splits.${split.key}.canonicalIdentityKey`,
          split.providerSplitId,
        ));
      }
    }
    if (splitKeys.has(split.key)) {
      pushIssue(errors, issue('error', 'duplicate_split_key', `Duplicate split key: ${split.key}.`, bundle, contest, `splits.${split.key}`));
    }
    splitKeys.add(split.key);

    if (splitOrders.has(split.order)) {
      pushIssue(errors, issue('error', 'duplicate_split_order', `Duplicate split order: ${split.order}.`, bundle, contest, `splits.${split.key}.order`));
    }
    splitOrders.add(split.order);

    if (split.order <= previousOrder) {
      pushIssue(errors, issue('error', 'split_order_not_increasing', `Split order is not increasing at ${split.key}.`, bundle, contest, `splits.${split.key}.order`));
    }
    previousOrder = split.order;

    if (split.distanceInLegKm < 0) {
      pushIssue(errors, issue('error', 'negative_leg_distance', `Split ${split.key} has a negative distance in leg.`, bundle, contest, `splits.${split.key}.distanceInLegKm`));
    }
    if (split.cumulativeDistanceKm < previousDistance) {
      pushIssue(errors, issue('error', 'cumulative_distance_decreased', `Cumulative distance decreases at ${split.key}.`, bundle, contest, `splits.${split.key}.cumulativeDistanceKm`));
    }
    previousDistance = split.cumulativeDistanceKm;

    if (split.required && !split.providerSplitId) {
      pushIssue(errors, issue('error', 'required_provider_split_missing', `Required split ${split.key} has no provider split ID.`, bundle, contest, `splits.${split.key}.providerSplitId`));
    }

    if (!split.providerTimingPointId) {
      pushIssue(warnings, issue('warning', 'timing_point_unresolved_nonfatal', `Split ${split.key} has no resolved timing point; the provider split remains available.`, bundle, contest, `splits.${split.key}.providerTimingPointId`, split.providerSplitId));
    }

    if (split.providerTimingPointId) {
      const rows = timingPointUsage.get(split.providerTimingPointId) ?? [];
      rows.push(split);
      timingPointUsage.set(split.providerTimingPointId, rows);
      if (split.passNumber !== null) {
        const passKey = `${split.providerTimingPointId}:${split.passNumber}`;
        const passRows = timingPointPassUsage.get(passKey) ?? [];
        passRows.push(split);
        timingPointPassUsage.set(passKey, passRows);
      }
    }
  }

  const requiredBoundaries = REQUIRED_BOUNDARIES[contest.raceType] ?? [];
  for (const splitKey of requiredBoundaries) {
    if (!splitKeys.has(splitKey)) {
      pushIssue(errors, issue('error', 'required_boundary_missing', `Required boundary split ${splitKey} is missing.`, bundle, contest, `splits.${splitKey}`));
    }
  }

  const legOrders = new Set<number>();
  let priorLegOrder = Number.NEGATIVE_INFINITY;
  for (const leg of contest.legs) {
    if ((['t1', 't2', 'transition'] as string[]).includes(leg.type as string)) {
      pushIssue(errors, issue('error', 'transition_stored_as_leg', `Transition ${String(leg.type)} must not be a source leg.`, bundle, contest, `legs.${leg.key}.type`));
    }
    if (legOrders.has(leg.order) || leg.order <= priorLegOrder) {
      pushIssue(errors, issue('error', 'invalid_leg_order', `Leg order is invalid at ${leg.key}.`, bundle, contest, `legs.${leg.key}.order`));
    }
    legOrders.add(leg.order);
    priorLegOrder = leg.order;
    if (!splitKeys.has(leg.startSplitKey) || !splitKeys.has(leg.finishSplitKey)) {
      pushIssue(errors, issue('error', 'leg_boundary_missing', `Leg ${leg.key} references a missing boundary split.`, bundle, contest, `legs.${leg.key}`));
    }
    if (leg.gpxUrls.length === 0) {
      pushIssue(warnings, issue('warning', 'gpx_missing', `No GPX URL is configured for ${leg.displayName}.`, bundle, contest, `legs.${leg.key}.gpxUrls`));
    }
  }

  let previousTransitionOrder = Number.NEGATIVE_INFINITY;
  for (const transition of contest.transitions) {
    if (!splitKeys.has(transition.startSplitKey) || !splitKeys.has(transition.finishSplitKey)) {
      pushIssue(errors, issue('error', 'transition_boundary_missing', `${transition.displayName} references a missing boundary split.`, bundle, contest, `transitions.${transition.key}`));
    }
    if (transition.order <= previousTransitionOrder) {
      pushIssue(errors, issue('error', 'invalid_transition_order', `Transition order is invalid at ${transition.displayName}.`, bundle, contest, `transitions.${transition.key}.order`));
    }
    previousTransitionOrder = transition.order;
  }

  for (const [timingPointId, splits] of timingPointUsage) {
    if (splits.length < 2) continue;
    const ambiguous = splits.filter((split) => split.readSelectionRule === null && split.passNumber === null);
    if (ambiguous.length > 0) {
      pushIssue(warnings, issue('warning', 'shared_timing_point_unresolved_nonfatal', `Timing point ${timingPointId} is shared; split identity remains authoritative until a read rule is configured.`, bundle, contest, undefined, timingPointId));
      continue;
    }
    const missingPass = splits.filter((split) => split.readSelectionRule === 'pass_number' && split.passNumber === null);
    if (missingPass.length > 0) {
      pushIssue(warnings, issue('warning', 'repeated_timing_point_missing_pass', `Timing point ${timingPointId} has no pass number; the split is preserved and timing resolution remains pending.`, bundle, contest, undefined, timingPointId));
    }
  }

  for (const [timingPointPassKey, splits] of timingPointPassUsage) {
    if (splits.length < 2) continue;
    const splitNames = splits.map((split) => `${split.displayName} (${split.providerSplitId})`).join(', ');
    pushIssue(errors, issue(
      'error',
      'timing_point_pass_collision',
      `Provider event ${contest.providerEventUuid || 'unknown'} contest ${contest.providerContestUuid} maps timing point/pass ${timingPointPassKey} to multiple splits: ${splitNames}.`,
      bundle,
      contest,
      'splits',
      timingPointPassKey,
    ));
  }

  const orderedSplits = [...contest.splits].sort((left, right) => left.order - right.order);
  const raceFinishes = orderedSplits.filter((split) => split.isRaceFinish);
  const legacyFinish = raceFinishes.length === 0 && orderedSplits.at(-1)?.isFinish
    ? orderedSplits.at(-1)!
    : null;
  if (raceFinishes.length > 1) {
    pushIssue(errors, issue('error', 'multiple_race_finishes', 'Exactly one split may be designated as the Race Finish.', bundle, contest, 'splits'));
  }
  const finish = raceFinishes.length === 1 ? raceFinishes[0] : legacyFinish;
  if (!finish) {
    pushIssue(errors, issue('error', 'race_finish_missing', 'A designated final Race Finish split is required.', bundle, contest, 'splits'));
  } else if (finish.key !== orderedSplits.at(-1)?.key) {
    pushIssue(errors, issue('error', 'race_finish_not_final', `Race Finish ${finish.key} must be the final configured split.`, bundle, contest, `splits.${finish.key}`));
  } else if (!finish.isRaceFinish) {
    pushIssue(warnings, issue('warning', 'legacy_race_finish_marker', `Final split ${finish.key} uses the legacy isFinish marker; rebuild the course to persist isRaceFinish.`, bundle, contest, `splits.${finish.key}.isRaceFinish`));
  }
  for (const split of orderedSplits.slice(0, -1).filter((row) => row.isRaceFinish || row.isFinish)) {
    pushIssue(errors, issue('error', 'intermediate_split_marked_finish', `Intermediate split ${split.key} cannot be designated as Race Finish.`, bundle, contest, `splits.${split.key}`));
  }
  if (finish && contest.configuredRaceDistanceKm > 0) {
    const delta = Math.abs(finish.cumulativeDistanceKm - contest.configuredRaceDistanceKm);
    if (delta > finishToleranceKm) {
      pushIssue(errors, issue('error', 'finish_distance_mismatch', `Finish distance ${finish.cumulativeDistanceKm} km does not match configured distance ${contest.configuredRaceDistanceKm} km.`, bundle, contest, `splits.${finish.key}.cumulativeDistanceKm`));
    }
  }

  const optionalCheckpoints = contest.splits.filter((split) => !split.required && !split.providerSplitId);
  for (const split of optionalCheckpoints) {
    pushIssue(warnings, issue('warning', 'optional_checkpoint_missing', `Optional checkpoint ${split.displayName} is not mapped.`, bundle, contest, `splits.${split.key}`));
  }
}

export function validateCanonicalCourse(
  bundle: CanonicalCourseBundle,
  options: { finishToleranceKm?: number } = {},
): CanonicalValidationResult {
  const errors: CanonicalValidationIssue[] = [];
  const warnings: CanonicalValidationIssue[] = [];
  const finishToleranceKm = options.finishToleranceKm ?? 0.1;

  for (const contest of bundle.contests) {
    validateContest(bundle, contest, errors, warnings, finishToleranceKm);
  }

  if (bundle.contests.length === 0) {
    errors.push(issue('error', 'no_mapped_contests', 'No mapped contests were available for canonical course generation.', bundle));
  }

  return {
    schemaVersion: CANONICAL_SCHEMA_VERSION,
    eventId: bundle.eventId,
    buildVersion: bundle.buildVersion,
    updatedAt: bundle.updatedAt,
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

export function expectedLegTypes(raceType: CanonicalContestCourse['raceType']): CanonicalLegType[] {
  if (raceType === 'triathlon') return ['swim', 'bike', 'run'];
  if (raceType === 'aquathlon') return ['swim', 'run'];
  if (raceType === 'duathlon') return ['run_1', 'bike', 'run_2'];
  if (raceType === 'swimathon') return ['swim'];
  if (raceType === 'running') return ['run'];
  return ['swim', 'bike', 'run'];
}

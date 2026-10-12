import type {
  CanonicalStartConfiguration,
  CanonicalStartReadStatus,
  CanonicalStartTimingState,
  CanonicalTimingPassage,
  CanonicalTimingRead,
} from './contracts';
import {
  shadowNormalizeStartConfiguration,
  shadowProcessStartPassageRead,
  shadowProcessStartTimingRead,
  shadowResolveOfficialAthleteStart,
} from './shadow-timing-calculations';

export const DEFAULT_START_CONFIGURATION: CanonicalStartConfiguration = {
  mode: 'GUN',
  gunStartTime: null,
  ignoreReadsBeforeOfficialStart: true,
  dedupWindowSeconds: 5,
  validWindowMinutes: 30,
  dnsGraceMinutes: 60,
  strictFinalCutoff: false,
  startWindowOpenTime: null,
  startWindowCloseTime: null,
  passageGapSeconds: 3,
  timingReorderBufferMs: 2000,
  lockFirstAcceptedRead: true,
  storeAllRawReads: true,
  minimumFinishGapSeconds: 300,
  requireMandatorySplitsBeforeFinish: true,
};

export interface StartReadDecision {
  status: CanonicalStartReadStatus;
  reason: string;
  permittedStartTime: string | null;
  state: CanonicalStartTimingState;
  /** The canonical START read to apply to race calculations, if any. */
  canonicalRead: CanonicalTimingRead | null;
}

function iso(value: unknown): string | null {
  const normalized = String(value ?? '').trim();
  if (!normalized) return null;
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function seconds(value: unknown, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}

function normalizeStartConfigurationAuthoritative(value: unknown): CanonicalStartConfiguration {
  const row = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const rawMode = String(row.mode ?? row.startMode ?? row.startTimingMode ?? '').trim().toUpperCase();
  const mode = rawMode === 'CHIP' || rawMode === 'WAVE' ? rawMode : 'GUN';
  return {
    mode,
    gunStartTime: iso(row.gunStartTime ?? row.gun_start_time ?? row.officialStartTime ?? row.startWindowOpenTime),
    officialStartSource: row.officialStartSource === 'FEIBOT_CONTEST'
      || row.officialStartSource === 'TICKET_CONFIGURATION'
      || row.officialStartSource === 'EVENT_CONFIGURATION'
      ? row.officialStartSource
      : null,
    ignoreReadsBeforeOfficialStart: true,
    dedupWindowSeconds: seconds(row.dedupWindowSeconds ?? row.startDedupWindowSeconds, 5, 0, 120),
    validWindowMinutes: seconds(row.validWindowMinutes ?? row.startReadAfterMinutes, 30, 1, 240),
    dnsGraceMinutes: seconds(row.dnsGraceMinutes ?? row.dns_grace_minutes, 60, 1, 1_440),
    strictFinalCutoff: row.strictFinalCutoff === true,
    startWindowOpenTime: iso(row.startWindowOpenTime ?? row.start_window_open_time ?? row.gunStartTime ?? row.officialStartTime),
    startWindowCloseTime: iso(row.startWindowCloseTime ?? row.start_window_close_time),
    passageGapSeconds: seconds(row.passageGapSeconds ?? row.startPassageGapSeconds, 3, 0.1, 30),
    timingReorderBufferMs: seconds(row.timingReorderBufferMs, 2000, 0, 10000),
    lockFirstAcceptedRead: true,
    storeAllRawReads: true,
    minimumFinishGapSeconds: seconds(row.minimumFinishGapSeconds, 300, 0, 86_400),
    requireMandatorySplitsBeforeFinish: row.requireMandatorySplitsBeforeFinish !== false,
  };
}

export function normalizeStartConfiguration(value: unknown): CanonicalStartConfiguration {
  return shadowNormalizeStartConfiguration(value, normalizeStartConfigurationAuthoritative(value));
}

export function emptyStartTimingState(): CanonicalStartTimingState {
  return {
    officialStartTime: null,
    chipStartDetectionTime: null,
    startTimeSource: null,
    startTimeLocked: false,
    acceptedReadId: null,
    startPassageId: null,
    startReadCount: 0,
    startStatus: 'NOT_STARTED',
    updatedAt: null,
    startInferenceSource: null,
  };
}

export interface ResolvedOfficialAthleteStart {
  timingMode: CanonicalStartConfiguration['mode'];
  resolvedAthleteStartTime: string | null;
  startSource: NonNullable<CanonicalStartTimingState['startInferenceSource']>;
}

/**
 * The only authority for the athlete's official timing baseline. RFID
 * detection is deliberately separate from GUN/WAVE contest clocks.
 */
function resolveOfficialAthleteStartAuthoritative(input: {
  configuration: CanonicalStartConfiguration;
  waveStartTime?: string | null;
  acceptedChipStartTime?: string | null;
  manualOverrideTime?: string | null;
}): ResolvedOfficialAthleteStart {
  const manual = iso(input.manualOverrideTime);
  if (manual) {
    return {
      timingMode: input.configuration.mode,
      resolvedAthleteStartTime: manual,
      startSource: 'manual_override',
    };
  }
  if (input.configuration.mode === 'GUN') {
    return {
      timingMode: 'GUN',
      resolvedAthleteStartTime: iso(input.configuration.gunStartTime ?? input.configuration.startWindowOpenTime),
      startSource: 'official_gun_start',
    };
  }
  if (input.configuration.mode === 'WAVE') {
    return {
      timingMode: 'WAVE',
      resolvedAthleteStartTime: iso(input.waveStartTime),
      startSource: 'official_wave_start',
    };
  }
  const acceptedChipStart = iso(input.acceptedChipStartTime);
  return {
    timingMode: 'CHIP',
    resolvedAthleteStartTime: acceptedChipStart,
    startSource: acceptedChipStart ? 'accepted_chip_start' : 'awaiting_chip_start',
  };
}

export function resolveOfficialAthleteStart(
  input: Parameters<typeof resolveOfficialAthleteStartAuthoritative>[0],
): ResolvedOfficialAthleteStart {
  return shadowResolveOfficialAthleteStart(input, resolveOfficialAthleteStartAuthoritative(input));
}

function processStartTimingReadAuthoritative(input: {
  configuration: CanonicalStartConfiguration;
  waveStartTime?: string | null;
  currentState?: CanonicalStartTimingState | null;
  read: CanonicalTimingRead;
}): StartReadDecision {
  const { configuration, read } = input;
  const current = input.currentState ?? emptyStartTimingState();
  const readAt = iso(read.timestamp ?? read.occurredAt);
  const gunStart = iso(configuration.startWindowOpenTime ?? configuration.gunStartTime);
  const waveStart = iso(input.waveStartTime);
  const permittedStartTime = configuration.mode === 'WAVE'
    ? waveStart
    : configuration.mode === 'CHIP'
      ? waveStart ?? gunStart
      : gunStart;
  const closeTime = iso(configuration.startWindowCloseTime)
    ?? (permittedStartTime ? new Date(Date.parse(permittedStartTime) + configuration.validWindowMinutes * 60_000).toISOString() : null);
  const resolvedStart = resolveOfficialAthleteStart({
    configuration,
    waveStartTime: waveStart,
    acceptedChipStartTime: current.chipStartDetectionTime,
  });
  const fixedOfficialStart = configuration.mode === 'CHIP' ? null : resolvedStart.resolvedAthleteStartTime;
  const base: CanonicalStartTimingState = {
    ...current,
    officialStartTime: current.officialStartTime ?? fixedOfficialStart,
    startTimeSource: current.startTimeSource ?? (fixedOfficialStart ? configuration.mode : null),
    startInferenceSource: current.startInferenceSource ?? resolvedStart.startSource,
  };

  if (!readAt) return { status: 'INVALID', reason: 'reader_timestamp_invalid', permittedStartTime, state: base, canonicalRead: null };
  if (!permittedStartTime) return { status: 'INVALID', reason: 'permitted_start_missing', permittedStartTime: null, state: base, canonicalRead: null };

  const readMillis = Date.parse(readAt);
  const permittedMillis = Date.parse(permittedStartTime);
  if (readMillis < permittedMillis) {
    return { status: 'PRE_START', reason: 'before_permitted_start', permittedStartTime, state: base, canonicalRead: null };
  }

  const acceptedAt = iso(current.chipStartDetectionTime);
  const automaticStartAlreadyFinal = acceptedAt !== null
    || (current.startTimeLocked && (configuration.mode === 'CHIP' || Boolean(current.acceptedReadId)));
  if (automaticStartAlreadyFinal) {
    const withinDedup = acceptedAt !== null
      && readMillis - Date.parse(acceptedAt) <= configuration.dedupWindowSeconds * 1000;
    return {
      status: withinDedup ? 'DUPLICATE' : 'IGNORED',
      reason: withinDedup ? 'within_start_dedup_window' : 'start_time_already_locked',
      permittedStartTime,
      state: base,
      canonicalRead: null,
    };
  }

  if (closeTime && readMillis > Date.parse(closeTime)) {
    return {
      status: 'IGNORED',
      reason: 'outside_valid_start_window',
      permittedStartTime,
      state: { ...base, startStatus: 'NO_START_DETECTION', updatedAt: read.receivedAt || readAt },
      canonicalRead: null,
    };
  }

  const officialStartTime = configuration.mode === 'CHIP' ? readAt : fixedOfficialStart;
  if (!officialStartTime) return { status: 'INVALID', reason: 'official_start_missing', permittedStartTime, state: base, canonicalRead: null };
  const state: CanonicalStartTimingState = {
    officialStartTime,
    chipStartDetectionTime: readAt,
    startTimeSource: configuration.mode,
    startTimeLocked: configuration.lockFirstAcceptedRead,
    acceptedReadId: read.readId,
    startPassageId: current.startPassageId ?? null,
    startReadCount: Math.max(1, current.startReadCount ?? 0),
    startStatus: 'ON_COURSE',
    updatedAt: read.receivedAt || readAt,
    startInferenceSource: configuration.mode === 'CHIP'
      ? 'accepted_chip_start'
      : configuration.mode === 'WAVE'
        ? 'official_wave_start'
        : 'official_gun_start',
  };
  const officialMillis = Date.parse(officialStartTime);
  const overallElapsedSeconds = Math.max(0, (readMillis - officialMillis) / 1000);
  return {
    status: 'VALID',
    reason: configuration.mode === 'CHIP' ? 'first_valid_chip_start' : 'valid_start_detection',
    permittedStartTime,
    state,
    canonicalRead: {
      ...read,
      // Keep the accepted passage timestamp on the START split. GUN/WAVE use
      // their configured baseline for elapsed time, while CHIP naturally
      // resolves to zero because its passage is the baseline.
      timestamp: readAt,
      occurredAt: readAt,
      timeOfDay: read.timeOfDay,
      elapsedSeconds: overallElapsedSeconds,
      overallElapsedSeconds,
      status: 'valid',
    },
  };
}

export function processStartTimingRead(
  input: Parameters<typeof processStartTimingReadAuthoritative>[0],
): StartReadDecision {
  return shadowProcessStartTimingRead(input, processStartTimingReadAuthoritative(input));
}

/**
 * Establishes course progress after a valid downstream checkpoint. GUN/WAVE
 * use their configured clock. CHIP deliberately remains unresolved without an
 * accepted START passage; recovery inference must be an explicit admin action.
 */
export function establishStartFromDownstreamRead(input: {
  configuration: CanonicalStartConfiguration;
  waveStartTime?: string | null;
  currentState?: CanonicalStartTimingState | null;
  read: CanonicalTimingRead;
}): { state: CanonicalStartTimingState; startTimestamp: string | null; inferred: boolean } {
  const current = input.currentState ?? emptyStartTimingState();
  if (current.startTimeLocked && current.officialStartTime) {
    const resolved = resolveOfficialAthleteStart({
      configuration: input.configuration,
      waveStartTime: input.waveStartTime,
      acceptedChipStartTime: current.chipStartDetectionTime,
    });
    return {
      state: { ...current, startInferenceSource: resolved.startSource },
      startTimestamp: current.officialStartTime,
      inferred: false,
    };
  }
  const readAt = iso(input.read.timestamp ?? input.read.occurredAt);
  const gunStart = iso(input.configuration.startWindowOpenTime ?? input.configuration.gunStartTime);
  const waveStart = iso(input.waveStartTime);
  const permittedStart = input.configuration.mode === 'WAVE' ? waveStart : gunStart;
  if (!readAt || !permittedStart || Date.parse(readAt) < Date.parse(permittedStart)) {
    return { state: current, startTimestamp: null, inferred: false };
  }

  if (input.configuration.mode === 'CHIP') {
    return {
      inferred: false,
      startTimestamp: null,
      state: {
        ...current,
        officialStartTime: null,
        chipStartDetectionTime: null,
        startTimeSource: null,
        startTimeLocked: false,
        startStatus: 'NO_START_DETECTION',
        updatedAt: input.read.receivedAt || readAt,
        startInferenceSource: 'awaiting_chip_start',
      },
    };
  }
  const resolved = resolveOfficialAthleteStart({
    configuration: input.configuration,
    waveStartTime: waveStart,
  });
  const startTimestamp = resolved.resolvedAthleteStartTime;
  if (!startTimestamp) return { state: current, startTimestamp: null, inferred: false };
  return {
    inferred: false,
    startTimestamp,
    state: {
      ...current,
      officialStartTime: startTimestamp,
      chipStartDetectionTime: current.chipStartDetectionTime,
      startTimeSource: input.configuration.mode,
      startTimeLocked: true,
      acceptedReadId: current.acceptedReadId,
      startStatus: 'ON_COURSE',
      updatedAt: input.read.receivedAt || readAt,
      startInferenceSource: resolved.startSource,
    },
  };
}

export interface StartPassageDecision extends StartReadDecision {
  passage: CanonicalTimingPassage;
  rawStatus: CanonicalStartReadStatus;
  usedForTiming: boolean;
}

/** Rebase a split/finish reader hit to the athlete's accepted official start. */
export function rebaseTimingReadToOfficialStart(
  read: CanonicalTimingRead,
  officialStartTime: string,
): CanonicalTimingRead {
  const readAt = iso(read.timestamp ?? read.occurredAt);
  const startAt = iso(officialStartTime);
  if (!readAt || !startAt) return read;
  const elapsedSeconds = (Date.parse(readAt) - Date.parse(startAt)) / 1000;
  if (!Number.isFinite(elapsedSeconds) || elapsedSeconds < 0) return read;
  return { ...read, elapsedSeconds, timestamp: readAt, timeOfDay: read.timeOfDay ?? readAt.slice(11, 19) };
}

function passageId(read: CanonicalTimingRead): string {
  return `start-passage:${read.readId}`;
}

function samePassage(
  passage: CanonicalTimingPassage,
  readerTimestamp: string,
  gapSeconds: number,
  reorderBufferMs: number,
): boolean {
  const timestamp = Date.parse(readerTimestamp);
  const first = Date.parse(passage.passageFirstTimestamp);
  const last = Date.parse(passage.passageLastTimestamp);
  const gap = Math.max(0, gapSeconds) * 1000;
  // Earlier timestamps necessarily arrived out of order because this passage
  // already exists. Give those the configured reorder allowance while keeping
  // forward grouping constrained by the physical passage gap.
  const earlierAllowance = Math.max(gap, Math.max(0, reorderBufferMs));
  return timestamp >= first - earlierAllowance && timestamp <= last + gap;
}

/** Converts an idempotent raw START hit into a processed passage decision. */
function processStartPassageReadAuthoritative(input: {
  configuration: CanonicalStartConfiguration;
  waveStartTime?: string | null;
  currentState?: CanonicalStartTimingState | null;
  activePassage?: CanonicalTimingPassage | null;
  read: CanonicalTimingRead;
  bib?: string | null;
  chipCode?: string | null;
}): StartPassageDecision {
  const readAt = iso(input.read.timestamp ?? input.read.occurredAt);
  const receivedAt = iso(input.read.receivedAt) ?? new Date().toISOString();
  const baseDecision = processStartTimingRead(input);
  const initialStatus = baseDecision.status === 'VALID' ? 'VALID_START'
    : baseDecision.status === 'PRE_START' ? 'PRE_START'
      : baseDecision.status === 'MANUAL' ? 'MANUAL'
        : 'INVALID';
  const newPassage: CanonicalTimingPassage = {
    id: passageId(input.read), eventId: input.read.eventId, contestUuid: input.read.contestUuid,
    participantUuid: input.read.participantUuid || input.read.providerParticipantUuid,
    bib: input.bib ?? input.read.bib ?? null, chipCode: input.chipCode ?? input.read.chipCode ?? null,
    timingPointUuid: input.read.providerTimingPointId, timingPointType: 'START',
    readerUuid: input.read.readerUuid ?? null,
    passageFirstTimestamp: readAt ?? input.read.occurredAt,
    passageLastTimestamp: readAt ?? input.read.occurredAt,
    readCount: 1, passageStatus: initialStatus, usedForTiming: baseDecision.status === 'VALID',
    createdAt: receivedAt, updatedAt: receivedAt,
  };

  const activePassageCanAcceptRead = Boolean(
    readAt
    && input.activePassage
    && samePassage(
      input.activePassage,
      readAt,
      input.configuration.passageGapSeconds,
      input.configuration.timingReorderBufferMs,
    )
    // A read on the opposite side of the start-window boundary is a new
    // physical passage even when it is only milliseconds away.
    && !(
      input.activePassage.passageStatus === 'PRE_START'
      && baseDecision.status !== 'PRE_START'
    )
    && !(
      input.activePassage.passageStatus !== 'PRE_START'
      && baseDecision.status === 'PRE_START'
    )
  );

  if (!activePassageCanAcceptRead) {
    if (baseDecision.status === 'IGNORED' && input.currentState?.startTimeLocked) {
      newPassage.passageStatus = 'SECOND_PASSAGE';
      newPassage.usedForTiming = false;
      return { ...baseDecision, status: 'SECOND_PASSAGE', rawStatus: 'SECOND_PASSAGE', reason: 'later_start_passage_after_locked_start', passage: newPassage, usedForTiming: false, canonicalRead: null };
    }
    const state = baseDecision.status === 'VALID'
      ? { ...baseDecision.state, startPassageId: newPassage.id, startReadCount: 1 }
      : baseDecision.state;
    return { ...baseDecision, state, passage: newPassage, rawStatus: baseDecision.status, usedForTiming: baseDecision.status === 'VALID' };
  }

  // activePassageCanAcceptRead guarantees both values here; keep these local
  // assertions at the boundary so the rest of the passage update stays typed.
  const active = input.activePassage!;
  const activeReadAt = readAt!;
  const firstTimestamp = new Date(Math.min(Date.parse(active.passageFirstTimestamp), Date.parse(activeReadAt))).toISOString();
  const lastTimestamp = new Date(Math.max(Date.parse(active.passageLastTimestamp), Date.parse(activeReadAt))).toISOString();
  const passage: CanonicalTimingPassage = {
    ...active,
    passageFirstTimestamp: firstTimestamp,
    passageLastTimestamp: lastTimestamp,
    readCount: active.readCount + 1,
    updatedAt: receivedAt,
  };
  if (active.passageStatus === 'PRE_START') {
    return { ...baseDecision, status: 'PRE_START', rawStatus: 'PRE_START', reason: 'grouped_pre_start_passage', passage, usedForTiming: false, canonicalRead: null };
  }
  if (active.passageStatus === 'VALID_START' && active.usedForTiming) {
    const earlier = firstTimestamp < active.passageFirstTimestamp;
    const state: CanonicalStartTimingState = {
      ...(input.currentState ?? baseDecision.state),
      officialStartTime: input.configuration.mode === 'CHIP' && earlier ? firstTimestamp : (input.currentState?.officialStartTime ?? baseDecision.state.officialStartTime),
      chipStartDetectionTime: earlier ? firstTimestamp : (input.currentState?.chipStartDetectionTime ?? active.passageFirstTimestamp),
      startPassageId: active.id,
      startReadCount: passage.readCount,
    };
    const canonicalRead = earlier && input.configuration.mode === 'CHIP'
      ? { ...input.read, timestamp: firstTimestamp, occurredAt: firstTimestamp, timeOfDay: firstTimestamp.slice(11, 19), elapsedSeconds: 0, status: 'valid' as const }
      : null;
    return { ...baseDecision, status: 'DUPLICATE', rawStatus: 'DUPLICATE', reason: earlier ? 'out_of_order_read_attached_to_start_passage' : 'read_attached_to_start_passage', state, passage, usedForTiming: false, canonicalRead };
  }
  return { ...baseDecision, status: 'DUPLICATE', rawStatus: 'DUPLICATE', reason: 'read_grouped_into_existing_passage', passage, usedForTiming: false, canonicalRead: null };
}

export function processStartPassageRead(
  input: Parameters<typeof processStartPassageReadAuthoritative>[0],
): StartPassageDecision {
  return shadowProcessStartPassageRead(input, processStartPassageReadAuthoritative(input));
}

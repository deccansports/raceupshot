export const CANONICAL_SCHEMA_VERSION = 1 as const;

export type CanonicalRaceType = 'triathlon' | 'aquathlon' | 'duathlon' | 'relay' | 'swimathon' | 'running';
export type CanonicalLegType = 'swim' | 'bike' | 'run' | 'run_1' | 'run_2';
export type CanonicalSectionType = 'leg' | 'transition';
export type CanonicalSectionStatus = 'not_started' | 'in_progress' | 'completed';
export type CanonicalTransitionType = 't1' | 't2';
export type CanonicalTimingStatus =
  | 'pending'
  | 'provisional'
  | 'confirmed'
  | 'corrected'
  | 'rejected'
  | 'valid'
  | 'missing'
  | 'invalid'
  | 'estimated'
  | 'official'
  | 'manual_corrected';
export type CanonicalAthleteStatus =
  | 'not_started'
  | 'swimming'
  | 'in_t1'
  | 'cycling'
  | 'in_t2'
  | 'running'
  | 'finished'
  | 'dns'
  | 'dnf'
  | 'dnq'
  | 'disqualified'
  | 'missing_data'
  | 'timing_under_review';
export type CanonicalReadSource = 'feibot_cloud' | 'feibot_fdb' | 'feibot' | 'manual' | 'correction' | 'final' | 'simulation';
export type CanonicalRankingMode = 'overall' | 'gender' | 'age' | 'club';
export type CanonicalLeaderboardType = 'race' | 'split';
export type CanonicalValidationSeverity = 'error' | 'warning';
export type CanonicalBuildStatus = 'building' | 'validating' | 'ready' | 'active' | 'published' | 'failed' | 'failed_stale_build';
export type CanonicalReadSelectionRule = 'first' | 'last' | 'fastest' | 'pass_number' | 'manual';
export type CanonicalStartMode = 'GUN' | 'WAVE' | 'CHIP';
export type CanonicalStartTimeSource = CanonicalStartMode | 'MANUAL';
export type CanonicalStartReadStatus = 'RAW' | 'PRE_START' | 'VALID' | 'DUPLICATE' | 'SECOND_PASSAGE' | 'AFTER_START_DUPLICATE' | 'IGNORED' | 'MANUAL' | 'INVALID';
export type CanonicalPassageStatus = 'VALID_START' | 'PRE_START' | 'DUPLICATE' | 'SECOND_PASSAGE' | 'INVALID' | 'MANUAL';
export type CanonicalStartStatus = 'NOT_STARTED' | 'START_WINDOW_OPEN' | 'NO_START_DETECTION' | 'START_DETECTED' | 'ON_COURSE' | 'FINISHED' | 'DNS' | 'DNF' | 'DSQ';
export type CanonicalTerminalStatusSource = 'MANUAL_OVERRIDE' | 'AUTO_TIMING_RULE' | 'AUTO_CUTOFF_RULE' | 'CANONICAL_TIMING';
export type CanonicalTimingPointType = 'START' | 'SPLIT' | 'LAP' | 'FINISH';

export interface CanonicalStartConfiguration {
  mode: CanonicalStartMode;
  /** Absolute ISO timestamp. This avoids race-date and timezone ambiguity. */
  gunStartTime: string | null;
  /** Records where the synchronized official/permitted start came from. */
  officialStartSource?: 'FEIBOT_CONTEST' | 'TICKET_CONFIGURATION' | 'EVENT_CONFIGURATION' | null;
  ignoreReadsBeforeOfficialStart: boolean;
  dedupWindowSeconds: number;
  validWindowMinutes: number;
  /** Minutes after the applicable official start before a missing START becomes DNS. */
  dnsGraceMinutes: number;
  /** When true, an accepted final read after the final cutoff resolves as DNF. */
  strictFinalCutoff: boolean;
  startWindowOpenTime: string | null;
  startWindowCloseTime: string | null;
  passageGapSeconds: number;
  timingReorderBufferMs: number;
  lockFirstAcceptedRead: boolean;
  storeAllRawReads: boolean;
  /** Minimum elapsed time before a shared START/FINISH point may finish an athlete. */
  minimumFinishGapSeconds: number;
  /** When true, every required split before FINISH must already be accepted. */
  requireMandatorySplitsBeforeFinish: boolean;
}

export interface CanonicalStartTimingState {
  officialStartTime: string | null;
  chipStartDetectionTime: string | null;
  startTimeSource: CanonicalStartTimeSource | null;
  startTimeLocked: boolean;
  acceptedReadId: string | null;
  startPassageId?: string | null;
  startReadCount?: number;
  startStatus: CanonicalStartStatus;
  updatedAt: string | null;
  /** Audit provenance for the effective athlete start shown to clients. */
  startInferenceSource?:
    | 'official_gun_start'
    | 'official_wave_start'
    | 'accepted_chip_start'
    | 'awaiting_chip_start'
    | 'manual_override'
    | 'recovery_inferred'
    // Legacy stored values remain readable; new writes never emit them.
    | 'reader'
    | 'persisted'
    | 'inferred_from_split'
    | 'official_start'
    | null;
}

export interface CanonicalStartReadAudit {
  id: string;
  eventId: string;
  contestUuid: string;
  participantUuid: string;
  bib: string | null;
  chipCode: string | null;
  /** Canonical logical split resolved for this timing decision. */
  splitKey?: string | null;
  splitName?: string | null;
  providerSplitId?: string | null;
  passNumber?: number | null;
  isRaceStart?: boolean;
  timingPointUuid: string;
  readerUuid: string | null;
  antennaId: string | null;
  readerTimestamp: string;
  receivedTimestamp: string;
  signalStrength: number | null;
  source: CanonicalReadSource;
  processingStatus: CanonicalStartReadStatus;
  processingReason: string;
  passageId: string | null;
  usedForTiming: boolean;
  permittedStartTime: string | null;
  officialStartTime: string | null;
  chipStartDetectionTime: string | null;
  startTimeSource: CanonicalStartTimeSource | null;
}

export interface CanonicalTimingPassage {
  id: string;
  eventId: string;
  contestUuid: string;
  participantUuid: string;
  bib: string | null;
  chipCode: string | null;
  timingPointUuid: string;
  timingPointType: CanonicalTimingPointType;
  readerUuid: string | null;
  passageFirstTimestamp: string;
  passageLastTimestamp: string;
  readCount: number;
  passageStatus: CanonicalPassageStatus;
  usedForTiming: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CanonicalPersistedRecord {
  schemaVersion: typeof CANONICAL_SCHEMA_VERSION;
  eventId: string;
  updatedAt: string;
  buildVersion: string;
}

export interface CanonicalEventManifest {
  schemaVersion: typeof CANONICAL_SCHEMA_VERSION;
  eventId: string;
  activeVersion: string;
  previousVersion: string | null;
  provider: 'feibot' | 'manual';
  courseVersion: number;
  participantVersion: number;
  timingVersion: number;
  leaderboardVersion: number;
  eventName?: string;
  timezone?: string;
  status?: 'upcoming' | 'live' | 'completed' | 'archived';
  participantCount?: number;
  contestMappings?: Record<string, { bergmanTicketId: string; name: string }>;
  completeBuildValid?: boolean;
  publishedAt: string;
  updatedAt: string;
}

export interface CanonicalBuildManifest extends CanonicalPersistedRecord {
  status: CanonicalBuildStatus;
  provider: 'feibot' | 'manual';
  source: CanonicalReadSource;
  startedAt: string;
  completedAt: string | null;
  artifactKeys: string[];
  error?: string;
}

export interface CanonicalBuildSummary extends CanonicalPersistedRecord {
  version: string;
  startedAt: string;
  completedAt: string | null;
  status: CanonicalBuildStatus;
  expectedParticipants: number;
  writtenParticipants: number;
  expectedContests: number;
  writtenContests: number;
  unresolvedContests: number;
  fatalErrors: number;
  warnings: number;
  valid: boolean;
  publishable: boolean;
  active: boolean;
}

export interface CanonicalValidationIssue {
  severity: CanonicalValidationSeverity;
  code: string;
  message: string;
  eventId: string;
  contestUuid?: string;
  path?: string;
  providerId?: string;
}

export interface CanonicalValidationResult extends CanonicalPersistedRecord {
  valid: boolean;
  errors: CanonicalValidationIssue[];
  warnings: CanonicalValidationIssue[];
}

export interface CanonicalSplit {
  /** Full logical identity. A physical timing point is not a split identity. */
  bergmanEventId?: string;
  providerEventUuid?: string;
  contestUuid?: string;
  splitUuid?: string;
  canonicalIdentityKey?: string;
  key: string;
  providerSplitId: string;
  providerTimingPointId: string | null;
  /** Feibot UUID used to correlate timing reads when supplied separately. */
  providerTimingPointUuid?: string | null;
  /** Feibot numeric timing-point ID. This is not a local display ID. */
  providerTimingPointNumericId?: string | null;
  timingPointResolutionStatus?: 'resolved' | 'unresolved_nonfatal';
  displayName: string;
  providerName?: string;
  canonicalCode: string;
  order: number;
  legType: CanonicalLegType;
  distanceInLegKm: number;
  cumulativeDistanceKm: number;
  readSelectionRule: CanonicalReadSelectionRule | null;
  passNumber: number | null;
  rankingEnabled: boolean;
  required: boolean;
  /** True only for the first official split of the race. */
  isRaceStart?: boolean;
  /** True for a start boundary of any configured leg. */
  isLegStart?: boolean;
  /** True only for the final official split of the race. */
  isRaceFinish?: boolean;
  /** True for a finish boundary of any configured leg. */
  isLegFinish?: boolean;
  /** Legacy race-level alias. Prefer isRaceStart. */
  isStart: boolean;
  /** Legacy race-level alias. Prefer isRaceFinish. */
  isFinish: boolean;
  timingPointType: CanonicalTimingPointType;
  startDetectionEnabled: boolean;
  passageGroupingEnabled: boolean;
  passageGapSeconds: number | null;
}

export interface CanonicalRaceLeg {
  key: string;
  type: CanonicalLegType;
  displayName: string;
  order: number;
  providerLegId: string | null;
  startSplitKey: string;
  finishSplitKey: string;
  distanceKm: number;
  gpxUrls: string[];
  geometryStatus?: 'available' | 'missing' | 'estimated';
  geometrySource?: 'gpx' | 'timing_points' | 'course_index' | 'fallback' | 'none';
  estimated?: boolean;
  cutoffSeconds: number | null;
  splits: CanonicalSplit[];
}

export interface CanonicalTransition {
  key: CanonicalTransitionType;
  type: CanonicalTransitionType;
  displayName: 'T1' | 'T2';
  order: number;
  fromLegType: CanonicalLegType;
  toLegType: CanonicalLegType;
  startSplitKey: string;
  finishSplitKey: string;
}

export interface CanonicalLegSection {
  key: string;
  sectionType: 'leg';
  order: number;
  displayName: string;
  legType: CanonicalLegType;
  startSplitKey: string;
  finishSplitKey: string;
  status?: CanonicalSectionStatus;
  durationSeconds?: number | null;
  activeSince?: string | null;
  averageMetric?: number | null;
  rankings?: CanonicalOverallRanking;
  rows?: CanonicalSplitRow[];
}

export interface CanonicalTransitionSection {
  key: CanonicalTransitionType;
  sectionType: 'transition';
  order: number;
  displayName: 'T1' | 'T2';
  transitionType: CanonicalTransitionType;
  startSplitKey: string;
  finishSplitKey: string;
  status?: CanonicalSectionStatus;
  durationSeconds?: number | null;
  /** Provenance for diagnostics; public presentation only renders name and duration. */
  transitionSource?: 'feibot' | 'calculated' | 'pending';
  activeSince?: string | null;
  rows?: CanonicalSplitRow[];
}

export type CanonicalRaceSection = CanonicalLegSection | CanonicalTransitionSection;

export interface CanonicalContestCourse {
  /** Feibot event that owns this contest. Required when a Bergman event merges multiple provider events. */
  providerEventUuid?: string | null;
  providerContestUuid: string;
  bergmanTicketId: string;
  legacyContestIds: string[];
  displayName: string;
  raceType: CanonicalRaceType;
  timezone: string;
  courseVersion: number;
  configuredRaceDistanceKm: number;
  totalDistanceKm: number;
  gpxUrls: string[];
  cutoffs: Record<string, number>;
  legs: CanonicalRaceLeg[];
  transitions: CanonicalTransition[];
  sections: CanonicalRaceSection[];
  splits: CanonicalSplit[];
  startConfiguration?: CanonicalStartConfiguration;
}

export interface CanonicalCourseBundle extends CanonicalPersistedRecord {
  source: Extract<CanonicalReadSource, 'feibot_cloud' | 'feibot_fdb' | 'manual'>;
  provider: 'feibot' | 'manual';
  timezone: string;
  courseVersion: number;
  contests: CanonicalContestCourse[];
  validation: CanonicalValidationResult;
}

export interface CanonicalParticipantIndexRow {
  /** Feibot event that owns the participant's contest. */
  providerEventUuid?: string | null;
  participantUuid: string;
  providerParticipantUuid: string;
  chipCode: string | null;
  waveStartTime: string | null;
  bib: string;
  displayName: string;
  contestUuid: string;
  /** Contest UUID received from Feibot before alias/canonical routing. */
  providerContestUuid?: string;
  /** Contest UUID used for canonical course, timing, and leaderboard routing. */
  canonicalContestUuid?: string;
  contestName: string;
  genderKey: string | null;
  ageGroupKey: string | null;
  clubName: string | null;
  countryCode: string | null;
  photoUrl: string | null;
  trackingVisibility?: 'PUBLIC' | 'ANONYMOUS';
  status: CanonicalAthleteStatus;
  statusReason?: string | null;
  statusSource?: CanonicalTerminalStatusSource | null;
  statusResolvedAt?: string | null;
  failedCheckpoint?: string | null;
  cutoffSeconds?: number | null;
  cutoffDeadline?: string | null;
  elapsedAtResolution?: number | null;
  currentLeg: CanonicalLegType | null;
  lastSplitKey: string | null;
  lastSplitLabel: string | null;
  overallSeconds: number | null;
  overallRank: number | null;
}

export interface CanonicalParticipantIndex extends CanonicalPersistedRecord {
  participantCount: number;
  rows: CanonicalParticipantIndexRow[];
}

export interface CanonicalAlias {
  schemaVersion: typeof CANONICAL_SCHEMA_VERSION;
  eventId: string;
  updatedAt: string;
  buildVersion: string;
  aliasType: 'bib' | 'provider' | 'uid' | 'booking' | 'email_hash';
  participantUuid: string;
}

export interface CanonicalAliasArtifact {
  key: string;
  value: CanonicalAlias;
}

export interface CanonicalAthleteIdentity {
  participantUuid: string;
  providerParticipantUuid: string;
  chipCode: string | null;
  bib: string;
  displayName: string;
  genderKey: string | null;
  ageGroupKey: string | null;
  dateOfBirth: string | null;
  clubName: string | null;
  countryCode: string | null;
  photoUrl: string | null;
  trackingVisibility?: 'PUBLIC' | 'ANONYMOUS';
  waveStartTime?: string | null;
}

export interface CanonicalBergmanIdentity {
  firebaseUid: string | null;
  bookingId: string | null;
  ticketId: string | null;
  subCategoryId: string | null;
  registrationId: string | null;
  matched: boolean;
  matchedBy: 'provider_uuid' | 'provider_record_id' | 'bib_contest' | 'email' | 'booking_id' | 'registration_id' | 'manual' | 'unmatched';
  profileUpdatedAt: string | null;
}

export interface CanonicalSplitRanking {
  splitKey: string;
  overallRank: number | null;
  genderRank: number | null;
  ageGroupRank: number | null;
  overallTotal: number | null;
  genderTotal: number | null;
  ageGroupTotal: number | null;
}

export interface CanonicalOverallRanking {
  overallRank: number | null;
  genderRank: number | null;
  ageGroupRank: number | null;
  clubRank: number | null;
}

export interface CanonicalAthleteLocation {
  segment: CanonicalLegType | CanonicalTransitionType | 'not_started' | 'finished';
  latitude: number | null;
  longitude: number | null;
  courseDistanceKm: number | null;
  legDistanceKm: number | null;
  accuracyMetres: number | null;
  recordedAt: string | null;
  source: 'timing_read' | 'estimated' | 'not_started' | 'finished';
  estimated: boolean;
}

export interface CanonicalSplitRow {
  splitKey: string;
  displayName: string;
  legType: CanonicalLegType;
  status: CanonicalTimingStatus;
  readAt: string | null;
  timeOfDay: string | null;
  elapsedSeconds: number | null;
  /** Continuous elapsed race time from this athlete's official start. */
  overallElapsedSeconds: number | null;
  /** Elapsed time from the accepted start boundary of this sport leg. */
  legElapsedSeconds: number | null;
  /** Elapsed time since the immediately preceding configured timing point. */
  sectionElapsedSeconds: number | null;
  /** Backward-compatible alias for sectionElapsedSeconds. */
  sectionSeconds: number | null;
  paceSecondsPerKm: number | null;
  paceSecondsPer100m: number | null;
  speedKmh: number | null;
  ranking: CanonicalSplitRanking | null;
  progressStatus?: 'PENDING' | 'CURRENT' | 'COMPLETED' | 'SKIPPED' | 'INVALID' | 'HELD';
}

export interface CanonicalResolvedSplitState {
  splitKey: string;
  providerSplitId: string;
  timingPointUuid: string | null;
  name: string;
  legType: CanonicalLegType;
  order: number;
  /** Distance measured inside this sport leg (used for GPX and leg pace). */
  legDistanceKm: number;
  /** Distance from the beginning of the complete race. */
  cumulativeRaceDistanceKm: number;
  /** Backward-compatible cumulative race distance. */
  distanceKm: number;
  status: 'PENDING' | 'CURRENT' | 'COMPLETED' | 'SKIPPED' | 'INVALID' | 'HELD';
  readAt: string | null;
  timeOfDay: string | null;
  elapsedSeconds: number | null;
  /** Continuous elapsed race time from this athlete's official start. */
  overallElapsedSeconds: number | null;
  /** Elapsed time from the accepted start boundary of this sport leg. */
  legElapsedSeconds: number | null;
  /** Elapsed time since the immediately preceding configured timing point. */
  sectionElapsedSeconds: number | null;
  /** Backward-compatible alias for sectionElapsedSeconds. */
  segmentElapsedSeconds: number | null;
  overallRank: number | null;
  categoryRank: number | null;
  genderRank: number | null;
  passageNumber: number | null;
}

export interface CanonicalResolvedAthleteState {
  eventTimezone: string;
  hasStarted: boolean;
  status: 'NOT_STARTED' | 'WAITING_CHIP_START' | 'ON_COURSE' | 'FINISHED' | 'DNF' | 'DNS' | 'DSQ';
  statusReason: string | null;
  statusSource: CanonicalTerminalStatusSource | null;
  statusResolvedAt: string | null;
  failedCheckpoint: string | null;
  cutoffSeconds: number | null;
  cutoffDeadline: string | null;
  elapsedAtResolution: number | null;
  timingMode: CanonicalStartMode;
  /** Explicit public/API timing authority. Clients render this mode, not inferred clocks. */
  officialTimingMode: CanonicalStartMode;
  gunStartTime: string | null;
  athleteStartTime: string | null;
  gunStartTimeUtc: string | null;
  athleteStartTimeUtc: string | null;
  /** Official contest gun baseline. This is never a START-mat detection. */
  officialGunStartAt: string | null;
  /** Accepted physical START reader passage for this athlete, when present. */
  startReaderAt: string | null;
  /** Backward-friendly explicit accepted START evidence. */
  acceptedStartAt: string | null;
  /** Selected official clock baseline for this athlete. */
  officialStartAt: string | null;
  /** Contest-wide gun baseline retained in every timing mode. */
  gunStartAt: string | null;
  /** Accepted athlete START-mat passage, when present. */
  chipStartAt: string | null;
  /** Assigned wave baseline, when configured. */
  waveStartAt: string | null;
  /** Physical START passage delay from the contest gun baseline. */
  startDelayMs: number | null;
  /** Gun elapsed accumulated when the athlete crossed START. */
  gunElapsedAtStartMs: number | null;
  /** Current/frozen elapsed value selected by officialTimingMode. */
  officialElapsedMs: number | null;
  officialRaceElapsedMs: number | null;
  /** Canonical continuous race clock. It freezes at the accepted finish. */
  liveOverallElapsedMs: number | null;
  /** Live elapsed time inside the current configured sport leg. */
  currentLegElapsedMs: number | null;
  /** Live elapsed time since the last accepted configured timing point. */
  currentSectionElapsedMs: number | null;
  athleteElapsedMs: number | null;
  finishTimeUtc: string | null;
  finishTimeOfDay: string | null;
  /** True only when the configured final split has an accepted official read. */
  finalSplitAccepted: boolean;
  /** Accepted configured-final-split timestamp. */
  finishAt: string | null;
  /** Explicit alias used by result/certificate consumers. */
  officialFinishAt: string | null;
  finalElapsedMs: number | null;
  gunElapsedMs: number | null;
  chipElapsedMs: number | null;
  waveElapsedMs: number | null;
  officialResultElapsedMs: number | null;
  officialResultBasis: 'CHIP' | 'GUN' | 'WAVE';
  overallRank: number | null;
  categoryRank: number | null;
  genderRank: number | null;
  clubRank?: number | null;
  finalRank?: number | null;
  averageRacePaceSecondsPerKm?: number | null;
  finishCutoffSeconds: number | null;
  cutoffTimeRemainingSeconds: number | null;
  cutoffStatus: 'WITHIN_CUTOFF' | 'CUTOFF_EXCEEDED' | null;
  cutoff: {
    activeCutoffKey: string;
    displayName: string;
    boundarySplitKey: string;
    deadlineUtc: string;
    deadlineLocal: string;
    remainingSeconds: number;
    officialStatus: 'ON_COURSE' | 'OUT_OF_CUTOFF';
    projectionStatus: 'SAFE' | 'DANGER' | 'PROJECTED_OUT' | 'NO_ESTIMATE';
    projectedArrivalUtc: string | null;
  } | null;
  startSource: CanonicalStartTimingState['startInferenceSource'];
  currentLeg: CanonicalLegType | null;
  /** Configured section authority. Unlike currentLeg, this can be T1/T2. */
  currentSectionKey: string | null;
  currentSectionType: CanonicalSectionType | null;
  currentSectionStatus: CanonicalSectionStatus | 'finished';
  previousSectionKey: string | null;
  nextSectionKey: string | null;
  currentSectionActiveSince: string | null;
  lastCompletedSplit: CanonicalResolvedSplitState | null;
  currentSplit: CanonicalResolvedSplitState | null;
  nextExpectedSplit: CanonicalResolvedSplitState | null;
  lastTimingPoint: CanonicalResolvedSplitState | null;
  officialDistanceKm: number;
  estimatedDistanceKm: number;
  officialLegDistanceKm: number;
  estimatedLegDistanceKm: number;
  currentLegDistanceKm: number;
  currentLegProgressRatio: number;
  totalDistanceKm: number;
  distanceRemainingKm: number;
  estimatedDistanceRemainingKm: number;
  distanceToNextSplitKm: number;
  officialProgressRatio: number;
  estimatedProgressRatio: number;
  etaNextSplit: string | null;
  /** Predicted cumulative race elapsed when the next checkpoint is reached. */
  estimatedElapsedAtNextSplitSeconds: number | null;
  /** Predicted cumulative race elapsed at the configured final checkpoint. */
  estimatedFinishElapsedSeconds: number | null;
  /** Countdown duration from the snapshot timestamp to the next checkpoint. */
  estimatedSecondsToNextSplit: number | null;
  estimatedFinishTime: string | null;
  predictionAnchorTimeUtc: string | null;
  predictionAnchorDistanceKm: number;
  nextSplitDistanceKm: number | null;
  awaitingCheckpointConfirmation: boolean;
  courseState: 'NOT_STARTED' | 'ON_COURSE' | 'WAITING_CHECKPOINT_CONFIRMATION' | 'LEG_COMPLETE_AWAITING_NEXT_START' | 'FINISHED' | 'TERMINAL';
  statusDetail: string;
  predictedPaceSecondsPerKm: number | null;
  predictedSpeedKmh: number | null;
  predictionSource: 'LIVE_SPLIT_PACE' | 'RACE_AVERAGE' | 'ATHLETE_HISTORY' | 'CONTEST_DEFAULT' | 'OFFICIAL_START' | 'NO_TRANSITION_ETA' | 'NO_ESTIMATE';
  predictionConfidence: 'LOW' | 'MEDIUM' | 'HIGH';
  positionSource: 'GPS' | 'OFFICIAL_TIMING_PREDICTION' | 'OFFICIAL_TIMING_POINT' | 'NO_POSITION';
  lastOfficialReadAt: string | null;
  splits: CanonicalResolvedSplitState[];
}

export interface CanonicalRaceState {
  status: CanonicalAthleteStatus;
  statusReason?: string | null;
  statusSource?: CanonicalTerminalStatusSource | null;
  statusResolvedAt?: string | null;
  failedCheckpoint?: string | null;
  cutoffSeconds?: number | null;
  cutoffDeadline?: string | null;
  elapsedAtResolution?: number | null;
  currentSectionKey: string | null;
  currentLegType: CanonicalLegType | null;
  progressRatio: number;
  distanceCompletedKm: number;
  elapsedSeconds: number | null;
  lastReadAt: string | null;
  resolved?: CanonicalResolvedAthleteState;
}

export interface CanonicalAthleteSnapshot extends CanonicalPersistedRecord {
  /** Feibot event that owns this athlete's contest and timing flow. */
  providerEventUuid?: string | null;
  contestUuid: string;
  /** Contest UUID received from Feibot before alias/canonical routing. */
  providerContestUuid?: string;
  /** Explicit canonical routing UUID. Equal to contestUuid for new records. */
  canonicalContestUuid?: string;
  courseVersion: number;
  timingVersion: number;
  leaderboardVersion: number;
  identity: CanonicalAthleteIdentity;
  bergmanIdentity: CanonicalBergmanIdentity;
  raceState: CanonicalRaceState;
  reads: Record<string, CanonicalTimingRead | null>;
  calculated: CanonicalCalculatedMetrics;
  sections: CanonicalRaceSection[];
  splits: CanonicalSplitRow[];
  overallRanking: CanonicalOverallRanking;
  splitRankings: Record<string, CanonicalSplitRanking>;
  location: CanonicalAthleteLocation | null;
  startTiming?: CanonicalStartTimingState;
  versions: CanonicalSnapshotVersions;
  /** Stable server-side finish projection for existing web/mobile clients. */
  finalSummary?: CanonicalFinalSummary;
  /** Backward-compatible duration summary consumed by compact race cards. */
  summary?: CanonicalFinishedTimingSummary;
  /** Preformatted labels; raw numeric canonical fields remain authoritative. */
  display?: CanonicalAthleteDisplay;
  status?: string;
  currentLeg?: CanonicalLegType | 'FINISHED' | null;
  currentSplit?: string | null;
  rank?: number | null;
  overallRank?: number | null;
  finalRank?: number | null;
  genderRank?: number | null;
  ageGroupRank?: number | null;
  clubRank?: number | null;
  averageRacePaceSecondsPerKm?: number | null;
  averagePaceSecondsPerKm?: number | null;
  averagePace?: number | null;
  avgPace?: number | null;
  pace?: number | null;
  averagePaceLabel?: string | null;
  finishTime?: number | null;
  overallTime?: number | null;
}

export interface CanonicalCalculatedMetrics {
  swimSeconds: number | null;
  t1Seconds: number | null;
  bikeSeconds: number | null;
  t2Seconds: number | null;
  runSeconds: number | null;
  overallSeconds: number | null;
  averageSwimPaceSecondsPer100m: number | null;
  averageBikeSpeedKmh: number | null;
  averageRunPaceSecondsPerKm: number | null;
  averageRacePaceSecondsPerKm: number | null;
}

export interface CanonicalFinishedTimingSummary {
  swimSeconds: number | null;
  t1Seconds: number | null;
  bikeSeconds: number | null;
  t2Seconds: number | null;
  runSeconds: number | null;
  overallSeconds: number | null;
}

export interface CanonicalFinalSummary extends CanonicalFinishedTimingSummary {
  finished: boolean;
  finishTimeUtc: string | null;
  finishTimeOfDay: string | null;
  overallRank: number | null;
  genderRank: number | null;
  ageGroupRank: number | null;
  clubRank: number | null;
  averageRacePaceSecondsPerKm: number | null;
  averageRunPaceSecondsPerKm: number | null;
  averageBikeSpeedKmh: number | null;
  averageSwimPaceSecondsPer100m: number | null;
  totalDistanceKm: number;
  rankDisplay: string | null;
  paceDisplay: string | null;
}

export interface CanonicalAthleteDisplay {
  statusLabel: string;
  overallTimeLabel: string | null;
  overallRankLabel: string | null;
  overallRankOrdinal: string | null;
  averageRacePaceLabel: string | null;
  swimTimeLabel: string | null;
  t1TimeLabel: string | null;
  bikeTimeLabel: string | null;
  t2TimeLabel: string | null;
  runTimeLabel: string | null;
  finishTimeLabel: string | null;
}

export interface CanonicalSnapshotVersions {
  course: number;
  participant: number;
  timing: number;
  profile: number;
  leaderboard: number;
}

export interface CanonicalTimingRead extends CanonicalPersistedRecord {
  /** Feibot event scope used to resolve this read. */
  providerEventUuid?: string | null;
  /** Present only when one physical crossing explicitly derives an adjacent logical boundary. */
  derivedFromReadId?: string | null;
  derivationReason?: 'ADJACENT_SHARED_TIMING_POINT' | null;
  readId: string;
  participantUuid: string;
  providerParticipantUuid: string;
  contestUuid: string;
  providerSplitId: string;
  providerTimingPointId: string;
  splitKey: string;
  splitName: string;
  elapsedSeconds: number | null;
  /** Timestamp-derived elapsed from the contest gun baseline. */
  gunElapsedSeconds?: number | null;
  /** Timestamp-derived elapsed from the athlete's accepted CHIP start. */
  chipElapsedSeconds?: number | null;
  /** Timestamp-derived elapsed from the athlete's assigned wave start. */
  waveElapsedSeconds?: number | null;
  /** Clock selected by the configured contest timing mode. */
  officialElapsedSeconds?: number | null;
  /** Feibot's processed GunTimeFromStartFormated evidence. */
  feibotGunElapsedSeconds?: number | null;
  /** Feibot's processed ChipTimeFromStartFormated evidence. */
  feibotChipElapsedSeconds?: number | null;
  /** Provider calculated-result identity, kept for reconciliation/audit. */
  providerResultId?: string | null;
  /** Continuous elapsed race time; never resets at a leg boundary. */
  overallElapsedSeconds?: number | null;
  legElapsedSeconds: number | null;
  segmentElapsedSeconds: number | null;
  /** Duration of the completed configured leg/transition section at this read. */
  sectionSeconds?: number | null;
  timeOfDay: string | null;
  timestamp: string | null;
  occurredAt: string;
  receivedAt: string;
  passNumber: number | null;
  status: CanonicalTimingStatus;
  source: CanonicalReadSource;
  bib?: string | null;
  chipCode?: string | null;
  rawChipCode?: string | null;
  readerUuid?: string | null;
  antennaId?: string | null;
  signalStrength?: number | null;
}

export interface CanonicalLeaderboardEntry {
  participantUuid: string;
  providerParticipantUuid: string;
  bib: string;
  displayName: string;
  rank: number;
  elapsedSeconds: number | null;
  /** The timing clock used to rank this row. */
  officialTimingMode?: CanonicalStartMode;
  /** Explicit alias for elapsedSeconds; always the configured official clock. */
  officialElapsedSeconds?: number | null;
  /** Secondary diagnostic clocks; never substitute these for officialElapsedSeconds. */
  gunElapsedSeconds?: number | null;
  chipElapsedSeconds?: number | null;
  waveElapsedSeconds?: number | null;
  status: CanonicalAthleteStatus;
  statusReason?: string | null;
  statusSource?: CanonicalTerminalStatusSource | null;
  statusResolvedAt?: string | null;
  failedCheckpoint?: string | null;
  cutoffSeconds?: number | null;
  cutoffDeadline?: string | null;
  elapsedAtResolution?: number | null;
  genderKey: string | null;
  ageGroupKey: string | null;
  clubName: string | null;
  countryCode: string | null;
  photoUrl: string | null;
  trackingVisibility?: 'PUBLIC' | 'ANONYMOUS';
  lastSplitKey: string | null;
  lastSplitOrder: number;
  distanceCompletedKm: number;
  readTimestamp: string | null;
  timeOfDay: string | null;
  paceSecondsPerKm: number | null;
  paceSecondsPer100m: number | null;
  speedKmh: number | null;
  /** Time behind the leader at this exact ranking checkpoint. */
  gapToLeaderSeconds?: number | null;
  gapDisplay?: string | null;
  /** Rank at the immediately previous configured ranking checkpoint. */
  previousRank?: number | null;
  /** Positive means positions gained; negative means positions lost. */
  positionDelta?: number | null;
  positionDirection?: 'UP' | 'DOWN' | 'SAME' | 'NEW';
  positionDisplay?: string | null;
  positionDescription?: string | null;
  /** Sport-specific pace/speed label for this checkpoint. */
  paceDisplay?: string | null;
  /** Stable projection of the athlete's current canonical race state. */
  stateFingerprint?: string;
  athleteRaceStatus?: CanonicalAthleteStatus;
  currentLeg?: CanonicalLegType | null;
  currentLastSplitKey?: string | null;
  currentLastSplitOrder?: number;
  currentDistanceCompletedKm?: number;
}

export interface CanonicalLeaderboard extends CanonicalPersistedRecord {
  leaderboardType: 'race';
  contestUuid: string;
  mode: CanonicalRankingMode;
  qualifier: string | null;
  entries: CanonicalLeaderboardEntry[];
}

export interface CanonicalSplitLeaderboardEntry extends CanonicalLeaderboardEntry {
  splitKey: string;
  splitStatus?: 'COMPLETED';
  splitElapsedSeconds: number | null;
  sectionSeconds: number | null;
}

export interface CanonicalSplitLeaderboard extends CanonicalPersistedRecord {
  leaderboardType: 'split';
  contestUuid: string;
  splitKey: string;
  mode: CanonicalRankingMode;
  qualifier: string | null;
  entries: CanonicalSplitLeaderboardEntry[];
}

export interface CanonicalSplitSummary extends CanonicalPersistedRecord {
  contestUuid: string;
  splits: Array<{
    splitKey: string;
    displayName: string;
    order: number;
    legType: CanonicalLegType;
    completedCount: number;
    /** Active athletes who have not yet completed this split. */
    pendingAtSplitCount?: number;
    /** Athletes who have started and are not in a terminal race state. */
    activeRaceCount?: number;
    /** @deprecated Use pendingAtSplitCount. */
    stillRacingCount: number;
    leader: CanonicalSplitLeaderboardEntry | null;
    latestFinisher: CanonicalSplitLeaderboardEntry | null;
  }>;
}

export interface CanonicalLeaderboardManifest extends CanonicalPersistedRecord {
  contestUuid: string;
  leaderboardVersion: number;
  availableRaceModes: CanonicalRankingMode[];
  availableSplitModes: CanonicalRankingMode[];
  splitKeys: string[];
  available: {
    overall: boolean;
    gender: string[];
    ageGroups: string[];
    club: boolean;
    splits: string[];
  };
}

export interface CanonicalParticipantSource {
  /** Feibot event that owns this participant's contest. */
  providerEventUuid?: string | null;
  participantUuid: string;
  providerParticipantUuid: string;
  chipCode?: string | null;
  providerRecordId?: string | null;
  bib: string;
  displayName: string;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  contestUuid: string;
  /** Contest UUID received from Feibot before alias/canonical routing. */
  providerContestUuid?: string;
  /** Contest UUID used for canonical course, timing, and leaderboard routing. */
  canonicalContestUuid?: string;
  contestName?: string | null;
  gender?: string | null;
  ageGroup?: string | null;
  dateOfBirth?: string | null;
  clubName?: string | null;
  countryCode?: string | null;
  photoUrl?: string | null;
  firebaseUid?: string | null;
  bookingId?: string | null;
  registrationId?: string | null;
  ticketId?: string | null;
  subCategoryId?: string | null;
  matchedBy?: CanonicalBergmanIdentity['matchedBy'];
  profileUpdatedAt?: string | null;
  trackingVisibility?: 'PUBLIC' | 'ANONYMOUS' | string | null;
  waveStartTime?: string | null;
}

export interface CanonicalUserAthleteReference {
  eventId: string;
  participantUuid: string;
  providerParticipantUuid: string;
  buildVersion: string;
}

export interface CanonicalParticipantBuildArtifacts {
  index: CanonicalParticipantIndex;
  snapshots: CanonicalAthleteSnapshot[];
  aliases: CanonicalAliasArtifact[];
  reverseIndexes: Record<string, CanonicalUserAthleteReference[]>;
}

export interface CanonicalLeaderboardBuildArtifacts {
  leaderboards: CanonicalLeaderboard[];
  splitLeaderboards: CanonicalSplitLeaderboard[];
  splitSummaries: CanonicalSplitSummary[];
  manifests: CanonicalLeaderboardManifest[];
  snapshots: CanonicalAthleteSnapshot[];
}

export interface CanonicalContestMappingInput {
  /** Feibot event that owns this contest. */
  providerEventUuid?: string;
  providerContestUuid: string;
  bergmanTicketId: string;
  legacyContestIds?: string[];
  displayName?: string;
  raceType: CanonicalRaceType;
  configuredRaceDistanceKm: number;
  /** Bergman-configured sport distances. Provider DistanceFromStart is never
   * authoritative for athlete-facing leg or cumulative course distance. */
  legDistancesKm?: Partial<Record<CanonicalLegType, number>>;
  timezone?: string;
  courseVersion?: number;
  gpxUrls?: string[];
  cutoffs?: Record<string, number>;
  startConfiguration?: Partial<CanonicalStartConfiguration>;
  splitMappings?: CanonicalSplitMappingInput[];
}

export interface CanonicalSplitMappingInput {
  canonicalCode: string;
  /** Admin-configured course order. This takes precedence over provider order. */
  order?: number;
  /** Admin-facing split label. This takes precedence over the provider label. */
  displayName?: string;
  /** Admin-configured distance from the beginning of the current leg. */
  distanceInLegKm?: number;
  /** Admin-configured distance from the beginning of the race. */
  cumulativeDistanceKm?: number;
  providerSplitId?: string;
  providerTimingPointId?: string;
  readSelectionRule?: CanonicalReadSelectionRule;
  passNumber?: number;
  rankingEnabled?: boolean;
  required?: boolean;
  timingPointType?: CanonicalTimingPointType;
  startDetectionEnabled?: boolean;
  passageGroupingEnabled?: boolean;
  passageGapSeconds?: number;
}

export interface CanonicalCourseNormalizerInput {
  eventId: string;
  buildVersion: string;
  source: Extract<CanonicalReadSource, 'feibot_cloud' | 'feibot_fdb' | 'manual'>;
  timingRules: unknown;
  contestMappings: CanonicalContestMappingInput[];
  timezone?: string;
  courseVersion?: number;
  updatedAt?: string;
}

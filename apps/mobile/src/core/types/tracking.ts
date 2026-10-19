/**
 * Live-tracking domain models ported from the BERGMAN web app
 * (`src/lib/types/results.ts`, `timingConfiguration.ts`, `courseIndex.ts`,
 * `feibot-integration/types.ts`). Kept faithful to the source of truth.
 */

export type LatLng = { lat: number; lng: number; ele?: number };

export type Split = {
  segment: string;
  name?: string;
  distance: number;
  time: number;
  absoluteTimestamp?: number;
  position?: LatLng;
};

export type AthleteRanks = {
  overall?: number | string;
  contest?: number | string;
  gender?: number | string;
  ageGroup?: number | string;
};

export type LiveAthlete = {
  id: string;
  bib: string;
  name: string;
  category: string;
  gender: "Male" | "Female" | string;
  status: string;
  leg: string;
  splits: Split[];
  ranks?: AthleteRanks;
  clubName?: string | null;
  predictedLocation?: LatLng;
  lat?: number;
  lng?: number;
  courseProgress?: number;
};

/**
 * Global live-tracking visibility (source of truth: the backend, per the
 * athlete's event registration). The mobile app never infers what to hide;
 * it renders the backend-provided `display*` fields and uses `visibility`
 * only to drive layout (e.g. a "tracking unavailable" state for PRIVATE).
 */
export type Visibility = "PUBLIC" | "ANONYMOUS" | "PRIVATE";

/**
 * Per-event athlete registration. The mobile app is another client of the
 * existing Race Upshot backend (not a parallel service): the global athlete profile
 * (name/email/`profilePhotoUrl`/club/city/country) is stored once and reused
 * everywhere, while race-specific fields — bib, category, status and
 * `liveTrackingVisibility` — live on the per-event registration. So an athlete
 * can be PUBLIC in one race and ANONYMOUS in another.
 */
export type Registration = {
  eventId: string;
  athleteId: string;
  bib?: string;
  category?: string;
  status?: string;
  /** Source of truth for this athlete's live-tracking privacy in this event. */
  liveTrackingVisibility?: Visibility;
  /** Backward-compatible alias accepted from older payloads. */
  visibility?: Visibility;
  eventName?: string;
  dateLabel?: string;
};

export type LeaderboardRow = {
  rank: number;
  athleteId: string;
  name: string;
  /** Backend-anonymized name ("Anonymous Athlete" when ANONYMOUS). */
  displayName?: string;
  /** Per-registration privacy; `liveTrackingVisibility` is the canonical name. */
  visibility?: Visibility;
  liveTrackingVisibility?: Visibility;
  viewerCanSeeIdentity?: boolean;
  privacyMasked?: boolean;
  /** Global athlete profile photo (hidden by the backend when ANONYMOUS/PRIVATE). */
  profilePhotoUrl?: string;
  bib: string;
  bibNumber?: string;
  contest?: string;
  ageGroup?: string;
  gender?: string;
  currentLeg?: string;
  gap?: string;
  deltaTime?: string;
  status?: string;
  speed?: string;
  pace?: string;
  distanceCovered?: number;
  distanceRemaining?: number;
  eta?: string;
  lastUpdated?: string;
  overallTime?: string;
  overallRank?: number;
  contestRank?: number;
  genderRank?: number;
  ageGroupRank?: number;
};

export type LiveTrackingTimingPointMarkerType =
  "start" | "finish" | "split" | "transition" | "checkpoint" | string;

export type ResolvedTimingPoint = {
  id: string;
  label: string;
  markerType?: LiveTrackingTimingPointMarkerType;
  order: number;
  distanceKm?: number;
  cutoffMinutes?: number;
};

export type ResolvedContestTiming = {
  contestId: string;
  contestName: string;
  timingPoints: ResolvedTimingPoint[];
  legs?: { segment: string; distanceKm?: number }[];
  splits?: { id: string; name: string; distanceKm?: number }[];
};

export type ResolvedTimingConfiguration = {
  eventId: string;
  contests: ResolvedContestTiming[];
  updatedAt?: string;
  timingPointDisplayConfig?: {
    points?: Record<
      string,
      {
        pointId?: string;
        label?: string;
        course?: "swim" | "bike" | "run" | "split" | "transition" | "finish" | string;
        km?: string | number;
        visible?: boolean;
        route?: string;
        segment?: string;
        leg?: string;
      }
    >;
  };
};

/** A marker rendered on the live map / track canvas. */
export type CourseMapMarkerKind =
  "start" | "finish" | "timing" | "transition" | "aid" | "camera";

export type CourseMapMarker = {
  id: string;
  label: string;
  kind: CourseMapMarkerKind;
  position: LatLng;
  distanceKm?: number;
  /** Camera markers: whether a live feed is currently available. */
  live?: boolean;
};

/** Per-leg GPX polyline (ordered coordinates) + optional leg distance. */
export type CourseLegGeometry = {
  segment: "swim" | "bike" | "run" | string;
  path: LatLng[];
  /** Original GPX points retained for elevation statistics and profiling. */
  elevationPath?: LatLng[];
  gpxUrl?: string;
  loadError?: boolean;
  distanceKm?: number;
};

/**
 * Course geometry for the live map: leg polylines + timing/aid/camera markers.
 * Sourced from the backend's live course config/index endpoints in production.
 */
export type CourseGeometry = {
  /** Contest/course-plan identity used to keep split configuration scoped. */
  contestId?: string;
  name?: string;
  legs: CourseLegGeometry[];
  markers: CourseMapMarker[];
};

export type CourseIndexContest = {
  contestId: string;
  name: string;
  legs: {
    segment: "swim" | "bike" | "run" | string;
    distanceKm?: number;
    gpxUrl?: string | null;
  }[];
  timingPoints: ResolvedTimingPoint[];
  geometry?: CourseGeometry;
};

export type CourseIndex = {
  eventId: string;
  contests: CourseIndexContest[];
};

export type ContestStatus =
  "not_started" | "live" | "paused" | "finished" | string;

export type ProviderStatus = {
  connected: boolean;
  provider?: string;
  lastSyncAt?: string | null;
  message?: string;
};

export type ReplayIndex = {
  eventId: string;
  available: boolean;
  url?: string | null;
  frames?: number;
  generatedAt?: string | null;
};

/** Envelope shapes returned by the Next.js live endpoints. */
export type LiveEventDto = {
  id: string;
  eventId?: string;
  name: string;
  eventName?: string;
  date: string | null;
  eventDate?: string | null;
  displayDateRange?: string | null;
  displayDate?: string | null;
  dateRange?: string | null;
  dateLabel?: string | null;
  startDate?: string | null;
  startAt?: string | null;
  countdownTargetAt?: string | null;
  timezone?: string | null;
  endDate?: string | null;
  dateStart?: string | null;
  dateEnd?: string | null;
  ticketDate?: string | null;
  ticketDates?: string | string[] | null;
  ticketEventDate?: string | null;
  ticketEventDates?: string | string[] | null;
  ticketCategoryDate?: string | null;
  ticketCategoryDates?: string | string[] | null;
  eventDates?: string | string[] | null;
  venueName?: string | null;
  address?: string | null;
  photoUrl?: string | null;
  logoUrl?: string | null;
  participantCount?: number | null;
  blocks?: { id?: string | null; html?: string | null }[] | null;
  customRules?: string | null;
  customRulesHtml?: string | null;
  customContent?: string | null;
  disciplineSchedule?: unknown;
  ticketDefinitions?: Record<string, unknown>[] | null;
  country?: string | null;
  state?: string | null;
  customSlug?: string | null;
  eventSlug?: string | null;
  registrationStatus?: string | null;
  registrationButtonState?: string | null;
  registrationUrl?: string | null;
  primaryCta?: { type?: string | null; label?: string | null; href?: string | null; disabled?: boolean | null } | null;
  courseDetails?: Record<string, unknown> | null;
  liveTrackingHub?: Record<string, unknown> | null;
  temperatureMetrics?: Record<string, unknown> | null;
  feibotConfig?: Record<string, unknown> | null;
  mapsSplitsConfig?: Record<string, unknown>[] | null;
  updatedAt?: string | null;
  cutoffMinutes?: number | null;
  cutoffs?: Record<string, unknown> | unknown[] | null;
  rulesUrl?: string | null;
  regulationsUrl?: string | null;
  rulesAndRegulationsUrl?: string | null;
  rulesHtml?: string | null;
  regulationsHtml?: string | null;
  rulesAndRegulationsHtml?: string | null;
  athleteGuidebookUrl?: string | null;
  athleteGuideBookUrl?: string | null;
  athleteGuideUrl?: string | null;
  guidebookUrl?: string | null;
  guideBookUrl?: string | null;
  guideUrl?: string | null;
  pdfUrl?: string | null;
  downloadUrl?: string | null;
  rulesContentHtml?: string | null;
  regulationsContentHtml?: string | null;
  liveTracking?: Record<string, unknown> | null;
  liveTrackingEnabled?: boolean | null;
  liveTrackingProviderState?: Record<string, unknown> | null;
  liveDataSource?: string | null;
  raw?: Record<string, unknown>;
  showLiveTrackingOnHomepage?: boolean | null;
  status: string;
  isUpcoming: boolean;
  imageUri?: string | null;
  imageUrl?: string | null;
  bannerImage?: string | null;
  bannerImageUrl?: string | null;
  coverImage?: string | null;
  coverImageUrl?: string | null;
  location?: string | null;
  discipline?: string | null;
  distances?: string[] | string | null;
};

// --- Aliases mirroring the web app's model names (see docs/WEB_APP_ANALYSIS.md) ---
export type LiveEvent = LiveEventDto;
export type TimingPoint = ResolvedTimingPoint;
export type TimingConfiguration = ResolvedTimingConfiguration;
export type CourseLeg = CourseIndexContest["legs"][number];
export type AthleteSearchResult = AthleteSearchMatch;

export type Contest = {
  id: string;
  name: string;
  raceType?: string;
  distance?: string;
  status?: ContestStatus;
};

/** Per-athlete prediction (ETA/pace/position) from the web prediction engine. */
export type Prediction = {
  etaSeconds?: number;
  paceSecondsPerKm?: number;
  confidence?: number;
  predictedLocation?: LatLng;
};

export type LeaderboardResponse = {
  success: boolean;
  eventId: string;
  athletes: LeaderboardRow[];
  contest?: string;
  ageGroup?: string;
  gender?: string;
  count: number;
  total?: number;
  source: string;
  timestamp?: string;
};

export type AthleteSearchMatch = {
  athleteId?: string;
  id?: string;
  providerUuid?: string;
  providerAthleteUuid?: string;
  providerTimingUuid?: string;
  providerRecordId?: string;
  participantUuid?: string;
  athleteUid?: string;
  bookingId?: string;

  bib: string;
  bibNumber?: string;
  name: string;
  fullName?: string;
  initials?: string;
  contest?: string;
  contestName?: string;
  contestUuid?: string;
  contest_uuid?: string;
  category?: string;
  ageGroup?: string;
  ageGroupName?: string;
  ageGroupUuid?: string;
  gender?: string;
  status?: string;
  leg?: string;
  chip?: string | null;
  chipNumber?: string | null;

  country?: string;
  countryCode?: string;
  club?: string;
  clubName?: string | null;
  email?: string;

  splits?: unknown[];
  currentSplit?: unknown;
  photoURL?: string | null;
  photoUrl?: string | null;
  avatarUrl?: string | null;
  displayPhoto?: string | null;
  profilePhotoUrl?: string;
  provider?: {
    mapped: boolean;
    provider: string;
    providerUuid: string | null;
    contestUuid: string | null;
  };
  liveTrackingPrivacy?: string;
  trackingVisibility?: string;
  privacy?: string;
  searchVisible?: boolean;
  mapVisible?: boolean;
  modalVisible?: boolean;
  visibility?: Visibility;
  liveTrackingVisibility?: Visibility;
  displayName?: string;
};

export type AthleteSearchResponse = {
  success: boolean;
  eventId: string;
  q: string;
  mode: string;
  totalIndex: number;
  matches: AthleteSearchMatch[];
  publicAthleteVisibility?: boolean;
  visibilityEnabled?: boolean;
  visibilityVersion?: number;
  source?: string;
};

/** Data-provenance for a live-position field (mirrors web signal badges). */
export type SignalKind = "official" | "estimated" | "waiting" | "delayed";

/** Prediction trust level, as emitted by the web prediction engine. */
export type PredictionConfidence = "HIGH" | "MEDIUM" | "LOW";

/** Swim/bike/run breakdown for the "Course Overview" card. */
export type CourseOverview = {
  swimKm?: number;
  bikeKm?: number;
  runKm?: number;
  run1Km?: number;
  run2Km?: number;
  totalKm?: number;
  breakdown?: { label: string; distanceKm?: number }[];
};

/** A single cumulative-cutoff row (label + formatted H:MM:SS). */
export type CutoffRow = { label: string; value: string };

/**
 * Rolling "Estimated Live Position" snapshot. Mirrors the web modal's
 * `participantLive`: officially-timed reads plus predicted values between them.
 */
export type ParticipantLive = {
  contestUuid?: string;
  splits?: Record<string, unknown>[];
  distanceCoveredKm?: number;
  distanceRemainingKm?: number;
  currentLeg?: string;
  currentSplit?: string;
  lastTimingPoint?: string;
  predictedLocation?: LatLng;
  lat?: number;
  lng?: number;
  currentSpeedKmh?: number;
  averageSpeedKmh?: number;
  averagePaceLabel?: string;
  etaNextSplitCountdownSec?: number;
  etaNextSplit?: string;
  etaFinishClock?: string;
  estimatedFinishTime?: string;
  estimatedDistanceKm?: number;
  totalDistanceKm?: number;
  estimatedProgressRatio?: number;
  predictedPaceSecondsPerKm?: number;
  predictedSpeedKmh?: number;
  eventTimezone?: string;
  startTime?: string;
  status?: string;
  resolvedRaceState?: Record<string, unknown>;
  predictionConfidence?: PredictionConfidence;
  predictionSource?: string;
  predictionStatus?: string;
  predictionUpdatedAtLabel?: string;
  predictionFrozen?: boolean;
  predictionFrozenReason?: string;
  cutoffLabel?: string;
  cutoffStatus?: string;
};

/** "Next Split Prediction (Robust)" — the web's pace-model checkpoint ETA. */
export type NextSplitPrediction = {
  checkpoint: string;
  etaElapsedLabel?: string;
  etaClockLabel?: string;
  remainingKm?: number;
  paceLabel?: string;
  confidence?: "High" | "Medium" | "Low";
  basis?: string;
};

/**
 * Official result, populated in KV by the timing provider after the race and
 * surfaced by the backend on the same athlete payload (mobile reads it via REST;
 * it never touches KV directly). When present + FINISHED, the app switches from
 * live tracking to Official Results mode.
 */
export type AthleteResult = {
  status?: string;
  /** Official chip/finish time. */
  chipTime?: string;
  gunTime?: string;
  finishTimeOfDay?: string;
  officialTime?: string;
  officialTimeBasis?: "CHIP" | "GUN";
  averagePace?: string;
  /** Configured canonical legs/transitions with official durations. */
  sections?: {
    key: string;
    label: string;
    type: "leg" | "transition";
    duration: string;
    metric?: string;
  }[];
  overallRank?: number | string;
  overallCount?: number | string;
  genderRank?: number | string;
  genderCount?: number | string;
  categoryRank?: number | string;
  categoryCount?: number | string;
  /** Ordered official splits (e.g. Swim/T1/Bike/T2/Run) — cumulative times. */
  splits?: {
    label: string;
    time: string;
    timeOfDay?: string;
    segmentTime?: string;
    paceSpeed?: string;
    rank?: number | string;
    leg?: string;
    distanceKm?: number;
  }[];
  progressPercent?: number;
  cutoffStatus?: string;
  cutoffTime?: string;
  provisional?: boolean;
  club?: string;
  points?: number | string;
  location?: string;
  eventCategory?: string;
  raceCategory?: string;
  raceDate?: string;
};

export type AthleteModalResponse = {
  success: boolean;
  eventId: string;
  /** Server-authorized exception to ANONYMOUS for an admin or this athlete. */
  viewerCanSeeIdentity?: boolean;
  privacyMasked?: boolean;
  /** Top-level fallback; visibility may also live on `athlete`/registration. */
  visibility?: Visibility;
  liveTrackingVisibility?: Visibility;
  /** Present once official results are uploaded to KV for this athlete. */
  result?: AthleteResult;
  athlete: Record<string, unknown> & {
    id?: string;
    bib?: string;
    name?: string;
    fullName?: string;
    category?: string;
    ageGroupName?: string;
    gender?: string;
    club?: string;
    clubName?: string;
    contest?: string;
    contestName?: string;
    country?: string;
    city?: string;
    state?: string;
    photoURL?: string | null;
    photoUrl?: string | null;
    avatarUrl?: string | null;
    registrationStatus?: string;
    // --- Backend-enforced visibility + display fields (see Visibility) ---
    // Visibility is a per-registration field; `liveTrackingVisibility` is the
    // canonical name, `visibility` is accepted as an alias.
    visibility?: Visibility;
    liveTrackingVisibility?: Visibility;
    displayName?: string;
    displayPhoto?: string | null;
    /** Raw profile photo (used when not anonymized). */
    profilePhotoUrl?: string;
    displayClub?: string | null;
    displayCountry?: string | null;
    displayLocation?: string | null;
    viewerCanSeeIdentity?: boolean;
    privacyMasked?: boolean;
    status?: string;
    /** e.g. "Live Racing", "Finished", "Waiting for Chip Start". */
    lifecycleLabel?: string;
    /** Header context: hosting event/date/scheduled start. */
    eventName?: string;
    eventDate?: string;
    scheduledStart?: string;
    currentLegName?: string;
    currentSplitName?: string;
    providerContestUuid?: string;
    participantUuid?: string;
    splits?: Record<string, unknown>[];
    summary?: Record<string, unknown>;
    distanceCoveredKm?: number;
    distanceRemainingKm?: number;
    currentPace?: string;
    averagePace?: string;
    elapsedTime?: string;
    estimatedFinish?: string;
    overallRank?: number | string;
    genderRank?: number | string;
    ageGroupRank?: number | string;
    clubRank?: number | string;
    prediction?: {
      finishTimeLabel?: string;
      paceLabel?: string;
      position?: number | string;
      confidence?: number;
    } | null;
    predictedLocation?: LatLng;
    lat?: number;
    lng?: number;
  };
  participantLive?: ParticipantLive;
  courseOverview?: CourseOverview;
  cutoffs?: CutoffRow[];
  nextSplitPrediction?: NextSplitPrediction;
  contestContext?: {
    contest?: unknown;
    splits?: (Split | Record<string, unknown>)[];
    timingPoints?: ResolvedTimingPoint[];
    ageGroups?: unknown[];
    legs?: unknown[];
    sections?: unknown[];
    transitions?: unknown[];
    legIndex?: unknown[];
    splitIndex?: unknown[];
    timingPointIndex?: unknown[];
  };
  contestDefinition?: unknown;
  ticketDefinition?: Record<string, unknown> | null;
  activeVersion?: string;
  courseVersion?: string;
  timingConfiguration?: ResolvedTimingConfiguration;
  courseIndex?: CourseIndex;
};

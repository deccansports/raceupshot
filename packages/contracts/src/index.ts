export const API_VERSION = "v1" as const;

export const EVENT_LIFECYCLE_STATUSES = [
  "DRAFT",
  "UPCOMING",
  "REGISTRATION_OPEN",
  "REGISTRATION_CLOSED",
  "START_LIST_PUBLISHED",
  "LIVE",
  "PAUSED",
  "COMPLETED",
  "RESULTS_PROVISIONAL",
  "RESULTS_OFFICIAL",
  "ARCHIVED",
  "CANCELLED",
] as const;

export type EventLifecycleStatus = typeof EVENT_LIFECYCLE_STATUSES[number];
export type EventSection = "UPCOMING" | "LIVE" | "PAST";
export type AthleteVisibility = "PUBLIC" | "ANONYMOUS" | "PRIVATE";

export const RACE_STATUSES = [
  "NOT_STARTED",
  "STARTED",
  "SWIMMING",
  "T1",
  "CYCLING",
  "T2",
  "RUNNING",
  "CUTOFF_PENDING",
  "FINISHED",
  "DNF",
  "DNS",
  "DNQ",
  "DSQ",
  "OTL",
  "UNKNOWN",
] as const;

export type RaceStatus = typeof RACE_STATUSES[number];

export const LIVE_BROADCAST_STATUSES = ["OFFLINE", "SCHEDULED", "LIVE", "ENDED"] as const;
export const LIVE_BROADCAST_CHANNEL_TYPES = ["HLS", "VIDEO", "YOUTUBE", "IFRAME", "EXTERNAL"] as const;
export type LiveBroadcastStatus = typeof LIVE_BROADCAST_STATUSES[number];
export type LiveBroadcastChannelType = typeof LIVE_BROADCAST_CHANNEL_TYPES[number];

export interface LiveBroadcastChannel {
  channelId: string;
  name: string;
  type: LiveBroadcastChannelType;
  playbackUrl: string;
  enabled: boolean;
  displayOrder: number;
  posterUrl?: string;
  description?: string;
  category?: string;
  featured?: boolean;
}

export interface BroadcastAthleteOverlayConfig {
  enabled: boolean;
  timingPointId: string;
  timingPointName: string;
  message: string;
  displaySeconds: number;
  recentWindowSeconds: number;
  maxAthletes: number;
}

export interface BroadcastAthleteOverlayEntry {
  participantUid: string;
  bib: string;
  displayName: string;
  contestName: string;
  timingPointId: string;
  timingPointName: string;
  readAt: string | null;
  state: "FINISHING_SOON" | "FINISHING_NOW";
}

export interface LiveBroadcastConfig {
  eventId: string;
  enabled: boolean;
  publicEnabled: boolean;
  status: LiveBroadcastStatus;
  title: string;
  subtitle: string;
  message: string;
  activeChannelId: string | null;
  channels: LiveBroadcastChannel[];
  athleteOverlay: BroadcastAthleteOverlayConfig;
  posterUrl?: string;
  startedAt: string | null;
  endedAt: string | null;
  updatedAt: string;
}

export interface LiveBroadcastPublicData {
  eventId: string;
  eventSlug: string;
  eventName: string;
  enabled: boolean;
  status: LiveBroadcastStatus;
  title: string;
  subtitle: string;
  message: string;
  activeChannel: LiveBroadcastChannel | null;
  channels: LiveBroadcastChannel[];
  athleteOverlay: BroadcastAthleteOverlayConfig;
  posterUrl?: string;
  startedAt: string | null;
  endedAt: string | null;
  updatedAt: string;
}

export interface ApiMeta {
  apiVersion: typeof API_VERSION;
  lastUpdatedAt: string | null;
  source: "raceupshot" | "timing-provider" | "published-results";
  provider?: "FEIBOT" | "MANUAL" | "RACE_UPSHOT";
  isStale: boolean;
  cacheSeconds: number;
  requestId: string;
}

export interface ApiEnvelope<T> {
  success: true;
  eventId?: string;
  data: T;
  meta: ApiMeta;
}

export interface ApiErrorEnvelope {
  success: false;
  error: {
    code: string;
    message: string;
  };
  meta: Pick<ApiMeta, "apiVersion" | "requestId">;
}

export interface LiveTrackingSettings {
  liveTrackingEnabled: boolean;
  publicLiveTrackingEnabled: boolean;
  loginOnlyTracking: boolean;
  athleteSearchEnabled: boolean;
  leaderboardEnabled: boolean;
  liveMapEnabled: boolean;
  splitsEnabled: boolean;
  estimatedPositionEnabled: boolean;
  watchlistEnabled: boolean;
  sharingEnabled: boolean;
  anonymousTrackingAllowed: boolean;
  privateTrackingAllowed: boolean;
  defaultAthleteVisibility: AthleteVisibility;
  forceVisibility: AthleteVisibility | null;
  resultsVisibleDuringRace: boolean;
  provisionalLeaderboard: boolean;
  liveTrackingStartAt: string | null;
  liveTrackingEndAt: string | null;
}

export interface MobileEventSettings {
  mobilePublished: boolean;
  mobileFeatured: boolean;
  mobileSection: EventSection | "AUTO";
  athleteSearchEnabled: boolean;
  leaderboardEnabled: boolean;
  courseMapEnabled: boolean;
  watchlistEnabled: boolean;
  notificationsEnabled: boolean;
  resultsEnabled: boolean;
  certificatesEnabled: boolean;
  announcementsEnabled: boolean;
  displayOrder: number;
  deepLinkSlug: string;
}

export interface PublicEvent {
  eventId: string;
  slug: string;
  name: string;
  sport: string;
  lifecycleStatus: EventLifecycleStatus;
  section: EventSection;
  startsAt: string;
  endsAt?: string;
  dateLabel: string;
  startTime?: string;
  city: string;
  venue: string;
  location: string;
  description: string;
  organizer?: string;
  contactEmail?: string;
  contactPhone?: string;
  websiteUrl?: string;
  latitude?: string;
  longitude?: string;
  logoUrl?: string;
  bannerUrl?: string;
  registrationUrl?: string;
  knowMoreUrl?: string;
  broadcastUrl?: string;
  rulesUrl?: string;
  athleteGuidebookUrl?: string;
  contests: string[];
  ticketDefinitions?: Array<{
    id: string;
    name: string;
    configurationSource: "MANUAL" | "FEIBOT";
    providerContestUuid: string;
    totalDistanceKm: number | null;
    overallCutoffSeconds: number | null;
    legs: Array<{ id: string; name: string; type: string; order: number; distanceKm: number | null; cutoffSeconds: number | null }>;
    splits: Array<{ id: string; name: string; legId: string; order: number; distanceKm: number | null; cutoffSeconds: number | null }>;
  }>;
  participantCount: number;
  hasResults: boolean;
  liveSettings: LiveTrackingSettings;
  mobileSettings: MobileEventSettings;
}

export interface LiveSplit {
  splitId: string;
  name: string;
  splitTime: string;
  cumulativeTime?: string;
  distanceKm?: number;
  paceOrSpeed?: string;
  rankAtSplit?: number;
  status?: string;
  timestamp?: string;
  readerTimestamp?: string;
  gunStartTimestamp?: string;
  chipStartTimestamp?: string;
  gunTimeMs?: number;
  chipTimeMs?: number;
  sectionTimeMs?: number;
  officialTimeMs?: number;
  source?: "AUTO" | "FIXED" | "MANUAL" | "FEIBOT_PROCESSED";
}

export interface LiveParticipant {
  eventId: string;
  participantUid: string;
  athleteUid?: string;
  bib: string;
  displayName: string;
  fullName?: string;
  initials: string;
  photoUrl?: string;
  contestId?: string;
  contestName: string;
  gender?: string;
  ageGroup?: string;
  country?: string;
  club?: string;
  team?: string;
  visibility: AthleteVisibility;
  raceStatus: RaceStatus;
  statusReason?: string | null;
  cutoffDeadline?: string | null;
  cutoffReconcileAt?: string | null;
  currentLeg?: string;
  elapsedTime?: string;
  /** Published overall pace, or the primary pace metric supplied by results import. */
  pace?: string;
  latestTimingPoint?: string;
  latestSplitTime?: string;
  cumulativeTime?: string;
  estimatedFinishAt?: string;
  overallRank?: number;
  genderRank?: number;
  ageGroupRank?: number;
  /** Number of confirmed finishers in the participant's contest. */
  overallRankTotal?: number;
  /** Number of confirmed finishers with the same declared gender. */
  genderRankTotal?: number;
  /** Number of confirmed finishers in the same declared age group. */
  ageGroupRankTotal?: number;
  distanceCompletedKm?: number;
  progressPercent?: number;
  splits: LiveSplit[];
  lastUpdatedAt?: string;
  timingSource?: string;
  resultStatus?: string;
  certificateUrl?: string;
}

export interface CanonicalLiveManifest {
  schemaVersion?: 1;
  eventId: string;
  activeVersion?: string;
  previousVersion?: string | null;
  provider: "FEIBOT" | "RACE_UPSHOT" | "feibot" | "race_upshot";
  courseVersion?: number;
  participantVersion?: number;
  timingVersion?: number;
  /** Monotonic race-day publication revision within the active base build. */
  raceDayRevision?: number;
  leaderboardVersion?: number;
  eventName?: string;
  timezone?: string;
  status?: string;
  contestMappings?: Record<string, { raceUpshotCategoryId: string; name: string }>;
  participantCount: number;
  leaderboardCount?: number;
  completeBuildValid: boolean;
  publishedAt?: string;
  updatedAt?: string;
  // Legacy aliases retained for old versions already stored in KV.
  providerEventUuid?: string;
  version?: string;
  builtAt?: string;
}

export interface CanonicalParticipantIndexRow {
  providerEventUuid: string;
  participantUuid: string;
  providerParticipantUuid: string | null;
  chipCode: string | null;
  waveStartTime: string | null;
  bib: string;
  displayName: string;
  contestUuid: string;
  providerContestUuid: string;
  canonicalContestUuid: string;
  contestName: string;
  genderKey: string | null;
  ageGroupKey: string | null;
  clubName: string | null;
  countryCode: string | null;
  photoUrl: string | null;
  trackingVisibility: AthleteVisibility;
  status: string;
  statusReason: string | null;
  statusSource: string | null;
  statusResolvedAt: string | null;
  failedCheckpoint: string | null;
  cutoffSeconds: number | null;
  cutoffDeadline: string | null;
  elapsedAtResolution: number | null;
  currentLeg: string | null;
  lastSplitKey: string | null;
  lastSplitLabel: string | null;
  overallSeconds: number | null;
  overallRank: number | null;
  genderRank?: number | null;
  ageGroupRank?: number | null;
  splits?: LiveSplit[];
  sourceParticipantUid?: string;
  lastUpdatedAt?: string | null;
}

export interface CanonicalParticipantIndex {
  schemaVersion: 1;
  eventId: string;
  buildVersion: string;
  updatedAt: string;
  participantCount: number;
  rows: CanonicalParticipantIndexRow[];
}

export interface CanonicalBuildStatus {
  schemaVersion: 1;
  eventId: string;
  buildVersion: string;
  status: "building" | "complete" | "failed";
  startedAt: string;
  completedAt: string | null;
  participantCount: number;
  message: string;
}

export interface CanonicalBuildValidation {
  schemaVersion: 1;
  eventId: string;
  buildVersion: string;
  valid: boolean;
  checkedAt: string;
  errors: string[];
  expectedFiles: string[];
}

export interface CanonicalCourseArtifact {
  schemaVersion: 1;
  eventId: string;
  buildVersion: string;
  updatedAt: string;
  courseVersion: number;
  maps: EventCourseMap[];
}

export interface AthletePrivacyPreference {
  liveTrackingVisibility: AthleteVisibility;
  showProfilePhoto: boolean;
  showCountry: boolean;
  showClub: boolean;
  showAgeGroup: boolean;
  showResultAfterFinish: boolean;
  allowResultSharing: boolean;
  allowWatchlist: boolean;
}

export interface FeibotIntegrationConfig {
  provider: "FEIBOT";
  enabled: boolean;
  baseUrl: string;
  accountReference: string;
  providerEventUuid: string;
  contestMappings: Array<{
    contestId: string;
    providerContestUuid: string;
  }>;
  syncParticipants: boolean;
  syncContests: boolean;
  syncTimingPoints: boolean;
  syncRealtime: boolean;
  syncLeaderboards: boolean;
  syncResults: boolean;
  participantSyncIntervalSeconds: number;
  realtimeSyncIntervalSeconds: number;
  leaderboardSyncIntervalSeconds: number;
  resultSyncIntervalSeconds: number;
  enabledForWeb: boolean;
  enabledForMobile: boolean;
  timingResultSource: "FEIBOT_PROCESSED" | "RACE_UPSHOT_ENGINE";
  resultTimeMode: "CHIP" | "GUN";
  passageGapMs: number;
  readerDetectionTimeoutMs: Record<string, number>;
  status:
    | "NOT_CONFIGURED"
    | "CONNECTED"
    | "INITIAL_SYNC"
    | "READY"
    | "LIVE_SYNC"
    | "PAUSED"
    | "RATE_LIMITED"
    | "AUTH_ERROR"
    | "PARTIAL_FAILURE"
    | "FAILED"
    | "COMPLETED";
  lastTestedAt: string | null;
  lastSuccessfulSyncAt: string | null;
  updatedAt: string;
}

export interface EventPlatformSettings {
  eventId: string;
  live: LiveTrackingSettings;
  mobile: MobileEventSettings;
  timingIntegration: FeibotIntegrationConfig | null;
  updatedAt: string;
}

export const COURSE_MAP_TYPES = [
  "RACE_COURSE",
  "SWIM",
  "BIKE",
  "RUN",
  "RUN_1",
  "RUN_2",
  "ALTERNATE_ROUTE",
  "EMERGENCY_ROUTE",
  "AID_STATIONS",
  "SHUTTLE_ROUTE",
  "EXPO_AREA",
  "PARKING",
  "SPECTATOR_ZONE",
  "TRANSITION_AREA",
  "CUSTOM",
] as const;

export type CourseMapType = typeof COURSE_MAP_TYPES[number];

export interface CoursePoint {
  latitude: number;
  longitude: number;
  elevation?: number;
}

export interface CourseMapVisibility {
  web: boolean;
  mobile: boolean;
  public: boolean;
}

export interface EventCourseMap {
  mapId: string;
  eventId: string;
  category: string;
  mapName: string;
  mapType: CourseMapType;
  customType?: string;
  fileName: string;
  gpxUrl?: string;
  gpxData?: string;
  points: CoursePoint[];
  distanceKm?: number | null;
  description?: string;
  cutoffSeconds?: number | null;
  routeColor: string;
  visibility: CourseMapVisibility;
  displayOrder: number;
  updatedAt: string;
}

export interface EventCourseCollection {
  eventId: string;
  maps: EventCourseMap[];
  updatedAt: string | null;
}

export interface EventCourseView extends EventCourseCollection {
  category: string | null;
  categories: string[];
  combined: Array<{
    category: string;
    segments: EventCourseMap[];
  }>;
}

export interface Announcement {
  announcementId: string;
  eventId?: string;
  title: string;
  message: string;
  imageUrl?: string;
  ctaLabel?: string;
  ctaUrl?: string;
  audience: "all" | "athletes" | "spectators";
  priority: number;
  startsAt?: string;
  endsAt?: string;
  active: boolean;
}

export function eventSection(status: EventLifecycleStatus): EventSection {
  if (status === "LIVE" || status === "PAUSED") return "LIVE";
  if (["COMPLETED", "RESULTS_PROVISIONAL", "RESULTS_OFFICIAL", "ARCHIVED"].includes(status)) return "PAST";
  return "UPCOMING";
}

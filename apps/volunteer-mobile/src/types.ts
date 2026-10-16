export type VolunteerModule =
  | 'ATHLETE_LOOKUP'
  | 'WAIVER_CHECK_IN'
  | 'ATHLETE_CHECK_IN'
  | 'BIKE_CHECK_IN'
  | 'BIKE_CHECK_OUT'
  | 'MEDAL_COUNTER'
  | 'FOOD_COUNTER'
  | 'PAID_FOOD_COUNTER'
  | 'LOCKER_COUNTER'
  | 'COUNTER'
  | 'FINISH_LINE_VOLUNTEER'
  | 'CUTOFF_TIME_VOLUNTEER'
  | 'TIMING_CHIP_ASSIGNMENT_COUNTER'
  | 'ATHLETE_BAND_ASSIGNMENT_COUNTER'
  | 'VOLUNTEER_BAND_ASSIGNMENT_COUNTER'
  | 'MANUAL_TIMING';

export type Assignment = {
  id: string;
  eventId: string;
  eventName: string;
  eventDate: string | null;
  eventLocation: string;
  eventLogoUrl: string | null;
  modules: VolunteerModule[];
  timingPointIds: string[];
  timingPointNames: string[];
  customCounterIds: string[];
  customCounters: CustomCounter[];
  timingScope?: "AUTO" | "RESTRICTED";
  manualGunFallback?: boolean;
  waiverRequired: boolean;
  waiverVersion: string;
  active: boolean;
};

export type CustomCounter = {
  id: string;
  eventId: string;
  name: string;
  itemName: string;
  actionLabel: string;
  active: boolean;
  applicableCategories: string[];
  inventoryUnit: 'litre' | 'kilogram' | 'piece' | 'packet' | 'custom';
  unitLabel: string;
  totalInventoryQuantity: number | null;
  totalServings: number | null;
  quantityPerServing: number;
  maxPerParticipant: number;
};

export type VolunteerSession = {
  volunteer: { id: string; name: string; email: string; mobile: string };
  assignments: Assignment[];
  refreshedAt: string;
};

export type ParticipantState = {
  waiverVerifiedAt: string | null;
  waiverId?: string | null;
  waiverDocumentUrl?: string | null;
  emailOtpVerifiedAt: string | null;
  checkedInAt: string | null;
  bikeCheckedInAt: string | null;
  bikeCheckedOutAt: string | null;
  helmetChecked: boolean;
  bikeRack: string | null;
  medalIssuedAt: string | null;
  foodIssuedAt: string | null;
  lockerNumber: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
};

export type Participant = {
  id: string;
  registrationId: string;
  participantId: string;
  eventId: string;
  eventEditionId: string;
  bib: string;
  name: string;
  email: string | null;
  mobile: string | null;
  emergencyContact: string | null;
  emergencyContactName: string | null;
  address: string | null;
  city: string | null;
  stateName: string | null;
  country: string | null;
  pincode: string | null;
  bloodGroup: string | null;
  dateOfBirth: string | null;
  tshirtSize: string;
  idProofUrl: string | null;
  category: string;
  raceCategoryId: string;
  sessionId: string | null;
  sessionName: string | null;
  scheduledStartAt: string | null;
  gender: string;
  ageGroup: string;
  registrationStatus: string;
  raceStatus: string;
  chipCode: string;
  athleteBandCode: string;
  participationMode: 'INDIVIDUAL' | 'RELAY';
  relayTeamId: string | null;
  relayTeamName: string | null;
  relayTeamSize: 2 | 3 | null;
  relayMemberNumber: number | null;
  relayMemberRole: string | null;
  relayTeam?: {
    bib: string;
    name: string;
    size: 2 | 3;
    teamChipCode: string;
    assignedBands: number;
    remainingBands: number;
    checkedInMembers: number;
    fullyCheckedIn: boolean;
    waiverCompletedMembers: number;
    teamWaiverCompleted: boolean;
    members: Array<{
      id: string;
      name: string;
      email: string | null;
      mobile: string | null;
      gender: string;
      dateOfBirth: string | null;
      ageGroup: string;
      tshirtSize: string;
      bloodGroup: string | null;
      emergencyContactName: string | null;
      emergencyContact: string | null;
      memberNumber: number | null;
      memberRole: string | null;
      chipCode: string;
      athleteBandCode: string;
      waiverVerified: boolean;
      waiverVerifiedAt: string | null;
      checkedIn: boolean;
    }>;
  };
  assignedBikeRack?: string | null;
  state: ParticipantState;
};

export type ParticipantSearch = {
  event: { id: string; name: string; waiverRequired: boolean; waiverVersion: string; waiverPolicy: { consolidatedWaiverEnabled: boolean; allowMultipleRegistrationsPerParticipant: boolean; allowDuplicateEmailAddresses: true; waiverCoverage: 'PER_REGISTRATION' | 'PER_EVENT_EDITION' | 'MULTIPLE_SELECTED_REGISTRATIONS'; requireSeparateWaiverForDifferentEvents: boolean; requireSeparateWaiverForDifferentDisciplines: boolean; allowCheckInBeforeScheduledSession: boolean; allowCheckInAll: boolean; requireGuardianSignatureForMinors: boolean } };
  participants: Participant[];
  participantProfiles: Array<{ participantId: string; name: string; email: string | null; mobile: string | null; registrations: Participant[] }>;
};

export type VolunteerOperationsOverviewLog = {
  id: string;
  action: string;
  bib: string;
  athleteName: string;
  volunteerName: string;
  capturedAt: string;
  status: string;
  bikeRack: string | null;
};

export type VolunteerOperationsOverview = {
  totalAthletes: number;
  checkedInAthletes: number;
  remainingToCheckIn: number;
  waiverCompletedAthletes: number;
  bikesEverCheckedIn: number;
  bikesCheckedIn: number;
  bikesCheckedOut: number;
  remainingToBikeCheckIn: number;
  remainingToBikeCheckOut: number;
  chipAssignmentTargets: number;
  chipsAssigned: number;
  remainingToAssign: number;
  chipsAssignedToBikeEntries: number;
  remainingToAssignFromBikeEntries: number;
  checkInLogs: VolunteerOperationsOverviewLog[];
  bikeCheckInLogs: VolunteerOperationsOverviewLog[];
  bikeCheckOutLogs: VolunteerOperationsOverviewLog[];
  chipAssignmentLogs: VolunteerOperationsOverviewLog[];
};

export type ManualTimingStamp = {
  id: string;
  bib: string;
  athleteName: string;
  timingPointName?: string;
  timingMode?: 'GUN' | 'TIMING_POINT';
  gunTime?: string | null;
  capturedAt: string;
  status: string;
  overallRank?: number | null;
  categoryRank?: number | null;
  genderRank?: number | null;
  ageGroupRank?: number | null;
  rankingElapsedMilliseconds?: number | null;
  rankingStartSource?: 'CANONICAL' | 'SAVED_GUN' | null;
  clockWarning?: string | null;
};

export type ContestGunStart = {
  uuid: string;
  name: string;
  raceDate: string | null;
  gunStartAt: string | null;
};

export type VolunteerBandTarget = {
  id: string;
  name: string;
  email: string;
  mobile: string;
  bandCode: string | null;
};

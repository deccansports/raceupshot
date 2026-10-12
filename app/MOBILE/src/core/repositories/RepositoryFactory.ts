import {
  ProductionAthleteRepository,
  type IAthleteRepository,
} from './athlete.repository';
import {
  ProductionCertificatesRepository,
  type ICertificatesRepository,
} from './certificates.repository';
import {
  ProductionCourseRepository,
  type ICourseRepository,
} from './course.repository';
import {
  ProductionEventsRepository,
  type IEventsRepository,
} from './events.repository';
import {
  ProductionLeaderboardRepository,
  type ILeaderboardRepository,
} from './leaderboard.repository';
import {
  ProductionNotificationRepository,
  type INotificationRepository,
} from './notification.repository';
import {
  ProductionMobileRepository,
  type IMobileRepository,
} from './mobile.repository';
import {
  ProductionProfileRepository,
  type IProfileRepository,
} from './profile.repository';
import {
  ProductionResultsRepository,
  type IResultsRepository,
} from './results.repository';
import {
  ProductionTrackingRepository,
  type ITrackingRepository,
} from './tracking.repository';
import { CanonicalTrackingRepository } from './canonicalTracking.repository';
import {
  ProductionTrackingSubscriptionRepository,
  type ITrackingSubscriptionRepository,
} from './trackingSubscription.repository';

export type Repositories = {
  events: IEventsRepository;
  athlete: IAthleteRepository;
  tracking: ITrackingRepository;
  canonicalTracking: typeof CanonicalTrackingRepository;
  leaderboard: ILeaderboardRepository;
  course: ICourseRepository;
  results: IResultsRepository;
  certificates: ICertificatesRepository;
  notifications: INotificationRepository;
  trackingSubscriptions: ITrackingSubscriptionRepository;
  profile: IProfileRepository;
  mobile: IMobileRepository;
};

/**
 * Central repository factory. Screens/hooks import `repositories.*` and never
 * touch a concrete repository directly.
 */
export const repositories: Repositories = {
  events: ProductionEventsRepository,
  athlete: ProductionAthleteRepository,
  tracking: ProductionTrackingRepository,
  canonicalTracking: CanonicalTrackingRepository,
  leaderboard: ProductionLeaderboardRepository,
  course: ProductionCourseRepository,
  results: ProductionResultsRepository,
  certificates: ProductionCertificatesRepository,
  notifications: ProductionNotificationRepository,
  trackingSubscriptions: ProductionTrackingSubscriptionRepository,
  profile: ProductionProfileRepository,
  mobile: ProductionMobileRepository,
};

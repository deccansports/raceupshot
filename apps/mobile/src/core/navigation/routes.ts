import { appConfig } from '@/core/constants/config';

import type { DeepLinkTarget } from './types';

/** In-app route paths (Expo Router). Expanded as routes are implemented. */
export const routes = {
  home: '/',
  events: '/events',
  eventDetail: (eventId: string) => `/event/${eventId}`,
  eventExperience: (eventId: string) => `/event/${eventId}`,
  eventTrack: (eventId: string) => `/event/${eventId}/track`,
  eventResults: (eventId: string) => `/event/${eventId}/results`,
  eventLeaderboard: (eventId: string) => `/event/${eventId}/leaderboard`,
  eventAccount: (eventId: string) => `/event/${eventId}/account`,
  athleteDetail: (athleteId: string) => `/athletes/${athleteId}`,
  certificate: (certificateId: string) => `/certificates/${certificateId}`,
  login: '/auth/login',
  settings: '/settings',
} as const;

const scheme = appConfig.deepLinkScheme;

/** Builds an external deep-link URL for a given target. */
export function buildDeepLink(target: DeepLinkTarget): string {
  switch (target.type) {
    case 'event':
      return `${scheme}://event/${target.eventId}`;
    case 'eventLive':
      return `${scheme}://event/${target.eventId}/track`;
    case 'athlete':
      return `${scheme}://athletes/${target.athleteId}`;
    case 'certificate':
      return `${scheme}://certificates/${target.certificateId}`;
  }
}

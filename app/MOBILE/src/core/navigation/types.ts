/**
 * Navigation-related types.
 *
 * Route params for feature screens are added as those routes are implemented.
 * Expo Router typed routes generate route types automatically.
 */

export type DeepLinkTarget =
  | { type: 'event'; eventId: string }
  | { type: 'eventLive'; eventId: string }
  | { type: 'athlete'; athleteId: string }
  | { type: 'certificate'; certificateId: string };

export type KvPrimitive = string | number | boolean | null;
export type KvJson = KvPrimitive | KvJson[] | { [key: string]: KvJson };

export type KvService = {
  get<T extends KvJson = KvJson>(key: string): Promise<T | null>;
  put<T extends KvJson = KvJson>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
  list(prefix: string): Promise<string[]>;
};

export const isLocalKvRuntime =
  process.env.NODE_ENV !== 'production' || process.env.LOCAL_DEV === 'true';

const eventKvKeys = {
  participants(eventId: string) {
    return `event:${eventId}:participants`;
  },
  index(eventId: string) {
    return `event:${eventId}:participant:index`;
  },
  participant(eventId: string, participantId: string) {
    return `event:${eventId}:participant:${participantId}`;
  },
  timingConfiguration(eventId: string) {
    return `event:${eventId}:timingConfiguration`;
  },
  courseIndex(eventId: string) {
    return `event:${eventId}:course:index`;
  },
  courseMaps(eventId: string) {
    return `event:${eventId}:courseMaps`;
  },
  courseMapsLower(eventId: string) {
    return `event:${eventId}:coursemaps`;
  },
  courseMapsDashed(eventId: string) {
    return `event:${eventId}:course-maps`;
  },
  contestIndex(eventId: string) {
    return `event:${eventId}:contest:index`;
  },
  timingPointIndex(eventId: string) {
    return `event:${eventId}:timingPoint:index`;
  },
  splitIndex(eventId: string) {
    return `event:${eventId}:split:index`;
  },
  legIndex(eventId: string) {
    return `event:${eventId}:leg:index`;
  },
  ageGroupIndex(eventId: string) {
    return `event:${eventId}:ageGroup:index`;
  },
  timingRules(eventId: string) {
    return `event:${eventId}:timing-rules`;
  },
  contest(eventId: string, contestUuid: string) {
    return `event:${eventId}:contest:${contestUuid}`;
  },
  splits(eventId: string) {
    return `event:${eventId}:splits`;
  },
} as const;

const liveKvKeys = {
  participants(eventId: string) {
    return `live:event:${eventId}:participants`;
  },
  index(eventId: string) {
    return `live:event:${eventId}:participant:index`;
  },
  participant(eventId: string, participantId: string) {
    return `live:event:${eventId}:participant:${participantId}`;
  },
  lookupBib(eventId: string, bib: string) {
    return `live:event:${eventId}:lookup:bib:${bib}`;
  },
  lookupUser(eventId: string, userId: string) {
    return `live:event:${eventId}:lookup:user:${userId}`;
  },
  lookupEmail(eventId: string, email: string) {
    return `live:event:${eventId}:lookup:email:${email}`;
  },
  timingParticipant(eventId: string, bookingId: string) {
    return `live:event:${eventId}:timingParticipant:${bookingId}`;
  },
  leaderboard(eventId: string) {
    return `live:event:${eventId}:leaderboard`;
  },
  courseMaps(eventId: string) {
    return `live:event:${eventId}:courseMaps`;
  },
  courseMapsLower(eventId: string) {
    return `live:event:${eventId}:coursemaps`;
  },
  courseMapsDashed(eventId: string) {
    return `live:event:${eventId}:course-maps`;
  },
} as const;

const resultsKvKeys = {
  root(eventId: string) {
    return `results:${eventId}`;
  },
  participants(eventId: string) {
    return `results:${eventId}:participants`;
  },
  participant(eventId: string, participantUid: string) {
    return `results:${eventId}:participant:${participantUid}`;
  },
} as const;

export const kvKeys = {
  event: eventKvKeys,
  live: liveKvKeys,
  results: resultsKvKeys,
  user: {
    root(uid: string) {
      return `user:${uid}`;
    },
    profile(uid: string) {
      return `user:${uid}:profile`;
    },
    eventsIndex(uid: string) {
      return `user:${uid}:events:index`;
    },
    notifications(uid: string) {
      return `user:${uid}:notifications`;
    },
    watchlist(uid: string) {
      return `user:${uid}:watchlist`;
    },
    rankings(uid: string) {
      return `user:${uid}:rankings`;
    },
    certificates(uid: string) {
      return `user:${uid}:certificates`;
    },
    dashboard(uid: string) {
      return `user:${uid}:dashboard`;
    },
  },
} as const;

export function createKvService(transport: KvService): KvService {
  return transport;
}

export const kvService = createKvService({
  async get() {
    throw new Error('KV transport is not configured in the mobile app runtime.');
  },
  async put() {
    throw new Error('KV transport is not configured in the mobile app runtime.');
  },
  async delete() {
    throw new Error('KV transport is not configured in the mobile app runtime.');
  },
  async list() {
    throw new Error('KV transport is not configured in the mobile app runtime.');
  },
});

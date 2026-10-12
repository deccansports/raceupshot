import AsyncStorage from '@react-native-async-storage/async-storage';

import type { LiveEventDto } from '@/core/types';

const EVENT_LIST_CACHE_KEY = 'bergman.events.list.v2';

type EventListCacheEntry = {
  events: LiveEventDto[];
  updatedAt: string;
};

const memoryCache = new Map<string, EventListCacheEntry>();

function normalizedScope(scope?: string): string {
  const candidate = String(scope ?? 'public').trim().toLowerCase();
  return candidate.replace(/[^a-z0-9:_-]+/g, '_') || 'public';
}

function storageKey(scope?: string): string {
  return `${EVENT_LIST_CACHE_KEY}:${normalizedScope(scope)}`;
}

function eventsSafeForScope(events: LiveEventDto[], scope?: string): LiveEventDto[] {
  if (normalizedScope(scope) !== 'public') return events;
  return events.filter((event) => {
    const row = event as Record<string, unknown>;
    return row.adminOnly !== true && row.isAdminOnly !== true;
  });
}

export async function readCachedEventList(scope = 'public'): Promise<LiveEventDto[]> {
  const key = storageKey(scope);
  const cached = memoryCache.get(key);
  if (cached?.events.length) return cached.events;

  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Partial<EventListCacheEntry>;
    if (!Array.isArray(parsed.events)) return [];
    const events = eventsSafeForScope(
      parsed.events.filter(
        (event): event is LiveEventDto => Boolean(event) && typeof event === 'object',
      ),
      scope,
    );
    if (events.length === 0) return [];
    memoryCache.set(key, {
      events,
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date(0).toISOString(),
    });
    return events;
  } catch {
    return [];
  }
}

export async function writeCachedEventList(
  events: LiveEventDto[],
  scope = 'public',
): Promise<void> {
  if (!Array.isArray(events) || events.length === 0) return;
  const scopedEvents = eventsSafeForScope(events, scope);
  if (scopedEvents.length === 0) return;
  const entry: EventListCacheEntry = {
    events: scopedEvents,
    updatedAt: new Date().toISOString(),
  };
  const key = storageKey(scope);
  memoryCache.set(key, entry);
  try {
    await AsyncStorage.setItem(key, JSON.stringify(entry));
  } catch {
    // Persistent cache is best effort; the in-memory copy is still usable.
  }
}

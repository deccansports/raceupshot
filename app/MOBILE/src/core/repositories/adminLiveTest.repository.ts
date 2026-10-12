import { authenticatedJson } from '@/core/auth/authenticatedFetch';

export type LiveTestEvent = {
  id: string;
  eventName: string;
  eventDate: string;
  categories: { contestUuid: string; name: string }[];
};

export type LiveTestSnapshot = {
  event: LiveTestEvent;
  simulation: { status: string; tickNumber: number; speedMultiplier: number; currentVirtualTime?: string | null };
  participants: {
    participantId?: string;
    id?: string;
    name?: string;
    fullName?: string;
    bib?: string;
    category?: string;
    status?: string;
    leg?: string;
    currentSplit?: string | null;
    position?: { courseProgress?: number };
  }[];
  results: { rows?: unknown[] };
  stats?: Record<string, number> | null;
};

type EventsResponse = { events: LiveTestEvent[] };

export const adminLiveTestRepository = {
  listEvents: () => authenticatedJson<EventsResponse>('/api/admin/live-test/events'),
  seed: (eventId: string) => authenticatedJson(`/api/admin/live-test/events`, {
    method: 'POST',
    body: { eventId },
  }),
  snapshot: (eventId: string) => authenticatedJson<LiveTestSnapshot>(`/api/admin/live-test/events/${encodeURIComponent(eventId)}/snapshot`),
  action: (eventId: string, action: 'START' | 'PAUSE' | 'RESUME' | 'STOP' | 'RESET') => authenticatedJson(`/api/admin/live-test/events/${encodeURIComponent(eventId)}/simulation`, {
    method: 'POST',
    body: { action },
  }),
  tick: (eventId: string) => authenticatedJson(`/api/admin/live-test/events/${encodeURIComponent(eventId)}/simulation/tick`, {
    method: 'POST',
  }),
};

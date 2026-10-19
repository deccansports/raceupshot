import {
  authenticatedJson,
  optionalAuthenticatedJson,
} from "@/core/auth/authenticatedFetch";
import { getPersistedPushDeviceId } from "@/core/services/pushDeviceIdentity";

export type TrackingSubscriptionInput = {
  [key: string]: unknown;
  /** Preserved server-side watchlist ID for legacy or normalized athletes. */
  watchlistItemId?: string | null;
  eventId?: string | null;
  athleteId: string;
  bib?: string | null;
  contestId?: string | null;
  name?: string | null;
  category?: string | null;
  ageGroup?: string | null;
  club?: string | null;
  photoUrl?: string | null;
  participantUuid?: string | null;
  providerUuid?: string | null;
  providerAthleteUuid?: string | null;
  providerTimingUuid?: string | null;
  providerRecordId?: string | null;
  athleteUid?: string | null;
  bookingId?: string | null;
  contestUuid?: string | null;
  providerContestUuid?: string | null;
  providerContestId?: string | null;
  ticketId?: string | null;
  raceDate?: string | null;
  email?: string | null;
};

export type TrackingSubscriptionRecord = TrackingSubscriptionInput & {
  id?: string | null;
};

export interface ITrackingSubscriptionRepository {
  list(): Promise<TrackingSubscriptionRecord[]>;
  subscribe(input: TrackingSubscriptionInput): Promise<void>;
  unsubscribe(
    input: Pick<
      TrackingSubscriptionInput,
      "eventId" | "athleteId" | "watchlistItemId"
    >,
  ): Promise<void>;
}

async function bodyFor(input: TrackingSubscriptionInput) {
  const eventId = String(input.eventId ?? "").trim();
  const athleteId = String(input.athleteId ?? "").trim();
  return {
    id: `${eventId}:${athleteId}`,
    type: "live-athlete",
    eventId,
    athleteId,
    label: input.name || input.bib || athleteId,
    deviceId: await getPersistedPushDeviceId(),
    athlete: {
      ...input,
      eventId,
      athleteId,
      id: athleteId,
    },
  };
}

function rowsFromResponse(payload: unknown): TrackingSubscriptionRecord[] {
  if (Array.isArray(payload)) return payload as TrackingSubscriptionRecord[];
  if (!payload || typeof payload !== "object") return [];
  const record = payload as Record<string, unknown>;
  const rows =
    record.subscriptions ?? record.watchlist ?? record.items ?? record.data;
  if (Array.isArray(rows)) return rows as TrackingSubscriptionRecord[];
  if (rows && typeof rows === "object") {
    const nested = rows as Record<string, unknown>;
    const nestedRows = nested.subscriptions ?? nested.watchlist ?? nested.items;
    if (Array.isArray(nestedRows))
      return nestedRows as TrackingSubscriptionRecord[];
  }
  return [];
}

let listRequest: Promise<TrackingSubscriptionRecord[]> | null = null;

export const ProductionTrackingSubscriptionRepository: ITrackingSubscriptionRepository =
  {
    async list() {
      if (listRequest) return listRequest;
      listRequest = authenticatedJson<unknown>("/api/watchlist")
        .then(rowsFromResponse)
        .finally(() => {
          listRequest = null;
        });
      return listRequest;
    },

    async subscribe(input) {
      if (!input.eventId || !input.athleteId) return;
      await optionalAuthenticatedJson("/api/watchlist", {
        method: "POST",
        body: await bodyFor(input),
      });
    },

    async unsubscribe(input) {
      if (!input.eventId || !input.athleteId) return;
      // The roster may normalize a saved entry to a bib, while older account
      // records were created with a provider UUID. Delete the persisted item
      // ID when available instead of reconstructing a different identifier.
      const itemId =
        String(input.watchlistItemId ?? "").trim() ||
        `${input.eventId}:${input.athleteId}`;
      const deviceId = await getPersistedPushDeviceId();
      await optionalAuthenticatedJson(
        `/api/watchlist/${encodeURIComponent(itemId)}?deviceId=${encodeURIComponent(deviceId)}`,
        {
          method: "DELETE",
        },
      );
    },
  };

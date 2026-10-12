"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiEnvelope, LiveParticipant, PublicEvent } from "@/packages/contracts/src";
import type { CanonicalChangeEvent } from "@/packages/live-tracking-contracts/src";
import { LiveAthleteDetail } from "./live-athlete-detail";
import { useCanonicalChangeStream } from "./use-canonical-change-stream";

export function LiveAthleteDetailRealtime({ event, initialAthlete, initialStale }: {
  event: PublicEvent; initialAthlete: LiveParticipant; initialStale: boolean;
}) {
  const [athlete, setAthlete] = useState(initialAthlete);
  const [stale, setStale] = useState(initialStale);
  const pendingRef = useRef<CanonicalChangeEvent | null>(null);
  const load = useCallback(async (change?: CanonicalChangeEvent) => {
    if (change?.participantUuid && change.participantUuid !== athlete.participantUid) return;
    if (change) pendingRef.current = change;
    const response = await fetch(`/api/v1/events/${encodeURIComponent(event.eventId)}/participants/${encodeURIComponent(athlete.participantUid)}`, { cache: "no-store" });
    const payload = await response.json() as ApiEnvelope<LiveParticipant>;
    if (!response.ok || !payload.success) return;
    setAthlete(payload.data);
    setStale(payload.meta.isStale);
  }, [athlete.participantUid, event.eventId]);
  useCanonicalChangeStream(event.eventId, load, () => load());
  useEffect(() => {
    const pending = pendingRef.current;
    if (!pending) return;
    pendingRef.current = null;
    const renderedAt = new Date().toISOString();
    console.info("[canonical-change:web:rendered]", {
      eventId: event.eventId, participantUuid: athlete.participantUid,
      manifestVersion: pending.manifestVersion,
      accepted_to_client_update_ms: pending.feibotReadAcceptedAt
        ? Date.parse(renderedAt) - Date.parse(pending.feibotReadAcceptedAt) : null,
    });
  }, [athlete.lastUpdatedAt, athlete.splits.length, athlete.participantUid, event.eventId]);
  return <LiveAthleteDetail event={event} athlete={athlete} stale={stale} />;
}

"use client";

import { useEffect, useRef } from "react";
import {
  compareManifestVersions,
  isCanonicalChangeEvent,
  type CanonicalChangeEvent,
} from "@/packages/live-tracking-contracts/src";

export function useCanonicalChangeStream(
  eventId: string | undefined,
  onChange: (event: CanonicalChangeEvent) => Promise<void> | void,
  onReconcile: () => Promise<void> | void,
) {
  const changeRef = useRef(onChange);
  const reconcileRef = useRef(onReconcile);
  const latestVersionRef = useRef<string | null>(null);
  useEffect(() => { changeRef.current = onChange; }, [onChange]);
  useEffect(() => { reconcileRef.current = onReconcile; }, [onReconcile]);

  useEffect(() => {
    if (!eventId) return;
    let socket: WebSocket | null = null;
    let reconnectTimer: number | null = null;
    let stopped = false;
    let attempts = 0;
    const connect = () => {
      if (stopped) return;
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      socket = new WebSocket(`${protocol}//${window.location.host}/api/live/events/${encodeURIComponent(eventId)}/stream`);
      socket.onopen = () => {
        attempts = 0;
        void reconcileRef.current();
      };
      socket.onmessage = (message) => {
        try {
          const parsed = JSON.parse(String(message.data)) as unknown;
          if (!isCanonicalChangeEvent(parsed) || parsed.eventId !== eventId) return;
          if (compareManifestVersions(parsed.manifestVersion, latestVersionRef.current) <= 0) return;
          latestVersionRef.current = parsed.manifestVersion;
          const receivedAt = new Date().toISOString();
          console.info("[canonical-change:web]", {
            eventId, participantUuid: parsed.participantUuid ?? null,
            manifestVersion: parsed.manifestVersion, canonicalUpdateReceivedAt: receivedAt,
            canonical_to_client_ms: Date.parse(receivedAt) - Date.parse(parsed.canonicalWriteCompletedAt),
          });
          void Promise.resolve(changeRef.current(parsed)).then(() => {
            const completedAt = new Date().toISOString();
            console.info("[canonical-change:web:refetched]", {
              eventId, participantUuid: parsed.participantUuid ?? null,
              manifestVersion: parsed.manifestVersion,
              push_to_refetch_ms: Date.parse(completedAt) - Date.parse(parsed.publishedAt),
              accepted_to_client_update_ms: parsed.feibotReadAcceptedAt
                ? Date.parse(completedAt) - Date.parse(parsed.feibotReadAcceptedAt) : null,
            });
          });
        } catch { /* Ignore non-contract frames such as pong/ready. */ }
      };
      socket.onclose = () => {
        if (stopped) return;
        const delay = Math.min(10_000, 500 * 2 ** Math.min(attempts++, 5));
        reconnectTimer = window.setTimeout(connect, delay);
      };
      socket.onerror = () => socket?.close();
    };
    const reconcile = () => { if (document.visibilityState === "visible") void reconcileRef.current(); };
    window.addEventListener("online", reconcile);
    document.addEventListener("visibilitychange", reconcile);
    connect();
    return () => {
      stopped = true;
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      window.removeEventListener("online", reconcile);
      document.removeEventListener("visibilitychange", reconcile);
      socket?.close(1000, "Component unmounted");
    };
  }, [eventId]);
}

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  useFocusEffect,
  useGlobalSearchParams,
  useLocalSearchParams,
} from "expo-router";

export function normalizeEventIdParam(value: unknown): string {
  const raw = Array.isArray(value) ? value[0] : value;
  return String(raw ?? "").trim();
}

export function hasValidEventId(value: unknown): boolean {
  const eventId = normalizeEventIdParam(value);
  return Boolean(eventId && eventId !== "undefined" && eventId !== "null");
}

type Refetchable = {
  refetch?: () => unknown;
};

export function useEventScreenInitialization() {
  const params = useLocalSearchParams<{ eventId?: string | string[] }>();
  const globalParams = useGlobalSearchParams<{ eventId?: string | string[] }>();
  const rawEventId = params.eventId || globalParams.eventId;
  const eventId = normalizeEventIdParam(rawEventId);
  const validEventId = hasValidEventId(eventId);
  const [focused, setFocused] = useState(() => {
    if (typeof document === "undefined") return true;
    return document.visibilityState !== "hidden";
  });

  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );

  useEffect(() => {
    // Expo Router can briefly mount nested tab screens before the dynamic
    // route param is hydrated. Queries remain disabled during that render, so
    // only report explicit invalid values such as "undefined" or "null".
    if (validEventId || !eventId) return;
    if (process.env.NODE_ENV === "production") return;
    console.error("[event-screen-route] Invalid eventId from route", {
      rawEventId,
      normalizedEventId: eventId,
    });
  }, [eventId, rawEventId, validEventId]);

  useEffect(() => {
    if (typeof window === "undefined" || typeof document === "undefined")
      return;

    const handleVisibilityChange = () => {
      setFocused(document.visibilityState !== "hidden");
    };

    const handlePageShow = () => {
      if (document.visibilityState === "hidden") return;
      setFocused(true);
    };

    const handleWindowFocus = () => {
      if (document.visibilityState === "hidden") return;
      setFocused(true);
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("pageshow", handlePageShow);
    window.addEventListener("focus", handleWindowFocus);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("pageshow", handlePageShow);
      window.removeEventListener("focus", handleWindowFocus);
    };
  }, []);

  return useMemo(
    () => ({
      eventId: validEventId ? eventId : "",
      rawEventId: eventId,
      validEventId,
      queryEnabled: validEventId,
      pollingEnabled: validEventId && focused,
      focused,
    }),
    [eventId, focused, validEventId],
  );
}

export function useEventScreenFocusRefresh(
  eventId: string,
  queries: Refetchable[],
) {
  const queriesRef = useRef(queries);
  useEffect(() => {
    queriesRef.current = queries;
  }, [queries]);

  useEffect(() => {
    if (typeof window === "undefined" || typeof document === "undefined")
      return;

    const doRefetch = () => {
      if (!hasValidEventId(eventId)) return;
      if (document.visibilityState === "hidden") return;
      queriesRef.current.forEach((query) => {
        void query.refetch?.();
      });
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        doRefetch();
      }
    };

    const handleWindowFocus = () => {
      doRefetch();
    };

    const handlePageShow = () => {
      if (document.visibilityState === "hidden") return;
      doRefetch();
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", handleWindowFocus);
    window.addEventListener("pageshow", handlePageShow);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", handleWindowFocus);
      window.removeEventListener("pageshow", handlePageShow);
    };
  }, [eventId]);

  useFocusEffect(
    useCallback(() => {
      if (!hasValidEventId(eventId)) return undefined;
      queriesRef.current.forEach((query) => {
        void query.refetch?.();
      });
      return undefined;
    }, [eventId]),
  );
}

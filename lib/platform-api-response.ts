import { API_VERSION, type ApiErrorEnvelope, type ApiMeta } from "@/packages/contracts/src";
import { NextResponse } from "next/server";

export interface PlatformMetaInput {
  eventId?: string;
  lastUpdatedAt?: string | null;
  source?: ApiMeta["source"];
  provider?: ApiMeta["provider"];
  isStale?: boolean;
  cacheSeconds?: number;
}

export function platformSuccess<T>(data: T, meta: PlatformMetaInput = {}, init: ResponseInit = {}) {
  const requestId = crypto.randomUUID();
  const headers = new Headers(init.headers);
  const cacheSeconds = meta.cacheSeconds ?? 10;
  headers.set("x-request-id", requestId);
  headers.set(
    "cache-control",
    headers.get("cache-control") ?? `public, max-age=${Math.min(cacheSeconds, 10)}, s-maxage=${cacheSeconds}, stale-while-revalidate=30`,
  );
  return NextResponse.json({
    success: true,
    ...(meta.eventId ? { eventId: meta.eventId } : {}),
    data,
    meta: {
      apiVersion: API_VERSION,
      lastUpdatedAt: meta.lastUpdatedAt ?? null,
      source: meta.source ?? "raceupshot",
      ...(meta.provider ? { provider: meta.provider } : {}),
      isStale: meta.isStale ?? false,
      cacheSeconds,
      requestId,
    },
  }, { ...init, headers });
}

export function platformFailure(code: string, message: string, status = 500) {
  const requestId = crypto.randomUUID();
  const retryable = status === 429 || status >= 500;
  const body: ApiErrorEnvelope = {
    success: false,
    error: {
      code,
      type: code.toLowerCase(),
      message,
      display: message,
      retryable,
    },
    meta: { apiVersion: API_VERSION, requestId },
  };
  return NextResponse.json(body, {
    status,
    headers: { "x-request-id": requestId, "cache-control": "no-store" },
  });
}

import { NextResponse } from "next/server";

export function apiSuccess<T>(data: T, init: ResponseInit = {}) {
  const requestId = crypto.randomUUID();
  const headers = new Headers(init.headers);
  headers.set("x-request-id", requestId);
  headers.set("cache-control", headers.get("cache-control") ?? "public, max-age=5, s-maxage=15, stale-while-revalidate=30");
  return NextResponse.json({ ok: true, data, requestId }, { ...init, headers });
}

export function apiFailure(error: string, status = 500, init: ResponseInit = {}) {
  const requestId = crypto.randomUUID();
  const headers = new Headers(init.headers);
  headers.set("x-request-id", requestId);
  headers.set("cache-control", "no-store");
  return NextResponse.json(
    { ok: false, error, requestId },
    { ...init, status, headers },
  );
}

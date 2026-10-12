"use client";

import type { User } from "firebase/auth";

export class AccountResolutionError extends Error {}

export async function openLinkedAccount(user: User) {
  const token = await user.getIdToken(true);
  const response = await fetch("/api/auth/resolve", {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  const payload = await response.json().catch(() => null) as {
    ok?: boolean;
    data?: { destination?: string; volunteerSessionToken?: string | null };
    error?: string;
  } | null;
  if (!response.ok || !payload?.ok || !payload.data?.destination) {
    throw new AccountResolutionError(payload?.error || "Unable to verify account access.");
  }
  if (payload.data.volunteerSessionToken) {
    window.localStorage.setItem("raceupshot-volunteer-session", payload.data.volunteerSessionToken);
  }
  window.location.assign(payload.data.destination);
}

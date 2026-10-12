import { onAuthStateChanged, signOut } from "firebase/auth";
import { useEffect, useRef, type ReactNode } from "react";
import { AppState, type AppStateStatus } from "react-native";

import { AuthRepository } from "@/core/repositories/auth.repository";

import { ensureFirebase } from "./firebase";
import {
  clearAccessToken,
  clearSessionMeta,
  getAccessToken,
  getSessionMeta,
  saveAccessToken,
  saveSessionMeta,
} from "./secureStore";
import { useSession } from "./session";
import { clearDashboardCache } from "@/core/repositories/mobile.repository";
import { ProductionTrackingSubscriptionRepository } from "@/core/repositories/trackingSubscription.repository";
import { useWatchlistStore, type TrackedAthlete } from "@/core/store";
import { resumePushRegistrationIfEnabled } from "@/core/services/notifications";

function watchlistAthlete(value: unknown): TrackedAthlete | null {
  if (!value || typeof value !== "object") return null;
  const outer = value as Record<string, unknown>;
  const nested =
    outer.athlete && typeof outer.athlete === "object"
      ? (outer.athlete as Record<string, unknown>)
      : {};
  const row = { ...outer, ...nested };
  const athleteId = String(
    row.athleteId ?? row.id ?? row.participantUuid ?? row.bib ?? "",
  ).trim();
  if (!athleteId) return null;
  const bib = String(row.bib ?? athleteId).trim();
  return {
    ...(row as TrackedAthlete),
    id: athleteId,
    watchlistItemId: String(outer.id ?? "").trim() || undefined,
    bib,
    name: String(row.name ?? row.displayName ?? `Bib ${bib}`).trim(),
    eventId: String(outer.eventId ?? row.eventId ?? "").trim() || undefined,
  };
}

function isAccountStatusUnavailable(error: unknown): boolean {
  return (error as { status?: number | null }).status === 404;
}

function isTerminalFirebaseSessionError(error: unknown): boolean {
  const code = String((error as { code?: unknown }).code ?? "").toLowerCase();
  return [
    "auth/user-disabled",
    "auth/user-token-expired",
    "auth/invalid-user-token",
  ].includes(code);
}

/**
 * Bootstraps Firebase and mirrors the web's session restoration via the auth
 * state listener: on launch/reload `onAuthStateChanged` fires and sets the
 * session (authenticated/guest). Profile data is loaded separately via React
 * Query (useProfile), never stored here.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const setAuthenticated = useSession((s) => s.setAuthenticated);
  const setGuest = useSession((s) => s.setGuest);
  const status = useSession((s) => s.status);
  const userId = useSession((s) => s.user?.uid);
  const previousUserId = useRef<string | null>(null);

  useEffect(() => {
    const sync = async () => {
      if (status !== "authenticated" || !userId) return;
      await useWatchlistStore.getState().hydrate(userId);
      try {
        const rows = await ProductionTrackingSubscriptionRepository.list();
        if (useSession.getState().user?.uid !== userId) return;
        useWatchlistStore
          .getState()
          .replaceAthletes(
            rows
              .map(watchlistAthlete)
              .filter((row): row is TrackedAthlete => Boolean(row)),
          );
        if (rows.length > 0) void resumePushRegistrationIfEnabled();
      } catch (error) {
        console.warn("[watchlist] account synchronization failed", error);
      }
    };

    const priorUserId = previousUserId.current;
    if (priorUserId && priorUserId !== userId) {
      void useWatchlistStore.getState().clearAccount(priorUserId);
    }
    previousUserId.current = userId ?? null;
    if (status !== "loading") void resumePushRegistrationIfEnabled();
    if (status === "authenticated" && userId) void sync();
    if (status === "guest") {
      // Keep public tracking usable without an account. Switching to the guest
      // namespace prevents account rows leaking after sign-out while preserving
      // athletes the guest already added during Firebase session resolution.
      void useWatchlistStore.getState().hydrate(null);
    }

    const onAppStateChange = (nextState: AppStateStatus) => {
      if (nextState === "active") {
        void sync();
        // APNs/FCM tokens and permissions can change while the app is in the
        // background (including after returning from system settings).
        void resumePushRegistrationIfEnabled();
      }
    };
    const subscription = AppState.addEventListener("change", onAppStateChange);
    return () => subscription.remove();
  }, [status, userId]);

  useEffect(() => {
    let unsub: (() => void) | undefined;
    let active = true;

    (async () => {
      try {
        const { auth } = await ensureFirebase();
        if (!active) return;
        unsub = onAuthStateChanged(auth, (fbUser) => {
          if (fbUser) {
            void (async () => {
              let token: string | null = null;
              try {
                token = await fbUser.getIdToken();
                // The bearer token is already the server-side authorization
                // boundary. Expose the restored Firebase session immediately so
                // the authenticated event request can run in parallel with the
                // slower account-profile status check.
                setAuthenticated(
                  {
                    uid: fbUser.uid,
                    email: fbUser.email,
                    displayName: fbUser.displayName,
                  },
                  token,
                );
                const accountStatus = await AuthRepository.checkAccountStatus(
                  token,
                ).catch((statusError) => {
                  if (isAccountStatusUnavailable(statusError)) {
                    console.warn(
                      "AuthProvider account status endpoint is not available; restoring legacy Firebase session until backend route is deployed",
                    );
                    return {
                      success: true,
                      accountExists: true,
                      uid: fbUser.uid,
                      profileComplete: true,
                      code: "ACCOUNT_ACTIVE" as const,
                    };
                  }
                  throw statusError;
                });
                if (
                  accountStatus.accountExists !== true ||
                  accountStatus.code === "ACCOUNT_DISABLED" ||
                  accountStatus.code === "PROFILE_INCOMPLETE"
                ) {
                  console.log(
                    "AuthProvider blocked Firebase session without an active Bergman account",
                    accountStatus.code,
                  );
                  await signOut(auth);
                  setGuest();
                  await clearSessionMeta();
                  await clearAccessToken();
                  await clearDashboardCache();
                  return;
                }
                setAuthenticated(
                  {
                    uid: fbUser.uid,
                    email: fbUser.email,
                    displayName: fbUser.displayName,
                  },
                  token,
                );
                console.log("AuthProvider restored session");
                console.log("Saving Firebase ID token...");
                await saveAccessToken(token);
                console.log("Firebase ID token saved successfully.");
                await saveSessionMeta({
                  uid: fbUser.uid,
                  email: fbUser.email,
                  lastLoginAt: Date.now(),
                });
              } catch (error) {
                console.error(
                  "AuthProvider failed to restore Firebase session",
                  error,
                );
                if (!active || auth.currentUser?.uid !== fbUser.uid) return;
                if (isTerminalFirebaseSessionError(error)) {
                  await signOut(auth).catch(() => undefined);
                  setGuest();
                  await clearSessionMeta();
                  await clearAccessToken();
                  await clearDashboardCache();
                  return;
                }

                // A network/account-status outage is not a logout. Firebase
                // still has an authenticated user, so retain the session while
                // API queries retry after connectivity returns.
                const cachedToken = token ?? (await getAccessToken());
                setAuthenticated(
                  {
                    uid: fbUser.uid,
                    email: fbUser.email,
                    displayName: fbUser.displayName,
                  },
                  cachedToken,
                );
                await saveSessionMeta({
                  uid: fbUser.uid,
                  email: fbUser.email,
                  lastLoginAt: Date.now(),
                });
                if (token) await saveAccessToken(token);
                console.warn(
                  "AuthProvider retained Firebase session after a temporary restore failure",
                );
              }
            })();
          } else {
            console.log("AuthProvider received null Firebase user");
            setGuest();
            void clearSessionMeta();
            void clearAccessToken();
            void clearDashboardCache();
          }
        });
      } catch (error) {
        // Preserve the last Firebase-derived identity during a temporary native
        // initialization failure. Explicit logout clears this metadata first.
        const [meta, token] = await Promise.all([
          getSessionMeta(),
          getAccessToken(),
        ]);
        if (!active) return;
        if (meta) {
          setAuthenticated(
            { uid: meta.uid, email: meta.email, displayName: meta.email },
            token,
          );
          console.warn(
            "AuthProvider restored cached session metadata after Firebase initialization failed",
            error,
          );
        } else {
          setGuest();
        }
      }
    })();

    return () => {
      active = false;
      unsub?.();
    };
  }, [setAuthenticated, setGuest]);

  return <>{children}</>;
}

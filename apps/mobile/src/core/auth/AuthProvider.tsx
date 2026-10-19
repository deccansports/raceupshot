import { useEffect, useRef, type ReactNode } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { AuthRepository } from '@/core/repositories/auth.repository';
import { clearDashboardCache } from '@/core/repositories/mobile.repository';
import { resumePushRegistrationIfEnabled } from '@/core/services/notifications';
import { ProductionTrackingSubscriptionRepository } from '@/core/repositories/trackingSubscription.repository';
import { useWatchlistStore, type TrackedAthlete } from '@/core/store';

import { clearAccessToken, clearSessionMeta, getAccessToken, getSessionMeta, saveAccessToken } from './secureStore';
import { useSession } from './session';
import { firebaseAccessToken, isFirebaseAccessToken } from './accessToken';
import { getRestoredFirebaseIdToken } from './firebase';

function watchlistAthlete(value: unknown): TrackedAthlete | null {
  if (!value || typeof value !== 'object') return null;
  const outer = value as Record<string, unknown>;
  const nested = outer.athlete && typeof outer.athlete === 'object' ? outer.athlete as Record<string, unknown> : {};
  const row = { ...outer, ...nested };
  const athleteId = String(row.athleteId ?? row.id ?? row.participantUuid ?? row.bib ?? '').trim();
  if (!athleteId) return null;
  const bib = String(row.bib ?? athleteId).trim();
  return {
    ...(row as TrackedAthlete), id: athleteId,
    watchlistItemId: String(outer.id ?? '').trim() || undefined,
    bib,
    name: String(row.name ?? row.displayName ?? `Bib ${bib}`).trim(),
    eventId: String(outer.eventId ?? row.eventId ?? '').trim() || undefined,
  };
}

/** Restores and validates either a Worker OTP session or Firebase password session. */
export function AuthProvider({ children }: { children: ReactNode }) {
  const status = useSession((state) => state.status);
  const userId = useSession((state) => state.user?.uid);
  const setAuthenticated = useSession((state) => state.setAuthenticated);
  const setGuest = useSession((state) => state.setGuest);
  const previousUserId = useRef<string | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      const [token, meta] = await Promise.all([getAccessToken(), getSessionMeta()]);
      if (!active) return;
      if (!token || !meta) { setGuest(); return; }
      try {
        const restoredToken = isFirebaseAccessToken(token)
          ? await getRestoredFirebaseIdToken(true).then((idToken) => idToken ? firebaseAccessToken(idToken) : null)
          : token;
        if (!restoredToken) throw new Error('Firebase session is unavailable.');
        if (restoredToken !== token) await saveAccessToken(restoredToken);
        const account = await AuthRepository.getAccount(restoredToken);
        if (!active) return;
        setAuthenticated({
          uid: account.uid || meta.uid,
          email: account.email || meta.email,
          displayName: account.profile?.name || account.name || meta.email || meta.uid,
        }, restoredToken);
      } catch {
        await Promise.allSettled([clearAccessToken(), clearSessionMeta(), clearDashboardCache()]);
        if (active) setGuest();
      }
    })();
    return () => { active = false; };
  }, [setAuthenticated, setGuest]);

  useEffect(() => {
    const sync = async () => {
      if (status !== 'authenticated' || !userId) return;
      await useWatchlistStore.getState().hydrate(userId);
      try {
        const rows = await ProductionTrackingSubscriptionRepository.list();
        if (useSession.getState().user?.uid !== userId) return;
        useWatchlistStore.getState().replaceAthletes(rows.map(watchlistAthlete).filter((row): row is TrackedAthlete => Boolean(row)));
        if (rows.length > 0) void resumePushRegistrationIfEnabled();
      } catch { /* keep the persisted watchlist available offline */ }
    };
    const priorUserId = previousUserId.current;
    if (priorUserId && priorUserId !== userId) void useWatchlistStore.getState().clearAccount(priorUserId);
    previousUserId.current = userId || null;
    if (status === 'authenticated') void sync();
    if (status === 'guest') void useWatchlistStore.getState().hydrate(null);
    const subscription = AppState.addEventListener('change', (nextState: AppStateStatus) => {
      if (nextState === 'active') void sync();
    });
    return () => subscription.remove();
  }, [status, userId]);

  return <>{children}</>;
}

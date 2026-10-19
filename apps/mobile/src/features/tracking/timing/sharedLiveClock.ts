import { useEffect, useState } from 'react';
import { AppState, type AppStateStatus, type NativeEventSubscription } from 'react-native';

const listeners = new Set<(nowMs: number) => void>();
let timer: ReturnType<typeof setInterval> | null = null;
let appStateSubscription: NativeEventSubscription | null = null;
let currentNowMs = Date.now();

function emitCurrentTime() {
  currentNowMs = Date.now();
  listeners.forEach((current) => current(currentNowMs));
}

function subscribe(listener: (nowMs: number) => void): () => void {
  listeners.add(listener);
  // A component may subscribe after Android has suspended timers. Never seed
  // a live race clock from the module's last (possibly stale) interval tick.
  emitCurrentTime();
  if (!timer) {
    timer = setInterval(emitCurrentTime, 1_000);
  }
  if (!appStateSubscription) {
    appStateSubscription = AppState.addEventListener(
      'change',
      (status: AppStateStatus) => {
        // Android/iOS pause JS intervals while backgrounded. Recalculate from
        // wall-clock time immediately on resume instead of waiting for a tick.
        if (status === 'active') emitCurrentTime();
      },
    );
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
    if (listeners.size === 0 && appStateSubscription) {
      appStateSubscription.remove();
      appStateSubscription = null;
    }
  };
}

/** One process-wide clock for all visible live timing and prediction cards. */
export function useSharedLiveNow(enabled: boolean): number {
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return undefined;
    return subscribe(setNowMs);
  }, [enabled]);
  return nowMs;
}

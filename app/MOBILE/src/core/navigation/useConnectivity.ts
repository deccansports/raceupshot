import { onlineManager } from '@tanstack/react-query';
import { useEffect } from 'react';

import { useAppStore } from '@/core/store';

/**
 * Mirrors React Query's online status into the app store so the global
 * OfflineBanner can react. React Query's `onlineManager` uses `navigator.onLine`
 * (+ online/offline events) on web and stays online on native; both drive the
 * same offline flag without an extra dependency. React Query also
 * auto-refetches on reconnect, so screens recover on their own.
 */
export function useConnectivity() {
  const setOffline = useAppStore((s) => s.setOffline);
  useEffect(() => {
    setOffline(!onlineManager.isOnline());
    return onlineManager.subscribe((online) => setOffline(!online));
  }, [setOffline]);
}

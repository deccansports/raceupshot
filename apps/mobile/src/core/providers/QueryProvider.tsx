import { focusManager, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, type ReactNode } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { queryClient } from '@/core/services/query/queryClient';

type QueryProviderProps = {
  children: ReactNode;
};

/**
 * Provides the shared React Query client and bridges React Native AppState to
 * React Query's focus manager, so background apps pause polling/refetching
 * (refetchIntervalInBackground is off by default).
 */
export function QueryProvider({ children }: QueryProviderProps) {
  useEffect(() => {
    const sub = AppState.addEventListener('change', (status: AppStateStatus) => {
      focusManager.setFocused(status === 'active');
    });
    return () => sub.remove();
  }, []);

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

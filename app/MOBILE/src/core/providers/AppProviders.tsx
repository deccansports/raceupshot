import { type ReactNode } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AuthProvider } from '@/core/auth';
import { ThemeProvider } from '@/core/theme/ThemeProvider';

import { ErrorBoundary } from './ErrorBoundary';
import { LoadingProvider } from './LoadingProvider';
import { QueryProvider } from './QueryProvider';

type AppProvidersProps = {
  children: ReactNode;
};

/**
 * Composes all app-wide providers in a deterministic order.
 * GestureHandlerRootView is applied at the route layout root.
 */
export function AppProviders({ children }: AppProvidersProps) {
  return (
    <SafeAreaProvider>
      <QueryProvider>
        <AuthProvider>
          <ThemeProvider>
            <ErrorBoundary>
              <LoadingProvider>{children}</LoadingProvider>
            </ErrorBoundary>
          </ThemeProvider>
        </AuthProvider>
      </QueryProvider>
    </SafeAreaProvider>
  );
}

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { useTheme } from '@/core/theme/ThemeProvider';

type LoadingContextValue = {
  isLoading: boolean;
  showLoading: () => void;
  hideLoading: () => void;
};

const LoadingContext = createContext<LoadingContextValue | null>(null);

type LoadingProviderProps = {
  children: ReactNode;
};

/** Provides an app-wide blocking loading overlay for global async operations. */
export function LoadingProvider({ children }: LoadingProviderProps) {
  const theme = useTheme();
  const [count, setCount] = useState(0);

  const showLoading = useCallback(() => setCount((c) => c + 1), []);
  const hideLoading = useCallback(() => setCount((c) => Math.max(0, c - 1)), []);

  const value = useMemo<LoadingContextValue>(
    () => ({ isLoading: count > 0, showLoading, hideLoading }),
    [count, showLoading, hideLoading],
  );

  return (
    <LoadingContext.Provider value={value}>
      {children}
      {count > 0 ? (
        <View
          style={[StyleSheet.absoluteFill, styles.overlay, { pointerEvents: 'auto' }]}
          accessibilityRole="progressbar"
          accessibilityLabel="Loading">
          <ActivityIndicator size="large" color={theme.colors.accent} />
        </View>
      ) : null}
    </LoadingContext.Provider>
  );
}

export function useLoading(): LoadingContextValue {
  const ctx = useContext(LoadingContext);
  if (!ctx) {
    throw new Error('useLoading must be used within a LoadingProvider');
  }
  return ctx;
}

const styles = StyleSheet.create({
  overlay: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
});

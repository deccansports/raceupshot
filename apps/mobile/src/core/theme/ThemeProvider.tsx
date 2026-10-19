import { createContext, useContext, useMemo, type ReactNode } from 'react';

import { useResolvedColorScheme } from '@/core/hooks/useColorScheme';

import { themes, type Theme } from './theme';

const ThemeContext = createContext<Theme | null>(null);

type ThemeProviderProps = {
  children: ReactNode;
};

/**
 * Theme bridge: resolves the active color scheme (preference + system) and
 * exposes design tokens to the component tree via context.
 */
export function ThemeProvider({ children }: ThemeProviderProps) {
  const scheme = useResolvedColorScheme();
  const theme = useMemo(() => themes[scheme], [scheme]);

  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

/** Access the active theme tokens. Throws if used outside ThemeProvider. */
export function useTheme(): Theme {
  const theme = useContext(ThemeContext);
  if (!theme) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return theme;
}

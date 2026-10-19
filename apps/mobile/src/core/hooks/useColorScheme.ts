import { useColorScheme as useRNColorScheme } from 'react-native';

import { usePreferencesStore } from '@/core/store/preferences.store';

import type { ColorSchemeName } from '@/core/theme/theme';

/**
 * Resolves the active color scheme from the user's preference, falling back to
 * the system scheme when the preference is "system".
 */
export function useResolvedColorScheme(): ColorSchemeName {
  const preference = usePreferencesStore((state) => state.colorScheme);
  const system = useRNColorScheme();

  if (preference === 'system') {
    return system === 'dark' ? 'dark' : 'light';
  }
  return preference;
}

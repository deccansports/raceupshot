import { create } from 'zustand';

export type ColorSchemePreference = 'light' | 'dark' | 'system';
export type UnitPreference = 'metric' | 'imperial';

type PreferencesState = {
  colorScheme: ColorSchemePreference;
  units: UnitPreference;
  setColorScheme: (value: ColorSchemePreference) => void;
  setUnits: (value: UnitPreference) => void;
};

/**
 * Client preferences (appearance, units).
 *
 * Persistence is intentionally omitted at the foundation stage because the
 * approved dependency set does not yet include an async storage adapter. A
 * persistence middleware can be layered on once that dependency is approved.
 */
export const usePreferencesStore = create<PreferencesState>((set) => ({
  colorScheme: 'light',
  units: 'metric',
  setColorScheme: (colorScheme) => set({ colorScheme }),
  setUnits: (units) => set({ units }),
}));

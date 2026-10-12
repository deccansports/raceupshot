import { create } from 'zustand';

type AppState = {
  hasSeenOnboarding: boolean;
  isOffline: boolean;
  lastTab: string | null;
  setHasSeenOnboarding: (value: boolean) => void;
  setOffline: (value: boolean) => void;
  setLastTab: (tab: string | null) => void;
};

/** Cross-feature app UI state. */
export const useAppStore = create<AppState>((set) => ({
  hasSeenOnboarding: false,
  isOffline: false,
  lastTab: null,
  setHasSeenOnboarding: (hasSeenOnboarding) => set({ hasSeenOnboarding }),
  setOffline: (isOffline) => set({ isOffline }),
  setLastTab: (lastTab) => set({ lastTab }),
}));

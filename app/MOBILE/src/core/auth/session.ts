import { create } from 'zustand';

export type SessionStatus = 'loading' | 'authenticated' | 'guest';

export type SessionUser = {
  uid: string;
  email: string | null;
  displayName: string | null;
};

type SessionState = {
  status: SessionStatus;
  user: SessionUser | null;
  accessToken: string | null;
  setAuthenticated: (user: SessionUser, accessToken?: string | null) => void;
  setAccessToken: (accessToken: string | null) => void;
  setGuest: () => void;
};

/**
 * Auth session metadata only (Firebase-derived). Tokens live in Firebase; profile
 * data lives in React Query. Screens read status/user, never tokens.
 */
export const useSession = create<SessionState>((set) => ({
  status: 'loading',
  user: null,
  accessToken: null,
  setAuthenticated: (user, accessToken = null) => set({ status: 'authenticated', user, accessToken }),
  setAccessToken: (accessToken) => set({ accessToken }),
  setGuest: () => set({ status: 'guest', user: null, accessToken: null }),
}));

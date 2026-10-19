import { useEffect, useState } from 'react';
import { signInWithEmailAndPassword, signOut } from 'firebase/auth';

import { AuthRepository, type AccountStatusCode } from '@/core/repositories/auth.repository';
import { clearDashboardCache } from '@/core/repositories/mobile.repository';
import { resumePushRegistrationIfEnabled, teardownPushRegistration } from '@/core/services/notifications';
import { queryClient } from '@/core/services/query/queryClient';
import type { ApiError } from '@/core/types';

import { clearAccessToken, clearSessionMeta, saveAccessToken, saveSessionMeta } from './secureStore';
import { useSession, type SessionUser } from './session';
import { firebaseAccessToken } from './accessToken';
import { getFirebaseAuth } from './firebase';

export type AuthStep = 'request' | 'verify';
export type AccountRequiredState = {
  code: Exclude<AccountStatusCode, 'ACCOUNT_ACTIVE'>;
  message: string;
} | null;

function friendlyOtpErrorMessage(error: unknown): string {
  const value = error as Partial<ApiError> & { message?: string; userMessage?: string };
  return value.userMessage || value.message || 'Unable to verify the OTP. Please try again.';
}

function friendlyPasswordErrorMessage(error: unknown): string {
  const code = String((error as { code?: unknown })?.code || '').toLowerCase();
  if (code.includes('invalid-credential') || code.includes('wrong-password') || code.includes('user-not-found')) return 'The email or password is incorrect.';
  if (code.includes('too-many-requests')) return 'Too many sign-in attempts. Please wait and try again.';
  if (code.includes('network-request-failed')) return 'The login service could not be reached. Check your connection and try again.';
  const message = error instanceof Error ? error.message : '';
  if (message.includes('Firebase configuration is not available')) return 'Password login is not configured in this app build.';
  return 'Unable to log in with password. Please try again.';
}

function accountUser(account: Awaited<ReturnType<typeof AuthRepository.getAccount>>, email: string): SessionUser {
  return {
    uid: account.uid || email,
    email: account.email || email,
    displayName: account.profile?.name || account.name || email,
  };
}

/** Race Upshot mobile authentication supports Worker OTP sessions and Firebase password sessions. */
export function useAuth() {
  const status = useSession((state) => state.status);
  const user = useSession((state) => state.user);
  const setAuthenticated = useSession((state) => state.setAuthenticated);
  const setGuest = useSession((state) => state.setGuest);
  const [step, setStep] = useState<AuthStep>('request');
  const [email, setEmail] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [accountRequired, setAccountRequired] = useState<AccountRequiredState>(null);
  const [resendCooldownSeconds, setResendCooldownSeconds] = useState(0);

  async function requestOtp(nextEmail: string): Promise<boolean> {
    setPending(true);
    setError(null);
    setInfo(null);
    setAccountRequired(null);
    try {
      const normalized = nextEmail.trim().toLowerCase();
      const response = await AuthRepository.sendEmailOtp(normalized);
      setEmail(normalized);
      setStep('verify');
      setInfo(response.message || 'Code sent by email and WhatsApp.');
      setResendCooldownSeconds(60);
      return true;
    } catch (cause) {
      setError(friendlyOtpErrorMessage(cause));
      return false;
    } finally {
      setPending(false);
    }
  }

  async function verifyOtp(otp: string): Promise<boolean> {
    setPending(true);
    setError(null);
    setAccountRequired(null);
    try {
      const response = await AuthRepository.verifyEmailOtp(email, otp);
      const token = response.token;
      // OTP verification is the authentication boundary. Do not keep the
      // user on the login screen while a separate profile request completes.
      // A slow `/athlete/me` response used to make a valid login feel stalled.
      const sessionUser: SessionUser = {
        uid: email,
        email,
        displayName: email,
      };
      await Promise.all([
        saveAccessToken(token),
        saveSessionMeta({ uid: sessionUser.uid, email: sessionUser.email, lastLoginAt: Date.now() }),
      ]);
      setAuthenticated(sessionUser, token);
      void AuthRepository.getAccount(token)
        .then((account) => setAuthenticated(accountUser(account, email), token))
        // The session is already valid; dashboard/profile queries can recover
        // account presentation if this best-effort refresh is unavailable.
        .catch(() => undefined);
      return true;
    } catch (cause) {
      setError(friendlyOtpErrorMessage(cause));
      return false;
    } finally {
      setPending(false);
    }
  }

  async function signInWithPassword(nextEmail: string, password: string): Promise<boolean> {
    setPending(true);
    setError(null);
    setInfo(null);
    setAccountRequired(null);
    const normalizedEmail = nextEmail.trim().toLowerCase();
    try {
      const firebaseAuth = await getFirebaseAuth();
      const credential = await signInWithEmailAndPassword(firebaseAuth, normalizedEmail, password);
      const storedToken = firebaseAccessToken(await credential.user.getIdToken(true));
      const account = await AuthRepository.getAccount(storedToken);
      const sessionUser = accountUser(account, normalizedEmail);
      await Promise.all([
        saveAccessToken(storedToken),
        saveSessionMeta({ uid: sessionUser.uid, email: sessionUser.email, lastLoginAt: Date.now() }),
      ]);
      setEmail(normalizedEmail);
      setAuthenticated(sessionUser, storedToken);
      return true;
    } catch (cause) {
      setError(friendlyPasswordErrorMessage(cause));
      return false;
    } finally {
      setPending(false);
    }
  }

  async function logout(): Promise<void> {
    setGuest();
    teardownPushRegistration();
    queryClient.clear();
    await Promise.allSettled([
      clearSessionMeta(),
      clearAccessToken(),
      clearDashboardCache(),
      getFirebaseAuth().then((auth) => signOut(auth)),
    ]);
    void resumePushRegistrationIfEnabled();
  }

  useEffect(() => {
    if (resendCooldownSeconds <= 0) return undefined;
    const timer = setInterval(() => setResendCooldownSeconds((value) => Math.max(0, value - 1)), 1000);
    return () => clearInterval(timer);
  }, [resendCooldownSeconds]);

  return {
    status, user, step, email, pending, error, info, accountRequired, resendCooldownSeconds,
    requestOtp, verifyOtp, signInWithPassword,
    resendOtp: () => requestOtp(email),
    backToRequest: () => { setStep('request'); setError(null); setAccountRequired(null); },
    clearAccountRequired: () => { setAccountRequired(null); setError(null); },
    logout,
  };
}

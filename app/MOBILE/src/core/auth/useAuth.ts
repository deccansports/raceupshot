import { signInWithCustomToken, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { useEffect, useState } from 'react';

import { APPLE_REVIEW_OTP, isAppleReviewLogin } from '@/core/auth/appleReview';
import { AuthRepository, type AccountStatusCode } from '@/core/repositories/auth.repository';
import { clearDashboardCache } from '@/core/repositories/mobile.repository';
import { resumePushRegistrationIfEnabled, teardownPushRegistration } from '@/core/services/notifications';
import { queryClient } from '@/core/services/query/queryClient';
import type { ApiError } from '@/core/types';

import { getFirebaseAuth } from './firebase';
import { clearAccessToken, clearSessionMeta, saveAccessToken, saveSessionMeta } from './secureStore';
import { useSession, type SessionUser } from './session';

export type AuthStep = 'request' | 'verify';

export type AccountRequiredState = {
  code: Exclude<AccountStatusCode, 'ACCOUNT_ACTIVE'>;
  message: string;
} | null;

const OTP_FAILURE_MESSAGES: Record<string, string> = {
  'Incorrect OTP entered. Please check and try again.':
    'The OTP you entered is incorrect.\n\nPlease check the code sent to your email and try again.',
  'OTP expired': 'This verification code has expired.\n\nPlease request a new OTP and try again.',
  'Too many incorrect attempts':
    'Too many incorrect attempts.\n\nPlease request a new OTP and try again.',
};

function friendlyOtpErrorMessage(error: unknown): string {
  const apiError = error as Partial<ApiError> & { message?: string; userMessage?: string };
  const message = apiError.message ?? apiError.userMessage ?? '';
  for (const [needle, replacement] of Object.entries(OTP_FAILURE_MESSAGES)) {
    if (message.includes(needle)) return replacement;
  }
  return "We couldn't verify your OTP at the moment.\n\nPlease try again or request a new verification code.";
}

function toSessionUser(profile: unknown, fallbackEmail: string, fallbackUid?: string | null): SessionUser {
  const record = profile && typeof profile === 'object' ? (profile as Record<string, unknown>) : {};
  const uid =
    (typeof record.uid === 'string' && record.uid.trim()) ||
    (typeof record.id === 'string' && record.id.trim()) ||
    fallbackUid?.trim() ||
    fallbackEmail.trim() ||
    'authenticated';

  const email = typeof record.email === 'string' && record.email.trim() ? record.email.trim() : fallbackEmail.trim() || null;
  const displayName =
    (typeof record.name === 'string' && record.name.trim()) ||
    (typeof record.fullName === 'string' && record.fullName.trim()) ||
    (typeof record.displayName === 'string' && record.displayName.trim()) ||
    email ||
    uid;

  return {
    uid,
    email,
    displayName,
  };
}

function isAccountStatusUnavailable(error: unknown): boolean {
  return (error as { status?: number | null }).status === 404;
}

async function finalizeFirebaseSignIn(
  email: string,
  firebaseUser: { uid: string; email: string | null; displayName: string | null; getIdToken: (forceRefresh?: boolean) => Promise<string> },
  setAccessToken: (token: string | null) => void,
  setGuest: () => void,
): Promise<boolean> {
  const idToken = await firebaseUser.getIdToken(true);

  const accountStatus = await AuthRepository.checkAccountStatus(idToken).catch((statusError) => {
    if (isAccountStatusUnavailable(statusError)) {
      console.warn('[auth] account status endpoint is not available; continuing with legacy login until backend route is deployed');
      return {
        success: true,
        accountExists: true,
        uid: firebaseUser?.uid,
        profileComplete: true,
        code: 'ACCOUNT_ACTIVE' as const,
      };
    }
    throw statusError;
  });
  console.log('[auth] account status checked', accountStatus);
  if (
    accountStatus.accountExists !== true ||
    accountStatus.code === 'ACCOUNT_NOT_CREATED' ||
    accountStatus.code === 'ACCOUNT_DISABLED' ||
    accountStatus.code === 'PROFILE_INCOMPLETE'
  ) {
    return false;
  }

  console.log('[auth] saving Firebase ID token');
  await saveAccessToken(idToken);
  setAccessToken(idToken);
  await saveSessionMeta({
    uid: firebaseUser?.uid ?? accountStatus.uid ?? 'authenticated',
    email: firebaseUser?.email ?? email,
    lastLoginAt: Date.now(),
  });
  console.log('[auth] Firebase ID token saved');

  const sessionUser = toSessionUser(
    {
      uid: firebaseUser?.uid,
      email: firebaseUser?.email ?? email,
      displayName: firebaseUser?.displayName,
    },
    email,
    firebaseUser?.uid,
  );
  useSession.getState().setAuthenticated(sessionUser, idToken);
  console.log('[auth] auth context updated', sessionUser);
  return true;
}

/**
 * Authentication hook mirroring the web flow:
 *   send-email-otp → verify-email-otp → Firebase custom token →
 *   signInWithCustomToken → onAuthStateChanged (AuthProvider) sets the session.
 */
export function useAuth() {
  const status = useSession((s) => s.status);
  const user = useSession((s) => s.user);
  const setGuest = useSession((s) => s.setGuest);
  const setAccessToken = useSession((s) => s.setAccessToken);

  const [step, setStep] = useState<AuthStep>('request');
  const [email, setEmail] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [accountRequired, setAccountRequired] = useState<AccountRequiredState>(null);
  const [resendCooldownSeconds, setResendCooldownSeconds] = useState(0);

  function accountStatusMessage(code: Exclude<AccountStatusCode, 'ACCOUNT_ACTIVE'>): string {
    if (code === 'ACCOUNT_DISABLED') return 'Your account is currently unavailable. Please contact Bergman support.';
    if (code === 'PROFILE_INCOMPLETE') return 'Please complete your athlete profile on the Bergman website before continuing.';
    return 'Your Bergman athlete account has not been created yet.\n\nPlease visit bergmantri.com and create your account using email OTP login. Once your account is created, return to the Bergman mobile app and log in again.';
  }

  async function requestOtp(nextEmail: string): Promise<boolean> {
    setPending(true);
    setError(null);
    setInfo(null);
    setAccountRequired(null);
    try {
      if (isAppleReviewLogin(nextEmail)) {
        console.log('[Apple Review Login]', {
          email: nextEmail.trim().toLowerCase(),
          timestamp: new Date().toISOString(),
          success: true,
          action: 'skip-send-email-otp',
        });
        setEmail(nextEmail);
        setStep('verify');
        setInfo(`For Apple App Review, use OTP ${APPLE_REVIEW_OTP}.`);
        return true;
      }

      const res = await AuthRepository.sendEmailOtp(nextEmail);
      setEmail(nextEmail);
      setStep('verify');
      setInfo(res.whatsappSent ? 'Code sent via email and WhatsApp.' : 'Code sent to your email.');
      setResendCooldownSeconds(45);
      return true;
    } catch (e) {
      setError((e as ApiError).userMessage ?? 'Could not send the code. Please try again.');
      return false;
    } finally {
      setPending(false);
    }
  }

  async function verifyOtp(otp: string): Promise<boolean> {
    setPending(true);
    setError(null);
    setAccountRequired(null);
    let signedInFirebase = false;
    try {
      console.log('[auth] verifyOtp:start', { email, otpLength: otp.length });
      const response = await AuthRepository.verifyEmailOtp(email, otp);
      console.log('[auth] verify-email-otp response', response);

      console.log('[auth] verify-email-otp success', response.success);
      if (response.success !== true) {
        console.log('[auth] verify-email-otp reported failure');
        setError(friendlyOtpErrorMessage(response.message ?? ''));
        return false;
      }

      const firebaseToken = response.token ?? null;
      console.log('[auth] firebase custom token received', Boolean(firebaseToken));

      if (!firebaseToken) {
        console.error('[auth] missing access token after verify-email-otp', response);
        setError('Unable to sign in. Please try again.');
        return false;
      }

      let firebaseUser;
      try {
        console.log('[auth] attempting Firebase sign-in');
        const auth = await getFirebaseAuth();
        const credential = await signInWithCustomToken(auth, firebaseToken);
        firebaseUser = credential.user;
        signedInFirebase = true;
        console.log('[auth] Firebase sign-in completed');
      } catch (firebaseError) {
        console.error('[auth] Firebase sign-in failed', firebaseError);
        if (firebaseError instanceof Error && firebaseError.stack) console.error(firebaseError.stack);
        setError('Unable to sign in. Please try again.');
        return false;
      }

      const ok = await finalizeFirebaseSignIn(email, firebaseUser, setAccessToken, setGuest);
      if (!ok) {
        setAccountRequired({
          code: 'ACCOUNT_NOT_CREATED',
          message: accountStatusMessage('ACCOUNT_NOT_CREATED'),
        });
        await clearSessionMeta();
        await clearAccessToken();
        setAccessToken(null);
        setGuest();
        try {
          const auth = await getFirebaseAuth();
          await signOut(auth);
        } catch (signOutError) {
          console.error('[auth] Firebase signOut failed after blocked account', signOutError);
        }
      }
      return ok;
    } catch (e) {
      console.error('[auth] verifyOtp fatal error', e);
      if (e instanceof Error && e.stack) console.error(e.stack);
      if (signedInFirebase) {
        try {
          const auth = await getFirebaseAuth();
          await signOut(auth);
          await clearSessionMeta();
          await clearAccessToken();
          setAccessToken(null);
          setGuest();
        } catch (signOutError) {
          console.error('[auth] Firebase signOut failed after verifyOtp failure', signOutError);
        }
      }
      setError(friendlyOtpErrorMessage(e));
      return false;
    } finally {
      setPending(false);
    }
  }

  async function signInWithPassword(emailAddress: string, password: string): Promise<boolean> {
    setPending(true);
    setError(null);
    setAccountRequired(null);
    try {
      const auth = await getFirebaseAuth();
      const credential = await signInWithEmailAndPassword(auth, emailAddress, password);
      const ok = await finalizeFirebaseSignIn(
        emailAddress,
        credential.user as unknown as {
          uid: string;
          email: string | null;
          displayName: string | null;
          getIdToken: (forceRefresh?: boolean) => Promise<string>;
        },
        setAccessToken,
        setGuest,
      );
      if (!ok) {
        setAccountRequired({
          code: 'ACCOUNT_NOT_CREATED',
          message: accountStatusMessage('ACCOUNT_NOT_CREATED'),
        });
        await signOut(auth);
        await clearSessionMeta();
        await clearAccessToken();
        setAccessToken(null);
        setGuest();
        return false;
      }
      return true;
    } catch (e) {
      console.error('[auth] password login fatal error', e);
      if (e instanceof Error && e.stack) console.error(e.stack);
      setError('Unable to sign in with password. Please try again.');
      return false;
    } finally {
      setPending(false);
    }
  }

  function backToRequest() {
    setStep('request');
    setError(null);
    setAccountRequired(null);
  }

  function clearAccountRequired() {
    setAccountRequired(null);
    setError(null);
  }

  useEffect(() => {
    if (resendCooldownSeconds <= 0) return undefined;
    const timer = setInterval(() => {
      setResendCooldownSeconds((value) => Math.max(0, value - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [resendCooldownSeconds]);

  async function logout(): Promise<void> {
    // Switch the app out of the authenticated state first. Firebase sign-out
    // can take a moment on a device, but it must not keep the signed-in UI (or
    // its cached data) visible while that native operation is in progress.
    setGuest();
    teardownPushRegistration();
    queryClient.clear();

    try {
      await Promise.all([
        clearSessionMeta(),
        clearAccessToken(),
        clearDashboardCache(),
      ]);
    } catch (logoutError) {
      // The session state above is already cleared. Keep logout successful if
      // platform storage is temporarily unavailable.
      console.error('[auth] local logout cleanup failed', logoutError);
    }

    try {
      const auth = await getFirebaseAuth();
      await signOut(auth);
    } catch (logoutError) {
      console.error('[auth] Firebase signOut failed during logout', logoutError);
      if (logoutError instanceof Error && logoutError.stack) console.error(logoutError.stack);
    } finally {
      void resumePushRegistrationIfEnabled();
    }
  }

  return {
    status,
    user,
    step,
    email,
    pending,
    error,
    info,
    accountRequired,
    resendCooldownSeconds,
    requestOtp,
    verifyOtp,
    signInWithPassword,
    resendOtp: () => requestOtp(email),
    backToRequest,
    clearAccountRequired,
    logout,
  };
}

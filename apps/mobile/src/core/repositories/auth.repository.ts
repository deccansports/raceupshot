import { api } from '@/core/services/api';
import { authorizationForAccessToken } from '@/core/auth/accessToken';

/**
 * Auth repository — the OTP endpoints mirrored exactly from the web app.
 * The backend handles OTP generation/hashing/expiry/abuse + Firebase custom
 * token creation; the app only calls these two endpoints.
 */

export type SendEmailOtpResult = {
  success: boolean;
  message: string;
  maskedMobile?: string | null;
  whatsappSent?: boolean;
};

export type VerifyEmailOtpResult = {
  success: boolean;
  message: string;
  token: string; // Race Upshot OTP session token
  isNewUser: boolean;
};

type LegacyApiEnvelope<T> = {
  ok: boolean;
  data?: T;
  error?: string;
};

type AthleteAccountEnvelope = {
  success: boolean;
  data?: {
    uid?: string;
    email?: string | null;
    name?: string | null;
    profile?: { name?: string | null } | null;
  };
};

export type AccountStatusCode =
  | 'ACCOUNT_ACTIVE'
  | 'ACCOUNT_NOT_CREATED'
  | 'ACCOUNT_DISABLED'
  | 'PROFILE_INCOMPLETE';

export type AccountStatusResult = {
  success: boolean;
  accountExists: boolean;
  uid?: string;
  profileComplete?: boolean;
  code?: AccountStatusCode;
};

export const AuthRepository = {
  async sendEmailOtp(email: string): Promise<SendEmailOtpResult> {
    const response = await api.json<LegacyApiEnvelope<{ requested: boolean; message: string }>>('/api/auth/otp/request', {
      method: 'POST',
      body: { email },
    });
    if (!response.ok || !response.data) throw new Error(response.error || 'Unable to send OTP.');
    return { success: true, message: response.data.message };
  },

  async verifyEmailOtp(email: string, otp: string): Promise<VerifyEmailOtpResult> {
    const response = await api.json<LegacyApiEnvelope<{ authenticated: boolean; sessionToken?: string }>>('/api/auth/otp/verify', {
      method: 'POST',
      body: { email, otp, surface: 'MOBILE' },
    });
    if (!response.ok || !response.data?.sessionToken) throw new Error(response.error || 'Unable to verify OTP.');
    return {
      success: true,
      message: 'Signed in successfully.',
      token: response.data.sessionToken,
      isNewUser: false,
    };
  },

  async getAccount(sessionToken: string) {
    const response = await api.json<AthleteAccountEnvelope>('/api/v1/athlete/me', {
      headers: { Authorization: authorizationForAccessToken(sessionToken) },
    });
    if (!response.success || !response.data) throw new Error('Unable to load athlete account.');
    return response.data;
  },

  checkAccountStatus(idToken: string): Promise<AccountStatusResult> {
    void idToken;
    return Promise.resolve({
      success: true,
      accountExists: true,
      profileComplete: true,
      code: 'ACCOUNT_ACTIVE',
    });
  },
};

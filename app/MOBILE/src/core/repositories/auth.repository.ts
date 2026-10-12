import { api } from '@/core/services/api';

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
  token: string; // Firebase custom token
  isNewUser: boolean;
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
  sendEmailOtp(email: string, name?: string): Promise<SendEmailOtpResult> {
    return api.json<SendEmailOtpResult>('/api/send-email-otp', {
      method: 'POST',
      body: { email, name },
    });
  },

  verifyEmailOtp(email: string, otp: string): Promise<VerifyEmailOtpResult> {
    return api.json<VerifyEmailOtpResult>('/api/verify-email-otp', {
      method: 'POST',
      body: { email, otp },
    });
  },

  checkAccountStatus(idToken: string): Promise<AccountStatusResult> {
    return Promise.resolve({
      success: true,
      accountExists: true,
      profileComplete: true,
      code: 'ACCOUNT_ACTIVE',
    });
  },
};

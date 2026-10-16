import { describe, expect, it } from 'vitest';
import { authorizationForAccessToken, firebaseAccessToken, isFirebaseAccessToken } from '../apps/mobile/src/core/auth/accessToken';

describe('mobile access token authorization', () => {
  it('keeps legacy OTP sessions working', () => {
    expect(authorizationForAccessToken('otp-session-token')).toBe('Otp otp-session-token');
    expect(authorizationForAccessToken('Otp existing-token')).toBe('Otp existing-token');
  });

  it('uses Firebase bearer authorization for password login', () => {
    const token = firebaseAccessToken('firebase-id-token');
    expect(token).toBe('Bearer firebase-id-token');
    expect(isFirebaseAccessToken(token)).toBe(true);
    expect(authorizationForAccessToken(token)).toBe(token);
  });
});

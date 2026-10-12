export const APPLE_REVIEW_EMAIL = 'applereview@bergmantri.com';
export const APPLE_REVIEW_OTP = '123456';

export function isAppleReviewLogin(email: string): boolean {
  return (
    process.env.EXPO_PUBLIC_APPLE_REVIEW_LOGIN_ENABLED === 'true' &&
    email.trim().toLowerCase() === APPLE_REVIEW_EMAIL
  );
}

const DEFAULT_MOBILE_API_URL = 'https://raceupshot.com';

export const env = {
  mobileApiBaseUrl: process.env.EXPO_PUBLIC_MOBILE_API_URL ?? DEFAULT_MOBILE_API_URL,
  environment: (process.env.EXPO_PUBLIC_ENV ?? 'development') as
    'development' | 'staging' | 'production',
} as const;

export const isDevelopment = env.environment === 'development';

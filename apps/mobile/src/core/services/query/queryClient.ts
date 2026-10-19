import { QueryClient } from '@tanstack/react-query';

import { appConfig } from '@/core/constants/config';

import type { ApiError } from '@/core/types/api';

/** Shared React Query client with app-wide defaults. */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: appConfig.query.staleTime.user,
      gcTime: appConfig.query.gcTime,
      retry: (failureCount, error) => {
        const apiError = error as unknown as ApiError;
        if (apiError?.isAuthError) return false;
        const status = apiError?.status;
        if (status === 400 || status === 401 || status === 403 || status === 404 || status === 422) return false;
        if (apiError?.retryable === false) return false;
        if (status != null && status !== 408 && status !== 429 && status < 500) return false;
        if (status != null && status >= 500 && ![500, 502, 503, 504].includes(status)) return false;
        return failureCount < appConfig.api.retryCount;
      },
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: false,
    },
  },
});

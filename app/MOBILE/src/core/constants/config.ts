/** Static app configuration shared across features. */
export const appConfig = {
  name: 'BERGMAN Race',
  deepLinkScheme: 'bergmanrace',
  api: {
    timeoutMs: 15000,
    retryCount: 2,
  },
  query: {
    // Stale times (ms) by data volatility; see STATE_MANAGEMENT.md.
    staleTime: {
      static: 1000 * 60 * 30,
      user: 1000 * 60 * 2,
      live: 1000 * 15,
    },
    gcTime: 1000 * 60 * 60 * 24,
  },
} as const;

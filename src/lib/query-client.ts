'use client';

import { QueryClient } from '@tanstack/react-query';

// Create a client with optimized settings for performance
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Cache data for 5 minutes
      staleTime: 5 * 60 * 1000,
      // Keep data in cache for 10 minutes
      gcTime: 10 * 60 * 1000,
      // Don't refetch on window focus to reduce unnecessary requests
      refetchOnWindowFocus: false,
      // Retry failed requests 3 times with exponential backoff
      retry: 3,
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
      // Enable background refetching for better UX
      refetchOnMount: 'always',
    },
    mutations: {
      // Retry mutations once on failure
      retry: 1,
    },
  },
});

// Query keys for consistent caching
export const queryKeys = {
  homeworks: (userId: string, page?: number, limit?: number) => 
    ['homeworks', userId, page, limit].filter(Boolean),
  homeworksPaginated: (userId: string, page: number, limit: number) => 
    ['homeworks', 'paginated', userId, page, limit],
  notifications: (userId: string) => ['notifications', userId],
  analytics: (userId: string, from?: Date, to?: Date) => 
    ['analytics', userId, from?.toISOString(), to?.toISOString()].filter(Boolean),
  users: () => ['users'],
  pricingConfig: () => ['pricing-config'],
  superWorkers: () => ['super-workers'],
  templates: () => ['notification-templates'],
} as const;
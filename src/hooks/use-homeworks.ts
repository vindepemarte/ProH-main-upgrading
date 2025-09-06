'use client';

import { useQuery, useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchHomeworksForUserPaginated, fetchHomeworksForUser, modifyHomework } from '@/lib/actions';
import { queryKeys } from '@/lib/query-client';
import { toast } from '@/hooks/use-toast';
import { User, Homework } from '@/lib/types';

interface UseHomeworksOptions {
  user: User;
  page?: number;
  limit?: number;
  enabled?: boolean;
}

interface UseHomeworksPaginatedOptions {
  user: User;
  limit?: number;
  enabled?: boolean;
}

interface PaginatedHomeworksResult {
  homeworks: Homework[];
  totalCount: number;
  hasMore: boolean;
  currentPage: number;
}

// Hook for paginated homeworks with React Query
export function useHomeworksPaginated({ 
  user, 
  limit = 20, 
  enabled = true 
}: UseHomeworksPaginatedOptions) {
  return useInfiniteQuery<PaginatedHomeworksResult>({
    queryKey: queryKeys.homeworksPaginated(user.id, 1, limit),
    queryFn: async ({ pageParam = 1 }) => {
      const result = await fetchHomeworksForUserPaginated(user, pageParam as number, limit);
      return result;
    },
    initialPageParam: 1,
    getNextPageParam: (lastPage) => {
      return lastPage.hasMore ? lastPage.currentPage + 1 : undefined;
    },
    enabled,
    staleTime: 2 * 60 * 1000, // 2 minutes
    gcTime: 5 * 60 * 1000, // 5 minutes
  });
}

// Hook for regular homeworks (backward compatibility)
export function useHomeworks({ 
  user, 
  page = 1, 
  limit = 20, 
  enabled = true 
}: UseHomeworksOptions) {
  return useQuery<Homework[]>({
    queryKey: queryKeys.homeworks(user.id, page, limit),
    queryFn: () => fetchHomeworksForUser(user),
    enabled,
    staleTime: 2 * 60 * 1000, // 2 minutes
    gcTime: 5 * 60 * 1000, // 5 minutes
  });
}

// Hook for homework mutations (create, update, delete)
export function useHomeworkMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ homeworkId, updates }: { homeworkId: string; updates: any }) => {
      return await modifyHomework(homeworkId, updates);
    },
    onSuccess: (data, variables) => {
      // Invalidate and refetch homework queries
      queryClient.invalidateQueries({ 
        queryKey: ['homeworks'] 
      });
      
      toast({
        title: "Success",
        description: "Homework updated successfully",
      });
    },
    onError: (error) => {
      console.error('Homework mutation error:', error);
      toast({
        title: "Error",
        description: "Failed to update homework",
        variant: "destructive",
      });
    },
  });
}

// Hook to prefetch next page for better UX
export function usePrefetchHomeworks() {
  const queryClient = useQueryClient();

  return (user: User, nextPage: number, limit: number = 20) => {
    queryClient.prefetchQuery({
      queryKey: queryKeys.homeworksPaginated(user.id, nextPage, limit),
      queryFn: () => fetchHomeworksForUserPaginated(user, nextPage, limit),
      staleTime: 2 * 60 * 1000,
    });
  };
}
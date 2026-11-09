import { useQuery } from '@tanstack/react-query';
import * as api from './api';

export function usePostStats(postId: string | undefined) {
  return useQuery({ queryKey: ['stats', 'post', postId], queryFn: () => api.fetchPostStats(postId!), enabled: !!postId });
}

export function useSummary(days: number) {
  return useQuery({ queryKey: ['stats', 'summary', days], queryFn: () => api.fetchSummary(days) });
}

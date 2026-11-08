import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as api from './api';

export function useActivity() {
  return useInfiniteQuery({
    queryKey: ['activity'],
    queryFn: ({ pageParam }) => api.fetchActivity(pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => (last.length < api.ACTIVITY_PAGE ? undefined : last[last.length - 1].createdAt),
  });
}

export function useActivityUnread() {
  return useQuery({ queryKey: ['activity-unread'], queryFn: api.fetchUnread, refetchInterval: 60_000 });
}

export function useMarkActivitySeen() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.markSeen,
    onSuccess: () => qc.setQueryData(['activity-unread'], 0),
  });
}

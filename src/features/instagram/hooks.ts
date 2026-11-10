import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as api from './api';

export function useInstagramStatus() {
  return useQuery({ queryKey: ['instagram', 'status'], queryFn: api.fetchStatus });
}

export function useInstagramMedia(enabled: boolean) {
  return useInfiniteQuery({
    queryKey: ['instagram', 'media'],
    queryFn: ({ pageParam }) => api.fetchMedia(pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.after ?? undefined,
    enabled,
  });
}

export function useImportPosts() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.importPosts,
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['instagram'] });
      qc.invalidateQueries({ queryKey: ['feed'] });
      qc.invalidateQueries({ queryKey: ['profile'] });
    },
  });
}

export function useDisconnectInstagram() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: api.disconnect, onSuccess: () => qc.invalidateQueries({ queryKey: ['instagram'] }) });
}

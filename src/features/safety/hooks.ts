import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import * as api from './api';

// Anything that shows other people's content must refetch after a block change.
function refreshContent(qc: QueryClient) {
  for (const key of ['feed', 'search', 'group-feed', 'group-roster', 'blocked']) {
    qc.invalidateQueries({ queryKey: [key] });
  }
}

export function useBlocked() {
  return useQuery({ queryKey: ['blocked'], queryFn: api.listBlocked });
}

export function useBlockUser() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: api.blockUser, onSuccess: () => refreshContent(qc) });
}

export function useUnblockUser() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: api.unblockUser, onSuccess: () => refreshContent(qc) });
}

export function useReport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.report,
    // A report can hide a post right away; refresh so the reporter sees that.
    onSuccess: (_d, v) => {
      if (v.targetType === 'post') refreshContent(qc);
    },
  });
}

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as api from './api';

export function useEarnings() {
  return useQuery({ queryKey: ['earnings', 'summary'], queryFn: api.fetchSummary });
}

export function useSales() {
  return useQuery({ queryKey: ['earnings', 'sales'], queryFn: api.fetchSales });
}

export function usePayouts() {
  return useQuery({ queryKey: ['earnings', 'payouts'], queryFn: api.fetchPayouts });
}

export function usePostEarnings(postId: string | undefined) {
  return useQuery({
    queryKey: ['earnings', 'post', postId],
    queryFn: () => api.fetchPostEarnings(postId!),
    enabled: !!postId,
  });
}

export function useRefreshPayoutAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.refreshPayoutAccount,
    onSettled: () => qc.invalidateQueries({ queryKey: ['earnings'] }),
  });
}

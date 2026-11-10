import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as api from './api';

export function useAnswers(postId: string | undefined) {
  return useQuery({ queryKey: ['answers', postId], queryFn: () => api.listAnswers(postId!), enabled: !!postId });
}

function useRefresh(postId: string | undefined) {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ['answers', postId] });
    // Answer counts, the asking flag and accepted tags live on feed rows.
    qc.invalidateQueries({ queryKey: ['feed'] });
  };
}

export function useSubmitAnswer(postId: string | undefined) {
  const refresh = useRefresh(postId);
  return useMutation({ mutationFn: (d: api.AnswerDraft) => api.submitAnswer(postId!, d), onSuccess: refresh });
}

export function useAcceptAnswer(postId: string | undefined) {
  const refresh = useRefresh(postId);
  return useMutation({ mutationFn: api.acceptAnswer, onSuccess: refresh });
}

export function useDeleteAnswer(postId: string | undefined) {
  const refresh = useRefresh(postId);
  return useMutation({ mutationFn: api.deleteAnswer, onSuccess: refresh });
}

export function useSetAsking(postId: string | undefined) {
  const refresh = useRefresh(postId);
  return useMutation({ mutationFn: (asking: boolean) => api.setAsking(postId!, asking), onSuccess: refresh });
}

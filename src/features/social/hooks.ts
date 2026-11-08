import { type InfiniteData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as api from './api';

export function useComments(postId: string | undefined) {
  return useInfiniteQuery({
    queryKey: ['comments', postId],
    queryFn: ({ pageParam }) => api.listComments(postId!, pageParam),
    initialPageParam: null as api.CommentCursor,
    getNextPageParam: (last) =>
      last.length < api.COMMENT_PAGE ? undefined : { createdAt: last[last.length - 1].createdAt, id: last[last.length - 1].id },
    enabled: !!postId,
  });
}

function useRefreshPost(postId: string | undefined) {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ['comments', postId] });
    // Comment counts live on feed rows.
    qc.invalidateQueries({ queryKey: ['feed'] });
  };
}

export function useAddComment(postId: string | undefined) {
  const refresh = useRefreshPost(postId);
  return useMutation({
    mutationFn: (v: { body: string; parentId?: string | null }) => api.addComment(postId!, v.body, v.parentId),
    onSuccess: refresh,
  });
}

export function useLikeComment(postId: string | undefined) {
  const qc = useQueryClient();
  const key = ['comments', postId];
  const patch = (id: string, like: boolean) =>
    qc.setQueryData<InfiniteData<api.Comment[]>>(key, (d) =>
      d
        ? {
            ...d,
            pages: d.pages.map((page) =>
              page.map((c) =>
                c.id === id && c.iLiked !== like ? { ...c, iLiked: like, likeCount: c.likeCount + (like ? 1 : -1) } : c,
              ),
            ),
          }
        : d,
    );
  return useMutation({
    mutationFn: (v: { id: string; like: boolean }) => api.setCommentLike(v.id, v.like),
    onMutate: (v) => patch(v.id, v.like),
    onError: (_e, v) => patch(v.id, !v.like),
  });
}

export function useDeleteComment(postId: string | undefined) {
  const refresh = useRefreshPost(postId);
  return useMutation({ mutationFn: api.deleteComment, onSuccess: refresh });
}

export function useSavedItems() {
  return useInfiniteQuery({
    queryKey: ['saved-items'],
    queryFn: ({ pageParam }) => api.listSavedItems(pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => (last.length < 30 ? undefined : last[last.length - 1].savedAt),
    staleTime: 5 * 60_000,
  });
}

export function useItemSaved(itemId: string | undefined) {
  return useQuery({ queryKey: ['item-saved', itemId], queryFn: () => api.isItemSaved(itemId!), enabled: !!itemId });
}

export function useSaveItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { itemId: string; postId: string; saved: boolean }) => api.setItemSaved(v.itemId, v.postId, v.saved),
    onMutate: (v) => qc.setQueryData(['item-saved', v.itemId], v.saved),
    onError: (_e, v) => qc.setQueryData(['item-saved', v.itemId], !v.saved),
    onSettled: () => qc.invalidateQueries({ queryKey: ['saved-items'] }),
  });
}

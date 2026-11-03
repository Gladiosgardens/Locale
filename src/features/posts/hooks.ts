import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/features/auth/AuthProvider';
import * as api from './api';

export type PublishStage = 'preparing' | 'uploading' | 'publishing';

export function useFeed(interestId: number | null) {
  return useInfiniteQuery({
    queryKey: ['feed', interestId],
    queryFn: ({ pageParam }) => api.fetchFeedPage(pageParam, interestId),
    initialPageParam: null as api.FeedCursor,
    getNextPageParam: (last) =>
      last.length < api.FEED_PAGE_SIZE
        ? undefined
        : { publishedAt: last[last.length - 1].publishedAt, id: last[last.length - 1].id },
    // Signed image URLs last an hour; refresh well before that.
    staleTime: 5 * 60_000,
  });
}

export function useDeletePost() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.deletePost,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['feed'] }),
  });
}

export function usePublishPost(onStage?: (stage: PublishStage, done: number, total: number) => void) {
  const qc = useQueryClient();
  const { session } = useAuth();
  return useMutation({
    mutationFn: async (input: { photos: api.PickedPhoto[]; caption: string; interestIds: number[] }) => {
      const userId = session?.user.id;
      if (!userId) throw new Error('not_authenticated');
      const total = input.photos.length;
      const uploads: string[] = [];
      for (const [i, photo] of input.photos.entries()) {
        onStage?.('preparing', i, total);
        const prepared = await api.preparePhoto(photo);
        onStage?.('uploading', i, total);
        uploads.push(await api.uploadPhoto(userId, prepared.uri));
      }
      onStage?.('publishing', total, total);
      return api.publishPost({ uploads, caption: input.caption, interestIds: input.interestIds });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['feed'] }),
  });
}

import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/features/auth/AuthProvider';
import * as api from './api';

export type PublishStage = 'preparing' | 'uploading' | 'publishing';

const nextCursor = (last: api.FeedPost[]): api.FeedCursor | undefined =>
  last.length < api.FEED_PAGE_SIZE
    ? undefined
    : { publishedAt: last[last.length - 1].publishedAt, id: last[last.length - 1].id };

// Signed image URLs last an hour; refresh well before that.
const STALE_MS = 5 * 60_000;

export function useFeed(scope: api.FeedScope, interestId: number | null) {
  return useInfiniteQuery({
    queryKey: ['feed', scope, scope === 'nearby' ? interestId : null],
    queryFn: ({ pageParam }) => api.fetchFeedPage(scope, pageParam, interestId),
    initialPageParam: null as api.FeedCursor,
    getNextPageParam: nextCursor,
    staleTime: STALE_MS,
  });
}

export function useSearch(query: string) {
  const q = query.trim();
  return useInfiniteQuery({
    queryKey: ['search', q.toLowerCase()],
    queryFn: ({ pageParam }) => api.searchPosts(q, pageParam),
    initialPageParam: null as api.FeedCursor,
    getNextPageParam: nextCursor,
    enabled: q.length >= api.MIN_QUERY_LENGTH,
    staleTime: STALE_MS,
  });
}

export function useDeletePost() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.deletePost,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['feed'] });
      qc.invalidateQueries({ queryKey: ['search'] });
    },
  });
}

export function usePublishPost(onStage?: (stage: PublishStage, done: number, total: number) => void) {
  const qc = useQueryClient();
  const { session } = useAuth();
  return useMutation({
    mutationFn: async (input: {
      photos: api.PickedPhoto[];
      caption: string;
      interestIds: number[];
      tags?: api.DraftTag[];
      searchable?: boolean;
    }) => {
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
      return api.publishPost({
        uploads,
        caption: input.caption,
        interestIds: input.interestIds,
        tags: input.tags,
        searchable: input.searchable,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['feed'] });
      qc.invalidateQueries({ queryKey: ['search'] });
    },
  });
}

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/features/auth/AuthProvider';
import * as api from './api';

export type PublishStage = 'preparing' | 'uploading' | 'processing' | 'publishing';

const VIDEO_POLL_MS = 2000;
const VIDEO_WAIT_MS = 3 * 60_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Upload a video to Mux and wait until it's ready to play. Returns the upload id.
async function uploadVideo(video: api.PickedVideo, onStage?: (stage: PublishStage, done: number, total: number) => void) {
  onStage?.('uploading', 0, 1);
  const { uploadId, url } = await api.createVideoUpload();
  await api.uploadVideoFile(url, video.uri);
  onStage?.('processing', 1, 1);
  const deadline = Date.now() + VIDEO_WAIT_MS;
  for (;;) {
    const status = await api.videoStatus(uploadId);
    if (status.status === 'ready') return uploadId;
    if (status.status === 'failed') throw new Error(status.reason === 'too_long' ? 'video_too_long' : 'invalid_video');
    if (Date.now() > deadline) throw new Error('video_processing');
    await sleep(VIDEO_POLL_MS);
  }
}

const nextCursor = (last: api.FeedPost[]): api.FeedCursor | undefined =>
  last.length < api.FEED_PAGE_SIZE
    ? undefined
    : { publishedAt: last[last.length - 1].rankAt, id: last[last.length - 1].id };

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

export function useGroupFeed(groupId: string | undefined, enabled: boolean) {
  return useInfiniteQuery({
    queryKey: ['group-feed', groupId],
    queryFn: ({ pageParam }) => api.fetchGroupFeedPage(groupId!, pageParam),
    initialPageParam: null as api.FeedCursor,
    getNextPageParam: nextCursor,
    enabled: !!groupId && enabled,
    staleTime: STALE_MS,
  });
}

export function useAuthorFeed(authorId: string | undefined) {
  return useInfiniteQuery({
    queryKey: ['feed', 'author', authorId],
    queryFn: ({ pageParam }) => api.fetchAuthorPage(authorId!, pageParam),
    initialPageParam: null as api.FeedCursor,
    getNextPageParam: nextCursor,
    enabled: !!authorId,
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

export function usePost(postId: string | undefined) {
  return useQuery({
    queryKey: ['feed', 'post', postId],
    queryFn: () => api.fetchPost(postId!),
    enabled: !!postId,
    staleTime: STALE_MS,
  });
}

/** Prepares and uploads a photo (once), then asks the server what's in it. */
export function useDetectItems() {
  const { session } = useAuth();
  return useMutation({
    mutationFn: async (photo: api.PickedPhoto): Promise<{ uploadedPath: string; items: api.DetectedItem[] }> => {
      const userId = session?.user.id;
      if (!userId) throw new Error('not_authenticated');
      const uploadedPath = photo.uploadedPath ?? (await api.uploadPhoto(userId, (await api.preparePhoto(photo)).uri));
      return { uploadedPath, items: await api.detectItems(uploadedPath) };
    },
  });
}

export function useSimilarItems(itemId: string | undefined, postId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ['similar', itemId],
    queryFn: () => api.similarItems(itemId!, postId!),
    enabled: enabled && !!itemId && !!postId,
    staleTime: 60 * 60_000,
    retry: false,
  });
}

export function useLikePost() {
  return useMutation({ mutationFn: ({ id, like }: { id: string; like: boolean }) => api.setLike(id, like) });
}

export function useSavePost() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, saved }: { id: string; saved: boolean }) => api.setPostSaved(id, saved),
    onSettled: () => qc.invalidateQueries({ queryKey: ['feed', 'saved'] }),
  });
}

export function useUpdateCaption() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, caption }: { id: string; caption: string }) => api.updateCaption(id, caption),
    // Single-post views are cached under ['feed', 'post', id] too.
    onSuccess: () => qc.invalidateQueries({ queryKey: ['feed'] }),
  });
}

export function useDeletePost() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.deletePost,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['feed'] });
      qc.invalidateQueries({ queryKey: ['search'] });
      qc.invalidateQueries({ queryKey: ['group-feed'] });
    },
  });
}

export function usePublishPost(onStage?: (stage: PublishStage, done: number, total: number) => void) {
  const qc = useQueryClient();
  const { session } = useAuth();
  return useMutation({
    mutationFn: async (input: {
      photos: api.PickedPhoto[];
      video?: api.PickedVideo | null;
      caption: string;
      interestIds: number[];
      tags?: api.DraftTag[];
      searchable?: boolean;
      groupId?: string | null;
      shopping?: boolean;
    }) => {
      const userId = session?.user.id;
      if (!userId) throw new Error('not_authenticated');
      const videoUploadId = input.video ? await uploadVideo(input.video, onStage) : null;
      const total = input.photos.length;
      const uploads: string[] = [];
      for (const [i, photo] of input.photos.entries()) {
        if (photo.uploadedPath) {
          uploads.push(photo.uploadedPath); // already prepared and uploaded for detection
          continue;
        }
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
        groupId: input.groupId,
        videoUploadId,
        shopping: input.shopping,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['feed'] });
      qc.invalidateQueries({ queryKey: ['search'] });
      qc.invalidateQueries({ queryKey: ['group-feed'] });
    },
  });
}

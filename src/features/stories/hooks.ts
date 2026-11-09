import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as api from './api';

export function useStoryTray() {
  return useQuery({ queryKey: ['stories', 'tray'], queryFn: api.fetchTray, staleTime: 60_000, refetchInterval: 5 * 60_000 });
}

/** One person's live stories, or one highlight's stories. */
export function useStories(source: { authorId: string } | { highlightId: string } | null) {
  return useQuery({
    queryKey: ['stories', 'list', source],
    queryFn: () =>
      'authorId' in source! ? api.fetchAuthorStories(source.authorId) : api.fetchHighlightStories(source!.highlightId),
    enabled: !!source,
    staleTime: 30_000,
  });
}

export function useMarkSeen() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.markSeen,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['stories', 'tray'] }),
  });
}

export function useStoryViewers(storyId: string | null) {
  return useQuery({ queryKey: ['stories', 'viewers', storyId], queryFn: () => api.fetchViewers(storyId!), enabled: !!storyId });
}

export function useProfileHighlights(profileId: string | undefined) {
  return useQuery({
    queryKey: ['stories', 'highlights', profileId],
    queryFn: () => api.fetchProfileHighlights(profileId!),
    enabled: !!profileId,
    staleTime: 5 * 60_000,
  });
}

export function useMyHighlights(storyId: string | null) {
  return useQuery({
    queryKey: ['stories', 'my-highlights', storyId],
    queryFn: () => api.fetchMyHighlights(storyId!),
    enabled: !!storyId,
  });
}

function useRefresh() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ['stories'] });
}

export function useAddToHighlight() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (v: { storyId: string; target: { id: string } | { name: string } }) => api.addToHighlight(v.storyId, v.target),
    onSuccess: refresh,
  });
}

export function useRemoveFromHighlight() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (v: { highlightId: string; storyId: string }) => api.removeFromHighlight(v.highlightId, v.storyId),
    onSuccess: refresh,
  });
}

export function useDeleteHighlight() {
  const refresh = useRefresh();
  return useMutation({ mutationFn: api.deleteHighlight, onSuccess: refresh });
}

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as api from './api';

export function useProfile(profileId: string | undefined) {
  return useQuery({
    queryKey: ['profile', profileId],
    queryFn: () => api.getProfile(profileId!),
    enabled: !!profileId,
  });
}

export function useFollow(profileId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (follow: boolean) => (follow ? api.follow(profileId!) : api.unfollow(profileId!)),
    // Optimistic: flip the button and count immediately, roll back on error.
    onMutate: async (follow) => {
      await qc.cancelQueries({ queryKey: ['profile', profileId] });
      const previous = qc.getQueryData<api.Profile | null>(['profile', profileId]);
      if (previous) {
        qc.setQueryData<api.Profile>(['profile', profileId], {
          ...previous,
          iFollow: follow,
          followerCount: previous.followerCount + (follow === previous.iFollow ? 0 : follow ? 1 : -1),
        });
      }
      return { previous };
    },
    onError: (_e, _v, ctx) => qc.setQueryData(['profile', profileId], ctx?.previous),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['profile', profileId] });
      qc.invalidateQueries({ queryKey: ['feed', 'following'] });
    },
  });
}

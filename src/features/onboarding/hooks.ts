import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/features/auth/AuthProvider';
import * as api from './api';

export const myProfileKey = (userId: string | undefined) => ['my-profile', userId] as const;

export function useMyProfile() {
  const { session } = useAuth();
  const userId = session?.user.id;
  return useQuery({
    queryKey: myProfileKey(userId),
    queryFn: () => api.fetchMyProfile(userId!),
    enabled: !!userId,
  });
}

export function useInterests() {
  return useQuery({ queryKey: ['interests'], queryFn: api.fetchInterests, staleTime: Infinity });
}

export function useAreaSearch(query: string, enabled: boolean) {
  return useQuery({
    queryKey: ['areas', query.trim().toLowerCase()],
    queryFn: () => api.searchAreas(query),
    enabled,
  });
}

function useInvalidateProfile() {
  const qc = useQueryClient();
  const { session } = useAuth();
  return () => qc.invalidateQueries({ queryKey: myProfileKey(session?.user.id) });
}

export function useSetAreaFromCell() {
  const invalidate = useInvalidateProfile();
  return useMutation({
    mutationFn: (v: { geohash5: string; name: string }) => api.setAreaFromCell(v.geohash5, v.name),
    onSuccess: invalidate,
  });
}

export function useChooseArea() {
  const invalidate = useInvalidateProfile();
  return useMutation({ mutationFn: api.chooseArea, onSuccess: invalidate });
}

export function useSetInterests() {
  const invalidate = useInvalidateProfile();
  return useMutation({ mutationFn: api.setMyInterests, onSuccess: invalidate });
}

export function useCompleteOnboarding() {
  const invalidate = useInvalidateProfile();
  return useMutation({ mutationFn: api.completeOnboarding, onSuccess: invalidate });
}

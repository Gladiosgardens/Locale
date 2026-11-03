import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as api from './api';

export function useGroups(opts: { mine?: boolean; interestId?: number | null } = {}) {
  return useQuery({
    queryKey: ['groups', opts.mine ? 'mine' : 'nearby', opts.interestId ?? null],
    queryFn: () => api.listGroups(opts),
  });
}

export function useGroup(groupId: string | undefined) {
  return useQuery({
    queryKey: ['group', groupId],
    queryFn: () => api.getGroup(groupId!),
    enabled: !!groupId,
  });
}

export function useRoster(groupId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ['group-roster', groupId],
    queryFn: () => api.getRoster(groupId!),
    enabled: !!groupId && enabled,
  });
}

// After any membership change, refresh everything group-shaped plus the group feed.
function useGroupMutation<TArgs>(groupId: string | undefined, fn: (args: TArgs) => Promise<unknown>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['groups'] });
      qc.invalidateQueries({ queryKey: ['group', groupId] });
      qc.invalidateQueries({ queryKey: ['group-roster', groupId] });
      qc.invalidateQueries({ queryKey: ['group-feed', groupId] });
    },
  });
}

export const useJoinGroup = (groupId: string | undefined) =>
  useGroupMutation(groupId, () => api.joinGroup(groupId!));
export const useLeaveGroup = (groupId: string | undefined) =>
  useGroupMutation(groupId, () => api.leaveGroup(groupId!));
export const useRespondToRequest = (groupId: string | undefined) =>
  useGroupMutation(groupId, (v: { profileId: string; approve: boolean }) =>
    api.respondToRequest(groupId!, v.profileId, v.approve),
  );
export const useRemoveMember = (groupId: string | undefined) =>
  useGroupMutation(groupId, (profileId: string) => api.removeMember(groupId!, profileId));
export const useSetRole = (groupId: string | undefined) =>
  useGroupMutation(groupId, (v: { profileId: string; role: 'moderator' | 'member' }) =>
    api.setRole(groupId!, v.profileId, v.role),
  );

export function useCreateGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.createGroup,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['groups'] }),
  });
}

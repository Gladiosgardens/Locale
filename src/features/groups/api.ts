import { check, unwrap } from '@/lib/errors';
import { supabase } from '@/lib/supabase';

export type GroupPrivacy = 'public' | 'private';
export type GroupRole = 'owner' | 'moderator' | 'member';
export type MembershipStatus = 'active' | 'pending' | 'banned';

export type Group = {
  id: string;
  name: string;
  description: string | null;
  interestId: number;
  privacy: GroupPrivacy;
  areaName: string;
  memberCount: number;
  myRole: GroupRole | null;
  myStatus: MembershipStatus | null;
  pendingCount: number;
};

export type RosterEntry = {
  profileId: string;
  handle: string;
  displayName: string;
  role: GroupRole;
  status: MembershipStatus;
};

type GroupRow = {
  id: string; name: string; description: string | null; interest_id: number; privacy: string;
  area_name: string; member_count: number; my_role: string | null; my_status: string | null; pending_count: number;
};

const toGroup = (r: GroupRow): Group => ({
  id: r.id,
  name: r.name,
  description: r.description,
  interestId: r.interest_id,
  privacy: r.privacy as GroupPrivacy,
  areaName: r.area_name,
  memberCount: r.member_count,
  myRole: r.my_role as GroupRole | null,
  myStatus: r.my_status as MembershipStatus | null,
  pendingCount: r.pending_count,
});

export async function listGroups(opts: { mine?: boolean; interestId?: number | null } = {}): Promise<Group[]> {
  const rows = unwrap(
    await supabase.rpc('list_groups', {
      ...(opts.mine ? { p_mine: true } : {}),
      ...(opts.interestId ? { p_interest_id: opts.interestId } : {}),
    }),
  );
  return rows.map(toGroup);
}

export async function getGroup(groupId: string): Promise<Group | null> {
  const rows = unwrap(await supabase.rpc('list_groups', { p_group_id: groupId }));
  return rows[0] ? toGroup(rows[0]) : null;
}

export async function getRoster(groupId: string): Promise<RosterEntry[]> {
  const rows = unwrap(await supabase.rpc('group_roster', { p_group_id: groupId }));
  return rows.map((r) => ({
    profileId: r.profile_id,
    handle: r.handle,
    displayName: r.display_name,
    role: r.role as GroupRole,
    status: r.status as MembershipStatus,
  }));
}

export async function createGroup(input: {
  name: string;
  description: string;
  interestId: number;
  privacy: GroupPrivacy;
}): Promise<string> {
  return unwrap(
    await supabase.rpc('create_group', {
      p_name: input.name,
      p_description: input.description,
      p_interest_id: input.interestId,
      p_privacy: input.privacy,
    }),
  );
}

export async function joinGroup(groupId: string): Promise<MembershipStatus> {
  return unwrap(await supabase.rpc('join_group', { p_group_id: groupId })) as MembershipStatus;
}

export async function leaveGroup(groupId: string): Promise<void> {
  check(await supabase.rpc('leave_group', { p_group_id: groupId }));
}

export async function respondToRequest(groupId: string, profileId: string, approve: boolean): Promise<void> {
  check(await supabase.rpc('respond_to_join_request', { p_group_id: groupId, p_profile_id: profileId, p_approve: approve }));
}

export async function removeMember(groupId: string, profileId: string): Promise<void> {
  check(await supabase.rpc('remove_group_member', { p_group_id: groupId, p_profile_id: profileId }));
}

export async function setRole(groupId: string, profileId: string, role: 'moderator' | 'member'): Promise<void> {
  check(await supabase.rpc('set_group_role', { p_group_id: groupId, p_profile_id: profileId, p_role: role }));
}

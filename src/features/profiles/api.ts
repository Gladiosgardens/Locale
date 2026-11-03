import { check, unwrap } from '@/lib/errors';
import { supabase } from '@/lib/supabase';

export type Profile = {
  id: string;
  handle: string;
  displayName: string;
  bio: string | null;
  followerCount: number;
  followingCount: number;
  iFollow: boolean;
  followsMe: boolean;
  isMe: boolean;
};

export async function getProfile(profileId: string): Promise<Profile | null> {
  const [r] = unwrap(await supabase.rpc('profile_summary', { p_profile_id: profileId }));
  if (!r) return null;
  return {
    id: r.id,
    handle: r.handle,
    displayName: r.display_name,
    bio: r.bio,
    followerCount: r.follower_count,
    followingCount: r.following_count,
    iFollow: r.i_follow,
    followsMe: r.follows_me,
    isMe: r.is_me,
  };
}

export async function follow(profileId: string): Promise<void> {
  check(await supabase.rpc('follow_user', { p_profile_id: profileId }));
}

export async function unfollow(profileId: string): Promise<void> {
  check(await supabase.rpc('unfollow_user', { p_profile_id: profileId }));
}

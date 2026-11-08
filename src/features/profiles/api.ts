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

export async function updateProfile(userId: string, fields: { displayName: string; bio: string; handle: string }): Promise<void> {
  const { error } = await supabase
    .from('profiles')
    .update({
      display_name: fields.displayName.trim(),
      bio: fields.bio.trim() || null,
      handle: fields.handle.trim().replace(/^@/, '').toLowerCase(),
    })
    .eq('id', userId);
  if (error) {
    if (error.code === '23505') throw new Error('handle_taken');
    if (error.code === '23514') throw new Error('invalid_profile');
    throw error;
  }
}

/** Sends an uploaded photo (in post-uploads) to be cleaned and set, or removes the photo. */
export async function setAvatar(uploadPath: string | null): Promise<string | null> {
  const { data, error } = await supabase.functions.invoke<{ avatarPath: string | null }>('set-avatar', {
    body: uploadPath ? { path: uploadPath } : { remove: true },
  });
  if (error) throw new Error('avatar_failed');
  return data?.avatarPath ?? null;
}

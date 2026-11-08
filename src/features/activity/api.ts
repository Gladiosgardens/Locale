import { check, unwrap } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import { thumbnailUrl } from '@/features/video/mux';

export type ActivityKind = 'like' | 'comment' | 'reply' | 'follow';

export type Activity = {
  kind: ActivityKind;
  actor: { id: string; handle: string; displayName: string };
  postId: string | null;
  postThumb: string | null;
  body: string | null;
  createdAt: string;
  iFollowActor: boolean;
};

export const ACTIVITY_PAGE = 30;

export async function fetchActivity(before: string | null): Promise<Activity[]> {
  const rows = unwrap(await supabase.rpc('my_activity', { p_limit: ACTIVITY_PAGE, ...(before ? { p_before: before } : {}) }));
  // Post photos are private: sign them all in one request.
  const paths = [...new Set(rows.map((r) => r.post_media_path).filter((p): p is string => !!p))];
  const signed = new Map<string, string>();
  if (paths.length) {
    const res = unwrap(await supabase.storage.from('post-media').createSignedUrls(paths, 3600));
    for (const s of res) if (s.path && s.signedUrl) signed.set(s.path, s.signedUrl);
  }
  return rows.map((r) => ({
    kind: r.kind as ActivityKind,
    actor: { id: r.actor_id, handle: r.actor_handle, displayName: r.actor_display_name },
    postId: r.post_id,
    postThumb: r.post_playback_id
      ? thumbnailUrl(r.post_playback_id, 200)
      : r.post_media_path
        ? (signed.get(r.post_media_path) ?? null)
        : null,
    body: r.body,
    createdAt: r.created_at,
    iFollowActor: r.i_follow_actor,
  }));
}

export async function fetchUnread(): Promise<number> {
  return unwrap(await supabase.rpc('my_activity_unread'));
}

export async function markSeen(): Promise<void> {
  check(await supabase.rpc('mark_activity_seen'));
}

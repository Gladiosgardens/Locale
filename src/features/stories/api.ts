import { toFeedPosts, type FeedMedia } from '@/features/posts/api';
import { thumbnailUrl } from '@/features/video/mux';
import { check, unwrap } from '@/lib/errors';
import { supabase } from '@/lib/supabase';

export const MAX_STORY_CAPTION = 200;
/** How long a photo story shows before moving on. Videos play to the end. */
export const PHOTO_STORY_MS = 6000;

export type TrayEntry = {
  author: { id: string; handle: string; displayName: string };
  count: number;
  allSeen: boolean;
  isMe: boolean;
};

export type Story = {
  id: string;
  caption: string | null;
  publishedAt: string;
  expiresAt: string;
  author: { id: string; handle: string; displayName: string };
  media: FeedMedia;
  seen: boolean;
  /** Only for my own stories. */
  viewCount: number | null;
};

export type Highlight = { id: string; name: string; count: number; coverUrl: string | null };

type StoryRow = {
  id: string;
  caption: string | null;
  published_at: string;
  expires_at: string;
  author_id: string;
  author_handle: string;
  author_display_name: string;
  media: unknown;
  seen: boolean;
  view_count: number | null;
};

async function toStories(rows: StoryRow[]): Promise<Story[]> {
  // Same media handling as posts (signed photo URLs, Mux video, item tags).
  const posts = await toFeedPosts(
    rows.map((r) => ({ ...r, area_name: null, interest_ids: [], matched_item_ids: [] })) as never,
  );
  return rows
    .map((r, i) => ({
      id: r.id,
      caption: r.caption,
      publishedAt: r.published_at,
      expiresAt: r.expires_at,
      author: posts[i].author,
      media: posts[i].media[0],
      seen: r.seen,
      viewCount: r.view_count,
    }))
    .filter((s) => !!s.media);
}

export async function fetchTray(): Promise<TrayEntry[]> {
  const rows = unwrap(await supabase.rpc('story_tray'));
  return rows.map((r) => ({
    author: { id: r.author_id, handle: r.author_handle, displayName: r.author_display_name },
    count: r.story_count,
    allSeen: r.all_seen,
    isMe: r.is_me,
  }));
}

export async function fetchAuthorStories(authorId: string): Promise<Story[]> {
  return toStories(unwrap(await supabase.rpc('author_stories', { p_author_id: authorId })));
}

export async function fetchHighlightStories(highlightId: string): Promise<Story[]> {
  return toStories(unwrap(await supabase.rpc('highlight_story_rows', { p_highlight_id: highlightId })));
}

export async function markSeen(storyId: string): Promise<void> {
  check(await supabase.rpc('mark_story_seen', { p_post_id: storyId }));
}

export type StoryViewer = { id: string; handle: string; displayName: string; viewedAt: string };

export async function fetchViewers(storyId: string): Promise<StoryViewer[]> {
  const rows = unwrap(await supabase.rpc('story_viewers', { p_post_id: storyId }));
  return rows.map((r) => ({ id: r.profile_id, handle: r.handle, displayName: r.display_name, viewedAt: r.viewed_at }));
}

export async function fetchProfileHighlights(profileId: string): Promise<Highlight[]> {
  const rows = unwrap(await supabase.rpc('profile_highlights', { p_profile_id: profileId }));
  const paths = rows.map((r) => r.cover_path).filter((p): p is string => !!p);
  const urls = new Map<string, string>();
  if (paths.length) {
    const signed = unwrap(await supabase.storage.from('post-media').createSignedUrls(paths, 3600));
    for (const s of signed) if (s.path && s.signedUrl) urls.set(s.path, s.signedUrl);
  }
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    count: r.story_count,
    coverUrl: r.cover_playback_id
      ? thumbnailUrl(r.cover_playback_id, 200)
      : r.cover_path
        ? (urls.get(r.cover_path) ?? null)
        : null,
  }));
}

export async function fetchMyHighlights(storyId: string): Promise<{ id: string; name: string; hasStory: boolean }[]> {
  const rows = unwrap(await supabase.rpc('my_highlights', { p_post_id: storyId }));
  return rows.map((r) => ({ id: r.id, name: r.name, hasStory: r.has_story }));
}

export async function addToHighlight(storyId: string, target: { id: string } | { name: string }): Promise<string> {
  return unwrap(
    await supabase.rpc('add_to_highlight', {
      p_post_id: storyId,
      ...('id' in target ? { p_highlight_id: target.id } : { p_name: target.name.trim() }),
    }),
  );
}

export async function removeFromHighlight(highlightId: string, storyId: string): Promise<void> {
  check(await supabase.rpc('remove_from_highlight', { p_highlight_id: highlightId, p_post_id: storyId }));
}

export async function deleteHighlight(highlightId: string): Promise<void> {
  check(await supabase.rpc('delete_highlight', { p_highlight_id: highlightId }));
}

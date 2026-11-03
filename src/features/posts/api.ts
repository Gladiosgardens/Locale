import { FunctionsHttpError } from '@supabase/supabase-js';
import { randomUUID } from 'expo-crypto';
import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { check, unwrap } from '@/lib/errors';
import { supabase } from '@/lib/supabase';

export const FEED_PAGE_SIZE = 20;
export const MAX_PHOTOS = 10;
export const MAX_POST_INTERESTS = 3;
const MAX_EDGE = 2048;
const SIGNED_URL_SECONDS = 60 * 60;

export type FeedMedia = { path: string; width: number; height: number; url: string | null };

export type FeedPost = {
  id: string;
  caption: string | null;
  publishedAt: string;
  author: { id: string; handle: string; displayName: string };
  areaName: string;
  media: FeedMedia[];
  interestIds: number[];
};

export type FeedCursor = { publishedAt: string; id: string } | null;

export async function fetchFeedPage(cursor: FeedCursor, interestId: number | null): Promise<FeedPost[]> {
  const rows = unwrap(
    await supabase.rpc('nearby_feed', {
      p_limit: FEED_PAGE_SIZE,
      ...(cursor ? { p_before_published_at: cursor.publishedAt, p_before_id: cursor.id } : {}),
      ...(interestId ? { p_interest_id: interestId } : {}),
    }),
  );

  const media = rows.flatMap((r) => r.media as { path: string; width: number; height: number }[]);
  const urls = new Map<string, string>();
  if (media.length) {
    // One request for the whole page. Storage RLS re-checks visibility.
    const signed = unwrap(
      await supabase.storage.from('post-media').createSignedUrls(media.map((m) => m.path), SIGNED_URL_SECONDS),
    );
    for (const s of signed) if (s.path && s.signedUrl) urls.set(s.path, s.signedUrl);
  }

  return rows.map((r) => ({
    id: r.id,
    caption: r.caption,
    publishedAt: r.published_at,
    author: { id: r.author_id, handle: r.author_handle, displayName: r.author_display_name },
    areaName: r.area_name,
    interestIds: r.interest_ids,
    media: (r.media as { path: string; width: number; height: number }[]).map((m) => ({
      ...m,
      url: urls.get(m.path) ?? null,
    })),
  }));
}

export async function deletePost(postId: string): Promise<void> {
  check(await supabase.rpc('delete_my_post', { p_post_id: postId }));
}

export type PickedPhoto = { uri: string; width: number; height: number };

// Re-encode as JPEG, at most 2048 px on the long edge. Re-rendering applies
// the orientation and drops EXIF (incl. GPS) on the device; the server strips
// metadata again regardless.
export async function preparePhoto(photo: PickedPhoto): Promise<PickedPhoto> {
  const context = ImageManipulator.manipulate(photo.uri);
  const longEdge = Math.max(photo.width, photo.height);
  if (longEdge > MAX_EDGE) {
    context.resize(photo.width >= photo.height ? { width: MAX_EDGE } : { height: MAX_EDGE });
  }
  const image = await context.renderAsync();
  const result = await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.82 });
  return { uri: result.uri, width: result.width, height: result.height };
}

export async function uploadPhoto(userId: string, uri: string): Promise<string> {
  const path = `${userId}/${randomUUID()}.jpg`;
  const bytes = await new File(uri).arrayBuffer();
  check(
    await supabase.storage.from('post-uploads').upload(path, bytes, {
      contentType: 'image/jpeg',
      upsert: false,
    }),
  );
  return path;
}

export async function publishPost(input: {
  uploads: string[];
  caption: string;
  interestIds: number[];
}): Promise<string> {
  const { data, error } = await supabase.functions.invoke<{ id: string }>('publish-post', {
    body: { uploads: input.uploads, caption: input.caption.trim() || null, interestIds: input.interestIds },
  });
  if (error) {
    let code = 'publish_failed';
    if (error instanceof FunctionsHttpError) {
      try {
        code = (await error.context.json()).error ?? code;
      } catch {
        // keep the generic code
      }
    }
    throw new Error(code);
  }
  return data!.id;
}

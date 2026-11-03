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

export type Item = {
  id: string;
  title: string;
  brand: string | null;
  storeName: string | null;
  url: string | null;
  urlHost: string | null;
  priceCents: number | null;
  currency: string | null;
  isAffiliate: boolean;
};

export type ItemTag = { id: string; x: number; y: number; item: Item };

export type FeedMedia = { path: string; width: number; height: number; url: string | null; tags: ItemTag[] };

export type FeedPost = {
  id: string;
  caption: string | null;
  publishedAt: string;
  author: { id: string; handle: string; displayName: string };
  /** Null when the post is outside the viewer's area (Everywhere and search). */
  areaName: string | null;
  media: FeedMedia[];
  interestIds: number[];
  matchedItemIds: string[];
};

export type FeedCursor = { publishedAt: string; id: string } | null;
export type FeedScope = 'nearby' | 'everywhere';

type RawItem = {
  id: string; title: string; brand: string | null; store_name: string | null; url: string | null;
  url_host: string | null; price_cents: number | null; currency: string | null; is_affiliate: boolean;
};
type RawMedia = {
  path: string; width: number; height: number;
  tags?: { id: string; x: number; y: number; item: RawItem }[];
};
type RawPost = {
  id: string; caption: string | null; published_at: string; author_id: string; author_handle: string;
  author_display_name: string; area_name: string | null; media: unknown; interest_ids: number[];
  matched_item_ids?: string[];
};

const cursorArgs = (cursor: FeedCursor) =>
  cursor ? { p_before_published_at: cursor.publishedAt, p_before_id: cursor.id } : {};

async function toFeedPosts(rows: RawPost[]): Promise<FeedPost[]> {
  const media = rows.flatMap((r) => r.media as RawMedia[]);
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
    matchedItemIds: r.matched_item_ids ?? [],
    media: (r.media as RawMedia[]).map((m) => ({
      path: m.path,
      width: m.width,
      height: m.height,
      url: urls.get(m.path) ?? null,
      tags: (m.tags ?? []).map((t) => ({
        id: t.id,
        x: t.x,
        y: t.y,
        item: {
          id: t.item.id,
          title: t.item.title,
          brand: t.item.brand,
          storeName: t.item.store_name,
          url: t.item.url,
          urlHost: t.item.url_host,
          priceCents: t.item.price_cents,
          currency: t.item.currency,
          isAffiliate: t.item.is_affiliate,
        },
      })),
    })),
  }));
}

export async function fetchFeedPage(
  scope: FeedScope,
  cursor: FeedCursor,
  interestId: number | null,
): Promise<FeedPost[]> {
  if (scope === 'everywhere') {
    return toFeedPosts(
      unwrap(await supabase.rpc('discover_posts', { p_limit: FEED_PAGE_SIZE, ...cursorArgs(cursor) })),
    );
  }
  return toFeedPosts(
    unwrap(
      await supabase.rpc('nearby_feed', {
        p_limit: FEED_PAGE_SIZE,
        ...cursorArgs(cursor),
        ...(interestId ? { p_interest_id: interestId } : {}),
      }),
    ),
  );
}

export async function fetchGroupFeedPage(groupId: string, cursor: FeedCursor): Promise<FeedPost[]> {
  return toFeedPosts(
    unwrap(
      await supabase.rpc('nearby_feed', { p_limit: FEED_PAGE_SIZE, p_group_id: groupId, ...cursorArgs(cursor) }),
    ),
  );
}

export const MIN_QUERY_LENGTH = 2;

export async function searchPosts(query: string, cursor: FeedCursor): Promise<FeedPost[]> {
  return toFeedPosts(
    unwrap(
      await supabase.rpc('discover_posts', {
        p_query: query.trim(),
        p_limit: FEED_PAGE_SIZE,
        ...cursorArgs(cursor),
      }),
    ),
  );
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

/** A tag drawn in the composer; `media` is the photo index. */
export type DraftTag = {
  media: number;
  x: number;
  y: number;
  item: {
    title: string;
    brand?: string;
    store_name?: string;
    url?: string;
    price_cents?: number;
    currency?: string;
    is_affiliate?: boolean;
  };
};

export async function publishPost(input: {
  uploads: string[];
  caption: string;
  interestIds: number[];
  tags?: DraftTag[];
  searchable?: boolean;
  groupId?: string | null;
}): Promise<string> {
  const { data, error } = await supabase.functions.invoke<{ id: string }>('publish-post', {
    body: {
      uploads: input.uploads,
      caption: input.caption.trim() || null,
      interestIds: input.interestIds,
      tags: input.tags ?? [],
      searchable: input.groupId ? false : (input.searchable ?? true),
      groupId: input.groupId ?? null,
    },
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

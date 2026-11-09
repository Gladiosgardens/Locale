import { FunctionsHttpError } from '@supabase/supabase-js';
import { randomUUID } from 'expo-crypto';
import type { VideoThumbnail } from 'expo-video';
import { File } from 'expo-file-system';
import { FileSystemUploadType, uploadAsync } from 'expo-file-system/legacy';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { check, unwrap } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import { playbackUrl, thumbnailUrl } from '@/features/video/mux';

/** A decoded image the app already holds: a video's poster frame. */
export type ImageRef = VideoThumbnail;

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

/** A person tagged on a photo. */
export type PersonTag = { profileId: string; handle: string; x: number; y: number };

export type FeedMedia = {
  kind: 'image' | 'video';
  /** Storage path for photos; a stable key (the playback id) for videos. */
  path: string;
  width: number;
  height: number;
  /** A photo, or a video's poster frame. */
  url: string | null;
  /** HLS stream for videos. */
  videoUrl: string | null;
  duration: number | null;
  tags: ItemTag[];
  people: PersonTag[];
};

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
  /** Where the post sits in its feed; the paging cursor. Equals publishedAt except in For you. */
  rankAt: string;
  likeCount: number;
  commentCount: number;
  iLiked: boolean;
  iSaved: boolean;
};

export type FeedCursor = { publishedAt: string; id: string } | null;
export type FeedScope = 'for-you' | 'nearby' | 'following' | 'everywhere' | 'saved';

type RawItem = {
  id: string; title: string; brand: string | null; store_name: string | null; url: string | null;
  url_host: string | null; price_cents: number | null; currency: string | null; is_affiliate: boolean;
};
type RawMedia = {
  kind?: 'image' | 'video'; path: string | null; playback_id?: string | null; duration?: number | null;
  width: number; height: number;
  tags?: { id: string; x: number; y: number; item: RawItem }[];
  people?: { profile_id: string; handle: string; x: number; y: number }[];
};
type RawPost = {
  id: string; caption: string | null; published_at: string; author_id: string; author_handle: string;
  author_display_name: string; area_name: string | null; media: unknown; interest_ids: number[];
  matched_item_ids?: string[];
  rank_at?: string;
  like_count?: number;
  comment_count?: number;
  i_liked?: boolean;
  i_saved?: boolean;
};

const cursorArgs = (cursor: FeedCursor) =>
  cursor ? { p_before_published_at: cursor.publishedAt, p_before_id: cursor.id } : {};

async function toFeedPosts(rows: RawPost[]): Promise<FeedPost[]> {
  const paths = rows.flatMap((r) => (r.media as RawMedia[]).map((m) => m.path).filter((p): p is string => !!p));
  const urls = new Map<string, string>();
  if (paths.length) {
    // One request for the whole page. Storage RLS re-checks visibility.
    const signed = unwrap(await supabase.storage.from('post-media').createSignedUrls(paths, SIGNED_URL_SECONDS));
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
    rankAt: r.rank_at ?? r.published_at,
    likeCount: r.like_count ?? 0,
    commentCount: r.comment_count ?? 0,
    iLiked: r.i_liked ?? false,
    iSaved: r.i_saved ?? false,
    media: (r.media as RawMedia[]).map((m) => ({
      kind: m.kind === 'video' ? ('video' as const) : ('image' as const),
      path: m.path ?? m.playback_id ?? '',
      width: m.width,
      height: m.height,
      url: m.kind === 'video' && m.playback_id ? thumbnailUrl(m.playback_id) : m.path ? (urls.get(m.path) ?? null) : null,
      videoUrl: m.kind === 'video' && m.playback_id ? playbackUrl(m.playback_id) : null,
      duration: m.duration ?? null,
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
      people: (m.people ?? []).map((p) => ({ profileId: p.profile_id, handle: p.handle, x: p.x, y: p.y })),
    })),
  }));
}

export async function fetchFeedPage(
  scope: FeedScope,
  cursor: FeedCursor,
  interestId: number | null,
): Promise<FeedPost[]> {
  if (scope !== 'nearby') {
    return toFeedPosts(
      unwrap(
        await supabase.rpc('discover_posts', {
          p_limit: FEED_PAGE_SIZE,
          ...(scope === 'following' ? { p_following: true } : {}),
          ...(scope === 'for-you' ? { p_for_you: true } : {}),
          ...(scope === 'saved' ? { p_saved: true } : {}),
          ...cursorArgs(cursor),
        }),
      ),
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

export async function fetchAuthorPage(authorId: string, cursor: FeedCursor): Promise<FeedPost[]> {
  return toFeedPosts(
    unwrap(
      await supabase.rpc('discover_posts', { p_author_id: authorId, p_limit: FEED_PAGE_SIZE, ...cursorArgs(cursor) }),
    ),
  );
}

export async function fetchPost(postId: string): Promise<FeedPost | null> {
  const [post] = await toFeedPosts(unwrap(await supabase.rpc('discover_posts', { p_post_id: postId, p_limit: 1 })));
  return post ?? null;
}

/** Posts with a hashtag, posts a person is tagged in, or one of my collections. */
export type PostFilter = { hashtag: string } | { taggedId: string } | { collectionId: string };

export async function fetchFilteredPage(filter: PostFilter, cursor: FeedCursor): Promise<FeedPost[]> {
  return toFeedPosts(
    unwrap(
      await supabase.rpc('discover_posts', {
        p_limit: FEED_PAGE_SIZE,
        ...('hashtag' in filter ? { p_hashtag: filter.hashtag } : {}),
        ...('taggedId' in filter ? { p_tagged_id: filter.taggedId } : {}),
        ...('collectionId' in filter ? { p_collection_id: filter.collectionId } : {}),
        ...cursorArgs(cursor),
      }),
    ),
  );
}

export type PeopleTagDraft = { position: number; profileId: string; handle: string; x: number; y: number };

export async function setPeopleTags(postId: string, tags: PeopleTagDraft[]): Promise<void> {
  check(
    await supabase.rpc('set_people_tags', {
      p_post_id: postId,
      p_tags: tags.map((t) => ({ position: t.position, profile_id: t.profileId, x: t.x, y: t.y })),
    }),
  );
}

export async function removeMyPeopleTag(postId: string): Promise<void> {
  check(await supabase.rpc('remove_my_people_tag', { p_post_id: postId }));
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

export async function setLike(postId: string, like: boolean): Promise<void> {
  check(await supabase.rpc('set_post_like', { p_post_id: postId, p_like: like }));
}

export async function setPostSaved(postId: string, saved: boolean): Promise<void> {
  check(await supabase.rpc('set_post_saved', { p_post_id: postId, p_saved: saved }));
}

export const MAX_CAPTION = 2200;

export async function updateCaption(postId: string, caption: string): Promise<void> {
  check(await supabase.rpc('update_post_caption', { p_post_id: postId, p_caption: caption.trim() }));
}

export async function deletePost(postId: string): Promise<void> {
  check(await supabase.rpc('delete_my_post', { p_post_id: postId }));
}

export type PickedPhoto = {
  uri: string;
  width: number;
  height: number;
  thumbnail?: ImageRef;
  /** Set once the photo has been prepared and uploaded (for detection), so publishing reuses it. */
  uploadedPath?: string;
};

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

async function invokeFn<T>(name: string, body: Record<string, unknown>, fallback: string): Promise<T> {
  const { data, error } = await supabase.functions.invoke<T>(name, { body });
  if (error) {
    let code = fallback;
    let detail: string = error.message;
    if (error instanceof FunctionsHttpError) {
      try {
        const body = await error.context.json();
        code = body.error ?? code;
        detail = body.detail ?? `HTTP ${error.context.status}`;
      } catch {
        detail = `HTTP ${error.context.status}`;
      }
    }
    throw Object.assign(new Error(code), { detail });
  }
  return data!;
}

export type ShopMatch = {
  title: string;
  store: string | null;
  url: string;
  host: string;
  priceCents: number | null;
  currency: string | null;
  thumbnail: string | null;
};

export type DetectedItem = { name: string; category: string; x: number; y: number; query: string; matches: ShopMatch[] };

/** Finds shoppable items in an uploaded photo, with suggested places to buy each. */
export async function detectItems(uploadPath: string): Promise<DetectedItem[]> {
  const res = await invokeFn<{ items: DetectedItem[] }>('detect-items', { path: uploadPath }, 'detection_failed');
  return res.items ?? [];
}

/** Similar products for an item on a post (for items with or without a link). */
export async function similarItems(itemId: string, postId: string): Promise<ShopMatch[]> {
  const res = await invokeFn<{ matches: ShopMatch[] }>('similar-items', { itemId, postId }, 'detection_failed');
  return res.matches ?? [];
}

export type PickedVideo = { uri: string; width: number; height: number; durationMs: number };

export function createVideoUpload(): Promise<{ uploadId: string; url: string }> {
  return invokeFn('create-video-upload', {}, 'upload_failed');
}

/** Streams the file from disk to Mux's one-time upload URL. */
export async function uploadVideoFile(url: string, uri: string): Promise<void> {
  const result = await uploadAsync(url, uri, {
    httpMethod: 'PUT',
    uploadType: FileSystemUploadType.BINARY_CONTENT,
    headers: { 'Content-Type': 'application/octet-stream' },
  });
  if (result.status < 200 || result.status >= 300) throw new Error('upload_failed');
}

export type VideoStatus = { status: 'processing' | 'ready' | 'failed'; reason?: string };

export function videoStatus(uploadId: string): Promise<VideoStatus> {
  return invokeFn('video-status', { uploadId }, 'status_failed');
}

export async function publishPost(input: {
  uploads: string[];
  caption: string;
  interestIds: number[];
  tags?: DraftTag[];
  searchable?: boolean;
  groupId?: string | null;
  videoUploadId?: string | null;
  shopping?: boolean;
}): Promise<string> {
  const { data, error } = await supabase.functions.invoke<{ id: string }>('publish-post', {
    body: {
      uploads: input.uploads,
      ...(input.videoUploadId ? { video: { uploadId: input.videoUploadId } } : {}),
      ...(input.shopping === false ? { shopping: false } : {}),
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

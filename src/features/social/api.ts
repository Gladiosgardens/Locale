import { check, unwrap } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import type { Item } from '@/features/posts/api';
import { thumbnailUrl } from '@/features/video/mux';

export const COMMENT_PAGE = 30;
export const MAX_COMMENT = 1000;

export type Comment = {
  id: string;
  body: string;
  createdAt: string;
  author: { id: string; handle: string; displayName: string };
  canDelete: boolean;
  parentId: string | null;
  likeCount: number;
  iLiked: boolean;
};

export type CommentCursor = { createdAt: string; id: string } | null;

export async function listComments(postId: string, after: CommentCursor): Promise<Comment[]> {
  const rows = unwrap(
    await supabase.rpc('list_comments', {
      p_post_id: postId,
      p_limit: COMMENT_PAGE,
      ...(after ? { p_after_created_at: after.createdAt, p_after_id: after.id } : {}),
    }),
  );
  return rows.map((r) => ({
    id: r.id,
    body: r.body,
    createdAt: r.created_at,
    author: { id: r.author_id, handle: r.author_handle, displayName: r.author_display_name },
    canDelete: r.can_delete,
    parentId: r.parent_id,
    likeCount: Number(r.like_count),
    iLiked: r.i_liked,
  }));
}

export async function addComment(postId: string, body: string, parentId?: string | null): Promise<string> {
  return unwrap(
    await supabase.rpc('add_comment', { p_post_id: postId, p_body: body.trim(), ...(parentId ? { p_parent_id: parentId } : {}) }),
  );
}

export async function setCommentLike(commentId: string, like: boolean): Promise<void> {
  check(await supabase.rpc('set_comment_like', { p_comment_id: commentId, p_like: like }));
}

// Replies sit under their parent, in the order they were written.
// Comments arrive oldest first, so a parent is always loaded before its replies.
export function threadComments(list: Comment[]): (Comment & { isReply: boolean })[] {
  const replies = new Map<string, Comment[]>();
  for (const c of list) if (c.parentId) replies.set(c.parentId, [...(replies.get(c.parentId) ?? []), c]);
  const out: (Comment & { isReply: boolean })[] = [];
  for (const c of list) {
    if (c.parentId) continue;
    out.push({ ...c, isReply: false });
    for (const r of replies.get(c.id) ?? []) out.push({ ...r, isReply: true });
  }
  return out;
}

export async function deleteComment(commentId: string): Promise<void> {
  check(await supabase.rpc('delete_comment', { p_comment_id: commentId }));
}

export type SavedItem = {
  item: Item;
  postId: string;
  photoUrl: string | null;
  photoPath: string | null;
  savedAt: string;
  /** The price on the store's page at the last daily check, if known. */
  current: { priceCents: number; currency: string } | null;
  inStock: boolean | null;
};

const SIGNED_URL_SECONDS = 60 * 60;

export async function listSavedItems(before: string | null): Promise<SavedItem[]> {
  const rows = unwrap(
    await supabase.rpc('my_saved_items', { p_limit: 30, ...(before ? { p_before_created_at: before } : {}) }),
  );
  const paths = rows.map((r) => r.photo_path).filter((p): p is string => !!p);
  const urls = new Map<string, string>();
  if (paths.length) {
    const signed = unwrap(await supabase.storage.from('post-media').createSignedUrls(paths, SIGNED_URL_SECONDS));
    for (const s of signed) if (s.path && s.signedUrl) urls.set(s.path, s.signedUrl);
  }
  return rows.map((r) => ({
    item: {
      id: r.item_id,
      title: r.title,
      brand: r.brand,
      storeName: r.store_name,
      url: r.url,
      urlHost: r.url_host,
      priceCents: r.price_cents,
      currency: r.currency,
      isAffiliate: r.is_affiliate,
    },
    postId: r.post_id,
    photoPath: r.photo_path,
    photoUrl: r.photo_path ? (urls.get(r.photo_path) ?? null) : null,
    savedAt: r.saved_at,
    current: r.current_price_cents != null && r.current_currency ? { priceCents: r.current_price_cents, currency: r.current_currency } : null,
    inStock: r.in_stock,
  }));
}

export async function isItemSaved(itemId: string): Promise<boolean> {
  const { data } = await supabase.from('saved_items').select('item_id').eq('item_id', itemId).maybeSingle();
  return !!data;
}

export async function setItemSaved(itemId: string, postId: string, saved: boolean): Promise<void> {
  check(await supabase.rpc('set_item_saved', { p_item_id: itemId, p_post_id: postId, p_saved: saved }));
}

export type Collection = { id: string; name: string; postCount: number; coverUrl: string | null };

export async function listCollections(): Promise<Collection[]> {
  const rows = unwrap(await supabase.rpc('my_collections'));
  const paths = rows.map((r) => r.cover_path).filter((p): p is string => !!p);
  const urls = new Map<string, string>();
  if (paths.length) {
    const signed = unwrap(await supabase.storage.from('post-media').createSignedUrls(paths, SIGNED_URL_SECONDS));
    for (const s of signed) if (s.path && s.signedUrl) urls.set(s.path, s.signedUrl);
  }
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    postCount: r.post_count,
    coverUrl: r.cover_playback_id
      ? thumbnailUrl(r.cover_playback_id, 300)
      : r.cover_path
        ? (urls.get(r.cover_path) ?? null)
        : null,
  }));
}

export async function createCollection(name: string): Promise<string> {
  return unwrap(await supabase.rpc('create_collection', { p_name: name.trim() }));
}

export async function renameCollection(id: string, name: string): Promise<void> {
  check(await supabase.rpc('rename_collection', { p_collection_id: id, p_name: name.trim() }));
}

export async function deleteCollection(id: string): Promise<void> {
  check(await supabase.rpc('delete_collection', { p_collection_id: id }));
}

export async function setInCollection(collectionId: string, postId: string, inIt: boolean): Promise<void> {
  check(await supabase.rpc('set_in_collection', { p_collection_id: collectionId, p_post_id: postId, p_in: inIt }));
}

export async function postCollectionIds(postId: string): Promise<string[]> {
  return unwrap(await supabase.rpc('post_collection_ids', { p_post_id: postId }));
}

import { check, unwrap } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import type { Item } from '@/features/posts/api';

export const COMMENT_PAGE = 30;
export const MAX_COMMENT = 1000;

export type Comment = {
  id: string;
  body: string;
  createdAt: string;
  author: { id: string; handle: string; displayName: string };
  canDelete: boolean;
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
  }));
}

export async function addComment(postId: string, body: string): Promise<string> {
  return unwrap(await supabase.rpc('add_comment', { p_post_id: postId, p_body: body.trim() }));
}

export async function deleteComment(commentId: string): Promise<void> {
  check(await supabase.rpc('delete_comment', { p_comment_id: commentId }));
}

export type SavedItem = { item: Item; postId: string; photoUrl: string | null; photoPath: string | null; savedAt: string };

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
  }));
}

export async function isItemSaved(itemId: string): Promise<boolean> {
  const { data } = await supabase.from('saved_items').select('item_id').eq('item_id', itemId).maybeSingle();
  return !!data;
}

export async function setItemSaved(itemId: string, postId: string, saved: boolean): Promise<void> {
  check(await supabase.rpc('set_item_saved', { p_item_id: itemId, p_post_id: postId, p_saved: saved }));
}

import { check, unwrap } from '@/lib/errors';
import { supabase } from '@/lib/supabase';

export type ItemStats = { itemId: string; title: string; urlHost: string | null; opens: number; linkTaps: number; wishlist: number };

export type PostStats = {
  reach: number;
  views: number;
  likes: number;
  comments: number;
  saves: number;
  itemOpens: number;
  linkTaps: number;
  items: ItemStats[];
};

export type Summary = {
  reach: number;
  likes: number;
  comments: number;
  saves: number;
  itemOpens: number;
  linkTaps: number;
  newFollowers: number;
  posts: { postId: string; reach: number; likes: number; linkTaps: number }[];
};

export async function fetchPostStats(postId: string): Promise<PostStats> {
  const [r] = unwrap(await supabase.rpc('post_stats', { p_post_id: postId }));
  const items = (r.items ?? []) as { item_id: string; title: string; url_host: string | null; opens: number; link_taps: number; wishlist: number }[];
  return {
    reach: r.reach,
    views: r.views,
    likes: r.likes,
    comments: r.comments,
    saves: r.saves,
    itemOpens: r.item_opens,
    linkTaps: r.link_taps,
    items: items.map((i) => ({
      itemId: i.item_id,
      title: i.title,
      urlHost: i.url_host,
      opens: Number(i.opens),
      linkTaps: Number(i.link_taps),
      wishlist: Number(i.wishlist),
    })),
  };
}

export async function fetchSummary(days: number): Promise<Summary> {
  const [r] = unwrap(await supabase.rpc('my_stats', { p_days: days }));
  const posts = (r.posts ?? []) as { post_id: string; reach: number; likes: number; link_taps: number }[];
  return {
    reach: r.reach,
    likes: r.likes,
    comments: r.comments,
    saves: r.saves,
    itemOpens: r.item_opens,
    linkTaps: r.link_taps,
    newFollowers: r.new_followers,
    posts: posts.map((p) => ({ postId: p.post_id, reach: Number(p.reach), likes: Number(p.likes), linkTaps: Number(p.link_taps) })),
  };
}

export async function recordItemEvent(postId: string, itemId: string, kind: 'open' | 'link'): Promise<void> {
  check(await supabase.rpc('record_item_event', { p_post_id: postId, p_item_id: itemId, p_kind: kind }));
}

// Views are batched: posts are queued as they scroll into view and sent every
// few seconds, at most once per post per app session.
const FLUSH_MS = 4000;
const sent = new Set<string>();
let queue: string[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;

async function flush() {
  timer = null;
  const ids = queue.splice(0, 50);
  if (!ids.length) return;
  try {
    check(await supabase.rpc('record_post_views', { p_post_ids: ids }));
  } catch {
    // Stats are best effort; a lost batch only undercounts.
  }
  if (queue.length) timer = setTimeout(flush, FLUSH_MS);
}

export function trackView(postId: string) {
  if (sent.has(postId)) return;
  sent.add(postId);
  queue.push(postId);
  if (!timer) timer = setTimeout(flush, FLUSH_MS);
}

/** For tests. */
export function resetViewTracking() {
  sent.clear();
  queue = [];
  if (timer) clearTimeout(timer);
  timer = null;
}

export { flush as flushViews };

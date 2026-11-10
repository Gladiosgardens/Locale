import { check, unwrap } from '@/lib/errors';
import { supabase } from '@/lib/supabase';

export type Answer = {
  id: string;
  answerer: { id: string; handle: string; displayName: string };
  title: string;
  storeName: string | null;
  url: string | null;
  urlHost: string | null;
  priceCents: number | null;
  currency: string | null;
  note: string | null;
  accepted: boolean;
  createdAt: string;
  isMine: boolean;
  canAccept: boolean;
};

export async function listAnswers(postId: string): Promise<Answer[]> {
  const rows = unwrap(await supabase.rpc('list_answers', { p_post_id: postId }));
  return rows.map((r) => ({
    id: r.id,
    answerer: { id: r.answerer_id, handle: r.answerer_handle, displayName: r.answerer_display_name },
    title: r.title,
    storeName: r.store_name,
    url: r.url,
    urlHost: r.url_host,
    priceCents: r.price_cents,
    currency: r.currency,
    note: r.note,
    accepted: r.status === 'accepted',
    createdAt: r.created_at,
    isMine: r.is_mine,
    canAccept: r.can_accept,
  }));
}

export type AnswerDraft = {
  title: string;
  url?: string;
  storeName?: string;
  priceCents?: number | null;
  currency?: string;
  note?: string;
};

export async function submitAnswer(postId: string, d: AnswerDraft): Promise<string> {
  return unwrap(
    await supabase.rpc('submit_answer', {
      p_post_id: postId,
      p_title: d.title.trim(),
      ...(d.url?.trim() ? { p_url: d.url.trim() } : {}),
      ...(d.storeName?.trim() ? { p_store_name: d.storeName.trim() } : {}),
      ...(d.priceCents != null ? { p_price_cents: d.priceCents, p_currency: d.currency ?? 'USD' } : {}),
      ...(d.note?.trim() ? { p_note: d.note.trim() } : {}),
    }),
  );
}

export async function acceptAnswer(id: string): Promise<void> {
  check(await supabase.rpc('accept_answer', { p_answer_id: id }));
}

export async function deleteAnswer(id: string): Promise<void> {
  check(await supabase.rpc('delete_answer', { p_answer_id: id }));
}

export async function setAsking(postId: string, asking: boolean): Promise<void> {
  check(await supabase.rpc('set_post_asking', { p_post_id: postId, p_asking: asking }));
}

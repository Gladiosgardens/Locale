import { invokeFn } from '@/features/posts/api';
import { thumbnailUrl } from '@/features/video/mux';
import { unwrap } from '@/lib/errors';
import { supabase } from '@/lib/supabase';

export type EarningsSummary = {
  pendingCents: number;
  availableCents: number;
  paidCents: number;
  sharePercent: number;
  minimumPayoutCents: number;
  nextPayoutOn: string;
  hasAccount: boolean;
  detailsSubmitted: boolean;
  payoutsEnabled: boolean;
  country: string | null;
};

export type SaleStatus = 'pending' | 'available' | 'processing' | 'paid' | 'reversed';

export type Sale = {
  id: string;
  occurredAt: string;
  status: SaleStatus;
  earnedCents: number;
  saleCents: number | null;
  postId: string | null;
  itemTitle: string | null;
  thumb: string | null;
};

export type Payout = { id: string; amountCents: number; status: 'processing' | 'paid' | 'failed'; createdAt: string };

export function formatUsd(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  return `${sign}$${(Math.abs(cents) / 100).toFixed(2)}`;
}

export async function fetchSummary(): Promise<EarningsSummary> {
  const [r] = unwrap(await supabase.rpc('my_earnings_summary'));
  return {
    pendingCents: r.pending_cents,
    availableCents: r.available_cents,
    paidCents: r.paid_cents,
    sharePercent: r.share_percent,
    minimumPayoutCents: r.minimum_payout_cents,
    nextPayoutOn: r.next_payout_on,
    hasAccount: r.has_account,
    detailsSubmitted: r.details_submitted,
    payoutsEnabled: r.payouts_enabled,
    country: r.country,
  };
}

export async function fetchSales(): Promise<Sale[]> {
  const rows = unwrap(await supabase.rpc('my_commissions', { p_limit: 50 }));
  const paths = [...new Set(rows.map((r) => r.post_media_path).filter((p): p is string => !!p))];
  const urls = new Map<string, string>();
  if (paths.length) {
    const signed = unwrap(await supabase.storage.from('post-media').createSignedUrls(paths, 3600));
    for (const s of signed) if (s.path && s.signedUrl) urls.set(s.path, s.signedUrl);
  }
  return rows.map((r) => ({
    id: r.id,
    occurredAt: r.occurred_at,
    status: r.status as SaleStatus,
    earnedCents: r.creator_cents,
    saleCents: r.sale_cents,
    postId: r.post_id,
    itemTitle: r.item_title,
    thumb: r.post_playback_id ? thumbnailUrl(r.post_playback_id, 200) : r.post_media_path ? (urls.get(r.post_media_path) ?? null) : null,
  }));
}

export async function fetchPayouts(): Promise<Payout[]> {
  const rows = unwrap(await supabase.rpc('my_payouts'));
  return rows.map((r) => ({ id: r.id, amountCents: r.amount_cents, status: r.status as Payout['status'], createdAt: r.created_at }));
}

export async function fetchPostEarnings(postId: string): Promise<{ sales: number; earnedCents: number }> {
  const [r] = unwrap(await supabase.rpc('post_earnings', { p_post_id: postId }));
  return { sales: r?.sales ?? 0, earnedCents: r?.earned_cents ?? 0 };
}

/** The link to open for a tagged item (tracked so the poster can earn). */
export async function shopLink(postId: string, itemId: string): Promise<string> {
  const res = await invokeFn<{ url: string }>('shop-link', { postId, itemId }, 'link_failed');
  return res.url;
}

export async function startPayoutSetup(country: string): Promise<string> {
  return (await invokeFn<{ url: string }>('stripe-connect', { action: 'onboard', country }, 'payouts_failed')).url;
}

export async function refreshPayoutAccount(): Promise<void> {
  await invokeFn('stripe-connect', { action: 'status' }, 'payouts_failed');
}

export async function payoutDashboard(): Promise<string> {
  return (await invokeFn<{ url: string }>('stripe-connect', { action: 'dashboard' }, 'payouts_failed')).url;
}

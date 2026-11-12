import { useMutation, useQuery } from '@tanstack/react-query';
import { invokeFn } from '@/features/posts/api';
import { unwrap } from '@/lib/errors';
import { supabase } from '@/lib/supabase';

export type DeletionSummary = { handle: string; postCount: number; unpaidCents: number; payoutInProgress: boolean };

export async function fetchDeletionSummary(): Promise<DeletionSummary | null> {
  const [r] = unwrap(await supabase.rpc('account_deletion_summary'));
  return r ? { handle: r.handle, postCount: r.post_count, unpaidCents: r.unpaid_cents, payoutInProgress: r.payout_in_progress } : null;
}

/** Deletes the account on the server, then clears the session on this phone. */
export async function deleteAccount(confirm: string): Promise<void> {
  await invokeFn('delete-account', { confirm }, 'delete_failed');
  await supabase.auth.signOut({ scope: 'local' });
}

export function useDeletionSummary() {
  return useQuery({ queryKey: ['account', 'deletion'], queryFn: fetchDeletionSummary });
}

export function useDeleteAccount() {
  return useMutation({ mutationFn: deleteAccount });
}

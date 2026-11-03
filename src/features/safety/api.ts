import { check, unwrap } from '@/lib/errors';
import { supabase } from '@/lib/supabase';

export type ReportTarget = 'post' | 'profile' | 'group';
export type ReportReason =
  | 'spam' | 'harassment' | 'nudity' | 'child_safety' | 'violence' | 'hate' | 'scam' | 'other';

export const REPORT_REASONS: { value: ReportReason; label: string; hint?: string }[] = [
  { value: 'child_safety', label: 'Child safety', hint: 'Hidden right away while we review' },
  { value: 'harassment', label: 'Harassment or bullying' },
  { value: 'nudity', label: 'Nudity or sexual content' },
  { value: 'violence', label: 'Violence or threats' },
  { value: 'hate', label: 'Hate speech' },
  { value: 'scam', label: 'Scam or fraud' },
  { value: 'spam', label: 'Spam' },
  { value: 'other', label: 'Something else' },
];

export type BlockedProfile = { profileId: string; handle: string; displayName: string };

export async function blockUser(profileId: string): Promise<void> {
  check(await supabase.rpc('block_user', { p_profile_id: profileId }));
}

export async function unblockUser(profileId: string): Promise<void> {
  check(await supabase.rpc('unblock_user', { p_profile_id: profileId }));
}

export async function listBlocked(): Promise<BlockedProfile[]> {
  const rows = unwrap(await supabase.rpc('my_blocked_profiles'));
  return rows.map((r) => ({ profileId: r.profile_id, handle: r.handle, displayName: r.display_name }));
}

export async function report(input: {
  targetType: ReportTarget;
  targetId: string;
  reason: ReportReason;
  details?: string;
}): Promise<void> {
  check(
    await supabase.rpc('report_content', {
      p_target_type: input.targetType,
      p_target_id: input.targetId,
      p_reason: input.reason,
      ...(input.details?.trim() ? { p_details: input.details.trim() } : {}),
    }),
  );
}

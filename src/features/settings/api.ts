import { check, unwrap } from '@/lib/errors';
import { supabase } from '@/lib/supabase';

export type DmPolicy = 'everyone' | 'connections';
export type PrivateSettings = {
  dmPolicy: DmPolicy;
  notifyMessages: boolean;
  notifyGroups: boolean;
  notifyFollows: boolean;
  notifyComments: boolean;
  notifyMentions: boolean;
  findableByEmail: boolean;
  shoppingDefault: boolean;
};

export async function getPrivateSettings(userId: string): Promise<PrivateSettings> {
  const result = await supabase
    .from('profile_private')
    .select('dm_policy, notify_messages, notify_groups, notify_follows, notify_comments, notify_mentions, findable_by_email, shopping_default')
    .eq('profile_id', userId)
    .maybeSingle();
  const row = unwrap(result) as {
    dm_policy: string;
    notify_messages: boolean;
    notify_groups: boolean;
    notify_follows: boolean;
    notify_comments: boolean;
    notify_mentions: boolean;
    findable_by_email: boolean;
    shopping_default: boolean;
  } | null;
  return {
    dmPolicy: (row?.dm_policy ?? 'everyone') as DmPolicy,
    notifyMessages: row?.notify_messages ?? true,
    notifyGroups: row?.notify_groups ?? true,
    notifyFollows: row?.notify_follows ?? true,
    notifyComments: row?.notify_comments ?? true,
    notifyMentions: row?.notify_mentions ?? true,
    findableByEmail: row?.findable_by_email ?? true,
    shoppingDefault: row?.shopping_default ?? true,
  };
}

export async function setDmPolicy(policy: DmPolicy): Promise<void> {
  check(await supabase.rpc('set_dm_policy', { p_policy: policy }));
}

export async function setShoppingDefault(enabled: boolean): Promise<void> {
  check(await supabase.rpc('set_shopping_default', { p_enabled: enabled }));
}

export async function setFindableByEmail(findable: boolean): Promise<void> {
  check(await supabase.rpc('set_findable_by_email', { p_findable: findable }));
}

export async function setNotificationPreferences(prefs: {
  messages?: boolean;
  groups?: boolean;
  follows?: boolean;
  comments?: boolean;
  mentions?: boolean;
}): Promise<void> {
  check(
    await supabase.rpc('set_notification_preferences', {
      ...(prefs.messages != null ? { p_messages: prefs.messages } : {}),
      ...(prefs.groups != null ? { p_groups: prefs.groups } : {}),
      ...(prefs.follows != null ? { p_follows: prefs.follows } : {}),
      ...(prefs.comments != null ? { p_comments: prefs.comments } : {}),
      ...(prefs.mentions != null ? { p_mentions: prefs.mentions } : {}),
    }),
  );
}

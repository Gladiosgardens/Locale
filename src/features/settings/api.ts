import { check, unwrap } from '@/lib/errors';
import { supabase } from '@/lib/supabase';

export type DmPolicy = 'everyone' | 'connections';
export type PrivateSettings = { dmPolicy: DmPolicy; notifyMessages: boolean; notifyGroups: boolean };

export async function getPrivateSettings(userId: string): Promise<PrivateSettings> {
  const result = await supabase
    .from('profile_private')
    .select('dm_policy, notify_messages, notify_groups')
    .eq('profile_id', userId)
    .maybeSingle();
  const row = unwrap(result) as { dm_policy: string; notify_messages: boolean; notify_groups: boolean } | null;
  return {
    dmPolicy: (row?.dm_policy ?? 'everyone') as DmPolicy,
    notifyMessages: row?.notify_messages ?? true,
    notifyGroups: row?.notify_groups ?? true,
  };
}

export async function setDmPolicy(policy: DmPolicy): Promise<void> {
  check(await supabase.rpc('set_dm_policy', { p_policy: policy }));
}

export async function setNotificationPreferences(prefs: { messages?: boolean; groups?: boolean }): Promise<void> {
  check(
    await supabase.rpc('set_notification_preferences', {
      ...(prefs.messages != null ? { p_messages: prefs.messages } : {}),
      ...(prefs.groups != null ? { p_groups: prefs.groups } : {}),
    }),
  );
}

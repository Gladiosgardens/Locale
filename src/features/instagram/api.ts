import { invokeFn } from '@/features/posts/api';
import { check, unwrap } from '@/lib/errors';
import { supabase } from '@/lib/supabase';

export type IgStatus = { connected: boolean; username: string | null; imported: number };
export type IgPost = { id: string; caption: string | null; takenAt: string; thumbnail: string; images: string[]; imported: boolean };

export async function fetchStatus(): Promise<IgStatus> {
  const [r] = unwrap(await supabase.rpc('my_instagram'));
  return { connected: r?.connected ?? false, username: r?.username ?? null, imported: r?.imported ?? 0 };
}

export async function connectUrl(): Promise<string> {
  return (await invokeFn<{ url: string }>('instagram-connect', { action: 'start' }, 'instagram_failed')).url;
}

export async function fetchMedia(after: string | null): Promise<{ posts: IgPost[]; after: string | null }> {
  return invokeFn('instagram-connect', { action: 'media', ...(after ? { after } : {}) }, 'instagram_failed');
}

export const MAX_IMPORT = 10;

export async function importPosts(ids: string[]): Promise<{ imported: string[]; skipped: { id: string; reason: string }[] }> {
  return invokeFn('instagram-connect', { action: 'import', ids }, 'instagram_failed');
}

export async function disconnect(): Promise<void> {
  check(await supabase.rpc('disconnect_instagram'));
}

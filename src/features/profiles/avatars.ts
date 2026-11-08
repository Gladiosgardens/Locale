import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

// Profile photos are looked up by user id. Requests made in the same moment
// (a feed full of authors, say) are combined into one query.

let pending: Map<string, ((path: string | null) => void)[]> | null = null;

function flush(batch: Map<string, ((path: string | null) => void)[]>) {
  const ids = [...batch.keys()];
  void supabase
    .from('profiles')
    .select('id, avatar_path')
    .in('id', ids)
    .then(({ data }) => {
      const found = new Map((data ?? []).map((r) => [r.id as string, (r.avatar_path as string | null) ?? null]));
      for (const [id, resolvers] of batch) for (const resolve of resolvers) resolve(found.get(id) ?? null);
    });
}

export function loadAvatarPath(userId: string): Promise<string | null> {
  return new Promise((resolve) => {
    if (!pending) {
      pending = new Map();
      const batch = pending;
      setTimeout(() => {
        pending = null;
        flush(batch);
      }, 10);
    }
    pending.set(userId, [...(pending.get(userId) ?? []), resolve]);
  });
}

export function avatarUrl(path: string | null | undefined): string | null {
  return path ? supabase.storage.from('avatars').getPublicUrl(path).data.publicUrl : null;
}

export function useAvatarUrl(userId: string | null | undefined) {
  const q = useQuery({
    queryKey: ['avatar', userId],
    queryFn: () => loadAvatarPath(userId!),
    enabled: !!userId,
    staleTime: 10 * 60_000,
  });
  return avatarUrl(q.data);
}

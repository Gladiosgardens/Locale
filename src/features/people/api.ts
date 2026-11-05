import { CryptoDigestAlgorithm, digestStringAsync } from 'expo-crypto';
import { unwrap } from '@/lib/errors';
import { supabase } from '@/lib/supabase';

export const MIN_PEOPLE_QUERY = 2;
export const MAX_CONTACT_HASHES = 1000;

export type Person = {
  id: string;
  handle: string;
  displayName: string;
  iFollow: boolean;
  /** Why we're showing them, in words (e.g. "Follows you"). */
  note: string | null;
};

export async function searchPeople(query: string): Promise<Person[]> {
  const rows = unwrap(await supabase.rpc('search_people', { p_query: query.trim(), p_limit: 30 }));
  return rows.map((r) => ({
    id: r.id,
    handle: r.handle,
    displayName: r.display_name,
    iFollow: r.i_follow,
    note: r.follows_me ? 'Follows you' : null,
  }));
}

export function suggestionNote(r: { reason: string; mutual_count: number; mutual_name: string | null }): string {
  switch (r.reason) {
    case 'follows_you':
      return 'Follows you';
    case 'mutual':
      if (r.mutual_name && r.mutual_count > 1) return `Followed by ${r.mutual_name} and ${r.mutual_count - 1} more`;
      return r.mutual_name ? `Followed by ${r.mutual_name}` : 'Friends with people you follow';
    case 'popular':
      return 'Popular on Locale';
    default:
      return 'New on Locale';
  }
}

export async function suggestedPeople(): Promise<Person[]> {
  const rows = unwrap(await supabase.rpc('suggested_people', { p_limit: 30 }));
  return rows.map((r) => ({
    id: r.id,
    handle: r.handle,
    displayName: r.display_name,
    iFollow: false,
    note: suggestionNote(r),
  }));
}

export const normalizeEmail = (email: string) => email.trim().toLowerCase();

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** SHA-256 (hex) of each distinct, valid email, so the addresses themselves never leave the phone. */
export async function hashEmails(emails: string[]): Promise<string[]> {
  const unique = [...new Set(emails.map(normalizeEmail).filter((e) => EMAIL.test(e)))].slice(0, MAX_CONTACT_HASHES);
  return Promise.all(unique.map((e) => digestStringAsync(CryptoDigestAlgorithm.SHA256, e)));
}

export async function matchContacts(hashes: string[]): Promise<Person[]> {
  if (!hashes.length) return [];
  const rows = unwrap(await supabase.rpc('match_contacts', { p_hashes: hashes }));
  return rows.map((r) => ({ id: r.id, handle: r.handle, displayName: r.display_name, iFollow: r.i_follow, note: 'In your contacts' }));
}

export async function profileIdByHandle(handle: string): Promise<string | null> {
  const clean = handle.trim().replace(/^@/, '').toLowerCase();
  if (!/^[a-z0-9_]{3,20}$/.test(clean)) return null;
  const { data } = await supabase.from('profiles').select('id').eq('handle', clean).maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}

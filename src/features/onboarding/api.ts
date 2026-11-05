import { check, unwrap } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import type { Tables } from '@/lib/database.types';

export type Area = Tables<'areas'>;
export type Interest = Tables<'interests'>;

export type MyProfile = Tables<'profiles'> & {
  area: Pick<Area, 'id' | 'name'> | null;
  interestIds: number[];
};

export async function fetchMyProfile(userId: string): Promise<MyProfile> {
  const [profile, priv, interests] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', userId).single(),
    supabase.from('profile_private').select('area:areas(id, name)').eq('profile_id', userId).single(),
    supabase.from('profile_interests').select('interest_id').eq('profile_id', userId),
  ]);
  return {
    ...unwrap(profile),
    area: unwrap(priv).area ?? null,
    interestIds: unwrap(interests).map((r) => r.interest_id),
  };
}

export async function fetchInterests(): Promise<Interest[]> {
  return unwrap(await supabase.from('interests').select('*').eq('active', true).order('sort_order'));
}

export async function searchAreas(query: string): Promise<Pick<Area, 'id' | 'name'>[]> {
  const q = query.trim();
  let request = supabase.from('areas').select('id, name').order('name').limit(20);
  if (q) request = request.ilike('name', `%${q.replace(/[%_]/g, '')}%`);
  return unwrap(await request);
}

export async function setAreaFromCell(geohash5: string, name: string): Promise<Area> {
  return unwrap(await supabase.rpc('set_my_area', { p_geohash5: geohash5, p_name: name }));
}

export async function chooseArea(areaId: string): Promise<Area> {
  return unwrap(await supabase.rpc('choose_area', { p_area_id: areaId }));
}

export async function setMyInterests(ids: number[]): Promise<void> {
  check(await supabase.rpc('set_my_interests', { p_interest_ids: ids }));
}

export async function completeOnboarding(input: {
  handle: string;
  displayName: string;
  confirmAdult: boolean;
}): Promise<Tables<'profiles'>> {
  return unwrap(
    await supabase.rpc('complete_onboarding', {
      p_handle: input.handle,
      p_display_name: input.displayName,
      p_confirm_adult: input.confirmAdult,
    }),
  );
}

-- Core-loop step 1: profiles, coarse areas, interests, onboarding.
--
-- Privacy rule: the server never receives a user's coordinates. The app sends a
-- 5-character geohash (~4.9 km x 4.9 km cell) and the server derives the cell
-- centre itself. Area and onboarding state change only through the RPCs below.

------------------------------------------------------------------------------
-- Helpers
------------------------------------------------------------------------------

-- Centre of a geohash cell. Used so the stored point is the cell centre, never
-- anything the client supplies.
create function public.geohash_center(
  p_hash text,
  out lat double precision,
  out lng double precision
)
language plpgsql
immutable
strict
set search_path = ''
as $$
declare
  base32 constant text := '0123456789bcdefghjkmnpqrstuvwxyz';
  lat_lo double precision := -90;
  lat_hi double precision := 90;
  lng_lo double precision := -180;
  lng_hi double precision := 180;
  is_lng boolean := true;
  idx int;
  mid double precision;
begin
  for i in 1..length(p_hash) loop
    idx := strpos(base32, substr(p_hash, i, 1)) - 1;
    if idx < 0 then
      raise exception 'invalid_geohash' using errcode = '22023';
    end if;
    for b in reverse 4..0 loop
      if is_lng then
        mid := (lng_lo + lng_hi) / 2;
        if ((idx >> b) & 1) = 1 then lng_lo := mid; else lng_hi := mid; end if;
      else
        mid := (lat_lo + lat_hi) / 2;
        if ((idx >> b) & 1) = 1 then lat_lo := mid; else lat_hi := mid; end if;
      end if;
      is_lng := not is_lng;
    end loop;
  end loop;
  lat := (lat_lo + lat_hi) / 2;
  lng := (lng_lo + lng_hi) / 2;
end;
$$;

-- At most 5 area changes per rolling 24h, so the area table can't be spammed
-- and nobody can hop between neighborhoods to scout them.
create function public.record_area_change(p_uid uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select count(*) from public.area_changes
      where profile_id = p_uid and created_at > now() - interval '24 hours') >= 5 then
    raise exception 'area_rate_limited' using errcode = 'P0001';
  end if;
  insert into public.area_changes (profile_id) values (p_uid);
end;
$$;

create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

------------------------------------------------------------------------------
-- Tables
------------------------------------------------------------------------------

create table public.areas (
  id uuid primary key default gen_random_uuid(),
  geohash5 text not null unique
    check (geohash5 ~ '^[0-9b-hjkmnp-z]{5}$'),
  name text not null
    check (name = btrim(name) and char_length(name) between 2 and 60),
  center_lat double precision not null check (center_lat between -90 and 90),
  center_lng double precision not null check (center_lng between -180 and 180),
  created_at timestamptz not null default now()
);
create index areas_name_lower_idx on public.areas (lower(name));

create table public.interests (
  id smallint generated always as identity primary key,
  slug text not null unique check (slug ~ '^[a-z0-9-]{2,40}$'),
  label text not null check (char_length(label) between 2 and 40),
  sort_order smallint not null default 0
);

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  handle text unique
    check (handle ~ '^[a-z0-9_]{3,20}$')
    constraint profiles_handle_not_reserved check (handle not in (
      'admin', 'administrator', 'support', 'help', 'locale', 'official', 'staff',
      'moderator', 'mod', 'security', 'system', 'root', 'team', 'null', 'undefined'
    )),
  display_name text
    check (display_name = btrim(display_name) and char_length(display_name) between 1 and 50),
  bio text check (char_length(bio) <= 300),
  onboarded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_onboarded_complete check (
    onboarded_at is null or (handle is not null and display_name is not null)
  )
);

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- Owner-only data. Kept out of `profiles` so no one can list "everyone in
-- area X" or combine area with family-related interests.
create table public.profile_private (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  area_id uuid references public.areas (id) on delete set null,
  adult_confirmed_at timestamptz,
  updated_at timestamptz not null default now()
);
create index profile_private_area_id_idx on public.profile_private (area_id);

create trigger profile_private_set_updated_at
  before update on public.profile_private
  for each row execute function public.set_updated_at();

-- Server-only log used to rate-limit area changes (no client access at all).
create table public.area_changes (
  profile_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index area_changes_profile_created_idx on public.area_changes (profile_id, created_at desc);

create table public.profile_interests (
  profile_id uuid not null references public.profiles (id) on delete cascade,
  interest_id smallint not null references public.interests (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (profile_id, interest_id)
);
create index profile_interests_interest_id_idx on public.profile_interests (interest_id);

------------------------------------------------------------------------------
-- Profile row for every new auth user
------------------------------------------------------------------------------

create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id) values (new.id);
  insert into public.profile_private (profile_id) values (new.id);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

------------------------------------------------------------------------------
-- Privileges and RLS
------------------------------------------------------------------------------

alter table public.areas enable row level security;
alter table public.interests enable row level security;
alter table public.profiles enable row level security;
alter table public.profile_private enable row level security;
alter table public.profile_interests enable row level security;
alter table public.area_changes enable row level security;

-- Start from nothing, then grant exactly what the app needs.
revoke all on public.areas, public.interests, public.profiles, public.profile_private,
  public.profile_interests, public.area_changes from anon, authenticated;

grant select on public.interests to anon, authenticated;
grant select on public.areas to authenticated;
grant select on public.profiles to authenticated;
grant update (handle, display_name, bio) on public.profiles to authenticated;
grant select on public.profile_private to authenticated;
grant select on public.profile_interests to authenticated;

create policy "interests are public"
  on public.interests for select
  to anon, authenticated
  using (true);

create policy "signed-in users can read areas"
  on public.areas for select
  to authenticated
  using (true);

create policy "read own profile or onboarded profiles"
  on public.profiles for select
  to authenticated
  using (id = (select auth.uid()) or onboarded_at is not null);

create policy "update own profile"
  on public.profiles for update
  to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

create policy "read own private profile"
  on public.profile_private for select
  to authenticated
  using (profile_id = (select auth.uid()));

-- Owner-only for now. Matching people by interest goes through groups later,
-- never a browsable list of who picked what.
create policy "read own interests"
  on public.profile_interests for select
  to authenticated
  using (profile_id = (select auth.uid()));

-- Trigger/helper functions are not callable by clients.
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.set_updated_at() from public, anon, authenticated;
revoke execute on function public.record_area_change(uuid) from public, anon, authenticated;

------------------------------------------------------------------------------
-- RPCs (the only write path for areas, interests and onboarding state)
------------------------------------------------------------------------------

-- Join (or create) the area for a geohash-5 cell. The first person to create
-- an area names it from their device's reverse-geocoded neighborhood/city.
create function public.set_my_area(p_geohash5 text, p_name text)
returns public.areas
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_hash text := lower(btrim(p_geohash5));
  v_name text := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
  v_center record;
  v_area public.areas;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if v_hash !~ '^[0-9b-hjkmnp-z]{5}$' then
    raise exception 'invalid_geohash' using errcode = '22023';
  end if;
  if char_length(v_name) not between 2 and 60 then
    raise exception 'invalid_area_name' using errcode = '22023';
  end if;

  perform public.record_area_change(v_uid);
  v_center := public.geohash_center(v_hash);

  insert into public.areas (geohash5, name, center_lat, center_lng)
  values (v_hash, v_name, v_center.lat, v_center.lng)
  on conflict (geohash5) do nothing;

  select * into v_area from public.areas where geohash5 = v_hash;

  update public.profile_private set area_id = v_area.id where profile_id = v_uid;
  return v_area;
end;
$$;

-- Fallback when location is denied: pick an existing area.
create function public.choose_area(p_area_id uuid)
returns public.areas
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_area public.areas;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  select * into v_area from public.areas where id = p_area_id;
  if not found then
    raise exception 'area_not_found' using errcode = 'P0002';
  end if;
  perform public.record_area_change(v_uid);
  update public.profile_private set area_id = v_area.id where profile_id = v_uid;
  return v_area;
end;
$$;

-- Replace the caller's interests. Always 3-15 distinct, existing interests.
create function public.set_my_interests(p_interest_ids smallint[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_ids smallint[];
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  select coalesce(array_agg(distinct x), '{}') into v_ids
  from unnest(coalesce(p_interest_ids, '{}')) as x;
  if cardinality(v_ids) not between 3 and 15 then
    raise exception 'interest_count' using errcode = '22023';
  end if;
  if (select count(*) from public.interests where id = any (v_ids)) <> cardinality(v_ids) then
    raise exception 'unknown_interest' using errcode = '22023';
  end if;

  delete from public.profile_interests
  where profile_id = v_uid and interest_id <> all (v_ids);

  insert into public.profile_interests (profile_id, interest_id)
  select v_uid, x from unnest(v_ids) as x
  on conflict do nothing;
end;
$$;

-- Final onboarding step. Requires an area, >= 3 interests and an 18+ confirmation.
create function public.complete_onboarding(
  p_handle text,
  p_display_name text,
  p_confirm_adult boolean
)
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_profile public.profiles;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if p_confirm_adult is not true then
    raise exception 'adult_required' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.profile_private where profile_id = v_uid and area_id is not null
  ) then
    raise exception 'area_required' using errcode = '22023';
  end if;
  if (select count(*) from public.profile_interests where profile_id = v_uid) < 3 then
    raise exception 'interest_count' using errcode = '22023';
  end if;

  begin
    update public.profiles
    set handle = lower(btrim(p_handle)),
        display_name = btrim(p_display_name),
        onboarded_at = coalesce(onboarded_at, now())
    where id = v_uid
    returning * into v_profile;
  exception
    when unique_violation then
      raise exception 'handle_taken' using errcode = '23505';
    when check_violation then
      raise exception 'invalid_profile' using errcode = '23514';
  end;

  update public.profile_private
  set adult_confirmed_at = coalesce(adult_confirmed_at, now())
  where profile_id = v_uid;

  return v_profile;
end;
$$;

revoke execute on function public.set_my_area(text, text) from public, anon;
revoke execute on function public.choose_area(uuid) from public, anon;
revoke execute on function public.set_my_interests(smallint[]) from public, anon;
revoke execute on function public.complete_onboarding(text, text, boolean) from public, anon;
grant execute on function public.set_my_area(text, text) to authenticated;
grant execute on function public.choose_area(uuid) to authenticated;
grant execute on function public.set_my_interests(smallint[]) to authenticated;
grant execute on function public.complete_onboarding(text, text, boolean) to authenticated;

------------------------------------------------------------------------------
-- Reference data
------------------------------------------------------------------------------

insert into public.interests (slug, label, sort_order) values
  ('dogs', 'Dogs', 10),
  ('cats', 'Cats', 20),
  ('toddlers', 'Toddlers', 30),
  ('school-age-kids', 'School-age kids', 40),
  ('teens', 'Parenting teens', 50),
  ('running', 'Running', 60),
  ('hiking', 'Hiking', 70),
  ('cycling', 'Cycling', 80),
  ('yoga', 'Yoga', 90),
  ('gardening', 'Gardening', 100),
  ('cooking', 'Cooking', 110),
  ('coffee', 'Coffee', 120),
  ('interior-design', 'Interior design', 130),
  ('fashion', 'Fashion', 140),
  ('beauty', 'Beauty & makeup', 150),
  ('thrifting', 'Thrifting & vintage', 160),
  ('books', 'Books', 170),
  ('board-games', 'Board games', 180),
  ('photography', 'Photography', 190),
  ('remote-work', 'Remote work', 200),
  ('new-in-town', 'New in town', 210);

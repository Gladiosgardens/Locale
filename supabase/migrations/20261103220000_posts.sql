-- Core-loop steps 2-3: photo posts and the nearby feed.
--
-- Visibility rule: a published post is readable only by its author and by
-- people whose area is the post's area or one of the 8 cells around it
-- (~15 km square). The rule lives in RLS, so it holds for direct table reads,
-- the feed function and storage downloads alike.
--
-- Write path: the app uploads JPEGs to a private holding bucket; the
-- `publish-post` Edge Function strips metadata, copies them into the media
-- bucket and calls create_post_record() with the service role.

------------------------------------------------------------------------------
-- Interests: flag family/children topics so the app can warn about faces
------------------------------------------------------------------------------

alter table public.interests add column is_family boolean not null default false;
update public.interests set is_family = true
where slug in ('toddlers', 'school-age-kids', 'teens');

-- Neighbouring cells are found by centre distance. Geohash-5 cells are
-- 0.0439 degrees on each side, so +/- 0.05 degrees selects the 3x3 block.
create index areas_center_idx on public.areas (center_lat, center_lng);

------------------------------------------------------------------------------
-- Tables
------------------------------------------------------------------------------

create table public.posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles (id) on delete cascade,
  area_id uuid not null references public.areas (id) on delete restrict,
  caption text check (char_length(caption) <= 2200),
  status text not null default 'published' check (status in ('published', 'removed')),
  published_at timestamptz not null default now(),
  removed_at timestamptz,
  constraint posts_removed_at check ((status = 'removed') = (removed_at is not null))
);
create index posts_feed_idx on public.posts (area_id, published_at desc, id desc)
  where status = 'published';
create index posts_author_idx on public.posts (author_id, published_at desc);

create table public.post_media (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts (id) on delete cascade,
  storage_path text not null unique,
  width int not null check (width between 1 and 8192),
  height int not null check (height between 1 and 8192),
  position smallint not null check (position between 0 and 9),
  unique (post_id, position)
);

create table public.post_interests (
  post_id uuid not null references public.posts (id) on delete cascade,
  interest_id smallint not null references public.interests (id) on delete cascade,
  primary key (post_id, interest_id)
);
create index post_interests_interest_idx on public.post_interests (interest_id);

------------------------------------------------------------------------------
-- Visibility helper
------------------------------------------------------------------------------

-- The caller's area plus the 8 surrounding cells. Security definer because it
-- reads the caller's own owner-only area row; it never takes a user id.
create function public.my_nearby_area_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select n.id
  from public.profile_private pp
  join public.areas mine on mine.id = pp.area_id
  join public.areas n
    on abs(n.center_lat - mine.center_lat) < 0.05
   and abs(n.center_lng - mine.center_lng) < 0.05
  where pp.profile_id = auth.uid()
$$;
revoke execute on function public.my_nearby_area_ids() from public, anon;
grant execute on function public.my_nearby_area_ids() to authenticated;

------------------------------------------------------------------------------
-- Privileges and RLS
------------------------------------------------------------------------------

alter table public.posts enable row level security;
alter table public.post_media enable row level security;
alter table public.post_interests enable row level security;

revoke all on public.posts, public.post_media, public.post_interests from anon, authenticated;
grant select on public.posts, public.post_media, public.post_interests to authenticated;

create policy "read own or nearby published posts"
  on public.posts for select
  to authenticated
  using (
    status = 'published'
    and (
      author_id = (select auth.uid())
      or area_id in (select public.my_nearby_area_ids())
    )
  );

-- Media and tags follow their post's visibility (posts RLS applies inside).
create policy "read media of visible posts"
  on public.post_media for select
  to authenticated
  using (exists (select 1 from public.posts p where p.id = post_media.post_id));

create policy "read tags of visible posts"
  on public.post_interests for select
  to authenticated
  using (exists (select 1 from public.posts p where p.id = post_interests.post_id));

------------------------------------------------------------------------------
-- Storage
------------------------------------------------------------------------------

-- Both buckets are private and JPEG-only. 10 MB is generous for a 2048 px JPEG.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('post-uploads', 'post-uploads', false, 10485760, array['image/jpeg']),
  ('post-media', 'post-media', false, 10485760, array['image/jpeg'])
on conflict (id) do nothing;

-- Users may only put files into their own folder of the holding bucket. No
-- one (but the service role) can read, overwrite or list holding files.
create policy "upload to own folder in post-uploads"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'post-uploads'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- Published images are readable exactly when their post is.
create policy "read media of visible posts"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'post-media'
    and exists (select 1 from public.post_media m where m.storage_path = objects.name)
  );

------------------------------------------------------------------------------
-- Write path
------------------------------------------------------------------------------

-- Called only by the publish-post Edge Function (service role) after it has
-- stripped metadata and written every image to post-media/<post id>/<n>.jpg.
create function public.create_post_record(
  p_post_id uuid,
  p_author_id uuid,
  p_caption text,
  p_interest_ids smallint[],
  p_media jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_area uuid;
  v_ids smallint[];
  v_caption text := nullif(btrim(coalesce(p_caption, '')), '');
  v_count int := jsonb_array_length(coalesce(p_media, '[]'::jsonb));
  m jsonb;
  i int := 0;
begin
  select pp.area_id into v_area
  from public.profile_private pp
  join public.profiles p on p.id = pp.profile_id
  where pp.profile_id = p_author_id and p.onboarded_at is not null;
  if v_area is null then
    raise exception 'not_onboarded' using errcode = '22023';
  end if;

  if (select count(*) from public.posts
      where author_id = p_author_id and published_at > now() - interval '24 hours') >= 20 then
    raise exception 'post_rate_limited' using errcode = 'P0001';
  end if;

  if v_count not between 1 and 10 then
    raise exception 'media_count' using errcode = '22023';
  end if;

  select coalesce(array_agg(distinct x), '{}') into v_ids
  from unnest(coalesce(p_interest_ids, '{}')) as x;
  if cardinality(v_ids) > 3 then
    raise exception 'too_many_interests' using errcode = '22023';
  end if;
  if (select count(*) from public.interests where id = any (v_ids)) <> cardinality(v_ids) then
    raise exception 'unknown_interest' using errcode = '22023';
  end if;

  insert into public.posts (id, author_id, area_id, caption)
  values (p_post_id, p_author_id, v_area, v_caption);

  for m in select value from jsonb_array_elements(p_media) loop
    if m ->> 'path' is distinct from p_post_id::text || '/' || i || '.jpg' then
      raise exception 'bad_media_path' using errcode = '22023';
    end if;
    if not exists (
      select 1 from storage.objects o where o.bucket_id = 'post-media' and o.name = m ->> 'path'
    ) then
      raise exception 'media_missing' using errcode = '22023';
    end if;
    insert into public.post_media (post_id, storage_path, width, height, position)
    values (p_post_id, m ->> 'path', (m ->> 'width')::int, (m ->> 'height')::int, i);
    i := i + 1;
  end loop;

  insert into public.post_interests (post_id, interest_id)
  select p_post_id, x from unnest(v_ids) as x;

  return p_post_id;
end;
$$;
revoke execute on function public.create_post_record(uuid, uuid, text, smallint[], jsonb)
  from public, anon, authenticated;
grant execute on function public.create_post_record(uuid, uuid, text, smallint[], jsonb)
  to service_role;

-- Authors can take a post down. Its images become unreadable immediately
-- because their visibility follows the post; files are purged later.
create function public.delete_my_post(p_post_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.posts
  set status = 'removed', removed_at = now()
  where id = p_post_id and author_id = auth.uid() and status = 'published';
  if not found then
    raise exception 'post_not_found' using errcode = 'P0002';
  end if;
end;
$$;
revoke execute on function public.delete_my_post(uuid) from public, anon;
grant execute on function public.delete_my_post(uuid) to authenticated;

------------------------------------------------------------------------------
-- Feed
------------------------------------------------------------------------------

-- Newest first, keyset-paginated on (published_at, id). Security invoker, so
-- the posts RLS above decides what is nearby.
create function public.nearby_feed(
  p_limit int default 20,
  p_before_published_at timestamptz default null,
  p_before_id uuid default null,
  p_interest_id smallint default null
)
returns table (
  id uuid,
  caption text,
  published_at timestamptz,
  author_id uuid,
  author_handle text,
  author_display_name text,
  area_name text,
  media jsonb,
  interest_ids smallint[]
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    p.id,
    p.caption,
    p.published_at,
    p.author_id,
    pr.handle,
    pr.display_name,
    a.name,
    coalesce(
      (select jsonb_agg(
                jsonb_build_object('path', m.storage_path, 'width', m.width, 'height', m.height)
                order by m.position)
       from public.post_media m where m.post_id = p.id),
      '[]'::jsonb),
    coalesce(
      (select array_agg(pi.interest_id order by pi.interest_id)
       from public.post_interests pi where pi.post_id = p.id),
      '{}'::smallint[])
  from public.posts p
  join public.profiles pr on pr.id = p.author_id
  join public.areas a on a.id = p.area_id
  where (p_before_published_at is null
         or (p.published_at, p.id) < (p_before_published_at, coalesce(p_before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
    and (p_interest_id is null
         or exists (select 1 from public.post_interests pi
                    where pi.post_id = p.id and pi.interest_id = p_interest_id))
  order by p.published_at desc, p.id desc
  limit least(greatest(coalesce(p_limit, 20), 1), 50)
$$;
revoke execute on function public.nearby_feed(int, timestamptz, uuid, smallint) from public, anon;
grant execute on function public.nearby_feed(int, timestamptz, uuid, smallint) to authenticated;

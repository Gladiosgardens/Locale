-- Core-loop step 6a: follows, profiles and the Following feed.
--
-- Follows are open (no approval). Profiles show follower/following counts but
-- not the lists, so nobody can scrape someone's social graph. The Following
-- feed and profile post lists go through discover_posts(), which already
-- applies every visibility rule (nearby-only, kid-tagged, groups, blocks).

create table public.follows (
  follower_id uuid not null references public.profiles (id) on delete cascade,
  followee_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, followee_id),
  constraint follows_not_self check (follower_id <> followee_id)
);
create index follows_followee_idx on public.follows (followee_id);
create index follows_follower_recent_idx on public.follows (follower_id, created_at desc);

alter table public.follows enable row level security;
revoke all on public.follows from anon, authenticated;
grant select on public.follows to authenticated;

-- Only rows that involve the caller: who I follow and who follows me.
create policy "see follows that involve me"
  on public.follows for select
  to authenticated
  using (follower_id = (select auth.uid()) or followee_id = (select auth.uid()));

create function public.follow_user(p_profile_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if p_profile_id = v_uid then
    raise exception 'cannot_follow_self' using errcode = '22023';
  end if;
  if not exists (select 1 from public.profiles where id = v_uid and onboarded_at is not null) then
    raise exception 'not_onboarded' using errcode = '22023';
  end if;
  if not exists (select 1 from public.profiles where id = p_profile_id and onboarded_at is not null)
     or p_profile_id in (select public.my_block_peers()) then
    raise exception 'profile_not_found' using errcode = 'P0002';
  end if;
  if (select count(*) from public.follows
      where follower_id = v_uid and created_at > now() - interval '24 hours') >= 200 then
    raise exception 'follow_rate_limited' using errcode = 'P0001';
  end if;
  insert into public.follows (follower_id, followee_id) values (v_uid, p_profile_id)
  on conflict do nothing;
end;
$$;

create function public.unfollow_user(p_profile_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.follows where follower_id = auth.uid() and followee_id = p_profile_id
$$;

create or replace function public.block_user(p_profile_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if p_profile_id = auth.uid() then
    raise exception 'cannot_block_self' using errcode = '22023';
  end if;
  if not exists (select 1 from public.profiles where id = p_profile_id) then
    raise exception 'profile_not_found' using errcode = 'P0002';
  end if;
  insert into public.blocks (blocker_id, blocked_id) values (auth.uid(), p_profile_id)
  on conflict do nothing;
  -- Blocking ends any follow relationship in both directions.
  delete from public.follows
  where (follower_id = auth.uid() and followee_id = p_profile_id)
     or (follower_id = p_profile_id and followee_id = auth.uid());
end;
$$;


-- A profile as the caller may see it, with counts and relationship flags.
create function public.profile_summary(p_profile_id uuid)
returns table (
  id uuid,
  handle text,
  display_name text,
  bio text,
  follower_count int,
  following_count int,
  i_follow boolean,
  follows_me boolean,
  is_me boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    p.id, p.handle, p.display_name, p.bio,
    (select count(*)::int from public.follows f where f.followee_id = p.id),
    (select count(*)::int from public.follows f where f.follower_id = p.id),
    exists (select 1 from public.follows f where f.follower_id = auth.uid() and f.followee_id = p.id),
    exists (select 1 from public.follows f where f.follower_id = p.id and f.followee_id = auth.uid()),
    p.id = auth.uid()
  from public.profiles p
  where p.id = p_profile_id
    and auth.uid() is not null
    and (p.id = auth.uid()
         or (p.onboarded_at is not null and p.id not in (select public.my_block_peers())))
$$;

revoke execute on function public.follow_user(uuid) from public, anon;
revoke execute on function public.unfollow_user(uuid) from public, anon;
revoke execute on function public.profile_summary(uuid) from public, anon;
grant execute on function public.follow_user(uuid) to authenticated;
grant execute on function public.unfollow_user(uuid) to authenticated;
grant execute on function public.profile_summary(uuid) to authenticated;

------------------------------------------------------------------------------
-- Discovery: add Following and per-author filters
------------------------------------------------------------------------------

drop function public.discover_posts(text, int, timestamptz, uuid);
create function public.discover_posts(
  p_query text default null,
  p_limit int default 20,
  p_before_published_at timestamptz default null,
  p_before_id uuid default null,
  p_following boolean default false,
  p_author_id uuid default null
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
  interest_ids smallint[],
  matched_item_ids uuid[]
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_query tsquery;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  if p_query is not null then
    select to_tsquery('simple', string_agg(quote_literal(w) || ':*', ' & '))
    into v_query
    from (
      select w from regexp_split_to_table(lower(p_query), '[^[:alnum:]]+') as w
      where char_length(w) >= 2
      limit 6
    ) words;
    if v_query is null then
      raise exception 'query_too_short' using errcode = '22023';
    end if;
  end if;

  return query
  with nearby as (select public.my_nearby_area_ids() as area_id),
  matches as (
    select pm.post_id, array_agg(distinct it.id) as item_ids
    from public.items it
    join public.item_tags t on t.item_id = it.id
    join public.post_media pm on pm.id = t.post_media_id
    where v_query is not null and it.search @@ v_query
    group by pm.post_id
  ),
  visible as (
    select p.*, mt.item_ids,
           (p.author_id = v_uid or p.area_id in (select area_id from nearby)) as is_nearby
    from public.posts p
    left join matches mt on mt.post_id = p.id
    where p.status = 'published'
      and p.group_id is null
      and p.author_id not in (select public.my_block_peers())
      and (not p_following or p.author_id in (
            select f.followee_id from public.follows f where f.follower_id = v_uid))
      and (p_author_id is null or p.author_id = p_author_id)
      and (v_query is null or mt.post_id is not null)
      and (p_before_published_at is null
           or (p.published_at, p.id) < (p_before_published_at,
               coalesce(p_before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
  )
  select
    v.id,
    v.caption,
    v.published_at,
    v.author_id,
    pr.handle,
    pr.display_name,
    case when v.is_nearby then a.name end,
    public.post_media_json(v.id),
    coalesce(
      (select array_agg(pi.interest_id order by pi.interest_id)
       from public.post_interests pi where pi.post_id = v.id),
      '{}'::smallint[]),
    coalesce(v.item_ids, '{}'::uuid[])
  from visible v
  join public.profiles pr on pr.id = v.author_id
  join public.areas a on a.id = v.area_id
  where v.is_nearby or public.post_is_globally_searchable(v.id)
  order by v.published_at desc, v.id desc
  limit least(greatest(coalesce(p_limit, 20), 1), 50);
end;
$$;
revoke execute on function public.discover_posts(text, int, timestamptz, uuid, boolean, uuid) from public, anon;
grant execute on function public.discover_posts(text, int, timestamptz, uuid, boolean, uuid) to authenticated;

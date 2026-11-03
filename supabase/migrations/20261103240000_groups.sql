-- Core-loop step 5: groups (one interest x the creator's area).
--
-- Public groups: anyone nearby sees the group and its posts; joining is instant.
-- Private groups: anyone nearby sees that the group exists; posts and the
-- member list are members-only; joining needs moderator approval. Groups with
-- a kid-related interest are always private.
--
-- Group posts live only in their group's feed: never in Nearby, Everywhere or
-- item search. Member lists are never visible to non-members.

------------------------------------------------------------------------------
-- Tables
------------------------------------------------------------------------------

create table public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (name = btrim(name) and char_length(name) between 3 and 60),
  description text check (char_length(description) <= 500),
  interest_id smallint not null references public.interests (id) on delete restrict,
  area_id uuid not null references public.areas (id) on delete restrict,
  privacy text not null check (privacy in ('public', 'private')),
  created_by uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index groups_area_idx on public.groups (area_id, interest_id);
create index groups_created_by_idx on public.groups (created_by, created_at desc);

create table public.group_members (
  group_id uuid not null references public.groups (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'moderator', 'member')),
  status text not null check (status in ('active', 'pending', 'banned')),
  requested_at timestamptz not null default now(),
  joined_at timestamptz,
  primary key (group_id, profile_id),
  constraint group_members_joined check ((status = 'active') = (joined_at is not null)),
  constraint group_members_owner_active check (role <> 'owner' or status = 'active')
);
create index group_members_profile_idx on public.group_members (profile_id, status);
create unique index group_members_one_owner on public.group_members (group_id) where role = 'owner';

alter table public.posts add column group_id uuid references public.groups (id) on delete cascade;
alter table public.posts add constraint posts_group_not_searchable check (group_id is null or not searchable);
create index posts_group_feed_idx on public.posts (group_id, published_at desc, id desc)
  where status = 'published' and group_id is not null;

------------------------------------------------------------------------------
-- Visibility helpers
------------------------------------------------------------------------------

-- The caller's active role in a group, or null.
create function public.my_group_role(p_group_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select gm.role from public.group_members gm
  where gm.group_id = p_group_id and gm.profile_id = auth.uid() and gm.status = 'active'
$$;
revoke execute on function public.my_group_role(uuid) from public, anon;
grant execute on function public.my_group_role(uuid) to authenticated;

-- Group exists for the caller: in their 3x3 area block, or they have a row in it.
create function public.can_see_group(p_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.groups g
    where g.id = p_group_id
      and (g.area_id in (select public.my_nearby_area_ids())
           or exists (select 1 from public.group_members gm
                      where gm.group_id = g.id and gm.profile_id = auth.uid()))
  )
$$;
revoke execute on function public.can_see_group(uuid) from public, anon;
grant execute on function public.can_see_group(uuid) to authenticated;

-- Posts in a group: active members always; nearby non-members only for public groups.
create function public.can_read_group_posts(p_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.my_group_role(p_group_id) is not null
      or exists (select 1 from public.groups g
                 where g.id = p_group_id and g.privacy = 'public'
                   and g.area_id in (select public.my_nearby_area_ids())
                   and not exists (select 1 from public.group_members gm
                                   where gm.group_id = g.id and gm.profile_id = auth.uid()
                                     and gm.status = 'banned'))
$$;
revoke execute on function public.can_read_group_posts(uuid) from public, anon;
grant execute on function public.can_read_group_posts(uuid) to authenticated;

------------------------------------------------------------------------------
-- RLS
------------------------------------------------------------------------------

alter table public.groups enable row level security;
alter table public.group_members enable row level security;
revoke all on public.groups, public.group_members from anon, authenticated;
grant select on public.groups, public.group_members to authenticated;

create policy "see nearby groups and groups I belong to"
  on public.groups for select
  to authenticated
  using (public.can_see_group(id));

create policy "own row; active roster for members; requests and bans for moderators"
  on public.group_members for select
  to authenticated
  using (
    profile_id = (select auth.uid())
    or (status = 'active' and public.my_group_role(group_id) is not null)
    or (status in ('pending', 'banned') and public.my_group_role(group_id) in ('owner', 'moderator'))
  );

-- Posts: group posts follow the group; others stay as before.
drop policy "read own or nearby published posts" on public.posts;
create policy "read own, nearby, or group posts I may see"
  on public.posts for select
  to authenticated
  using (
    status = 'published'
    and (
      author_id = (select auth.uid())
      or (group_id is null and area_id in (select public.my_nearby_area_ids()))
      or (group_id is not null and public.can_read_group_posts(group_id))
    )
  );

-- Group posts are never discoverable outside the group.
create or replace function public.post_is_globally_searchable(p_post_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.posts p
    where p.id = p_post_id
      and p.status = 'published'
      and p.group_id is null
      and p.searchable
      and not exists (
        select 1 from public.post_interests pi
        join public.interests i on i.id = pi.interest_id
        where pi.post_id = p.id and i.is_family
      )
  )
$$;

create or replace function public.can_view_post_media(p_path text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.post_media m
    join public.posts p on p.id = m.post_id
    where m.storage_path = p_path
      and p.status = 'published'
      and (
        p.author_id = auth.uid()
        or (p.group_id is null
            and (p.area_id in (select public.my_nearby_area_ids())
                 or public.post_is_globally_searchable(p.id)))
        or (p.group_id is not null and public.can_read_group_posts(p.group_id))
      )
  )
$$;

------------------------------------------------------------------------------
-- Shared post shape
------------------------------------------------------------------------------

-- Photos with their tags for one post. Security invoker: RLS applies when
-- called by a client; called from a definer function it runs as the owner.
create function public.post_media_json(p_post_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(
    (select jsonb_agg(
              jsonb_build_object(
                'path', m.storage_path,
                'width', m.width,
                'height', m.height,
                'tags', coalesce(
                  (select jsonb_agg(
                            jsonb_build_object(
                              'id', t.id, 'x', t.x, 'y', t.y,
                              'item', jsonb_build_object(
                                'id', it.id, 'title', it.title, 'brand', it.brand,
                                'store_name', it.store_name, 'url', it.url,
                                'url_host', it.url_host, 'price_cents', it.price_cents,
                                'currency', it.currency, 'is_affiliate', it.is_affiliate))
                            order by t.y, t.x)
                   from public.item_tags t
                   join public.items it on it.id = t.item_id
                   where t.post_media_id = m.id),
                  '[]'::jsonb))
              order by m.position)
     from public.post_media m where m.post_id = p_post_id),
    '[]'::jsonb)
$$;

------------------------------------------------------------------------------
-- Feeds
------------------------------------------------------------------------------

-- Nearby feed, or one group's feed when p_group_id is given. Security
-- invoker: posts RLS decides what is visible.
drop function public.nearby_feed(int, timestamptz, uuid, smallint);
create function public.nearby_feed(
  p_limit int default 20,
  p_before_published_at timestamptz default null,
  p_before_id uuid default null,
  p_interest_id smallint default null,
  p_group_id uuid default null
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
    public.post_media_json(p.id),
    coalesce(
      (select array_agg(pi.interest_id order by pi.interest_id)
       from public.post_interests pi where pi.post_id = p.id),
      '{}'::smallint[])
  from public.posts p
  join public.profiles pr on pr.id = p.author_id
  join public.areas a on a.id = p.area_id
  where (case when p_group_id is null then p.group_id is null else p.group_id = p_group_id end)
    and (p_before_published_at is null
         or (p.published_at, p.id) < (p_before_published_at, coalesce(p_before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
    and (p_interest_id is null
         or exists (select 1 from public.post_interests pi
                    where pi.post_id = p.id and pi.interest_id = p_interest_id))
  order by p.published_at desc, p.id desc
  limit least(greatest(coalesce(p_limit, 20), 1), 50)
$$;
revoke execute on function public.nearby_feed(int, timestamptz, uuid, smallint, uuid) from public, anon;
grant execute on function public.nearby_feed(int, timestamptz, uuid, smallint, uuid) to authenticated;

create or replace function public.discover_posts(
  p_query text default null,
  p_limit int default 20,
  p_before_published_at timestamptz default null,
  p_before_id uuid default null
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

------------------------------------------------------------------------------
-- Posting into groups
------------------------------------------------------------------------------

drop function public.create_post_record(uuid, uuid, text, smallint[], jsonb, jsonb, boolean);

create function public.create_post_record(
  p_post_id uuid,
  p_author_id uuid,
  p_caption text,
  p_interest_ids smallint[],
  p_media jsonb,
  p_tags jsonb default '[]'::jsonb,
  p_searchable boolean default true,
  p_group_id uuid default null
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
  v_tag_count int := jsonb_array_length(coalesce(p_tags, '[]'::jsonb));
  v_media_ids uuid[] := '{}';
  v_media_id uuid;
  v_item_id uuid;
  v_item jsonb;
  v_url text;
  m jsonb;
  t jsonb;
  v_index int;
  i int := 0;
begin
  select pp.area_id into v_area
  from public.profile_private pp
  join public.profiles p on p.id = pp.profile_id
  where pp.profile_id = p_author_id and p.onboarded_at is not null;
  if v_area is null then
    raise exception 'not_onboarded' using errcode = '22023';
  end if;

  -- Group posts: author must be an active member; the post takes the group's
  -- area and is never globally searchable.
  if p_group_id is not null then
    if not exists (
      select 1 from public.group_members gm
      where gm.group_id = p_group_id and gm.profile_id = p_author_id and gm.status = 'active'
    ) then
      raise exception 'not_a_member' using errcode = '42501';
    end if;
    select g.area_id into v_area from public.groups g where g.id = p_group_id;
  end if;

  if (select count(*) from public.posts
      where author_id = p_author_id and published_at > now() - interval '24 hours') >= 20 then
    raise exception 'post_rate_limited' using errcode = 'P0001';
  end if;

  if v_count not between 1 and 10 then
    raise exception 'media_count' using errcode = '22023';
  end if;
  if v_tag_count > 20 then
    raise exception 'too_many_tags' using errcode = '22023';
  end if;

  select coalesce(array_agg(distinct x), '{}') into v_ids
  from unnest(coalesce(p_interest_ids, '{}')) as x;
  if cardinality(v_ids) > 3 then
    raise exception 'too_many_interests' using errcode = '22023';
  end if;
  if (select count(*) from public.interests where id = any (v_ids)) <> cardinality(v_ids) then
    raise exception 'unknown_interest' using errcode = '22023';
  end if;

  insert into public.posts (id, author_id, area_id, caption, searchable, group_id)
  values (p_post_id, p_author_id, v_area, v_caption,
          p_group_id is null and coalesce(p_searchable, true), p_group_id);

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
    values (p_post_id, m ->> 'path', (m ->> 'width')::int, (m ->> 'height')::int, i)
    returning id into v_media_id;
    v_media_ids := v_media_ids || v_media_id;
    i := i + 1;
  end loop;

  insert into public.post_interests (post_id, interest_id)
  select p_post_id, x from unnest(v_ids) as x;

  for t in select value from jsonb_array_elements(coalesce(p_tags, '[]'::jsonb)) loop
    begin
      v_index := (t ->> 'media')::int;
      v_item := t -> 'item';
      if v_index is null or v_index < 0 or v_index >= v_count or jsonb_typeof(v_item) <> 'object' then
        raise exception 'invalid_tag' using errcode = '22023';
      end if;
      v_url := nullif(btrim(coalesce(v_item ->> 'url', '')), '');

      insert into public.items (created_by, title, brand, store_name, url, url_host,
                                price_cents, currency, is_affiliate)
      values (
        p_author_id,
        btrim(v_item ->> 'title'),
        nullif(btrim(coalesce(v_item ->> 'brand', '')), ''),
        nullif(btrim(coalesce(v_item ->> 'store_name', '')), ''),
        v_url,
        case when v_url is null then null else public.item_url_host(v_url) end,
        (v_item ->> 'price_cents')::int,
        upper(nullif(btrim(coalesce(v_item ->> 'currency', '')), '')),
        coalesce((v_item ->> 'is_affiliate')::boolean, false)
      )
      returning id into v_item_id;

      insert into public.item_tags (post_media_id, item_id, x, y)
      values (v_media_ids[v_index + 1], v_item_id, (t ->> 'x')::real, (t ->> 'y')::real);
    exception
      when check_violation or not_null_violation or invalid_text_representation
           or numeric_value_out_of_range then
        raise exception 'invalid_tag' using errcode = '22023';
    end;
  end loop;

  if exists (
    select 1 from public.item_tags tg
    join public.post_media pm on pm.id = tg.post_media_id
    where pm.post_id = p_post_id
    group by tg.post_media_id having count(*) > 5
  ) then
    raise exception 'too_many_tags' using errcode = '22023';
  end if;

  return p_post_id;
end;
$$;
revoke execute on function public.create_post_record(uuid, uuid, text, smallint[], jsonb, jsonb, boolean, uuid)
  from public, anon, authenticated;
grant execute on function public.create_post_record(uuid, uuid, text, smallint[], jsonb, jsonb, boolean, uuid)
  to service_role;

------------------------------------------------------------------------------
-- Reading groups
------------------------------------------------------------------------------

-- Groups the caller can see, with counts the roster RLS would hide.
-- p_group_id: one group. p_mine: only groups the caller belongs to or asked to join.
create function public.list_groups(
  p_group_id uuid default null,
  p_interest_id smallint default null,
  p_mine boolean default false
)
returns table (
  id uuid,
  name text,
  description text,
  interest_id smallint,
  privacy text,
  area_name text,
  member_count int,
  my_role text,
  my_status text,
  pending_count int
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    g.id, g.name, g.description, g.interest_id, g.privacy, a.name,
    (select count(*)::int from public.group_members gm where gm.group_id = g.id and gm.status = 'active'),
    me.role,
    me.status,
    case when me.status = 'active' and me.role in ('owner', 'moderator')
         then (select count(*)::int from public.group_members gm
               where gm.group_id = g.id and gm.status = 'pending')
         else 0 end
  from public.groups g
  join public.areas a on a.id = g.area_id
  left join public.group_members me on me.group_id = g.id and me.profile_id = auth.uid()
  where auth.uid() is not null
    and (g.area_id in (select public.my_nearby_area_ids()) or me.profile_id is not null)
    and (p_group_id is null or g.id = p_group_id)
    and (p_interest_id is null or g.interest_id = p_interest_id)
    and (not p_mine or me.status in ('active', 'pending'))
  order by (me.status = 'active') desc nulls last,
           (select count(*) from public.group_members gm where gm.group_id = g.id and gm.status = 'active') desc,
           g.created_at desc
  limit 100
$$;
revoke execute on function public.list_groups(uuid, smallint, boolean) from public, anon;
grant execute on function public.list_groups(uuid, smallint, boolean) to authenticated;

-- Members (and, for moderators, requests) of one group. Security invoker:
-- the group_members policy decides which rows come back.
create function public.group_roster(p_group_id uuid)
returns table (
  profile_id uuid,
  handle text,
  display_name text,
  role text,
  status text,
  requested_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select gm.profile_id, pr.handle, pr.display_name, gm.role, gm.status, gm.requested_at
  from public.group_members gm
  join public.profiles pr on pr.id = gm.profile_id
  where gm.group_id = p_group_id
  order by case gm.status when 'pending' then 0 when 'active' then 1 else 2 end,
           case gm.role when 'owner' then 0 when 'moderator' then 1 else 2 end,
           pr.handle
$$;
revoke execute on function public.group_roster(uuid) from public, anon;
grant execute on function public.group_roster(uuid) to authenticated;

------------------------------------------------------------------------------
-- Writing groups (RPCs only)
------------------------------------------------------------------------------

create function public.create_group(
  p_name text,
  p_description text,
  p_interest_id smallint,
  p_privacy text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_area uuid;
  v_family boolean;
  v_id uuid;
  v_name text := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
  v_description text := nullif(btrim(coalesce(p_description, '')), '');
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  select pp.area_id into v_area
  from public.profile_private pp join public.profiles p on p.id = pp.profile_id
  where pp.profile_id = v_uid and p.onboarded_at is not null;
  if v_area is null then
    raise exception 'not_onboarded' using errcode = '22023';
  end if;
  select is_family into v_family from public.interests where id = p_interest_id;
  if v_family is null then
    raise exception 'unknown_interest' using errcode = '22023';
  end if;
  if p_privacy is null or p_privacy not in ('public', 'private')
     or char_length(v_name) not between 3 and 60 or char_length(v_description) > 500 then
    raise exception 'invalid_group' using errcode = '22023';
  end if;
  if (select count(*) from public.groups
      where created_by = v_uid and created_at > now() - interval '24 hours') >= 3 then
    raise exception 'group_rate_limited' using errcode = 'P0001';
  end if;

  begin
    insert into public.groups (name, description, interest_id, area_id, privacy, created_by)
    values (
      v_name,
      v_description,
      p_interest_id,
      v_area,
      case when v_family then 'private' else p_privacy end,
      v_uid
    )
    returning id into v_id;
  exception when check_violation then
    raise exception 'invalid_group' using errcode = '22023';
  end;

  insert into public.group_members (group_id, profile_id, role, status, joined_at)
  values (v_id, v_uid, 'owner', 'active', now());
  return v_id;
end;
$$;

-- Public: join now. Private: request. Returns the resulting status.
create function public.join_group(p_group_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_privacy text;
  v_existing text;
  v_status text;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if not exists (select 1 from public.profiles where id = v_uid and onboarded_at is not null) then
    raise exception 'not_onboarded' using errcode = '22023';
  end if;
  select g.privacy into v_privacy from public.groups g
  where g.id = p_group_id and g.area_id in (select public.my_nearby_area_ids());
  if v_privacy is null then
    raise exception 'group_not_found' using errcode = 'P0002';
  end if;
  select status into v_existing from public.group_members
  where group_id = p_group_id and profile_id = v_uid;
  if v_existing = 'banned' then
    raise exception 'banned_from_group' using errcode = '42501';
  elsif v_existing is not null then
    return v_existing;
  end if;

  v_status := case when v_privacy = 'public' then 'active' else 'pending' end;
  insert into public.group_members (group_id, profile_id, role, status, joined_at)
  values (p_group_id, v_uid, 'member', v_status, case when v_status = 'active' then now() end);
  return v_status;
end;
$$;

-- Leave, or withdraw a pending request. Owners cannot leave.
create function public.leave_group(p_group_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.group_members;
begin
  select * into v_row from public.group_members
  where group_id = p_group_id and profile_id = v_uid and status in ('active', 'pending');
  if not found then
    raise exception 'not_a_member' using errcode = 'P0002';
  end if;
  if v_row.role = 'owner' then
    raise exception 'owner_cannot_leave' using errcode = '22023';
  end if;
  delete from public.group_members where group_id = p_group_id and profile_id = v_uid;
end;
$$;

create function public.respond_to_join_request(p_group_id uuid, p_profile_id uuid, p_approve boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.my_group_role(p_group_id) not in ('owner', 'moderator') or public.my_group_role(p_group_id) is null then
    raise exception 'not_a_moderator' using errcode = '42501';
  end if;
  if p_approve then
    update public.group_members set status = 'active', joined_at = now()
    where group_id = p_group_id and profile_id = p_profile_id and status = 'pending';
  else
    delete from public.group_members
    where group_id = p_group_id and profile_id = p_profile_id and status = 'pending';
  end if;
  if not found then
    raise exception 'request_not_found' using errcode = 'P0002';
  end if;
end;
$$;

-- Remove and ban. Moderators can remove members; only the owner can remove moderators.
create function public.remove_group_member(p_group_id uuid, p_profile_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_my_role text := public.my_group_role(p_group_id);
  v_their_role text;
begin
  if v_my_role is null or v_my_role not in ('owner', 'moderator') then
    raise exception 'not_a_moderator' using errcode = '42501';
  end if;
  select role into v_their_role from public.group_members
  where group_id = p_group_id and profile_id = p_profile_id and status = 'active';
  if v_their_role is null then
    raise exception 'member_not_found' using errcode = 'P0002';
  end if;
  if v_their_role = 'owner' or (v_their_role = 'moderator' and v_my_role <> 'owner') then
    raise exception 'cannot_remove' using errcode = '42501';
  end if;
  update public.group_members
  set status = 'banned', role = 'member', joined_at = null
  where group_id = p_group_id and profile_id = p_profile_id;
end;
$$;

-- Owner promotes a member to moderator or demotes back to member.
create function public.set_group_role(p_group_id uuid, p_profile_id uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.my_group_role(p_group_id) is distinct from 'owner' then
    raise exception 'not_owner' using errcode = '42501';
  end if;
  if p_role not in ('moderator', 'member') then
    raise exception 'invalid_role' using errcode = '22023';
  end if;
  update public.group_members set role = p_role
  where group_id = p_group_id and profile_id = p_profile_id and status = 'active' and role <> 'owner';
  if not found then
    raise exception 'member_not_found' using errcode = 'P0002';
  end if;
end;
$$;

revoke execute on function public.create_group(text, text, smallint, text) from public, anon;
revoke execute on function public.join_group(uuid) from public, anon;
revoke execute on function public.leave_group(uuid) from public, anon;
revoke execute on function public.respond_to_join_request(uuid, uuid, boolean) from public, anon;
revoke execute on function public.remove_group_member(uuid, uuid) from public, anon;
revoke execute on function public.set_group_role(uuid, uuid, text) from public, anon;
grant execute on function public.create_group(text, text, smallint, text) to authenticated;
grant execute on function public.join_group(uuid) to authenticated;
grant execute on function public.leave_group(uuid) to authenticated;
grant execute on function public.respond_to_join_request(uuid, uuid, boolean) to authenticated;
grant execute on function public.remove_group_member(uuid, uuid) to authenticated;
grant execute on function public.set_group_role(uuid, uuid, text) to authenticated;

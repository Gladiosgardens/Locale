-- Step 17: Stories. A story is a post (one photo or one video, with the same
-- item tags, cleaning and safety rules) that disappears after 24 hours unless
-- its author keeps it in a highlight. Stories never appear in feeds or grids.

alter table public.posts
  add column kind text not null default 'post' check (kind in ('post', 'story')),
  add column expires_at timestamptz,
  add constraint posts_story_expiry check ((kind = 'story') = (expires_at is not null));
create index posts_active_stories on public.posts (author_id, expires_at desc) where kind = 'story';

create table public.highlights (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 30),
  created_at timestamptz not null default now()
);
create index highlights_owner on public.highlights (owner_id, created_at);
alter table public.highlights enable row level security;

create table public.highlight_stories (
  highlight_id uuid not null references public.highlights (id) on delete cascade,
  post_id uuid not null references public.posts (id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (highlight_id, post_id)
);
create index highlight_stories_post on public.highlight_stories (post_id);
alter table public.highlight_stories enable row level security;

create table public.story_views (
  post_id uuid not null references public.posts (id) on delete cascade,
  viewer_id uuid not null references public.profiles (id) on delete cascade,
  viewed_at timestamptz not null default now(),
  primary key (post_id, viewer_id)
);
create index story_views_viewer on public.story_views (viewer_id, post_id);
alter table public.story_views enable row level security;
-- No client policies on these three: everything goes through the functions below.

-- A story is live for 24 hours; after that only its author, or anyone viewing
-- one of the author's highlights that holds it, can see it.
create function public.story_is_open(p_post_id uuid, p_author_id uuid, p_expires_at timestamptz)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_expires_at is null
      or p_expires_at > now()
      or p_author_id = auth.uid()
      or exists (select 1 from public.highlight_stories hs where hs.post_id = p_post_id)
$$;
revoke execute on function public.story_is_open(uuid, uuid, timestamptz) from public, anon;
grant execute on function public.story_is_open(uuid, uuid, timestamptz) to authenticated;

drop policy "read own, nearby, or group posts I may see" on public.posts;
create policy "read own, nearby, or group posts I may see"
  on public.posts for select
  to authenticated
  using (
    status = 'published'
    and public.story_is_open(id, author_id, expires_at)
    and (
      author_id = (select auth.uid())
      or (
        author_id not in (select public.my_block_peers())
        and (
          (group_id is null and area_id in (select public.my_nearby_area_ids()))
          or (group_id is not null and public.can_read_group_posts(group_id))
        )
      )
    )
  );

create or replace function public.can_view_post(p_post_id uuid)
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
      and public.story_is_open(p.id, p.author_id, p.expires_at)
      and (
        p.author_id = auth.uid()
        or (
          p.author_id not in (select public.my_block_peers())
          and (
            (p.group_id is null
             and (p.area_id in (select public.my_nearby_area_ids())
                  or public.post_is_globally_searchable(p.id)))
            or (p.group_id is not null and public.can_read_group_posts(p.group_id))
          )
        )
      )
  )
$$;

-- Mentions in a story's caption don't notify ("mentioned you in a post" would
-- point at something that isn't in any feed and disappears).
create or replace function public.on_post_caption()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_new uuid[];
begin
  delete from public.post_hashtags where post_id = new.id;
  if new.kind = 'post' and coalesce(current_setting('locale.story', true), '') <> 'on' then
    insert into public.post_hashtags (post_id, tag)
    select new.id, t from unnest(public.extract_hashtags(new.caption)) t;
  end if;

  select coalesce(array_agg(pr.id), '{}') into v_new
  from public.profiles pr
  where pr.handle = any (public.extract_mentions(new.caption))
    and pr.onboarded_at is not null
    and pr.id <> new.author_id
    and not exists (select 1 from public.blocks b
                    where (b.blocker_id = pr.id and b.blocked_id = new.author_id)
                       or (b.blocker_id = new.author_id and b.blocked_id = pr.id));

  delete from public.post_mentions where post_id = new.id and profile_id <> all (v_new);
  with added as (
    insert into public.post_mentions (post_id, profile_id)
    select new.id, r from unnest(v_new) r
    on conflict do nothing
    returning profile_id
  )
  select coalesce(array_agg(profile_id), '{}') into v_new from added;

  if new.status = 'published' and new.kind = 'post' and coalesce(current_setting('locale.story', true), '') <> 'on' then
    perform public.notify_mentions(v_new, 'mention', new.author_id, new.id);
  end if;
  return new;
end;
$$;

-- Called by publish-post (service role) for a story: one photo or video, up to
-- 20 item tags, at most 30 stories a day (separate from the 20 posts a day).
create function public.create_story_record(
  p_post_id uuid,
  p_author_id uuid,
  p_caption text,
  p_media jsonb,
  p_tags jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  if jsonb_array_length(coalesce(p_media, '[]'::jsonb)) <> 1 then
    raise exception 'media_count' using errcode = '22023';
  end if;
  if char_length(coalesce(p_caption, '')) > 200 then
    raise exception 'invalid_caption' using errcode = '22023';
  end if;
  if (select count(*) from public.posts
      where author_id = p_author_id and kind = 'story' and published_at > now() - interval '24 hours') >= 30 then
    raise exception 'story_rate_limited' using errcode = 'P0001';
  end if;
  perform set_config('locale.story', 'on', true);
  perform public.create_post_record(p_post_id, p_author_id, p_caption, '{}'::smallint[], p_media, p_tags, true, null);
  update public.posts set kind = 'story', expires_at = now() + interval '24 hours', searchable = true
  where id = p_post_id;
  perform set_config('locale.story', 'off', true);
  return p_post_id;
end;
$$;
revoke execute on function public.create_story_record(uuid, uuid, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.create_story_record(uuid, uuid, text, jsonb, jsonb) to service_role;

------------------------------------------------------------------------------
-- Reading stories
------------------------------------------------------------------------------

-- The row shape the app reads (like discover_posts, plus story fields).
create function public.story_rows(p_ids uuid[])
returns table (
  id uuid,
  caption text,
  published_at timestamptz,
  expires_at timestamptz,
  author_id uuid,
  author_handle text,
  author_display_name text,
  media jsonb,
  seen boolean,
  view_count int
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.caption, p.published_at, p.expires_at, p.author_id, pr.handle, pr.display_name,
         public.post_media_json(p.id),
         exists (select 1 from public.story_views v where v.post_id = p.id and v.viewer_id = auth.uid()),
         case when p.author_id = auth.uid()
              then (select count(*)::int from public.story_views v where v.post_id = p.id) end
  from public.posts p
  join public.profiles pr on pr.id = p.author_id
  where p.id = any (p_ids) and p.kind = 'story' and public.can_view_post(p.id)
  order by p.published_at, p.id
$$;
revoke execute on function public.story_rows(uuid[]) from public, anon, authenticated;

-- The circles on Home: me (if I have a live story), then people I follow with
-- live stories, unseen first, newest first.
create function public.story_tray()
returns table (
  author_id uuid,
  author_handle text,
  author_display_name text,
  story_count int,
  latest_at timestamptz,
  all_seen boolean,
  is_me boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with live as (
    select p.id, p.author_id, p.published_at
    from public.posts p
    where p.kind = 'story' and p.status = 'published' and p.expires_at > now()
      and (p.author_id = auth.uid()
           or p.author_id in (select f.followee_id from public.follows f where f.follower_id = auth.uid()))
      and public.can_view_post(p.id)
  )
  select l.author_id, pr.handle, pr.display_name, count(*)::int, max(l.published_at),
         bool_and(exists (select 1 from public.story_views v where v.post_id = l.id and v.viewer_id = auth.uid())
                  or l.author_id = auth.uid()),
         l.author_id = auth.uid()
  from live l join public.profiles pr on pr.id = l.author_id
  group by l.author_id, pr.handle, pr.display_name
  order by (l.author_id = auth.uid()) desc,
           bool_and(exists (select 1 from public.story_views v where v.post_id = l.id and v.viewer_id = auth.uid())) asc,
           max(l.published_at) desc
  limit 100
$$;

-- One person's live stories, oldest first.
create function public.author_stories(p_author_id uuid)
returns table (
  id uuid, caption text, published_at timestamptz, expires_at timestamptz, author_id uuid,
  author_handle text, author_display_name text, media jsonb, seen boolean, view_count int
)
language sql
stable
security definer
set search_path = ''
as $$
  select * from public.story_rows(array(
    select p.id from public.posts p
    where p.author_id = p_author_id and p.kind = 'story' and p.status = 'published' and p.expires_at > now()))
$$;

-- Marks a story seen (for the ring on Home and the author's viewer list).
create function public.mark_story_seen(p_post_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  insert into public.story_views (post_id, viewer_id)
  select p.id, auth.uid() from public.posts p
  where p.id = p_post_id and p.kind = 'story' and p.author_id <> auth.uid() and public.can_view_post(p.id)
  on conflict do nothing;
end;
$$;

-- Who saw my story (author only; people with a block either way are left out).
create function public.story_viewers(p_post_id uuid)
returns table (profile_id uuid, handle text, display_name text, viewed_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select pr.id, pr.handle, pr.display_name, v.viewed_at
  from public.story_views v
  join public.posts p on p.id = v.post_id and p.author_id = auth.uid()
  join public.profiles pr on pr.id = v.viewer_id
  where v.post_id = p_post_id and v.viewer_id not in (select public.my_block_peers())
  order by v.viewed_at desc
  limit 500
$$;

------------------------------------------------------------------------------
-- Highlights
------------------------------------------------------------------------------

create function public.profile_highlights(p_profile_id uuid)
returns table (id uuid, name text, story_count int, cover_path text, cover_playback_id text)
language sql
stable
security definer
set search_path = ''
as $$
  select h.id, h.name,
         (select count(*)::int from public.highlight_stories hs
          where hs.highlight_id = h.id and public.can_view_post(hs.post_id)),
         cov.storage_path, cov.mux_playback_id
  from public.highlights h
  left join lateral (
    select pm.storage_path, pm.mux_playback_id
    from public.highlight_stories hs
    join public.post_media pm on pm.post_id = hs.post_id and pm.position = 0
    where hs.highlight_id = h.id and public.can_view_post(hs.post_id)
    order by hs.added_at desc limit 1
  ) cov on true
  where h.owner_id = p_profile_id
    and (h.owner_id = auth.uid() or h.owner_id not in (select public.my_block_peers()))
    and exists (select 1 from public.highlight_stories hs
                where hs.highlight_id = h.id and public.can_view_post(hs.post_id))
  order by h.created_at
$$;

create function public.highlight_story_rows(p_highlight_id uuid)
returns table (
  id uuid, caption text, published_at timestamptz, expires_at timestamptz, author_id uuid,
  author_handle text, author_display_name text, media jsonb, seen boolean, view_count int
)
language sql
stable
security definer
set search_path = ''
as $$
  select * from public.story_rows(array(
    select hs.post_id from public.highlight_stories hs
    join public.highlights h on h.id = hs.highlight_id
    where hs.highlight_id = p_highlight_id
      and (h.owner_id = auth.uid() or h.owner_id not in (select public.my_block_peers()))))
$$;

-- My highlights, with whether a given story is in each (for "Add to highlight").
create function public.my_highlights(p_post_id uuid default null)
returns table (id uuid, name text, has_story boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select h.id, h.name,
         exists (select 1 from public.highlight_stories hs where hs.highlight_id = h.id and hs.post_id = p_post_id)
  from public.highlights h where h.owner_id = auth.uid()
  order by h.created_at
$$;

-- Adds my story to a highlight; p_highlight_id null creates one named p_name.
create function public.add_to_highlight(p_post_id uuid, p_highlight_id uuid default null, p_name text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid := p_highlight_id;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if not exists (select 1 from public.posts p
                 where p.id = p_post_id and p.author_id = v_uid and p.kind = 'story' and p.status = 'published') then
    raise exception 'post_not_found' using errcode = 'P0002';
  end if;
  if v_id is null then
    if char_length(btrim(coalesce(p_name, ''))) not between 1 and 30 then
      raise exception 'invalid_highlight_name' using errcode = '22023';
    end if;
    if (select count(*) from public.highlights where owner_id = v_uid) >= 50 then
      raise exception 'highlight_limit' using errcode = 'P0001';
    end if;
    insert into public.highlights (owner_id, name) values (v_uid, btrim(p_name)) returning id into v_id;
  elsif not exists (select 1 from public.highlights where id = v_id and owner_id = v_uid) then
    raise exception 'highlight_not_found' using errcode = 'P0002';
  end if;
  if (select count(*) from public.highlight_stories where highlight_id = v_id) >= 100 then
    raise exception 'highlight_full' using errcode = 'P0001';
  end if;
  insert into public.highlight_stories (highlight_id, post_id) values (v_id, p_post_id) on conflict do nothing;
  return v_id;
end;
$$;

create function public.remove_from_highlight(p_highlight_id uuid, p_post_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.highlight_stories hs using public.highlights h
  where h.id = hs.highlight_id and h.owner_id = auth.uid()
    and hs.highlight_id = p_highlight_id and hs.post_id = p_post_id
$$;

-- Deleting a highlight keeps the stories (in the author's archive).
create function public.delete_highlight(p_highlight_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.highlights where id = p_highlight_id and owner_id = auth.uid()
$$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.story_tray()', 'public.author_stories(uuid)', 'public.mark_story_seen(uuid)',
    'public.story_viewers(uuid)', 'public.profile_highlights(uuid)', 'public.highlight_story_rows(uuid)',
    'public.my_highlights(uuid)', 'public.add_to_highlight(uuid, uuid, text)',
    'public.remove_from_highlight(uuid, uuid)', 'public.delete_highlight(uuid)'] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end;
$$;

------------------------------------------------------------------------------
-- Stories stay out of feeds, grids, search and the post limit
------------------------------------------------------------------------------

create or replace function public.create_post_record(
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
  v_is_video boolean;
  i int := 0;
begin
  if not exists (select 1 from public.profiles where id = p_author_id and onboarded_at is not null) then
    raise exception 'not_onboarded' using errcode = '22023';
  end if;
  -- May be null: posts without an area are global (not tied to a neighborhood).
  select pp.area_id into v_area from public.profile_private pp where pp.profile_id = p_author_id;

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

  if coalesce(current_setting('locale.story', true), '') <> 'on'
     and (select count(*) from public.posts
          where author_id = p_author_id and kind = 'post' and published_at > now() - interval '24 hours') >= 20 then
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
  if (select count(*) from public.interests where id = any (v_ids) and active) <> cardinality(v_ids) then
    raise exception 'unknown_interest' using errcode = '22023';
  end if;

  insert into public.posts (id, author_id, area_id, caption, searchable, group_id)
  values (p_post_id, p_author_id, v_area, v_caption,
          p_group_id is null and coalesce(p_searchable, true), p_group_id);

  -- A post is up to 10 photos, or exactly one video.
  v_is_video := exists (select 1 from jsonb_array_elements(p_media) x where x.value ->> 'kind' = 'video');
  if v_is_video and v_count <> 1 then
    raise exception 'media_count' using errcode = '22023';
  end if;

  for m in select value from jsonb_array_elements(p_media) loop
    if v_is_video then
      -- The video must be one this author uploaded and hasn't used yet; the
      -- Edge Function has already checked it with Mux.
      if coalesce(m ->> 'asset_id', '') !~ '^[A-Za-z0-9]{8,80}$'
         or coalesce(m ->> 'playback_id', '') !~ '^[A-Za-z0-9]{8,80}$'
         or coalesce((m ->> 'duration')::real, 999) > 61 then
        raise exception 'invalid_video' using errcode = '22023';
      end if;
      update public.video_uploads set used_at = now(), post_id = p_post_id
      where profile_id = p_author_id and asset_id = m ->> 'asset_id' and used_at is null;
      if not found then
        raise exception 'invalid_video' using errcode = '22023';
      end if;
      insert into public.post_media (post_id, kind, storage_path, mux_asset_id, mux_playback_id, duration_s,
                                     width, height, position)
      values (p_post_id, 'video', null, m ->> 'asset_id', m ->> 'playback_id', (m ->> 'duration')::real,
              (m ->> 'width')::int, (m ->> 'height')::int, i)
      returning id into v_media_id;
    else
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
    end if;
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

drop function public.discover_posts(text, int, timestamptz, uuid, boolean, uuid, uuid, boolean, boolean, text, uuid, uuid);
create function public.discover_posts(
  p_query text default null,
  p_limit int default 20,
  p_before_published_at timestamptz default null,
  p_before_id uuid default null,
  p_following boolean default false,
  p_author_id uuid default null,
  p_post_id uuid default null,
  p_for_you boolean default false,
  p_saved boolean default false,
  p_hashtag text default null,
  p_tagged_id uuid default null,
  p_collection_id uuid default null
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
  matched_item_ids uuid[],
  rank_at timestamptz,
  like_count int,
  comment_count int,
  i_liked boolean,
  i_saved boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_query tsquery;
  -- For you: a post in one of your topics counts as this much newer, and one
  -- from someone you follow as this much newer. Ranking by this "effective
  -- time" keeps paging simple: the cursor is (rank_at, id).
  v_topic_boost constant interval := interval '36 hours';
  v_follow_boost constant interval := interval '24 hours';
  v_my_topics smallint[];
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

  if p_for_you then
    select coalesce(array_agg(pi.interest_id), '{}') into v_my_topics
    from public.profile_interests pi where pi.profile_id = v_uid;
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
           coalesce(p.author_id = v_uid or p.area_id in (select area_id from nearby), false) as is_nearby,
           case when p_for_you then
             p.published_at
             + case when exists (select 1 from public.post_interests pi
                                 where pi.post_id = p.id and pi.interest_id = any (v_my_topics))
                    then v_topic_boost else interval '0' end
             + case when p.author_id <> v_uid and p.author_id in (
                      select f.followee_id from public.follows f where f.follower_id = v_uid)
                    then v_follow_boost else interval '0' end
           else p.published_at end as rank_at
    from public.posts p
    left join matches mt on mt.post_id = p.id
    where p.status = 'published'
      and p.kind = 'post'
      and p.group_id is null
      and p.author_id not in (select public.my_block_peers())
      and (not p_following or p.author_id in (
            select f.followee_id from public.follows f where f.follower_id = v_uid))
      and (p_author_id is null or p.author_id = p_author_id)
      and (p_post_id is null or p.id = p_post_id)
      and (not p_saved or p.id in (select sp.post_id from public.saved_posts sp where sp.profile_id = v_uid))
      and (p_hashtag is null or p.id in (
            select h.post_id from public.post_hashtags h where h.tag = lower(ltrim(btrim(p_hashtag), '#'))))
      and (p_tagged_id is null or p.id in (
            select pm.post_id from public.people_tags pt join public.post_media pm on pm.id = pt.post_media_id
            where pt.profile_id = p_tagged_id))
      and (p_collection_id is null or p.id in (
            select cp.post_id from public.collection_posts cp join public.collections c on c.id = cp.collection_id
            where cp.collection_id = p_collection_id and c.owner_id = v_uid))
      and (v_query is null or mt.post_id is not null)
      -- In For you the cursor is a rank_at; rank_at is never before published_at, so this only skips posts that can't come next.
      and (p_before_published_at is null
           or (not p_for_you and (p.published_at, p.id) < (p_before_published_at,
               coalesce(p_before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
           or (p_for_you and p.published_at < p_before_published_at))
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
    coalesce(v.item_ids, '{}'::uuid[]),
    v.rank_at,
    (select count(*)::int from public.post_likes l where l.post_id = v.id),
    (select count(*)::int from public.comments c
     where c.post_id = v.id and c.removed_at is null and c.hidden_at is null
       and c.author_id not in (select public.my_block_peers())),
    exists (select 1 from public.post_likes l where l.post_id = v.id and l.profile_id = v_uid),
    exists (select 1 from public.saved_posts sp where sp.post_id = v.id and sp.profile_id = v_uid)
  from visible v
  join public.profiles pr on pr.id = v.author_id
  left join public.areas a on a.id = v.area_id
  where (v.is_nearby or public.post_is_globally_searchable(v.id))
    and (not p_for_you or p_before_published_at is null
         or (v.rank_at, v.id) < (p_before_published_at,
             coalesce(p_before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
  order by v.rank_at desc, v.id desc
  limit least(greatest(coalesce(p_limit, 20), 1), 50);
end;
$$;
revoke execute on function public.discover_posts(text, int, timestamptz, uuid, boolean, uuid, uuid, boolean, boolean, text, uuid, uuid) from public, anon;
grant execute on function public.discover_posts(text, int, timestamptz, uuid, boolean, uuid, uuid, boolean, boolean, text, uuid, uuid) to authenticated;

create or replace function public.nearby_feed(
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
  where p.kind = 'post'
    and (case when p_group_id is null then p.group_id is null else p.group_id = p_group_id end)
    and (p_before_published_at is null
         or (p.published_at, p.id) < (p_before_published_at, coalesce(p_before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
    and (p_interest_id is null
         or exists (select 1 from public.post_interests pi
                    where pi.post_id = p.id and pi.interest_id = p_interest_id))
  order by p.published_at desc, p.id desc
  limit least(greatest(coalesce(p_limit, 20), 1), 50)
$$;

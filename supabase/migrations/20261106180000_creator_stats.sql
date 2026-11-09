-- Step 18: creator stats. Counts who saw a post and who opened or followed
-- its tagged items, shown only to the post's author, in aggregate.
-- Viewers are never listed (except story viewers, as before).

-- One row per viewer per post; repeat views bump the counter.
create table public.post_views (
  post_id uuid not null references public.posts (id) on delete cascade,
  viewer_id uuid not null references public.profiles (id) on delete cascade,
  first_viewed_at timestamptz not null default now(),
  last_viewed_at timestamptz not null default now(),
  view_count int not null default 1 check (view_count >= 1),
  primary key (post_id, viewer_id)
);
create index post_views_first on public.post_views (post_id, first_viewed_at);
alter table public.post_views enable row level security;

-- 'open' = opened the item's details; 'link' = tapped through to the shop.
create table public.item_events (
  post_id uuid not null references public.posts (id) on delete cascade,
  item_id uuid not null references public.items (id) on delete cascade,
  viewer_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('open', 'link')),
  first_at timestamptz not null default now(),
  last_at timestamptz not null default now(),
  event_count int not null default 1 check (event_count >= 1),
  primary key (post_id, item_id, viewer_id, kind)
);
create index item_events_post on public.item_events (post_id, kind);
alter table public.item_events enable row level security;
-- No client policies: writes go through record_* and reads through the stats functions.

-- Called by the app as posts scroll into view (batched). Authors' own views
-- and posts the caller can't see are ignored. At most 50 per call.
create function public.record_post_views(p_post_ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if cardinality(p_post_ids) > 50 then
    raise exception 'too_many' using errcode = '22023';
  end if;
  insert into public.post_views as v (post_id, viewer_id)
  select p.id, auth.uid()
  from public.posts p
  where p.id = any (p_post_ids) and p.author_id <> auth.uid() and p.kind = 'post' and public.can_view_post(p.id)
  on conflict (post_id, viewer_id) do update
    set view_count = v.view_count + 1, last_viewed_at = now()
    -- Scrolling back and forth within a few minutes counts once.
    where v.last_viewed_at < now() - interval '10 minutes';
end;
$$;

create function public.record_item_event(p_post_id uuid, p_item_id uuid, p_kind text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if p_kind not in ('open', 'link') then
    raise exception 'bad_request' using errcode = '22023';
  end if;
  insert into public.item_events as e (post_id, item_id, viewer_id, kind)
  select p.id, p_item_id, auth.uid(), p_kind
  from public.posts p
  where p.id = p_post_id and p.author_id <> auth.uid() and public.can_view_post(p.id)
    and exists (select 1 from public.item_tags t join public.post_media m on m.id = t.post_media_id
                where m.post_id = p.id and t.item_id = p_item_id)
  on conflict (post_id, item_id, viewer_id, kind) do update
    set event_count = e.event_count + 1, last_at = now()
    where e.last_at < now() - interval '10 minutes';
end;
$$;

-- One post's numbers, for its author. Stories count viewers from story_views.
create function public.post_stats(p_post_id uuid)
returns table (
  reach int,
  views int,
  likes int,
  comments int,
  saves int,
  item_opens int,
  link_taps int,
  items jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_kind text;
begin
  select p.kind into v_kind from public.posts p where p.id = p_post_id and p.author_id = auth.uid();
  if v_kind is null then
    raise exception 'post_not_found' using errcode = 'P0002';
  end if;
  return query
  select
    case when v_kind = 'story'
         then (select count(*)::int from public.story_views sv where sv.post_id = p_post_id)
         else (select count(*)::int from public.post_views pv where pv.post_id = p_post_id) end,
    case when v_kind = 'story'
         then (select count(*)::int from public.story_views sv where sv.post_id = p_post_id)
         else (select coalesce(sum(pv.view_count), 0)::int from public.post_views pv where pv.post_id = p_post_id) end,
    (select count(*)::int from public.post_likes l where l.post_id = p_post_id),
    (select count(*)::int from public.comments c where c.post_id = p_post_id and c.removed_at is null and c.hidden_at is null),
    (select count(*)::int from public.saved_posts s where s.post_id = p_post_id),
    (select count(distinct e.viewer_id)::int from public.item_events e where e.post_id = p_post_id and e.kind = 'open'),
    (select count(distinct e.viewer_id)::int from public.item_events e where e.post_id = p_post_id and e.kind = 'link'),
    coalesce((
      select jsonb_agg(jsonb_build_object(
               'item_id', it.id, 'title', it.title, 'url_host', it.url_host,
               'opens', (select count(*) from public.item_events e
                         where e.post_id = p_post_id and e.item_id = it.id and e.kind = 'open'),
               'link_taps', (select count(*) from public.item_events e
                             where e.post_id = p_post_id and e.item_id = it.id and e.kind = 'link'),
               'wishlist', (select count(*) from public.saved_items si
                            where si.post_id = p_post_id and si.item_id = it.id))
             order by m.position, t.y, t.x)
      from public.item_tags t
      join public.post_media m on m.id = t.post_media_id
      join public.items it on it.id = t.item_id
      where m.post_id = p_post_id), '[]'::jsonb);
end;
$$;

-- The last N days across my posts: totals, plus each post's numbers for the list.
create function public.my_stats(p_days int default 30)
returns table (
  reach int,
  likes int,
  comments int,
  saves int,
  item_opens int,
  link_taps int,
  new_followers int,
  posts jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  with since as (select now() - make_interval(days => least(greatest(coalesce(p_days, 30), 1), 90)) as at),
  mine as (
    select p.id, p.published_at from public.posts p
    where p.author_id = auth.uid() and p.status = 'published' and p.kind = 'post'
  ),
  per_post as (
    select m.id, m.published_at,
      (select count(*) from public.post_views v where v.post_id = m.id and v.first_viewed_at >= (select at from since)) as reach,
      (select count(*) from public.post_likes l where l.post_id = m.id and l.created_at >= (select at from since)) as likes,
      (select count(*) from public.item_events e where e.post_id = m.id and e.kind = 'link'
         and e.first_at >= (select at from since)) as link_taps
    from mine m
  )
  select
    (select count(distinct v.viewer_id)::int from public.post_views v join mine m on m.id = v.post_id
     where v.first_viewed_at >= (select at from since)),
    (select coalesce(sum(likes), 0)::int from per_post),
    (select count(*)::int from public.comments c join mine m on m.id = c.post_id
     where c.created_at >= (select at from since) and c.author_id <> auth.uid() and c.removed_at is null),
    (select count(*)::int from public.saved_posts s join mine m on m.id = s.post_id
     where s.created_at >= (select at from since)),
    (select count(distinct (e.viewer_id, e.item_id))::int from public.item_events e join mine m on m.id = e.post_id
     where e.kind = 'open' and e.first_at >= (select at from since)),
    (select count(distinct (e.viewer_id, e.item_id))::int from public.item_events e join mine m on m.id = e.post_id
     where e.kind = 'link' and e.first_at >= (select at from since)),
    (select count(*)::int from public.follows f
     where f.followee_id = auth.uid() and f.created_at >= (select at from since)),
    coalesce((
      select jsonb_agg(jsonb_build_object('post_id', x.id, 'reach', x.reach, 'likes', x.likes, 'link_taps', x.link_taps)
                       order by x.reach desc, x.published_at desc)
      from (select * from per_post where reach > 0 or likes > 0 or link_taps > 0
            order by reach desc, published_at desc limit 20) x), '[]'::jsonb)
$$;

revoke execute on function public.record_post_views(uuid[]) from public, anon;
revoke execute on function public.record_item_event(uuid, uuid, text) from public, anon;
revoke execute on function public.post_stats(uuid) from public, anon;
revoke execute on function public.my_stats(int) from public, anon;
grant execute on function public.record_post_views(uuid[]) to authenticated;
grant execute on function public.record_item_event(uuid, uuid, text) to authenticated;
grant execute on function public.post_stats(uuid) to authenticated;
grant execute on function public.my_stats(int) to authenticated;

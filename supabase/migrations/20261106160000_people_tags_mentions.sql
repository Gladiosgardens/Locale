-- Step 16: tag people in photos, @mentions, #hashtags and saved collections.

------------------------------------------------------------------------------
-- Parsing
------------------------------------------------------------------------------

-- Handles are ^[a-z0-9_]{3,20}$. A mention is @handle not glued to a word
-- before it (so emails like a@b.com don't count). At most 10 per text.
create function public.extract_mentions(p_text text)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select coalesce(array_agg(h order by h), '{}') from (
    select distinct m[1] as h
    from regexp_matches(lower(coalesce(p_text, '')), '(?:^|[^[:alnum:]_@.])@([a-z0-9_]{3,20})(?![a-z0-9_])', 'g') as m
    limit 10
  ) x
$$;

-- Hashtags: letters (any script), digits and _, up to 50, not all digits.
-- At most 30 per post.
create function public.extract_hashtags(p_text text)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select coalesce(array_agg(t order by t), '{}') from (
    select distinct m[1] as t
    from regexp_matches(lower(coalesce(p_text, '')), '(?:^|[^[:alnum:]_&#])#([[:alnum:]_]{1,50})(?![[:alnum:]_])', 'g') as m
    where m[1] !~ '^[0-9_]+$'
    limit 30
  ) x
$$;

------------------------------------------------------------------------------
-- Tables
------------------------------------------------------------------------------

create table public.post_hashtags (
  post_id uuid not null references public.posts (id) on delete cascade,
  tag text not null check (char_length(tag) between 1 and 50 and tag = lower(tag) and tag !~ '[^[:alnum:]_]'),
  primary key (post_id, tag)
);
create index post_hashtags_tag on public.post_hashtags (tag, post_id);
alter table public.post_hashtags enable row level security;

-- Who a caption or comment mentions (resolved handles), for Activity.
create table public.post_mentions (
  post_id uuid not null references public.posts (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, profile_id)
);
create index post_mentions_profile on public.post_mentions (profile_id, created_at desc);
alter table public.post_mentions enable row level security;

create table public.comment_mentions (
  comment_id uuid not null references public.comments (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  primary key (comment_id, profile_id)
);
create index comment_mentions_profile on public.comment_mentions (profile_id);
alter table public.comment_mentions enable row level security;

create table public.people_tags (
  post_media_id uuid not null references public.post_media (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  x real not null check (x >= 0 and x <= 1),
  y real not null check (y >= 0 and y <= 1),
  created_at timestamptz not null default now(),
  primary key (post_media_id, profile_id)
);
create index people_tags_profile on public.people_tags (profile_id);
alter table public.people_tags enable row level security;
revoke all on public.people_tags from anon, authenticated;
grant select on public.people_tags to authenticated;
-- Like item tags: readable wherever the photo is (post_media RLS applies inside).
-- Changes go through set_people_tags and remove_my_people_tag.
create policy "read people tags on visible media"
  on public.people_tags for select
  to authenticated
  using (exists (select 1 from public.post_media m where m.id = people_tags.post_media_id));

create table public.collections (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 40),
  created_at timestamptz not null default now()
);
create unique index collections_owner_name on public.collections (owner_id, lower(btrim(name)));
alter table public.collections enable row level security;

create table public.collection_posts (
  collection_id uuid not null references public.collections (id) on delete cascade,
  post_id uuid not null references public.posts (id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (collection_id, post_id)
);
create index collection_posts_post on public.collection_posts (post_id);
alter table public.collection_posts enable row level security;
-- No client policies on the others: reads and writes go through the functions below.

------------------------------------------------------------------------------
-- Notifications: mentions in posts and comments, and photo tags
------------------------------------------------------------------------------

alter table public.profile_private add column notify_mentions boolean not null default true;

drop function public.set_notification_preferences(boolean, boolean, boolean, boolean);
create function public.set_notification_preferences(
  p_messages boolean default null,
  p_groups boolean default null,
  p_follows boolean default null,
  p_comments boolean default null,
  p_mentions boolean default null
)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.profile_private
  set notify_messages = coalesce(p_messages, notify_messages),
      notify_groups = coalesce(p_groups, notify_groups),
      notify_follows = coalesce(p_follows, notify_follows),
      notify_comments = coalesce(p_comments, notify_comments),
      notify_mentions = coalesce(p_mentions, notify_mentions)
  where profile_id = auth.uid()
$$;
revoke execute on function public.set_notification_preferences(boolean, boolean, boolean, boolean, boolean) from public, anon;
grant execute on function public.set_notification_preferences(boolean, boolean, boolean, boolean, boolean) to authenticated;

alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('message', 'message_request', 'group_join_request', 'group_join_approved', 'new_follower',
                  'comment', 'reply', 'mention', 'comment_mention', 'tag'));

-- Who may be told about a post: not blocked either way, can see the post
-- (group posts only reach active members), and has mention pushes on.
create function public.may_notify_about_post(p_recipient uuid, p_actor uuid, p_post_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_recipient <> p_actor
    and exists (select 1 from public.profiles pr where pr.id = p_recipient and pr.onboarded_at is not null)
    and not exists (select 1 from public.blocks b
                    where (b.blocker_id = p_recipient and b.blocked_id = p_actor)
                       or (b.blocker_id = p_actor and b.blocked_id = p_recipient))
    and exists (select 1 from public.posts p
                where p.id = p_post_id and p.status = 'published'
                  and (p.group_id is null
                       or exists (select 1 from public.group_members gm
                                  where gm.group_id = p.group_id and gm.profile_id = p_recipient
                                    and gm.status = 'active')))
$$;
revoke execute on function public.may_notify_about_post(uuid, uuid, uuid) from public, anon, authenticated;

create function public.notify_mentions(p_ids uuid[], p_kind text, p_actor uuid, p_post_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.notifications (recipient_id, kind, actor_id, post_id)
  select r, p_kind, p_actor, p_post_id
  from unnest(p_ids) r
  where coalesce((select notify_mentions from public.profile_private where profile_id = r), false)
    and public.may_notify_about_post(r, p_actor, p_post_id)
  on conflict (recipient_id, kind, post_id) where sent_at is null and post_id is not null
  do update set actor_id = excluded.actor_id
$$;
revoke execute on function public.notify_mentions(uuid[], text, uuid, uuid) from public, anon, authenticated;

-- Captions: keep hashtags in sync and tell newly mentioned people.
create function public.on_post_caption()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_new uuid[];
begin
  delete from public.post_hashtags where post_id = new.id;
  insert into public.post_hashtags (post_id, tag)
  select new.id, t from unnest(public.extract_hashtags(new.caption)) t;

  -- Mentions of yourself and of people with a block either way don't count.
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

  if new.status = 'published' then
    perform public.notify_mentions(v_new, 'mention', new.author_id, new.id);
  end if;
  return new;
end;
$$;
revoke execute on function public.on_post_caption() from public, anon, authenticated;

create trigger posts_caption
after insert or update of caption on public.posts
for each row execute function public.on_post_caption();

-- Comments: mentioned people hear about it, except the post's author and the
-- person replied to, who already get a comment or reply notification.
create function public.on_comment_mentions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids uuid[];
  v_skip uuid[];
begin
  with added as (
    insert into public.comment_mentions (comment_id, profile_id)
    select new.id, pr.id
    from public.profiles pr
    where pr.handle = any (public.extract_mentions(new.body))
      and pr.onboarded_at is not null
      and pr.id <> new.author_id
      and not exists (select 1 from public.blocks b
                      where (b.blocker_id = pr.id and b.blocked_id = new.author_id)
                         or (b.blocker_id = new.author_id and b.blocked_id = pr.id))
    returning profile_id
  )
  select coalesce(array_agg(profile_id), '{}') into v_ids from added;

  select array_remove(array[p.author_id,
           (select c.author_id from public.comments c where c.id = new.parent_id)], null)
  into v_skip
  from public.posts p where p.id = new.post_id;
  perform public.notify_mentions(
    array(select r from unnest(v_ids) r where r <> all (coalesce(v_skip, '{}'))),
    'comment_mention', new.author_id, new.post_id);
  return new;
end;
$$;
revoke execute on function public.on_comment_mentions() from public, anon, authenticated;

create trigger comments_mentions
after insert on public.comments
for each row execute function public.on_comment_mentions();

-- Existing captions get their hashtags and mentions (no notifications for old posts).
insert into public.post_hashtags (post_id, tag)
select p.id, t from public.posts p, unnest(public.extract_hashtags(p.caption)) t
on conflict do nothing;
insert into public.post_mentions (post_id, profile_id, created_at)
select p.id, pr.id, p.published_at
from public.posts p
join public.profiles pr on pr.handle = any (public.extract_mentions(p.caption)) and pr.id <> p.author_id
on conflict do nothing;
insert into public.comment_mentions (comment_id, profile_id)
select c.id, pr.id
from public.comments c
join public.profiles pr on pr.handle = any (public.extract_mentions(c.body)) and pr.id <> c.author_id
on conflict do nothing;

------------------------------------------------------------------------------
-- People tags
------------------------------------------------------------------------------

-- Replaces the tags on a post. p_tags: [{"position": 0, "profile_id": "...", "x": 0.4, "y": 0.6}].
-- Only the author can tag; up to 20 people per post; people who blocked you
-- (or whom you blocked) can't be tagged. Newly tagged people get a notification.
create function public.set_people_tags(p_post_id uuid, p_tags jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_before uuid[];
  t jsonb;
  v_media uuid;
  v_profile uuid;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if not exists (select 1 from public.posts p where p.id = p_post_id and p.author_id = v_uid and p.status = 'published') then
    raise exception 'post_not_found' using errcode = 'P0002';
  end if;
  if jsonb_typeof(coalesce(p_tags, '[]')) <> 'array' or jsonb_array_length(coalesce(p_tags, '[]')) > 20 then
    raise exception 'too_many_people_tags' using errcode = '22023';
  end if;

  select coalesce(array_agg(distinct pt.profile_id), '{}') into v_before
  from public.people_tags pt join public.post_media pm on pm.id = pt.post_media_id
  where pm.post_id = p_post_id;

  delete from public.people_tags pt using public.post_media pm
  where pm.id = pt.post_media_id and pm.post_id = p_post_id;

  for t in select * from jsonb_array_elements(coalesce(p_tags, '[]')) loop
    select pm.id into v_media from public.post_media pm
    where pm.post_id = p_post_id and pm.position = (t ->> 'position')::int;
    if v_media is null then
      raise exception 'invalid_people_tag' using errcode = '22023';
    end if;
    v_profile := (t ->> 'profile_id')::uuid;
    if not exists (select 1 from public.profiles pr where pr.id = v_profile and pr.onboarded_at is not null)
       or v_profile in (select public.my_block_peers()) then
      raise exception 'person_not_found' using errcode = 'P0002';
    end if;
    insert into public.people_tags (post_media_id, profile_id, x, y)
    values (v_media, v_profile, (t ->> 'x')::real, (t ->> 'y')::real)
    on conflict (post_media_id, profile_id) do update set x = excluded.x, y = excluded.y;
  end loop;

  insert into public.notifications (recipient_id, kind, actor_id, post_id)
  select distinct pt.profile_id, 'tag', v_uid, p_post_id
  from public.people_tags pt join public.post_media pm on pm.id = pt.post_media_id
  where pm.post_id = p_post_id
    and pt.profile_id <> all (v_before)
    and coalesce((select notify_mentions from public.profile_private where profile_id = pt.profile_id), false)
    and public.may_notify_about_post(pt.profile_id, v_uid, p_post_id)
  on conflict (recipient_id, kind, post_id) where sent_at is null and post_id is not null
  do update set actor_id = excluded.actor_id;
exception
  when invalid_text_representation then
    raise exception 'invalid_people_tag' using errcode = '22023';
end;
$$;

-- A tagged person can take themselves off a post.
create function public.remove_my_people_tag(p_post_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.people_tags pt using public.post_media pm
  where pm.id = pt.post_media_id and pm.post_id = p_post_id and pt.profile_id = auth.uid()
$$;

revoke execute on function public.set_people_tags(uuid, jsonb) from public, anon;
revoke execute on function public.remove_my_people_tag(uuid) from public, anon;
grant execute on function public.set_people_tags(uuid, jsonb) to authenticated;
grant execute on function public.remove_my_people_tag(uuid) to authenticated;

-- Media JSON gains "people": who's tagged where (minus anyone the viewer has a block with).
create or replace function public.post_media_json(p_post_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(
    (select jsonb_agg(
              jsonb_build_object(
                'kind', m.kind,
                'path', m.storage_path,
                'playback_id', m.mux_playback_id,
                'duration', m.duration_s,
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
                  '[]'::jsonb),
                'people', coalesce(
                  (select jsonb_agg(
                            jsonb_build_object('profile_id', pr.id, 'handle', pr.handle, 'x', pt.x, 'y', pt.y)
                            order by pt.y, pt.x)
                   from public.people_tags pt
                   join public.profiles pr on pr.id = pt.profile_id
                   where pt.post_media_id = m.id
                     and pt.profile_id not in (select public.my_block_peers())),
                  '[]'::jsonb))
              order by m.position)
     from public.post_media m where m.post_id = p_post_id),
    '[]'::jsonb)
$$;

------------------------------------------------------------------------------
-- Activity: mentions and tags show up too
------------------------------------------------------------------------------

create or replace function public.activity_rows(p_uid uuid)
returns table (
  kind text,
  actor_id uuid,
  post_id uuid,
  body text,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select 'like', l.profile_id, l.post_id, null::text, l.created_at
  from public.post_likes l join public.posts p on p.id = l.post_id
  where p.author_id = p_uid and l.profile_id <> p_uid and p.status = 'published'
  union all
  select 'comment', c.author_id, c.post_id, left(c.body, 140), c.created_at
  from public.comments c join public.posts p on p.id = c.post_id
  where p.author_id = p_uid and c.author_id <> p_uid and p.status = 'published'
    and c.removed_at is null and c.hidden_at is null
  union all
  select 'reply', c.author_id, c.post_id, left(c.body, 140), c.created_at
  from public.comments c
  join public.comments par on par.id = c.parent_id
  join public.posts p on p.id = c.post_id
  where par.author_id = p_uid and c.author_id <> p_uid and p.author_id <> p_uid and p.status = 'published'
    and c.removed_at is null and c.hidden_at is null
  union all
  select 'follow', f.follower_id, null::uuid, null::text, f.created_at
  from public.follows f
  where f.followee_id = p_uid
  union all
  select 'mention', p.author_id, p.id, left(p.caption, 140), m.created_at
  from public.post_mentions m join public.posts p on p.id = m.post_id
  where m.profile_id = p_uid and p.author_id <> p_uid
    and public.may_notify_about_post(p_uid, p.author_id, p.id)
  union all
  select 'comment_mention', c.author_id, c.post_id, left(c.body, 140), c.created_at
  from public.comment_mentions m
  join public.comments c on c.id = m.comment_id
  join public.posts p on p.id = c.post_id
  where m.profile_id = p_uid and c.author_id <> p_uid and p.author_id <> p_uid
    and (c.parent_id is null or (select par.author_id from public.comments par where par.id = c.parent_id) <> p_uid)
    and c.removed_at is null and c.hidden_at is null
    and public.may_notify_about_post(p_uid, c.author_id, p.id)
  union all
  select distinct on (pm.post_id) 'tag', p.author_id, pm.post_id, null::text, pt.created_at
  from public.people_tags pt
  join public.post_media pm on pm.id = pt.post_media_id
  join public.posts p on p.id = pm.post_id
  where pt.profile_id = p_uid and p.author_id <> p_uid and p.status = 'published'
$$;
revoke execute on function public.activity_rows(uuid) from public, anon, authenticated;

------------------------------------------------------------------------------
-- Collections
------------------------------------------------------------------------------

create function public.my_collections()
returns table (id uuid, name text, post_count int, cover_path text, cover_playback_id text, created_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, c.name,
         (select count(*)::int from public.collection_posts cp
          join public.posts p on p.id = cp.post_id and p.status = 'published'
          where cp.collection_id = c.id),
         cov.storage_path, cov.mux_playback_id, c.created_at
  from public.collections c
  left join lateral (
    select pm.storage_path, pm.mux_playback_id
    from public.collection_posts cp
    join public.posts p on p.id = cp.post_id and p.status = 'published'
    join public.post_media pm on pm.post_id = cp.post_id and pm.position = 0
    where cp.collection_id = c.id
    order by cp.added_at desc limit 1
  ) cov on true
  where c.owner_id = auth.uid()
  order by c.created_at
$$;

create function public.create_collection(p_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(p_name, ''))) not between 1 and 40 then
    raise exception 'invalid_collection_name' using errcode = '22023';
  end if;
  if (select count(*) from public.collections where owner_id = v_uid) >= 100 then
    raise exception 'collection_limit' using errcode = 'P0001';
  end if;
  insert into public.collections (owner_id, name) values (v_uid, btrim(p_name)) returning id into v_id;
  return v_id;
exception
  when unique_violation then
    raise exception 'collection_exists' using errcode = '23505';
end;
$$;

create function public.rename_collection(p_collection_id uuid, p_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if char_length(btrim(coalesce(p_name, ''))) not between 1 and 40 then
    raise exception 'invalid_collection_name' using errcode = '22023';
  end if;
  update public.collections set name = btrim(p_name) where id = p_collection_id and owner_id = auth.uid();
  if not found then
    raise exception 'collection_not_found' using errcode = 'P0002';
  end if;
exception
  when unique_violation then
    raise exception 'collection_exists' using errcode = '23505';
end;
$$;

-- Deleting a collection keeps the posts in Saved.
create function public.delete_collection(p_collection_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.collections where id = p_collection_id and owner_id = auth.uid()
$$;

-- Adding to a collection also saves the post; removing keeps it saved.
create function public.set_in_collection(p_collection_id uuid, p_post_id uuid, p_in boolean)
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
  if not exists (select 1 from public.collections where id = p_collection_id and owner_id = v_uid) then
    raise exception 'collection_not_found' using errcode = 'P0002';
  end if;
  if not p_in then
    delete from public.collection_posts where collection_id = p_collection_id and post_id = p_post_id;
    return;
  end if;
  perform public.set_post_saved(p_post_id, true);
  if (select count(*) from public.collection_posts where collection_id = p_collection_id) >= 5000 then
    raise exception 'save_limit' using errcode = 'P0001';
  end if;
  insert into public.collection_posts (collection_id, post_id) values (p_collection_id, p_post_id)
  on conflict do nothing;
end;
$$;

-- Which of my collections hold this post.
create function public.post_collection_ids(p_post_id uuid)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(cp.collection_id), '{}')
  from public.collection_posts cp join public.collections c on c.id = cp.collection_id
  where cp.post_id = p_post_id and c.owner_id = auth.uid()
$$;

-- Unsaving a post takes it out of all of that person's collections.
create function public.on_unsave_post()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.collection_posts cp using public.collections c
  where c.id = cp.collection_id and c.owner_id = old.profile_id and cp.post_id = old.post_id;
  return old;
end;
$$;
revoke execute on function public.on_unsave_post() from public, anon, authenticated;

create trigger saved_posts_unsave
after delete on public.saved_posts
for each row execute function public.on_unsave_post();

revoke execute on function public.my_collections() from public, anon;
revoke execute on function public.create_collection(text) from public, anon;
revoke execute on function public.rename_collection(uuid, text) from public, anon;
revoke execute on function public.delete_collection(uuid) from public, anon;
revoke execute on function public.set_in_collection(uuid, uuid, boolean) from public, anon;
revoke execute on function public.post_collection_ids(uuid) from public, anon;
grant execute on function public.my_collections() to authenticated;
grant execute on function public.create_collection(text) to authenticated;
grant execute on function public.rename_collection(uuid, text) to authenticated;
grant execute on function public.delete_collection(uuid) to authenticated;
grant execute on function public.set_in_collection(uuid, uuid, boolean) to authenticated;
grant execute on function public.post_collection_ids(uuid) to authenticated;

------------------------------------------------------------------------------
-- Feed: by hashtag, by people tagged, by collection
------------------------------------------------------------------------------

drop function public.discover_posts(text, int, timestamptz, uuid, boolean, uuid, uuid, boolean, boolean);
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

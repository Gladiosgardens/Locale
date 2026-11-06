-- Likes, comments and saves.
--
-- - Likes: one per person per post. Counts are public; who liked is not listed.
-- - Comments: flat, up to 1,000 characters, on posts you can see. The commenter
--   or the post's author can delete one. Comments can be reported; one
--   child-safety report or three reporters hide it pending review.
-- - Saves: posts ("Saved") and individual tagged items (a wishlist). Saved
--   items only show while the post they came from is still visible to you.
-- - A push notification when someone comments on your post, with its own switch.
-- Every write goes through a function that checks the post is visible to the caller.

------------------------------------------------------------------------------
-- Tables
------------------------------------------------------------------------------

create table public.post_likes (
  post_id uuid not null references public.posts (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, profile_id)
);
create index post_likes_profile_idx on public.post_likes (profile_id, created_at desc);

create table public.comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts (id) on delete cascade,
  author_id uuid not null references public.profiles (id) on delete cascade,
  body text not null check (body = btrim(body) and char_length(body) between 1 and 1000),
  created_at timestamptz not null default now(),
  hidden_at timestamptz,
  removed_at timestamptz
);
create index comments_post_idx on public.comments (post_id, created_at, id);
create index comments_author_recent_idx on public.comments (author_id, created_at desc);

create table public.saved_posts (
  profile_id uuid not null references public.profiles (id) on delete cascade,
  post_id uuid not null references public.posts (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (profile_id, post_id)
);

create table public.saved_items (
  profile_id uuid not null references public.profiles (id) on delete cascade,
  item_id uuid not null references public.items (id) on delete cascade,
  -- The post it was saved from, for the photo and to re-check visibility.
  post_id uuid not null references public.posts (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (profile_id, item_id)
);
create index saved_items_recent_idx on public.saved_items (profile_id, created_at desc);

alter table public.post_likes enable row level security;
alter table public.comments enable row level security;
alter table public.saved_posts enable row level security;
alter table public.saved_items enable row level security;
revoke all on public.post_likes, public.comments, public.saved_posts, public.saved_items from anon, authenticated;

-- People can read their own saved items (to show the Save button's state). All writes go through functions.
grant select on public.saved_items to authenticated;
create policy "own saved items" on public.saved_items for select to authenticated
  using (profile_id = (select auth.uid()));

------------------------------------------------------------------------------
-- Likes
------------------------------------------------------------------------------

create function public.set_post_like(p_post_id uuid, p_like boolean)
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
  if not p_like then
    delete from public.post_likes where post_id = p_post_id and profile_id = v_uid;
    return;
  end if;
  if not public.can_view_post(p_post_id) then
    raise exception 'post_not_found' using errcode = 'P0002';
  end if;
  if (select count(*) from public.post_likes
      where profile_id = v_uid and created_at > now() - interval '1 hour') >= 300 then
    raise exception 'like_rate_limited' using errcode = 'P0001';
  end if;
  insert into public.post_likes (post_id, profile_id) values (p_post_id, v_uid) on conflict do nothing;
end;
$$;

------------------------------------------------------------------------------
-- Comments
------------------------------------------------------------------------------

create function public.add_comment(p_post_id uuid, p_body text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_body text := btrim(coalesce(p_body, ''));
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if not exists (select 1 from public.profiles pr where pr.id = v_uid and pr.onboarded_at is not null) then
    raise exception 'not_onboarded' using errcode = '22023';
  end if;
  if char_length(v_body) not between 1 and 1000 then
    raise exception 'invalid_comment' using errcode = '22023';
  end if;
  if not public.can_view_post(p_post_id) then
    raise exception 'post_not_found' using errcode = 'P0002';
  end if;
  if (select count(*) from public.comments c
      where c.author_id = v_uid and c.created_at > now() - interval '10 minutes') >= 30 then
    raise exception 'comment_rate_limited' using errcode = 'P0001';
  end if;
  insert into public.comments (post_id, author_id, body) values (p_post_id, v_uid, v_body)
  returning id into v_id;
  return v_id;
end;
$$;

-- The commenter, or the author of the post, can delete a comment.
create function public.delete_comment(p_comment_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.comments c set removed_at = now()
  where c.id = p_comment_id and c.removed_at is null
    and (c.author_id = auth.uid()
         or exists (select 1 from public.posts p where p.id = c.post_id and p.author_id = auth.uid()))
$$;

-- Oldest first, paged forward with (created_at, id).
create function public.list_comments(
  p_post_id uuid,
  p_limit int default 30,
  p_after_created_at timestamptz default null,
  p_after_id uuid default null
)
returns table (
  id uuid,
  body text,
  created_at timestamptz,
  author_id uuid,
  author_handle text,
  author_display_name text,
  can_delete boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, c.body, c.created_at, c.author_id, pr.handle, pr.display_name,
         c.author_id = auth.uid() or p.author_id = auth.uid()
  from public.comments c
  join public.posts p on p.id = c.post_id
  join public.profiles pr on pr.id = c.author_id
  where c.post_id = p_post_id
    and auth.uid() is not null
    and public.can_view_post(p_post_id)
    and c.removed_at is null and c.hidden_at is null
    and c.author_id not in (select public.my_block_peers())
    and (p_after_created_at is null
         or (c.created_at, c.id) > (p_after_created_at,
             coalesce(p_after_id, '00000000-0000-0000-0000-000000000000'::uuid)))
  order by c.created_at, c.id
  limit least(greatest(coalesce(p_limit, 30), 1), 100)
$$;

------------------------------------------------------------------------------
-- Saves
------------------------------------------------------------------------------

create function public.set_post_saved(p_post_id uuid, p_saved boolean)
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
  if not p_saved then
    delete from public.saved_posts where profile_id = v_uid and post_id = p_post_id;
    return;
  end if;
  if not public.can_view_post(p_post_id) then
    raise exception 'post_not_found' using errcode = 'P0002';
  end if;
  if (select count(*) from public.saved_posts where profile_id = v_uid) >= 5000 then
    raise exception 'save_limit' using errcode = 'P0001';
  end if;
  insert into public.saved_posts (profile_id, post_id) values (v_uid, p_post_id) on conflict do nothing;
end;
$$;

create function public.set_item_saved(p_item_id uuid, p_post_id uuid, p_saved boolean)
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
  if not p_saved then
    delete from public.saved_items where profile_id = v_uid and item_id = p_item_id;
    return;
  end if;
  -- The item must be tagged on that post, and the post visible to the caller.
  if not exists (select 1 from public.item_tags t join public.post_media m on m.id = t.post_media_id
                 where t.item_id = p_item_id and m.post_id = p_post_id)
     or not public.can_view_post(p_post_id) then
    raise exception 'item_not_found' using errcode = 'P0002';
  end if;
  if (select count(*) from public.saved_items where profile_id = v_uid) >= 5000 then
    raise exception 'save_limit' using errcode = 'P0001';
  end if;
  insert into public.saved_items (profile_id, item_id, post_id) values (v_uid, p_item_id, p_post_id)
  on conflict (profile_id, item_id) do update set post_id = excluded.post_id, created_at = now();
end;
$$;

-- Your wishlist, newest first, with the photo the item was saved from.
create function public.my_saved_items(p_limit int default 30, p_before_created_at timestamptz default null)
returns table (
  item_id uuid,
  title text,
  brand text,
  store_name text,
  url text,
  url_host text,
  price_cents int,
  currency text,
  is_affiliate boolean,
  post_id uuid,
  photo_path text,
  saved_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select i.id, i.title, i.brand, i.store_name, i.url, i.url_host, i.price_cents, i.currency, i.is_affiliate,
         s.post_id,
         (select m.storage_path from public.post_media m
          join public.item_tags t on t.post_media_id = m.id and t.item_id = i.id
          where m.post_id = s.post_id order by m.position limit 1),
         s.created_at
  from public.saved_items s
  join public.items i on i.id = s.item_id
  where s.profile_id = auth.uid()
    and public.can_view_post(s.post_id)
    and (p_before_created_at is null or s.created_at < p_before_created_at)
  order by s.created_at desc
  limit least(greatest(coalesce(p_limit, 30), 1), 100)
$$;

------------------------------------------------------------------------------
-- Reporting comments
------------------------------------------------------------------------------

alter table public.reports drop constraint reports_target_type_check;
alter table public.reports add constraint reports_target_type_check
  check (target_type in ('post', 'profile', 'group', 'message', 'comment'));

create or replace function public.report_content(
  p_target_type text,
  p_target_id uuid,
  p_reason text,
  p_details text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_visible boolean;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if (select count(*) from public.reports
      where reporter_id = v_uid and created_at > now() - interval '24 hours') >= 30 then
    raise exception 'report_rate_limited' using errcode = 'P0001';
  end if;

  v_visible := case p_target_type
    when 'post' then public.can_view_post(p_target_id)
    when 'message' then exists (
      select 1 from public.messages m
      join public.conversation_members me
        on me.conversation_id = m.conversation_id and me.profile_id = v_uid and me.state <> 'declined'
      where m.id = p_target_id and m.sender_id <> v_uid and m.removed_at is null)
    when 'comment' then exists (
      select 1 from public.comments c
      where c.id = p_target_id and c.author_id <> v_uid and c.removed_at is null
        and public.can_view_post(c.post_id))
    when 'profile' then p_target_id <> v_uid and exists (
      select 1 from public.profiles where id = p_target_id and onboarded_at is not null)
    when 'group' then public.can_see_group(p_target_id)
    else false
  end;
  if not coalesce(v_visible, false) then
    raise exception 'report_target_not_found' using errcode = 'P0002';
  end if;

  begin
    insert into public.reports (reporter_id, target_type, target_id, reason, details, snapshot)
    values (
      v_uid, p_target_type, p_target_id, p_reason, nullif(btrim(coalesce(p_details, '')), ''),
      case
        -- Reporting a private message shares that one message with reviewers.
        when p_target_type = 'message' then (
          select jsonb_build_object('body', m.body, 'shared_post_id', m.shared_post_id,
                                    'sender_id', m.sender_id, 'conversation_id', m.conversation_id,
                                    'sent_at', m.created_at)
          from public.messages m where m.id = p_target_id)
        when p_target_type = 'comment' then (
          select jsonb_build_object('body', c.body, 'author_id', c.author_id, 'post_id', c.post_id,
                                    'commented_at', c.created_at)
          from public.comments c where c.id = p_target_id)
      end
    );
  exception
    when unique_violation then
      return; -- already reported by this person
    when check_violation then
      raise exception 'invalid_report' using errcode = '22023';
  end;

  -- Hide a post or comment pending review: any child-safety report, or 3 different reporters.
  if p_target_type in ('post', 'comment') and (
       p_reason = 'child_safety'
       or (select count(distinct reporter_id) from public.reports
           where target_type = p_target_type and target_id = p_target_id and status = 'open') >= 3
     ) then
    if p_target_type = 'post' then
      update public.posts set status = 'hidden', hidden_at = now()
      where id = p_target_id and status = 'published';
    else
      update public.comments set hidden_at = now() where id = p_target_id and hidden_at is null;
    end if;
  end if;
end;
$$;

create or replace function public.resolve_report(p_target_type text, p_target_id uuid, p_action text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_action not in ('remove', 'dismiss') then
    raise exception 'invalid_action' using errcode = '22023';
  end if;

  update public.reports
  set status = case when p_action = 'remove' then 'actioned' else 'dismissed' end,
      resolved_at = now()
  where target_type = p_target_type and target_id = p_target_id and status = 'open';
  if not found then
    raise exception 'report_not_found' using errcode = 'P0002';
  end if;

  if p_target_type = 'message' and p_action = 'remove' then
    update public.messages set body = null, shared_post_id = null, removed_at = now()
    where id = p_target_id and removed_at is null;
  end if;

  if p_target_type = 'comment' then
    if p_action = 'remove' then
      update public.comments set removed_at = now() where id = p_target_id and removed_at is null;
    else
      update public.comments set hidden_at = null where id = p_target_id;
    end if;
  end if;

  if p_target_type = 'post' then
    if p_action = 'remove' then
      update public.posts set status = 'removed', removed_at = now(), hidden_at = null
      where id = p_target_id and status <> 'removed';
    else
      update public.posts set status = 'published', hidden_at = null
      where id = p_target_id and status = 'hidden';
    end if;
  end if;
end;
$$;

------------------------------------------------------------------------------
-- Comment notifications
------------------------------------------------------------------------------

alter table public.profile_private add column notify_comments boolean not null default true;

drop function public.set_notification_preferences(boolean, boolean, boolean);
create function public.set_notification_preferences(
  p_messages boolean default null,
  p_groups boolean default null,
  p_follows boolean default null,
  p_comments boolean default null
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
      notify_comments = coalesce(p_comments, notify_comments)
  where profile_id = auth.uid()
$$;

alter table public.notifications add column post_id uuid references public.posts (id) on delete cascade;
alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('message', 'message_request', 'group_join_request', 'group_join_approved', 'new_follower', 'comment'));
-- While one comment notification for a post is unsent, more comments don't add more.
create unique index notifications_pending_post
  on public.notifications (recipient_id, kind, post_id)
  where sent_at is null and post_id is not null;

create function public.notify_on_comment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_author uuid;
begin
  select p.author_id into v_author from public.posts p where p.id = new.post_id;
  if v_author is not null and v_author <> new.author_id
     and coalesce((select notify_comments from public.profile_private where profile_id = v_author), false)
     and not exists (select 1 from public.blocks b
                     where (b.blocker_id = v_author and b.blocked_id = new.author_id)
                        or (b.blocker_id = new.author_id and b.blocked_id = v_author)) then
    insert into public.notifications (recipient_id, kind, actor_id, post_id)
    values (v_author, 'comment', new.author_id, new.post_id)
    on conflict (recipient_id, kind, post_id) where sent_at is null and post_id is not null
    do update set actor_id = excluded.actor_id;
  end if;
  return new;
end;
$$;

create trigger comments_notify
  after insert on public.comments
  for each row execute function public.notify_on_comment();

drop function public.claim_notifications(int);
create function public.claim_notifications(p_limit int default 100)
returns table (
  id bigint,
  kind text,
  actor_id uuid,
  actor_name text,
  group_name text,
  conversation_id uuid,
  group_id uuid,
  post_id uuid,
  tokens text[]
)
language sql
security definer
set search_path = ''
as $$
  with picked as (
    select n.id from public.notifications n
    where n.sent_at is null and (n.claimed_at is null or n.claimed_at < now() - interval '5 minutes')
    order by n.id
    limit least(greatest(coalesce(p_limit, 100), 1), 500)
    for update skip locked
  ),
  claimed as (
    update public.notifications n set claimed_at = now()
    from picked where n.id = picked.id
    returning n.*
  )
  select c.id, c.kind, c.actor_id, a.display_name, g.name, c.conversation_id, c.group_id, c.post_id,
         coalesce((select array_agg(t.token order by t.last_seen_at desc)
                   from public.push_tokens t where t.profile_id = c.recipient_id), '{}')
  from claimed c
  left join public.profiles a on a.id = c.actor_id
  left join public.groups g on g.id = c.group_id
  order by c.id
$$;

------------------------------------------------------------------------------
-- Privileges
------------------------------------------------------------------------------

revoke execute on function public.set_post_like(uuid, boolean) from public, anon;
revoke execute on function public.add_comment(uuid, text) from public, anon;
revoke execute on function public.delete_comment(uuid) from public, anon;
revoke execute on function public.list_comments(uuid, int, timestamptz, uuid) from public, anon;
revoke execute on function public.set_post_saved(uuid, boolean) from public, anon;
revoke execute on function public.set_item_saved(uuid, uuid, boolean) from public, anon;
revoke execute on function public.my_saved_items(int, timestamptz) from public, anon;
revoke execute on function public.set_notification_preferences(boolean, boolean, boolean, boolean) from public, anon;
revoke execute on function public.notify_on_comment() from public, anon, authenticated;
revoke execute on function public.claim_notifications(int) from public, anon, authenticated;
grant execute on function public.set_post_like(uuid, boolean) to authenticated;
grant execute on function public.add_comment(uuid, text) to authenticated;
grant execute on function public.delete_comment(uuid) to authenticated;
grant execute on function public.list_comments(uuid, int, timestamptz, uuid) to authenticated;
grant execute on function public.set_post_saved(uuid, boolean) to authenticated;
grant execute on function public.set_item_saved(uuid, uuid, boolean) to authenticated;
grant execute on function public.my_saved_items(int, timestamptz) to authenticated;
grant execute on function public.set_notification_preferences(boolean, boolean, boolean, boolean) to authenticated;
grant execute on function public.claim_notifications(int) to service_role;

------------------------------------------------------------------------------
-- Discovery: counts, my likes and saves, and a Saved filter
------------------------------------------------------------------------------

drop function public.discover_posts(text, int, timestamptz, uuid, boolean, uuid, uuid, boolean);
create function public.discover_posts(
  p_query text default null,
  p_limit int default 20,
  p_before_published_at timestamptz default null,
  p_before_id uuid default null,
  p_following boolean default false,
  p_author_id uuid default null,
  p_post_id uuid default null,
  p_for_you boolean default false,
  p_saved boolean default false
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
revoke execute on function public.discover_posts(text, int, timestamptz, uuid, boolean, uuid, uuid, boolean, boolean) from public, anon;
grant execute on function public.discover_posts(text, int, timestamptz, uuid, boolean, uuid, uuid, boolean, boolean) to authenticated;

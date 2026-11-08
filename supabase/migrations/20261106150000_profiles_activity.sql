-- Profile photos, the activity feed, caption edits, and comment replies and likes.
--
-- - Profile photos: the app uploads to post-uploads; the set-avatar Edge
--   Function strips metadata (like location) and stores a clean copy in the
--   public "avatars" bucket at <user id>/<random>.jpg.
-- - Activity: likes and comments on your posts, replies to your comments, and
--   new followers, newest first, with an unread count since you last looked.
-- - Authors can edit a post's caption.
-- - Comments can reply to a top-level comment (one level), and can be liked.

------------------------------------------------------------------------------
-- Profile photos
------------------------------------------------------------------------------

alter table public.profiles add column avatar_path text
  check (avatar_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.jpg$');

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 2097152, array['image/jpeg'])
on conflict (id) do nothing;
-- No client policies on avatars: only the Edge Function (service role) writes.

-- Set by set-avatar after it stores the cleaned photo. Returns the old path to delete.
create function public.set_avatar_path(p_profile_id uuid, p_path text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old text;
begin
  if p_path is not null and p_path not like p_profile_id::text || '/%' then
    raise exception 'invalid_avatar' using errcode = '22023';
  end if;
  select avatar_path into v_old from public.profiles where id = p_profile_id for update;
  update public.profiles set avatar_path = p_path, updated_at = now() where id = p_profile_id;
  return v_old;
end;
$$;
revoke execute on function public.set_avatar_path(uuid, text) from public, anon, authenticated;
grant execute on function public.set_avatar_path(uuid, text) to service_role;

------------------------------------------------------------------------------
-- Caption edits
------------------------------------------------------------------------------

create function public.update_post_caption(p_post_id uuid, p_caption text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caption text := nullif(btrim(coalesce(p_caption, '')), '');
begin
  if char_length(coalesce(v_caption, '')) > 2200 then
    raise exception 'invalid_caption' using errcode = '22023';
  end if;
  update public.posts set caption = v_caption
  where id = p_post_id and author_id = auth.uid() and status in ('published', 'hidden');
  if not found then
    raise exception 'post_not_found' using errcode = 'P0002';
  end if;
end;
$$;
revoke execute on function public.update_post_caption(uuid, text) from public, anon;
grant execute on function public.update_post_caption(uuid, text) to authenticated;

------------------------------------------------------------------------------
-- Comment replies and likes
------------------------------------------------------------------------------

alter table public.comments add column parent_id uuid references public.comments (id) on delete cascade;
create index comments_parent_idx on public.comments (parent_id) where parent_id is not null;

create table public.comment_likes (
  comment_id uuid not null references public.comments (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (comment_id, profile_id)
);
alter table public.comment_likes enable row level security;
revoke all on public.comment_likes from anon, authenticated;

drop function public.add_comment(uuid, text);
create function public.add_comment(p_post_id uuid, p_body text, p_parent_id uuid default null)
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
  -- Replies go to a visible top-level comment on the same post.
  if p_parent_id is not null and not exists (
    select 1 from public.comments c
    where c.id = p_parent_id and c.post_id = p_post_id and c.parent_id is null
      and c.removed_at is null and c.hidden_at is null
      and c.author_id not in (select public.my_block_peers())
  ) then
    raise exception 'comment_not_found' using errcode = 'P0002';
  end if;
  if (select count(*) from public.comments c
      where c.author_id = v_uid and c.created_at > now() - interval '10 minutes') >= 30 then
    raise exception 'comment_rate_limited' using errcode = 'P0001';
  end if;
  insert into public.comments (post_id, author_id, body, parent_id) values (p_post_id, v_uid, v_body, p_parent_id)
  returning id into v_id;
  return v_id;
end;
$$;

create function public.set_comment_like(p_comment_id uuid, p_like boolean)
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
    delete from public.comment_likes where comment_id = p_comment_id and profile_id = v_uid;
    return;
  end if;
  if not exists (select 1 from public.comments c
                 where c.id = p_comment_id and c.removed_at is null and c.hidden_at is null
                   and c.author_id not in (select public.my_block_peers())
                   and public.can_view_post(c.post_id)) then
    raise exception 'comment_not_found' using errcode = 'P0002';
  end if;
  insert into public.comment_likes (comment_id, profile_id) values (p_comment_id, v_uid) on conflict do nothing;
end;
$$;

drop function public.list_comments(uuid, int, timestamptz, uuid);
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
  can_delete boolean,
  parent_id uuid,
  like_count int,
  i_liked boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, c.body, c.created_at, c.author_id, pr.handle, pr.display_name,
         c.author_id = auth.uid() or p.author_id = auth.uid(),
         c.parent_id,
         (select count(*)::int from public.comment_likes l where l.comment_id = c.id),
         exists (select 1 from public.comment_likes l where l.comment_id = c.id and l.profile_id = auth.uid())
  from public.comments c
  join public.posts p on p.id = c.post_id
  join public.profiles pr on pr.id = c.author_id
  where c.post_id = p_post_id
    and auth.uid() is not null
    and public.can_view_post(p_post_id)
    and c.removed_at is null and c.hidden_at is null
    and c.author_id not in (select public.my_block_peers())
    -- A reply to a hidden or removed comment is hidden with it.
    and (c.parent_id is null or exists (
      select 1 from public.comments par where par.id = c.parent_id and par.removed_at is null and par.hidden_at is null
        and par.author_id not in (select public.my_block_peers())))
    and (p_after_created_at is null
         or (c.created_at, c.id) > (p_after_created_at,
             coalesce(p_after_id, '00000000-0000-0000-0000-000000000000'::uuid)))
  order by c.created_at, c.id
  limit least(greatest(coalesce(p_limit, 30), 1), 100)
$$;

revoke execute on function public.add_comment(uuid, text, uuid) from public, anon;
revoke execute on function public.set_comment_like(uuid, boolean) from public, anon;
revoke execute on function public.list_comments(uuid, int, timestamptz, uuid) from public, anon;
grant execute on function public.add_comment(uuid, text, uuid) to authenticated;
grant execute on function public.set_comment_like(uuid, boolean) to authenticated;
grant execute on function public.list_comments(uuid, int, timestamptz, uuid) to authenticated;

-- Replies notify the person replied to (unless they're the post's author, who
-- already hears about every comment).
alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('message', 'message_request', 'group_join_request', 'group_join_approved', 'new_follower',
                  'comment', 'reply'));

create or replace function public.notify_on_comment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_author uuid;
  v_parent_author uuid;
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

  if new.parent_id is not null then
    select c.author_id into v_parent_author from public.comments c where c.id = new.parent_id;
    if v_parent_author is not null and v_parent_author <> new.author_id and v_parent_author <> v_author
       and coalesce((select notify_comments from public.profile_private where profile_id = v_parent_author), false)
       and not exists (select 1 from public.blocks b
                       where (b.blocker_id = v_parent_author and b.blocked_id = new.author_id)
                          or (b.blocker_id = new.author_id and b.blocked_id = v_parent_author)) then
      insert into public.notifications (recipient_id, kind, actor_id, post_id)
      values (v_parent_author, 'reply', new.author_id, new.post_id)
      on conflict (recipient_id, kind, post_id) where sent_at is null and post_id is not null
      do update set actor_id = excluded.actor_id;
    end if;
  end if;
  return new;
end;
$$;

------------------------------------------------------------------------------
-- Activity
------------------------------------------------------------------------------

alter table public.profile_private add column activity_seen_at timestamptz not null default now();

create function public.activity_rows(p_uid uuid)
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
$$;
revoke execute on function public.activity_rows(uuid) from public, anon, authenticated;

create function public.my_activity(p_limit int default 30, p_before timestamptz default null)
returns table (
  kind text,
  actor_id uuid,
  actor_handle text,
  actor_display_name text,
  actor_avatar_path text,
  post_id uuid,
  post_media_path text,
  post_playback_id text,
  body text,
  created_at timestamptz,
  i_follow_actor boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select a.kind, a.actor_id, pr.handle, pr.display_name, pr.avatar_path, a.post_id,
         m.storage_path, m.mux_playback_id, a.body, a.created_at,
         exists (select 1 from public.follows f where f.follower_id = auth.uid() and f.followee_id = a.actor_id)
  from public.activity_rows(auth.uid()) a
  join public.profiles pr on pr.id = a.actor_id and pr.onboarded_at is not null
  left join lateral (
    select pm.storage_path, pm.mux_playback_id from public.post_media pm
    where pm.post_id = a.post_id order by pm.position limit 1
  ) m on true
  where auth.uid() is not null
    and a.actor_id not in (select public.my_block_peers())
    and (p_before is null or a.created_at < p_before)
  order by a.created_at desc
  limit least(greatest(coalesce(p_limit, 30), 1), 100)
$$;

create function public.my_activity_unread()
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select least(count(*), 99)::int
  from public.activity_rows(auth.uid()) a
  where auth.uid() is not null
    and a.created_at > (select activity_seen_at from public.profile_private where profile_id = auth.uid())
    and a.actor_id not in (select public.my_block_peers())
$$;

create function public.mark_activity_seen()
returns void
language sql
security definer
set search_path = ''
as $$
  update public.profile_private set activity_seen_at = now() where profile_id = auth.uid()
$$;

revoke execute on function public.my_activity(int, timestamptz) from public, anon;
revoke execute on function public.my_activity_unread() from public, anon;
revoke execute on function public.mark_activity_seen() from public, anon;
grant execute on function public.my_activity(int, timestamptz) to authenticated;
grant execute on function public.my_activity_unread() to authenticated;
grant execute on function public.mark_activity_seen() to authenticated;

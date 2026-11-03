-- Safety layer: blocking and reporting.
--
-- Blocks are two-way: neither person sees the other's posts (and therefore
-- tags, items and images) or profile anywhere. The blocked person is never
-- told and cannot see who blocked them.
--
-- Reports are private to the reporter and the service role. A post is hidden
-- pending review after one child-safety report or reports from 3 different
-- people. Review happens through moderation_queue + resolve_report() (service
-- role only).

------------------------------------------------------------------------------
-- Blocks
------------------------------------------------------------------------------

create table public.blocks (
  blocker_id uuid not null references public.profiles (id) on delete cascade,
  blocked_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint blocks_not_self check (blocker_id <> blocked_id)
);
create index blocks_blocked_idx on public.blocks (blocked_id);

alter table public.blocks enable row level security;
revoke all on public.blocks from anon, authenticated;
grant select on public.blocks to authenticated;

create policy "see the people I blocked"
  on public.blocks for select
  to authenticated
  using (blocker_id = (select auth.uid()));

-- Everyone the caller has blocked or been blocked by.
create function public.my_block_peers()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select blocked_id from public.blocks where blocker_id = auth.uid()
  union
  select blocker_id from public.blocks where blocked_id = auth.uid()
$$;
revoke execute on function public.my_block_peers() from public, anon;
grant execute on function public.my_block_peers() to authenticated;

create function public.block_user(p_profile_id uuid)
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
end;
$$;

create function public.unblock_user(p_profile_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.blocks where blocker_id = auth.uid() and blocked_id = p_profile_id
$$;

-- Handles and names of the people the caller blocked (profiles RLS would hide them).
create function public.my_blocked_profiles()
returns table (profile_id uuid, handle text, display_name text, blocked_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select b.blocked_id, p.handle, p.display_name, b.created_at
  from public.blocks b join public.profiles p on p.id = b.blocked_id
  where b.blocker_id = auth.uid()
  order by b.created_at desc
$$;

revoke execute on function public.block_user(uuid) from public, anon;
revoke execute on function public.unblock_user(uuid) from public, anon;
revoke execute on function public.my_blocked_profiles() from public, anon;
grant execute on function public.block_user(uuid) to authenticated;
grant execute on function public.unblock_user(uuid) to authenticated;
grant execute on function public.my_blocked_profiles() to authenticated;

------------------------------------------------------------------------------
-- Hidden posts
------------------------------------------------------------------------------

alter table public.posts drop constraint posts_status_check;
alter table public.posts add constraint posts_status_check
  check (status in ('published', 'hidden', 'removed'));
alter table public.posts add column hidden_at timestamptz;
alter table public.posts add constraint posts_hidden_at check ((status = 'hidden') = (hidden_at is not null));

-- Authors can also delete a post that is hidden pending review.
create or replace function public.delete_my_post(p_post_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.posts
  set status = 'removed', removed_at = now(), hidden_at = null
  where id = p_post_id and author_id = auth.uid() and status in ('published', 'hidden');
  if not found then
    raise exception 'post_not_found' using errcode = 'P0002';
  end if;
end;
$$;

------------------------------------------------------------------------------
-- Block-aware visibility
------------------------------------------------------------------------------

drop policy "read own profile or onboarded profiles" on public.profiles;
create policy "read own profile or onboarded, unblocked profiles"
  on public.profiles for select
  to authenticated
  using (
    id = (select auth.uid())
    or (onboarded_at is not null and id not in (select public.my_block_peers()))
  );

drop policy "read own, nearby, or group posts I may see" on public.posts;
create policy "read own, nearby, or group posts I may see"
  on public.posts for select
  to authenticated
  using (
    status = 'published'
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

-- One place that answers "may the caller see this post?"
create function public.can_view_post(p_post_id uuid)
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
revoke execute on function public.can_view_post(uuid) from public, anon;
grant execute on function public.can_view_post(uuid) to authenticated;

create or replace function public.can_view_post_media(p_path text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.post_media m
    where m.storage_path = p_path and public.can_view_post(m.post_id)
  )
$$;

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
      and p.author_id not in (select public.my_block_peers())
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
-- Reports
------------------------------------------------------------------------------

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles (id) on delete cascade,
  target_type text not null check (target_type in ('post', 'profile', 'group')),
  target_id uuid not null,
  reason text not null check (reason in (
    'spam', 'harassment', 'nudity', 'child_safety', 'violence', 'hate', 'scam', 'other')),
  details text check (char_length(details) <= 1000),
  status text not null default 'open' check (status in ('open', 'actioned', 'dismissed')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  unique (reporter_id, target_type, target_id)
);
create index reports_target_idx on public.reports (target_type, target_id) where status = 'open';
create index reports_reporter_idx on public.reports (reporter_id, created_at desc);

alter table public.reports enable row level security;
revoke all on public.reports from anon, authenticated;
grant select on public.reports to authenticated;

create policy "see my own reports"
  on public.reports for select
  to authenticated
  using (reporter_id = (select auth.uid()));

create function public.report_content(
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
    when 'profile' then p_target_id <> v_uid and exists (
      select 1 from public.profiles where id = p_target_id and onboarded_at is not null)
    when 'group' then public.can_see_group(p_target_id)
    else false
  end;
  if not coalesce(v_visible, false) then
    raise exception 'report_target_not_found' using errcode = 'P0002';
  end if;

  begin
    insert into public.reports (reporter_id, target_type, target_id, reason, details)
    values (v_uid, p_target_type, p_target_id, p_reason, nullif(btrim(coalesce(p_details, '')), ''));
  exception
    when unique_violation then
      return; -- already reported by this person
    when check_violation then
      raise exception 'invalid_report' using errcode = '22023';
  end;

  -- Hide a post pending review: any child-safety report, or 3 different reporters.
  if p_target_type = 'post' and (
       p_reason = 'child_safety'
       or (select count(distinct reporter_id) from public.reports
           where target_type = 'post' and target_id = p_target_id and status = 'open') >= 3
     ) then
    update public.posts set status = 'hidden', hidden_at = now()
    where id = p_target_id and status = 'published';
  end if;
end;
$$;
revoke execute on function public.report_content(text, uuid, text, text) from public, anon;
grant execute on function public.report_content(text, uuid, text, text) to authenticated;

------------------------------------------------------------------------------
-- Review (service role only)
------------------------------------------------------------------------------

create view public.moderation_queue
with (security_invoker = true) as
select
  r.target_type,
  r.target_id,
  count(*) as open_reports,
  count(distinct r.reporter_id) as reporters,
  bool_or(r.reason = 'child_safety') as child_safety,
  array_agg(distinct r.reason) as reasons,
  min(r.created_at) as first_reported_at,
  max(r.created_at) as last_reported_at,
  (select p.status from public.posts p where r.target_type = 'post' and p.id = r.target_id) as post_status
from public.reports r
where r.status = 'open'
group by r.target_type, r.target_id
order by bool_or(r.reason = 'child_safety') desc, count(distinct r.reporter_id) desc, min(r.created_at);

revoke all on public.moderation_queue from public, anon, authenticated;
grant select on public.moderation_queue to service_role;

-- p_action 'remove': take the post down (posts only) and close every open
-- report on the target. 'dismiss': close the target's open reports and
-- restore a hidden post.
create function public.resolve_report(p_target_type text, p_target_id uuid, p_action text)
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
revoke execute on function public.resolve_report(text, uuid, text) from public, anon, authenticated;
grant execute on function public.resolve_report(text, uuid, text) to service_role;

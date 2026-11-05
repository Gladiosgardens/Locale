-- Everyday posts and finding friends.
--
-- 1. Everyday topics come back next to the style ones (kid topics stay retired).
-- 2. People search by name or @handle.
-- 3. "Suggested for you": people who follow you, friends of friends, popular
--    accounts, then people who just joined.
-- 4. Contacts matching: the phone hashes its contacts' email addresses
--    (SHA-256) and sends only the hashes. We compare them with a hash of each
--    account's sign-in email and keep nothing that was sent. People can turn
--    this off, and calls are rate-limited so it can't be used to test lots of
--    addresses.
-- 5. A push notification when someone follows you, with its own switch.

------------------------------------------------------------------------------
-- Topics
------------------------------------------------------------------------------

update public.interests set active = true, sort_order = v.sort_order
from (values ('cooking', 310), ('coffee', 320), ('running', 350), ('yoga', 360), ('hiking', 370),
             ('cycling', 380), ('dogs', 390), ('cats', 400), ('gardening', 410), ('books', 420),
             ('board-games', 460)) as v(slug, sort_order)
where interests.slug = v.slug;

update public.interests set label = 'Travel', sort_order = 330 where slug = 'travel-style';

insert into public.interests (slug, label, sort_order) values
  ('food', 'Food', 300),
  ('fitness', 'Fitness', 340),
  ('music', 'Music', 430),
  ('cars', 'Cars', 440),
  ('sports', 'Sports', 450)
on conflict (slug) do update set active = true;

------------------------------------------------------------------------------
-- Settings
------------------------------------------------------------------------------

alter table public.profile_private
  add column findable_by_email boolean not null default true,
  add column notify_follows boolean not null default true;

create function public.set_findable_by_email(p_findable boolean)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.profile_private set findable_by_email = coalesce(p_findable, findable_by_email)
  where profile_id = auth.uid()
$$;

drop function public.set_notification_preferences(boolean, boolean);
create function public.set_notification_preferences(
  p_messages boolean default null,
  p_groups boolean default null,
  p_follows boolean default null
)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.profile_private
  set notify_messages = coalesce(p_messages, notify_messages),
      notify_groups = coalesce(p_groups, notify_groups),
      notify_follows = coalesce(p_follows, notify_follows)
  where profile_id = auth.uid()
$$;

revoke execute on function public.set_findable_by_email(boolean) from public, anon;
revoke execute on function public.set_notification_preferences(boolean, boolean, boolean) from public, anon;
grant execute on function public.set_findable_by_email(boolean) to authenticated;
grant execute on function public.set_notification_preferences(boolean, boolean, boolean) to authenticated;

------------------------------------------------------------------------------
-- People search
------------------------------------------------------------------------------

create index profiles_handle_prefix_idx on public.profiles (handle text_pattern_ops);
create index profiles_name_prefix_idx on public.profiles (lower(display_name) text_pattern_ops);

create function public.search_people(p_query text, p_limit int default 20)
returns table (
  id uuid,
  handle text,
  display_name text,
  follower_count int,
  i_follow boolean,
  follows_me boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_q text := lower(btrim(regexp_replace(coalesce(p_query, ''), '^\s*@', '')));
  v_like text;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if char_length(v_q) < 2 then
    raise exception 'query_too_short' using errcode = '22023';
  end if;
  v_q := left(v_q, 40);
  -- Escape LIKE wildcards so "%" or "_" in a query match literally.
  v_like := replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_');

  return query
  select p.id, p.handle, p.display_name,
         (select count(*)::int from public.follows f where f.followee_id = p.id) as followers,
         exists (select 1 from public.follows f where f.follower_id = v_uid and f.followee_id = p.id),
         exists (select 1 from public.follows f where f.follower_id = p.id and f.followee_id = v_uid)
  from public.profiles p
  where p.onboarded_at is not null
    and p.id <> v_uid
    and p.id not in (select public.my_block_peers())
    and (p.handle like v_like || '%'
         or lower(p.display_name) like v_like || '%'
         or lower(p.display_name) like '% ' || v_like || '%')
  order by (p.handle = v_q) desc, followers desc, p.handle
  limit least(greatest(coalesce(p_limit, 20), 1), 50);
end;
$$;

------------------------------------------------------------------------------
-- Suggestions
------------------------------------------------------------------------------

create function public.suggested_people(p_limit int default 20)
returns table (
  id uuid,
  handle text,
  display_name text,
  reason text,
  mutual_count int,
  mutual_name text
)
language sql
stable
security definer
set search_path = ''
as $$
  with me as (select auth.uid() as uid),
  following as (select f.followee_id as id from public.follows f, me where f.follower_id = me.uid),
  excluded as (
    select uid as id from me
    union select id from following
    union select public.my_block_peers()
  ),
  follows_you as (
    select f.follower_id as id, 'follows_you'::text as reason, 0 as mutuals, 3000000 as score
    from public.follows f, me where f.followee_id = me.uid
  ),
  mutual as (
    select f2.followee_id as id, 'mutual'::text, count(*)::int, 2000000 + count(*)::int
    from following fo
    join public.follows f2 on f2.follower_id = fo.id
    group by f2.followee_id
  ),
  popular as (
    select f.followee_id as id, 'popular'::text, 0, count(*)::int
    from public.follows f
    group by f.followee_id
    order by count(*) desc
    limit 200
  ),
  -- While the app is small, new people are worth showing too.
  recent as (
    select p.id, 'new'::text, 0, 0
    from public.profiles p
    where p.onboarded_at is not null
    order by p.onboarded_at desc
    limit 100
  ),
  candidates as (
    select distinct on (c.id) c.id, c.reason, c.mutuals, c.score
    from (select * from follows_you union all select * from mutual union all select * from popular
          union all select * from recent) c
    where c.id not in (select id from excluded where id is not null)
    order by c.id, c.score desc
  )
  select p.id, p.handle, p.display_name, c.reason, c.mutuals,
         case when c.reason = 'mutual' then (
           select fp.display_name from following fo
           join public.follows f2 on f2.follower_id = fo.id and f2.followee_id = c.id
           join public.profiles fp on fp.id = fo.id
           order by fp.display_name limit 1)
         end
  from candidates c
  join public.profiles p on p.id = c.id and p.onboarded_at is not null
  where (select uid from me) is not null
  order by c.score desc, p.handle
  limit least(greatest(coalesce(p_limit, 20), 1), 50)
$$;

------------------------------------------------------------------------------
-- Contacts matching
------------------------------------------------------------------------------

-- SHA-256 of each account's lowercased sign-in email. No grants: only the
-- functions below read it.
create table public.email_hashes (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  hash text not null unique check (hash ~ '^[0-9a-f]{64}$')
);
alter table public.email_hashes enable row level security;
revoke all on public.email_hashes from anon, authenticated;

create function public.email_hash(p_email text)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(pg_catalog.sha256(convert_to(lower(btrim(p_email)), 'UTF8')), 'hex')
$$;

create function public.sync_email_hash()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.email is null or btrim(new.email) = '' then
    delete from public.email_hashes where profile_id = new.id;
  elsif exists (select 1 from public.profiles where id = new.id) then
    insert into public.email_hashes (profile_id, hash) values (new.id, public.email_hash(new.email))
    on conflict (profile_id) do update set hash = excluded.hash;
  end if;
  return new;
end;
$$;

-- Runs after on_auth_user_created (triggers fire in name order), so the profile exists.
create trigger on_auth_user_email
  after insert or update of email on auth.users
  for each row execute function public.sync_email_hash();

insert into public.email_hashes (profile_id, hash)
select u.id, public.email_hash(u.email)
from auth.users u join public.profiles p on p.id = u.id
where u.email is not null and btrim(u.email) <> ''
on conflict do nothing;

create table public.contact_match_log (
  profile_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index contact_match_log_idx on public.contact_match_log (profile_id, created_at desc);
alter table public.contact_match_log enable row level security;
revoke all on public.contact_match_log from anon, authenticated;

create function public.match_contacts(p_hashes text[])
returns table (
  id uuid,
  handle text,
  display_name text,
  i_follow boolean
)
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
  if not exists (select 1 from public.profiles pr where pr.id = v_uid and pr.onboarded_at is not null) then
    raise exception 'not_onboarded' using errcode = '22023';
  end if;
  if coalesce(cardinality(p_hashes), 0) = 0 then
    return;
  end if;
  if cardinality(p_hashes) > 1000 then
    raise exception 'too_many_contacts' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(p_hashes) h where h is null or h !~ '^[0-9a-f]{64}$') then
    raise exception 'invalid_hash' using errcode = '22023';
  end if;
  if (select count(*) from public.contact_match_log l
      where l.profile_id = v_uid and created_at > now() - interval '24 hours') >= 5 then
    raise exception 'contacts_rate_limited' using errcode = 'P0001';
  end if;
  insert into public.contact_match_log (profile_id) values (v_uid);

  return query
  select p.id, p.handle, p.display_name,
         exists (select 1 from public.follows f where f.follower_id = v_uid and f.followee_id = p.id)
  from public.email_hashes e
  join public.profiles p on p.id = e.profile_id
  join public.profile_private pp on pp.profile_id = p.id
  where e.hash = any (p_hashes)
    and p.onboarded_at is not null
    and pp.findable_by_email
    and p.id <> v_uid
    and p.id not in (select public.my_block_peers())
  order by p.display_name;
end;
$$;

revoke execute on function public.search_people(text, int) from public, anon;
revoke execute on function public.suggested_people(int) from public, anon;
revoke execute on function public.match_contacts(text[]) from public, anon;
revoke execute on function public.sync_email_hash() from public, anon, authenticated;
grant execute on function public.search_people(text, int) to authenticated;
grant execute on function public.suggested_people(int) to authenticated;
grant execute on function public.match_contacts(text[]) to authenticated;

------------------------------------------------------------------------------
-- New-follower notifications
------------------------------------------------------------------------------

alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('message', 'message_request', 'group_join_request', 'group_join_approved', 'new_follower'));

create unique index notifications_pending_actor
  on public.notifications (recipient_id, kind, actor_id)
  where sent_at is null and kind = 'new_follower';

create function public.notify_on_follow()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Follow, unfollow, follow again within a day notifies once.
  if coalesce((select notify_follows from public.profile_private where profile_id = new.followee_id), false)
     and not exists (select 1 from public.notifications n
                     where n.recipient_id = new.followee_id and n.kind = 'new_follower'
                       and n.actor_id = new.follower_id and n.created_at > now() - interval '24 hours') then
    insert into public.notifications (recipient_id, kind, actor_id)
    values (new.followee_id, 'new_follower', new.follower_id)
    on conflict (recipient_id, kind, actor_id) where sent_at is null and kind = 'new_follower' do nothing;
  end if;
  return new;
end;
$$;

create trigger follows_notify
  after insert on public.follows
  for each row execute function public.notify_on_follow();

revoke execute on function public.notify_on_follow() from public, anon, authenticated;

-- The sender needs the actor's id to link a new-follower push to their profile.
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
  select c.id, c.kind, c.actor_id, a.display_name, g.name, c.conversation_id, c.group_id,
         coalesce((select array_agg(t.token order by t.last_seen_at desc)
                   from public.push_tokens t where t.profile_id = c.recipient_id), '{}')
  from claimed c
  left join public.profiles a on a.id = c.actor_id
  left join public.groups g on g.id = c.group_id
  order by c.id
$$;

revoke execute on function public.claim_notifications(int) from public, anon, authenticated;
grant execute on function public.claim_notifications(int) to service_role;

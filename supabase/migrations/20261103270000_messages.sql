-- Core-loop step 6b: one-to-one messaging with message requests.
--
-- Connections (mutual follows, or members of the same group) message freely.
-- Anyone else's first message is a request: it waits in the recipient's
-- Requests, and the sender cannot send more until it is accepted. Declining
-- is silent: the sender keeps seeing "request sent". People can switch
-- "who can message me" to connections only. Blocks stop messaging both ways
-- and hide the conversation. Shared posts render only if the viewer may see
-- the post. Reporting a message copies that message into the report.

------------------------------------------------------------------------------
-- Settings
------------------------------------------------------------------------------

alter table public.profile_private
  add column dm_policy text not null default 'everyone' check (dm_policy in ('everyone', 'connections'));

create function public.set_dm_policy(p_policy text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_policy not in ('everyone', 'connections') then
    raise exception 'invalid_setting' using errcode = '22023';
  end if;
  update public.profile_private set dm_policy = p_policy where profile_id = auth.uid();
end;
$$;

------------------------------------------------------------------------------
-- Tables
------------------------------------------------------------------------------

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  -- One conversation per pair: "<smaller uuid>:<larger uuid>".
  pair_key text not null unique,
  created_by uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  last_message_at timestamptz not null default now()
);
create index conversations_creator_idx on public.conversations (created_by, created_at desc);

create table public.conversation_members (
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  -- active: in the inbox; request: waiting in Requests; declined: request
  -- deleted (silently); hidden: removed from the inbox until a new message.
  state text not null check (state in ('active', 'request', 'declined', 'hidden')),
  last_read_at timestamptz,
  primary key (conversation_id, profile_id)
);
create index conversation_members_profile_idx on public.conversation_members (profile_id, state);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  sender_id uuid not null references public.profiles (id) on delete cascade,
  body text check (char_length(body) <= 2000),
  shared_post_id uuid references public.posts (id) on delete set null,
  created_at timestamptz not null default now(),
  removed_at timestamptz
);
create index messages_conversation_idx on public.messages (conversation_id, created_at desc, id desc);
create index messages_sender_recent_idx on public.messages (sender_id, created_at desc);

------------------------------------------------------------------------------
-- Helpers
------------------------------------------------------------------------------

-- Mutual follows, or both active members of some group.
create function public.are_connected(p_a uuid, p_b uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (
    exists (select 1 from public.follows where follower_id = p_a and followee_id = p_b)
    and exists (select 1 from public.follows where follower_id = p_b and followee_id = p_a)
  ) or exists (
    select 1 from public.group_members ga
    join public.group_members gb on gb.group_id = ga.group_id
    where ga.profile_id = p_a and gb.profile_id = p_b and ga.status = 'active' and gb.status = 'active'
  )
$$;
revoke execute on function public.are_connected(uuid, uuid) from public, anon, authenticated;

-- My membership row in a conversation, if I can see it at all.
create function public.my_conversation_state(p_conversation_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select state from public.conversation_members
  where conversation_id = p_conversation_id and profile_id = auth.uid() and state <> 'declined'
$$;
revoke execute on function public.my_conversation_state(uuid) from public, anon;
grant execute on function public.my_conversation_state(uuid) to authenticated;

create function public.conversation_peer(p_conversation_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select profile_id from public.conversation_members
  where conversation_id = p_conversation_id and profile_id <> auth.uid()
$$;
revoke execute on function public.conversation_peer(uuid) from public, anon;
grant execute on function public.conversation_peer(uuid) to authenticated;

------------------------------------------------------------------------------
-- RLS (reads only; all writes go through RPCs)
------------------------------------------------------------------------------

alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages enable row level security;
revoke all on public.conversations, public.conversation_members, public.messages from anon, authenticated;
grant select on public.conversations, public.conversation_members, public.messages to authenticated;

create policy "conversations I am in"
  on public.conversations for select
  to authenticated
  using (public.my_conversation_state(id) is not null
         and public.conversation_peer(id) not in (select public.my_block_peers()));

-- Only my own row: the other person's state (e.g. a silent decline) is never exposed.
create policy "my own membership rows"
  on public.conversation_members for select
  to authenticated
  using (profile_id = (select auth.uid()));

-- Also what Supabase Realtime uses to decide who receives new messages.
create policy "messages in conversations I am in"
  on public.messages for select
  to authenticated
  using (public.my_conversation_state(conversation_id) is not null
         and sender_id not in (select public.my_block_peers()));

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.messages;
  end if;
end;
$$;

------------------------------------------------------------------------------
-- Sending
------------------------------------------------------------------------------

-- Either p_to (start or continue the conversation with that person) or
-- p_conversation_id. Returns the conversation id.
create function public.send_message(
  p_to uuid default null,
  p_conversation_id uuid default null,
  p_body text default null,
  p_shared_post_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_other uuid;
  v_conv uuid;
  v_body text := nullif(btrim(coalesce(p_body, '')), '');
  v_my_state text;
  v_their_state text;
  v_creator uuid;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if not exists (select 1 from public.profiles where id = v_uid and onboarded_at is not null) then
    raise exception 'not_onboarded' using errcode = '22023';
  end if;
  if v_body is null and p_shared_post_id is null then
    raise exception 'empty_message' using errcode = '22023';
  end if;
  if char_length(v_body) > 2000 then
    raise exception 'message_too_long' using errcode = '22023';
  end if;
  if p_shared_post_id is not null and not public.can_view_post(p_shared_post_id) then
    raise exception 'post_unavailable' using errcode = 'P0002';
  end if;
  if (select count(*) from public.messages
      where sender_id = v_uid and created_at > now() - interval '1 minute') >= 30 then
    raise exception 'message_rate_limited' using errcode = 'P0001';
  end if;

  -- Resolve the conversation and the other person.
  if p_conversation_id is not null then
    v_conv := p_conversation_id;
    select state into v_my_state from public.conversation_members
    where conversation_id = v_conv and profile_id = v_uid;
    if v_my_state is null then
      raise exception 'conversation_not_found' using errcode = 'P0002';
    end if;
    select profile_id into v_other from public.conversation_members
    where conversation_id = v_conv and profile_id <> v_uid;
  else
    if p_to is null or p_to = v_uid then
      raise exception 'cannot_message' using errcode = '22023';
    end if;
    v_other := p_to;
    select c.id into v_conv from public.conversations c
    where c.pair_key = least(v_uid, v_other)::text || ':' || greatest(v_uid, v_other)::text;
    if v_conv is not null then
      select state into v_my_state from public.conversation_members
      where conversation_id = v_conv and profile_id = v_uid;
    end if;
  end if;

  if v_other is null
     or not exists (select 1 from public.profiles where id = v_other and onboarded_at is not null)
     or v_other in (select public.my_block_peers()) then
    raise exception 'cannot_message' using errcode = '42501';
  end if;

  if v_conv is null then
    -- New conversation.
    if (select count(*) from public.conversations
        where created_by = v_uid and created_at > now() - interval '24 hours') >= 20 then
      raise exception 'request_rate_limited' using errcode = 'P0001';
    end if;
    if public.are_connected(v_uid, v_other) then
      v_their_state := 'active';
    elsif (select dm_policy from public.profile_private where profile_id = v_other) = 'connections' then
      raise exception 'messages_closed' using errcode = '42501';
    else
      v_their_state := 'request';
    end if;
    insert into public.conversations (pair_key, created_by)
    values (least(v_uid, v_other)::text || ':' || greatest(v_uid, v_other)::text, v_uid)
    returning id into v_conv;
    insert into public.conversation_members (conversation_id, profile_id, state, last_read_at)
    values (v_conv, v_uid, 'active', now()), (v_conv, v_other, v_their_state, null);
  else
    select state into v_their_state from public.conversation_members
    where conversation_id = v_conv and profile_id = v_other;
    select created_by into v_creator from public.conversations where id = v_conv;

    -- Replying to (or messaging after declining) a request accepts it.
    if v_my_state in ('request', 'declined', 'hidden') then
      update public.conversation_members set state = 'active'
      where conversation_id = v_conv and profile_id = v_uid;
    end if;

    if v_their_state in ('request', 'declined') then
      -- Pending request from me: they may have since become a connection.
      if v_their_state = 'request' and public.are_connected(v_uid, v_other) then
        update public.conversation_members set state = 'active'
        where conversation_id = v_conv and profile_id = v_other;
      else
        -- One message until they accept. A decline looks exactly the same.
        raise exception 'awaiting_acceptance' using errcode = 'P0001';
      end if;
    elsif v_their_state = 'hidden' then
      update public.conversation_members set state = 'active'
      where conversation_id = v_conv and profile_id = v_other;
    end if;
  end if;

  insert into public.messages (conversation_id, sender_id, body, shared_post_id)
  values (v_conv, v_uid, v_body, p_shared_post_id);
  update public.conversations set last_message_at = now() where id = v_conv;
  update public.conversation_members set last_read_at = now()
  where conversation_id = v_conv and profile_id = v_uid;
  return v_conv;
end;
$$;

create function public.respond_to_message_request(p_conversation_id uuid, p_accept boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.conversation_members
  set state = case when p_accept then 'active' else 'declined' end
  where conversation_id = p_conversation_id and profile_id = auth.uid() and state = 'request';
  if not found then
    raise exception 'request_not_found' using errcode = 'P0002';
  end if;
end;
$$;

-- Remove from my inbox; it comes back if a new message arrives.
create function public.hide_conversation(p_conversation_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.conversation_members set state = 'hidden'
  where conversation_id = p_conversation_id and profile_id = auth.uid() and state = 'active'
$$;

create function public.mark_conversation_read(p_conversation_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.conversation_members set last_read_at = now()
  where conversation_id = p_conversation_id and profile_id = auth.uid() and state <> 'declined'
$$;

------------------------------------------------------------------------------
-- Reading
------------------------------------------------------------------------------

-- What the app may tell me before I message someone: 'existing' (open that
-- conversation), 'direct', 'request', or 'closed'. Never reveals a decline.
create function public.message_status(p_profile_id uuid)
returns table (status text, conversation_id uuid)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_conv uuid;
begin
  if p_profile_id = v_uid or p_profile_id in (select public.my_block_peers())
     or not exists (select 1 from public.profiles where id = p_profile_id and onboarded_at is not null) then
    return query select 'closed'::text, null::uuid;
    return;
  end if;
  select c.id into v_conv from public.conversations c
  where c.pair_key = least(v_uid, p_profile_id)::text || ':' || greatest(v_uid, p_profile_id)::text;
  if v_conv is not null then
    return query select 'existing'::text, v_conv;
  elsif public.are_connected(v_uid, p_profile_id) then
    return query select 'direct'::text, null::uuid;
  elsif (select dm_policy from public.profile_private where profile_id = p_profile_id) = 'connections' then
    return query select 'closed'::text, null::uuid;
  else
    return query select 'request'::text, null::uuid;
  end if;
end;
$$;

-- Inbox (p_requests = false) or Requests (true).
create function public.my_conversations(p_requests boolean default false)
returns table (
  conversation_id uuid,
  other_id uuid,
  other_handle text,
  other_display_name text,
  last_message text,
  last_message_at timestamptz,
  unread_count int,
  awaiting_reply boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    c.id,
    o.profile_id,
    p.handle,
    p.display_name,
    (select case when m.removed_at is not null then 'Message removed'
                 when m.body is not null then left(m.body, 140)
                 else 'Shared a post' end
     from public.messages m where m.conversation_id = c.id
     order by m.created_at desc, m.id desc limit 1),
    c.last_message_at,
    (select count(*)::int from public.messages m
     where m.conversation_id = c.id and m.sender_id <> auth.uid()
       and m.created_at > coalesce(me.last_read_at, '-infinity'::timestamptz)),
    -- I started it and they have not accepted (or declined: shown the same way).
    (c.created_by = auth.uid() and o.state in ('request', 'declined'))
  from public.conversation_members me
  join public.conversations c on c.id = me.conversation_id
  join public.conversation_members o on o.conversation_id = c.id and o.profile_id <> me.profile_id
  join public.profiles p on p.id = o.profile_id
  where me.profile_id = auth.uid()
    and me.state = case when p_requests then 'request' else 'active' end
    and o.profile_id not in (select public.my_block_peers())
  order by c.last_message_at desc
  limit 200
$$;

-- Messages newest first, keyset-paginated. Shared posts are included only
-- when the viewer may see them.
create function public.conversation_messages(
  p_conversation_id uuid,
  p_limit int default 50,
  p_before_created_at timestamptz default null,
  p_before_id uuid default null
)
returns table (
  id uuid,
  sender_id uuid,
  body text,
  created_at timestamptz,
  removed boolean,
  shared_post jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    m.id,
    m.sender_id,
    m.body,
    m.created_at,
    m.removed_at is not null,
    case
      when m.shared_post_id is null then null
      when public.can_view_post(m.shared_post_id) then (
        select jsonb_build_object(
          'id', sp.id,
          'caption', sp.caption,
          'author_handle', pr.handle,
          'media_path', (select pm.storage_path from public.post_media pm
                         where pm.post_id = sp.id order by pm.position limit 1))
        from public.posts sp join public.profiles pr on pr.id = sp.author_id
        where sp.id = m.shared_post_id)
      else jsonb_build_object('unavailable', true)
    end
  from public.messages m
  where m.conversation_id = p_conversation_id
    and public.my_conversation_state(p_conversation_id) is not null
    and public.conversation_peer(p_conversation_id) not in (select public.my_block_peers())
    and (p_before_created_at is null
         or (m.created_at, m.id) < (p_before_created_at, coalesce(p_before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
  order by m.created_at desc, m.id desc
  limit least(greatest(coalesce(p_limit, 50), 1), 100)
$$;

-- Header for one conversation.
create function public.conversation_summary(p_conversation_id uuid)
returns table (
  conversation_id uuid,
  other_id uuid,
  other_handle text,
  other_display_name text,
  my_state text,
  awaiting_reply boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, o.profile_id, p.handle, p.display_name, me.state,
         (c.created_by = auth.uid() and o.state in ('request', 'declined'))
  from public.conversations c
  join public.conversation_members me on me.conversation_id = c.id and me.profile_id = auth.uid()
  join public.conversation_members o on o.conversation_id = c.id and o.profile_id <> auth.uid()
  join public.profiles p on p.id = o.profile_id
  where c.id = p_conversation_id
    and me.state <> 'declined'
    and o.profile_id not in (select public.my_block_peers())
$$;

revoke execute on function public.set_dm_policy(text) from public, anon;
revoke execute on function public.send_message(uuid, uuid, text, uuid) from public, anon;
revoke execute on function public.respond_to_message_request(uuid, boolean) from public, anon;
revoke execute on function public.hide_conversation(uuid) from public, anon;
revoke execute on function public.mark_conversation_read(uuid) from public, anon;
revoke execute on function public.message_status(uuid) from public, anon;
revoke execute on function public.my_conversations(boolean) from public, anon;
revoke execute on function public.conversation_messages(uuid, int, timestamptz, uuid) from public, anon;
revoke execute on function public.conversation_summary(uuid) from public, anon;
grant execute on function public.set_dm_policy(text) to authenticated;
grant execute on function public.send_message(uuid, uuid, text, uuid) to authenticated;
grant execute on function public.respond_to_message_request(uuid, boolean) to authenticated;
grant execute on function public.hide_conversation(uuid) to authenticated;
grant execute on function public.mark_conversation_read(uuid) to authenticated;
grant execute on function public.message_status(uuid) to authenticated;
grant execute on function public.my_conversations(boolean) to authenticated;
grant execute on function public.conversation_messages(uuid, int, timestamptz, uuid) to authenticated;
grant execute on function public.conversation_summary(uuid) to authenticated;

------------------------------------------------------------------------------
-- Reporting messages
------------------------------------------------------------------------------

alter table public.reports drop constraint reports_target_type_check;
alter table public.reports add constraint reports_target_type_check
  check (target_type in ('post', 'profile', 'group', 'message'));
alter table public.reports add column snapshot jsonb;

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
      -- Reporting a private message shares that one message with reviewers.
      case when p_target_type = 'message' then (
        select jsonb_build_object('body', m.body, 'shared_post_id', m.shared_post_id,
                                  'sender_id', m.sender_id, 'conversation_id', m.conversation_id,
                                  'sent_at', m.created_at)
        from public.messages m where m.id = p_target_id) end
    );
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

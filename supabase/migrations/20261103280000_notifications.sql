-- Push notifications via an outbox.
--
-- Triggers write rows to public.notifications; the deliver-notifications Edge
-- Function claims them, sends them through Expo's push service and marks them
-- sent. Keeping the "who gets notified" rules in SQL makes them testable.
--
-- Privacy: notifications carry no message text, only who and what kind.
-- While one notification for a conversation/group is still unsent, further
-- events of the same kind do not add more.

------------------------------------------------------------------------------
-- Preferences and device tokens
------------------------------------------------------------------------------

alter table public.profile_private
  add column notify_messages boolean not null default true,
  add column notify_groups boolean not null default true;

create function public.set_notification_preferences(p_messages boolean, p_groups boolean)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.profile_private
  set notify_messages = coalesce(p_messages, notify_messages),
      notify_groups = coalesce(p_groups, notify_groups)
  where profile_id = auth.uid()
$$;

create table public.push_tokens (
  token text primary key check (token ~ '^Expo(nent)?PushToken\[[A-Za-z0-9_-]{8,}\]$'),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  platform text not null check (platform in ('ios', 'android')),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index push_tokens_profile_idx on public.push_tokens (profile_id);

-- Tokens are never readable by clients.
alter table public.push_tokens enable row level security;
revoke all on public.push_tokens from anon, authenticated;

-- A device belongs to whoever signed in on it last.
create function public.register_push_token(p_token text, p_platform text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  begin
    insert into public.push_tokens (token, profile_id, platform)
    values (p_token, auth.uid(), p_platform)
    on conflict (token) do update
      set profile_id = excluded.profile_id, platform = excluded.platform, last_seen_at = now();
  exception when check_violation then
    raise exception 'invalid_push_token' using errcode = '22023';
  end;
end;
$$;

create function public.unregister_push_token(p_token text)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.push_tokens where token = p_token and profile_id = auth.uid()
$$;

revoke execute on function public.set_notification_preferences(boolean, boolean) from public, anon;
revoke execute on function public.register_push_token(text, text) from public, anon;
revoke execute on function public.unregister_push_token(text) from public, anon;
grant execute on function public.set_notification_preferences(boolean, boolean) to authenticated;
grant execute on function public.register_push_token(text, text) to authenticated;
grant execute on function public.unregister_push_token(text) to authenticated;

------------------------------------------------------------------------------
-- Outbox
------------------------------------------------------------------------------

create table public.notifications (
  id bigint generated always as identity primary key,
  recipient_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('message', 'message_request', 'group_join_request', 'group_join_approved')),
  actor_id uuid references public.profiles (id) on delete cascade,
  conversation_id uuid references public.conversations (id) on delete cascade,
  group_id uuid references public.groups (id) on delete cascade,
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  sent_at timestamptz
);
create index notifications_pending_idx on public.notifications (id) where sent_at is null;
-- One pending notification per recipient + kind + conversation (or group).
create unique index notifications_pending_conversation
  on public.notifications (recipient_id, kind, conversation_id)
  where sent_at is null and conversation_id is not null;
create unique index notifications_pending_group
  on public.notifications (recipient_id, kind, group_id)
  where sent_at is null and group_id is not null;

alter table public.notifications enable row level security;
revoke all on public.notifications from anon, authenticated;

------------------------------------------------------------------------------
-- Triggers
------------------------------------------------------------------------------

create function public.notify_on_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_recipient uuid;
  v_state text;
begin
  select cm.profile_id, cm.state into v_recipient, v_state
  from public.conversation_members cm
  where cm.conversation_id = new.conversation_id and cm.profile_id <> new.sender_id;

  if v_recipient is null or v_state = 'declined'
     or not coalesce((select notify_messages from public.profile_private where profile_id = v_recipient), false)
     or exists (select 1 from public.blocks
                where (blocker_id = v_recipient and blocked_id = new.sender_id)
                   or (blocker_id = new.sender_id and blocked_id = v_recipient)) then
    return new;
  end if;

  insert into public.notifications (recipient_id, kind, actor_id, conversation_id)
  values (v_recipient, case when v_state = 'request' then 'message_request' else 'message' end,
          new.sender_id, new.conversation_id)
  on conflict (recipient_id, kind, conversation_id) where sent_at is null and conversation_id is not null
  do nothing;
  return new;
end;
$$;

create trigger messages_notify
  after insert on public.messages
  for each row execute function public.notify_on_message();

create function public.notify_on_group_membership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' and new.status = 'pending' then
    -- Tell the group's owner and moderators someone asked to join.
    insert into public.notifications (recipient_id, kind, actor_id, group_id)
    select gm.profile_id, 'group_join_request', new.profile_id, new.group_id
    from public.group_members gm
    join public.profile_private pp on pp.profile_id = gm.profile_id
    where gm.group_id = new.group_id and gm.status = 'active'
      and gm.role in ('owner', 'moderator') and pp.notify_groups
    on conflict (recipient_id, kind, group_id) where sent_at is null and group_id is not null
    do nothing;
  elsif tg_op = 'UPDATE' and old.status = 'pending' and new.status = 'active' then
    if coalesce((select notify_groups from public.profile_private where profile_id = new.profile_id), false) then
      insert into public.notifications (recipient_id, kind, group_id)
      values (new.profile_id, 'group_join_approved', new.group_id)
      on conflict (recipient_id, kind, group_id) where sent_at is null and group_id is not null
      do nothing;
    end if;
  end if;
  return new;
end;
$$;

create trigger group_members_notify
  after insert or update of status on public.group_members
  for each row execute function public.notify_on_group_membership();

revoke execute on function public.notify_on_message() from public, anon, authenticated;
revoke execute on function public.notify_on_group_membership() from public, anon, authenticated;

------------------------------------------------------------------------------
-- Delivery (service role only)
------------------------------------------------------------------------------

-- Claim up to p_limit pending notifications (a claim expires after 5 minutes,
-- so a crashed run is retried) and return what the sender needs: kind, who,
-- where to open, and the recipient's device tokens.
create function public.claim_notifications(p_limit int default 100)
returns table (
  id bigint,
  kind text,
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
  select c.id, c.kind, a.display_name, g.name, c.conversation_id, c.group_id,
         coalesce((select array_agg(t.token order by t.last_seen_at desc)
                   from public.push_tokens t where t.profile_id = c.recipient_id), '{}')
  from claimed c
  left join public.profiles a on a.id = c.actor_id
  left join public.groups g on g.id = c.group_id
  order by c.id
$$;

create function public.mark_notifications_sent(p_ids bigint[])
returns void
language sql
security definer
set search_path = ''
as $$
  update public.notifications set sent_at = now() where id = any (p_ids) and sent_at is null;
  -- Keep the outbox small: sent rows older than a week are no longer useful.
  delete from public.notifications where sent_at < now() - interval '7 days';
$$;

create function public.drop_push_tokens(p_tokens text[])
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.push_tokens where token = any (p_tokens)
$$;

revoke execute on function public.claim_notifications(int) from public, anon, authenticated;
revoke execute on function public.mark_notifications_sent(bigint[]) from public, anon, authenticated;
revoke execute on function public.drop_push_tokens(text[]) from public, anon, authenticated;
grant execute on function public.claim_notifications(int) to service_role;
grant execute on function public.mark_notifications_sent(bigint[]) to service_role;
grant execute on function public.drop_push_tokens(text[]) to service_role;
